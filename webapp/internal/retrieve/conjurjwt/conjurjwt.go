// Package conjurjwt retrieves a secret from Conjur Cloud (Secrets Manager SaaS)
// using authn-jwt: the workload presents a JWT-SVID, Conjur validates it against
// the configured JWKS/issuer and maps its claims to a Conjur host, returns a
// short-lived access token, and the app reads a variable with it. Only a masked
// proof-of-retrieval is surfaced — never the raw secret.
package conjurjwt

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/strick-j/swa-demo/webapp/internal/retrieve"
	"github.com/strick-j/swa-demo/webapp/internal/svid"
)

// Config is the Conjur authn-jwt wiring. When ApplianceURL, ServiceID, or
// SecretPath are empty the retriever runs in simulated mode.
type Config struct {
	ApplianceURL string // e.g. https://<tenant>.secretsmgr.cyberark.cloud/api
	Account      string // e.g. conjur
	ServiceID    string // authenticator path, e.g. authn-jwt/swa
	SecretPath   string // variable id, e.g. data/secrets/demo-db-password
	Audience     string // JWT audience, e.g. conjur
}

func (c Config) complete() bool {
	return c.ApplianceURL != "" && c.Account != "" && c.ServiceID != "" && c.SecretPath != ""
}

// JWTProvider returns a freshly minted JWT for the given audience plus the
// workload's SPIFFE ID. Wired in main to the SWA Agent Workload API.
type JWTProvider func(ctx context.Context, audience string) (token, spiffeID string, err error)

// Retriever implements retrieve.Retriever for Conjur authn-jwt.
type Retriever struct {
	cfg  Config
	jwt  JWTProvider
	http *http.Client
}

// New builds the retriever. jwt may be nil (forces simulated mode).
func New(cfg Config, jwt JWTProvider) *Retriever {
	if cfg.Audience == "" {
		cfg.Audience = "conjur"
	}
	return &Retriever{cfg: cfg, jwt: jwt, http: &http.Client{Timeout: 12 * time.Second}}
}

// Mode implements retrieve.Retriever.
func (r *Retriever) Mode() string { return "conjur-jwt" }

func (r *Retriever) base() retrieve.Result {
	return retrieve.Result{
		Family:     retrieve.FamilySecretsManager,
		Mode:       "conjur-jwt",
		ModeLabel:  "Conjur · JWT auth",
		AuthMethod: "authn-jwt",
		SecretName: r.cfg.SecretPath,
	}
}

// Retrieve runs the authn-jwt flow (or synthesizes it when unconfigured).
func (r *Retriever) Retrieve(ctx context.Context) retrieve.Result {
	if r.jwt == nil || !r.cfg.complete() {
		return r.simulate()
	}

	res := r.base()
	t0 := time.Now()

	// 1) Mint the workload JWT-SVID.
	token, spiffeID, err := r.jwt(ctx, r.cfg.Audience)
	if err != nil {
		res.Steps = stepsThrough(t0, 0, "fetch jwt-svid: "+err.Error())
		res.Error = "fetch jwt-svid: " + err.Error()
		return res
	}
	res.Identity = spiffeID

	// 2) Exchange it for a Conjur access token via authn-jwt.
	accessToken, err := r.authenticate(ctx, token)
	if err != nil {
		res.Steps = stepsThrough(t0, 1, err.Error())
		res.Error = err.Error()
		return res
	}

	// 3) Read the variable with the access token.
	secret, err := r.readSecret(ctx, accessToken)
	if err != nil {
		res.Steps = stepsThrough(t0, 2, err.Error())
		res.Error = err.Error()
		return res
	}

	// 4) Mask immediately — the raw value is discarded here.
	res.Masked = retrieve.Mask(secret)
	res.Retrieved = true
	res.Steps = okSteps(t0, r.cfg)
	return res
}

