// Package cp retrieves a credential from a locally-installed CyberArk Credential
// Provider (CP) via a small HTTP bridge running on the host. Unlike the Central
// Credential Provider (CCP, package ccp), the CP is an agent installed ON the
// host and is queried through a native SDK — here the Java JavaPasswordSDK. The
// CP authenticates the CALLING APPLICATION by its characteristics (application
// HASH, path, OS user) rather than a client certificate, then authorizes that
// application's access to the requested Safe.
//
// The webapp runs in a container and cannot load the host's SDK directly, so it
// POSTs a scenario to the host bridge (see hostbridge/cp). The bridge invokes the
// appropriate Java caller — a jar whose registered hash IS the auth factor — and
// returns non-secret metadata plus the retrieved secret's LENGTH, SHA-256, and a
// short leading preview (never the full value). This retriever maps that into a
// masked Result.
//
// It exposes four didactic scenarios (see Scenario) mirroring the CCP set, with
// the client certificate swapped for the application hash:
//   - authorized:   registered caller hash + an authorized Safe          -> success
//   - invalid-hash: an UNregistered caller hash (a different jar)         -> authn deny
//   - denied:       registered caller hash but a Safe it may not read     -> authz deny
//   - dual:         registered caller hash, dual-account query            -> active account
package cp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/strick-j/swa-demo/webapp/internal/retrieve"
)

// Scenario selects one of the four CP use cases.
type Scenario string

const (
	// Authorized: a caller whose hash IS registered on the App, reading a Safe the
	// App may access -> success.
	Authorized Scenario = "authorized"
	// InvalidHash: a caller whose hash is NOT registered on the App (a different
	// jar) -> rejected at the application-authentication layer.
	InvalidHash Scenario = "invalid-hash"
	// Denied: a registered caller reading a Safe the App may NOT access ->
	// rejected at the authorization layer.
	Denied Scenario = "denied"
	// Dual: a registered caller querying a dual-account pair -> returns the ACTIVE
	// account (zero-downtime rotation model).
	Dual Scenario = "dual"
)

// Scenarios returns the ordered scenario list for the UI.
func Scenarios() []Scenario { return []Scenario{Authorized, InvalidHash, Denied, Dual} }

func valid(s Scenario) bool {
	switch s {
	case Authorized, InvalidHash, Denied, Dual:
		return true
	}
	return false
}

// Config is the CP bridge wiring. When BridgeURL is empty (or Live is false) the
// retriever runs in an unconfigured state and every scenario returns an explicit
// "CP bridge not configured" error rather than a synthesized success — this mode
// is live-only by design (the credential really comes from the host CP).
type Config struct {
	BridgeURL string // e.g. http://host.minikube.internal:8890 (the host cp-bridge)
	AppID     string // the CP Application id (display; the bridge is the source of truth)
	Live      bool   // false forces the not-configured error path
}

// Client runs CP scenarios against the host bridge.
type Client struct {
	cfg  Config
	http *http.Client
}

// New builds the Client. It never fails: an unconfigured client simply reports
// the not-configured error on Run.
func New(cfg Config) *Client {
	return &Client{
		cfg: cfg,
		// JVM cold-start on the host per call is ~1s; give the bridge headroom.
		http: &http.Client{Timeout: 20 * time.Second},
	}
}

// Mode implements retrieve.Retriever so the registry marks CP available and the
// landing card links to it. The page drives individual scenarios via Run.
func (c *Client) Mode() string { return "cp" }

// Retrieve implements retrieve.Retriever with the authorized happy path.
func (c *Client) Retrieve(ctx context.Context) retrieve.Result { return c.Run(ctx, Authorized) }

// AppID returns the configured CP Application id (for page display).
func (c *Client) AppID() string { return c.cfg.AppID }

// Live reports whether a bridge is configured; when false every Run returns the
// not-configured error.
func (c *Client) Live() bool { return c.cfg.Live && c.cfg.BridgeURL != "" }

