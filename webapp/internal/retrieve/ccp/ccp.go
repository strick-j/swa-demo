// Package ccp retrieves a credential from the CyberArk Central Credential
// Provider (CCP) over its AIMWebService REST API. The app authenticates with a
// client certificate (mTLS); CCP authenticates the certificate to an Application
// identity, authorizes that application's access to the requested Safe, and
// returns the account. Only a masked proof-of-retrieval is surfaced — never the
// raw credential.
//
// It exposes four didactic scenarios (see Scenario) covering the auth and authz
// boundaries plus the dual-account (zero-downtime rotation) model. When the CCP
// host / app id / client cert are not configured, every scenario is simulated.
package ccp

import (
	"context"
	"crypto/tls"
	"crypto/x509"
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

// Scenario selects one of the four CCP use cases.
type Scenario string

const (
	// Authorized: valid client cert + a Safe the application may read -> success.
	Authorized Scenario = "authorized"
	// NoCert: no client certificate presented -> rejected at the auth layer.
	NoCert Scenario = "no-cert"
	// Denied: valid client cert but a Safe the application may NOT read ->
	// rejected at the authorization layer.
	Denied Scenario = "denied"
	// Dual: valid client cert, query a dual-account pair by custom property ->
	// returns the ACTIVE account (zero-downtime rotation model).
	Dual Scenario = "dual"
)

// Scenarios returns the ordered scenario list for the UI.
func Scenarios() []Scenario { return []Scenario{Authorized, NoCert, Denied, Dual} }

func valid(s Scenario) bool {
	switch s {
	case Authorized, NoCert, Denied, Dual:
		return true
	}
	return false
}

// Config is the CCP / AIMWebService wiring. When BaseURL, AppID, or the client
// cert/key are empty (or Live is false), all scenarios are simulated.
type Config struct {
	BaseURL            string // e.g. https://<ccp-host> (AIMWebService listens here)
	AppID              string // the CCP Application id
	Safe               string // a safe the app IS authorized for (Authorized/NoCert)
	Object             string // object name in that safe
	DeniedSafe         string // a safe the app is NOT authorized for (Denied)
	DeniedObject       string // object name in the denied safe
	DualQuery          string // custom-property query for the dual-account pair (Dual)
	CertFile           string // client cert PEM (mTLS) presented to CCP
	KeyFile            string // client key PEM
	InsecureSkipVerify bool   // skip CCP server cert verification (self-signed/demo)
	Live               bool   // false forces simulated mode
}

func (c Config) complete() bool {
	return c.BaseURL != "" && c.AppID != "" && c.CertFile != "" && c.KeyFile != ""
}

// Client runs CCP scenarios. It holds two HTTP clients: one that presents the
// client certificate and one that does not (for the NoCert scenario).
type Client struct {
	cfg      Config
	certCN   string
	withCert *http.Client
	noCert   *http.Client
}

// New builds the Client. When live config + cert are present it loads the client
// certificate; otherwise the client runs simulated (New still succeeds).
func New(cfg Config) (*Client, error) {
	c := &Client{cfg: cfg}
	c.noCert = httpClient(&tls.Config{InsecureSkipVerify: cfg.InsecureSkipVerify}) //nolint:gosec // demo: internal/self-signed CCP cert
	if cfg.Live && cfg.CertFile != "" && cfg.KeyFile != "" {
		cert, err := tls.LoadX509KeyPair(cfg.CertFile, cfg.KeyFile)
		if err != nil {
			return nil, fmt.Errorf("load CCP client cert: %w", err)
		}
		c.certCN = leafCN(cert)
		clientCert := cert
		c.withCert = httpClient(&tls.Config{
			// Present the cert UNCONDITIONALLY. With Certificates alone, Go only
			// sends the cert when it matches the server's advertised acceptable
			// CAs — a self-signed client cert usually doesn't, so Go would send
			// an empty cert and CCP cert-auth would fail. GetClientCertificate
			// forces it (the equivalent of PowerShell Invoke-RestMethod -Certificate).
			GetClientCertificate: func(*tls.CertificateRequestInfo) (*tls.Certificate, error) {
				return &clientCert, nil
			},
			InsecureSkipVerify: cfg.InsecureSkipVerify, //nolint:gosec // demo only
		})
	}
	return c, nil
}

// httpClient builds an HTTP/1.1-only client with the given TLS config.
// AIMWebService is HTTP/1.1, so we must NOT offer HTTP/2 (ALPN h2): some IIS /
// load-balancer / WAF tiers in front of CCP reset the connection mid-handshake
// on the h2 offer — the classic "works with curl, Go gets 'connection reset by
// peer'" symptom. ForceAttemptHTTP2=false + an empty TLSNextProto disable h2.
func httpClient(tlsCfg *tls.Config) *http.Client {
	return &http.Client{
		Timeout: 12 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig:   tlsCfg,
			ForceAttemptHTTP2: false,
			TLSNextProto:      map[string]func(string, *tls.Conn) http.RoundTripper{},
		},
	}
}

// Mode implements retrieve.Retriever so the registry marks CCP available and the
// landing card links to it. The page drives individual scenarios via Run.
func (c *Client) Mode() string { return "ccp" }

// Retrieve implements retrieve.Retriever with the authorized happy path.
func (c *Client) Retrieve(ctx context.Context) retrieve.Result { return c.Run(ctx, Authorized) }

// CertCN returns the client-cert CN that will be presented (empty if simulated).
func (c *Client) CertCN() string { return c.certCN }

// AppID returns the configured CCP Application id (for page display).
func (c *Client) AppID() string { return c.cfg.AppID }