// authenticate POSTs the JWT to authn-jwt and returns the Conjur access token
// (already base64, ready for the Authorization header).
func (r *Retriever) authenticate(ctx context.Context, jwt string) (string, error) {
	endpoint := strings.TrimRight(r.cfg.ApplianceURL, "/") + "/" +
		strings.Trim(r.cfg.ServiceID, "/") + "/" + url.PathEscape(r.cfg.Account) + "/authenticate"

	body := strings.NewReader("jwt=" + url.QueryEscape(jwt))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return "", fmt.Errorf("authn-jwt request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	// base64 so the response is header-ready (Token token="<base64>").
	req.Header.Set("Accept-Encoding", "base64")

	resp, err := r.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("authn-jwt: %w", err)
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("authn-jwt rejected (status %d)", resp.StatusCode)
	}
	tok := strings.TrimSpace(string(payload))
	if tok == "" {
		return "", fmt.Errorf("authn-jwt returned an empty token")
	}
	return tok, nil
}

// readSecret GETs the variable using the Conjur access token.
func (r *Retriever) readSecret(ctx context.Context, accessToken string) ([]byte, error) {
	endpoint := strings.TrimRight(r.cfg.ApplianceURL, "/") + "/secrets/" +
		url.PathEscape(r.cfg.Account) + "/variable/" + url.PathEscape(r.cfg.SecretPath)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("read secret request: %w", err)
	}
	req.Header.Set("Authorization", `Token token="`+accessToken+`"`)

	resp, err := r.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("read secret: %w", err)
	}
	defer resp.Body.Close()
	val, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("read secret denied (status %d)", resp.StatusCode)
	}
	return val, nil
}

// simulate returns an illustrative success when no live Conjur is configured.
func (r *Retriever) simulate() retrieve.Result {
	res := r.base()
	if res.SecretName == "" {
		res.SecretName = "data/secrets/demo-db-password"
	}
	res.Identity = "spiffe://swa-demo.example.com/minikube-nodes/ns/swa-demo/sa/swa-demo-webapp"
	res.Masked = retrieve.Mask([]byte("s1mul4ted-demo-secret-value"))
	res.Retrieved = true
	res.Simulated = true
	res.Steps = okSteps(time.Now(), r.cfg)
	return res
}

func okSteps(t0 time.Time, cfg Config) []svid.Step {
	svc := cfg.ServiceID
	if svc == "" {
		svc = "authn-jwt/<service>"
	}
	path := cfg.SecretPath
	if path == "" {
		path = "data/secrets/demo-db-password"
	}
	ms := t0.UnixMilli()
	return []svid.Step{
		{Name: "Mint workload JWT", Detail: "The app requests a short-lived JWT-SVID (audience conjur) from the SWA Agent — it holds no Conjur API key.", Meta: "aud=conjur · jwt-svid", Status: "ok", AtMillis: ms},
		{Name: "authn-jwt", Detail: "It presents the JWT to Conjur " + svc + ". Conjur validates it against the configured JWKS/issuer and maps the claims to a Conjur host.", Meta: svc, Status: "ok", AtMillis: ms + 18},
		{Name: "Conjur access token", Detail: "Conjur returns a short-lived access token bound to that host's permissions.", Meta: "Token token=\"…\"", Status: "ok", AtMillis: ms + 30},
		{Name: "Read variable", Detail: "The app reads " + path + " over the Conjur API and masks it immediately — never written to disk.", Meta: path, Status: "ok", AtMillis: ms + 44},
	}
}

// stepsThrough returns the okSteps with the step at failIdx (and beyond) marked
// failed, carrying the error on the failing step.
func stepsThrough(t0 time.Time, failIdx int, errMsg string) []svid.Step {
	steps := okSteps(t0, Config{})
	for i := range steps {
		if i == failIdx {
			steps[i].Status = "error"
			steps[i].Meta = errMsg
		} else if i > failIdx {
			steps[i].Status = "pending"
		}
	}
	return steps
}