// bridgeResponse is the JSON contract emitted by the host cp-bridge (which in
// turn relays the Java caller's output). It carries only non-secret metadata plus
// the retrieved secret's LENGTH, SHA-256, and a short preview — never the full value.
type bridgeResponse struct {
	OK              bool   `json:"ok"`
	AppID           string `json:"app_id"`
	AppHash         string `json:"app_hash"`         // short prefix of the caller hash the CP authenticated
	CallerPath      string `json:"caller_path"`      // path of the calling jar
	OSUser          string `json:"os_user"`          // OS user the caller ran as
	Safe            string `json:"safe"`             // safe queried
	Query           string `json:"query"`            // object name or dual-account query
	Account         string `json:"account"`          // returned account UserName (NOT the secret)
	Address         string `json:"address"`          // returned account Address/target
	VirtualUsername string `json:"virtual_username"` // dual-account fronting identity
	DualActive      string `json:"dual_active"`      // active account of the dual pair
	ContentLen      int    `json:"content_len"`      // length of the retrieved secret (hashed on the host)
	ContentSHA256   string `json:"content_sha256"`   // hex SHA-256 of the retrieved secret
	ContentPrefix   string `json:"content_prefix"`   // first few chars of the secret (matched by eye vs the Vault)
	ErrorCode       string `json:"error_code"`       // CyberArk error code on denial (e.g. APPAP008E)
	Error           string `json:"error"`            // human-readable error/denial message
}

// Run executes one scenario against the host bridge and returns a masked Result.
func (c *Client) Run(ctx context.Context, s Scenario) retrieve.Result {
	if !valid(s) {
		return retrieve.Result{Family: retrieve.FamilyCredentialProviders, Mode: "cp", Error: "unknown scenario: " + string(s)}
	}
	res := c.base(s)
	t0 := time.Now()

	if !c.Live() {
		res.Error = "CP bridge not configured (set CP_BRIDGE_URL); this mode is live-only — the credential is served by the host Credential Provider."
		res.Steps = stepsAt(t0, s, 0, res.Error)
		return res
	}

	br, err := c.call(ctx, s)
	if err != nil {
		res.Error = "cp-bridge unreachable: " + cleanErr(err.Error())
		res.Steps = stepsAt(t0, s, 0, res.Error)
		return res
	}

	res.CP = &retrieve.CPInfo{
		AppID:      firstNonEmpty(br.AppID, c.cfg.AppID),
		AppHash:    br.AppHash,
		CallerPath: br.CallerPath,
		OSUser:     br.OSUser,
		Safe:       br.Safe,
		Query:      br.Query,
	}
	res.Identity = callerIdentity(br)

	if !br.OK {
		msg := br.Error
		if br.ErrorCode != "" {
			msg = br.ErrorCode + ": " + br.Error
		}
		if msg == "" {
			msg = "retrieval denied"
		}
		// invalid-hash fails at the application-authentication step; denied fails at
		// the safe-authorization step. Mark the right step in the lifecycle.
		failStep := 2
		if s == InvalidHash {
			failStep = 1
		}
		log.Printf("cp %s denied: code=%s", s, br.ErrorCode)
		res.Error = msg
		res.Steps = stepsAt(t0, s, failStep, msg)
		return res
	}

	res.CP.Account = br.Account
	res.CP.Address = br.Address
	if s == Dual {
		res.CP.VirtualUsername = br.VirtualUsername
		res.CP.DualActive = br.DualActive
	}
	res.SecretName = secretName(br.Safe, br.Query)
	res.Masked = retrieve.MaskSummary(br.ContentLen, br.ContentSHA256, br.ContentPrefix)
	res.Retrieved = true
	res.Steps = okSteps(t0, s)
	return res
}

// call POSTs the scenario to the host bridge and decodes its JSON response. A
// non-2xx with a decodable body is still returned (the body carries the CP
// denial); only transport/decoding failures surface as an error.
func (c *Client) call(ctx context.Context, s Scenario) (bridgeResponse, error) {
	endpoint := strings.TrimRight(c.cfg.BridgeURL, "/") + "/cp?" + url.Values{"scenario": {string(s)}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
	if err != nil {
		return bridgeResponse{}, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return bridgeResponse{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	var br bridgeResponse
	if err := json.Unmarshal(body, &br); err != nil {
		return bridgeResponse{}, fmt.Errorf("bridge returned HTTP %d: %s", resp.StatusCode, cleanErr(string(body)))
	}
	return br, nil
}

func (c *Client) base(s Scenario) retrieve.Result {
	return retrieve.Result{
		Family:     retrieve.FamilyCredentialProviders,
		Mode:       "cp",
		ModeLabel:  "Credential Provider · " + label(s),
		AuthMethod: "application hash (JavaPasswordSDK)",
	}
}

// callerIdentity renders who the CP authenticated: the app id plus a short hash.
func callerIdentity(br bridgeResponse) string {
	id := br.AppID
	if br.AppHash != "" {
		id += " (hash " + br.AppHash + ")"
	}
	return id
}

func secretName(safe, query string) string {
	if safe != "" && query != "" {
		return safe + " / " + query
	}
	return firstNonEmpty(safe, query)
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// cleanErr collapses an error/body string to a single bounded line for display.
func cleanErr(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 300 {
		return s[:300] + "…"
	}
	return s
}