// Simulated reports whether Run will synthesize results (no live CCP/cert).
func (c *Client) Simulated() bool { return !c.cfg.Live || !c.cfg.complete() || c.withCert == nil }

// Run executes one scenario and returns a masked Result.
func (c *Client) Run(ctx context.Context, s Scenario) retrieve.Result {
	if !valid(s) {
		return retrieve.Result{Family: retrieve.FamilyCredentialProviders, Mode: "ccp", Error: "unknown scenario: " + string(s)}
	}
	if c.Simulated() {
		return c.simulate(s)
	}
	switch s {
	case Authorized:
		return c.fetch(ctx, s, c.withCert, c.cfg.Safe, c.cfg.Object, "")
	case Denied:
		return c.fetch(ctx, s, c.withCert, c.cfg.DeniedSafe, c.cfg.DeniedObject, "")
	case Dual:
		return c.fetch(ctx, s, c.withCert, "", "", c.cfg.DualQuery)
	case NoCert:
		return c.fetch(ctx, s, c.noCert, c.cfg.Safe, c.cfg.Object, "")
	}
	return c.simulate(s)
}

// aimResponse is the AIMWebService JSON for both success and error bodies.
type aimResponse struct {
	Content           string `json:"Content"`
	UserName          string `json:"UserName"`
	Address           string `json:"Address"`
	Name              string `json:"Name"`
	VirtualUsername   string `json:"VirtualUsername"`   // dual-account fronting identity
	DualAccountStatus string `json:"DualAccountStatus"` // Active / Inactive
	Index             string `json:"Index"`             // which account of the pair
	ErrorCode         string `json:"ErrorCode"`
	ErrorMsg          string `json:"ErrorMsg"`
}

// fetch performs one AIMWebService GET and maps the outcome to a Result. For the
// NoCert/Denied scenarios a failure IS the expected demonstration.
func (c *Client) fetch(ctx context.Context, s Scenario, client *http.Client, safe, object, query string) retrieve.Result {
	res := c.base(s)
	cn := c.certCN
	if s == NoCert {
		cn = "" // deliberately present no certificate
	}
	res.CCP = &retrieve.CCPInfo{AppID: c.cfg.AppID, CertCN: cn, Safe: safe, Query: firstNonEmpty(query, object)}
	t0 := time.Now()

	endpoint := strings.TrimRight(c.cfg.BaseURL, "/") + "/AIMWebService/api/Accounts"
	q := url.Values{"AppID": {c.cfg.AppID}}
	switch {
	case query != "":
		q.Set("Query", query)
		q.Set("QueryFormat", "Exact")
	default:
		q.Set("Safe", safe)
		q.Set("Object", object)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+q.Encode(), nil)
	if err != nil {
		res.Error = "build request: " + err.Error()
		res.Steps = stepsAt(t0, s, 0, res.Error)
		return res
	}

	resp, err := client.Do(req)
	if err != nil {
		// A required-client-cert AIMWebService rejects the NoCert call during the
		// TLS handshake — that surfaces here as a transport error (expected).
		res.Error = "AIMWebService unreachable / TLS rejected: " + cleanErr(err.Error())
		res.Steps = stepsAt(t0, s, 1, res.Error)
		return res
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	var ar aimResponse
	_ = json.Unmarshal(body, &ar)

	if resp.StatusCode != http.StatusOK {
		msg := ar.ErrorMsg
		if ar.ErrorCode != "" {
			msg = ar.ErrorCode + ": " + ar.ErrorMsg
		}
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, cleanErr(string(body)))
		}
		// Authn failures (no/invalid cert) are a 403 at the auth layer; safe-access
		// failures are a 403 at the authorization layer — mark the right step.
		failStep := 2
		if s == NoCert {
			failStep = 1
		}
		log.Printf("ccp %s denied: status=%d code=%s", s, resp.StatusCode, ar.ErrorCode)
		res.Error = msg
		res.Steps = stepsAt(t0, s, failStep, msg)
		return res
	}

	res.CCP.Account = ar.UserName
	res.CCP.Address = ar.Address
	if s == Dual {
		res.CCP.VirtualUsername = ar.VirtualUsername
		res.CCP.DualActive = dualActive(ar.UserName, ar.Name, ar.DualAccountStatus, ar.Index)
	}
	res.SecretName = secretName(safe, object, query)
	res.Masked = retrieve.Mask([]byte(ar.Content))
	res.Retrieved = true
	res.Steps = okSteps(t0, s)
	return res
}

func (c *Client) base(s Scenario) retrieve.Result {
	return retrieve.Result{
		Family:     retrieve.FamilyCredentialProviders,
		Mode:       "ccp",
		ModeLabel:  "Central Credential Provider · " + label(s),
		AuthMethod: "client-cert (AIMWebService)",
		Identity:   c.certCN,
	}
}

func leafCN(cert tls.Certificate) string {
	leaf := cert.Leaf
	if leaf == nil && len(cert.Certificate) > 0 {
		leaf, _ = x509.ParseCertificate(cert.Certificate[0])
	}
	if leaf != nil {
		return leaf.Subject.CommonName
	}
	return ""
}

func secretName(safe, object, query string) string {
	if query != "" {
		return "Query: " + query
	}
	if safe != "" {
		return safe + "/" + object
	}
	return object
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// dualActive describes which account of a dual pair resolved, e.g.
// "admin1 (Active, index 1)".
func dualActive(user, name, status, index string) string {
	active := firstNonEmpty(user, name)
	if status != "" {
		active += " (" + status
		if index != "" {
			active += ", index " + index
		}
		active += ")"
	}
	return active
}

// cleanErr collapses an error/body string to a single bounded line for display.
func cleanErr(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 300 {
		return s[:300] + "…"
	}
	return s
}
