// Package handlers wires the HTTP layer to a svid.Fetcher. It depends only on the
// svid interface, so it is fully testable without a live SWA Agent.
package handlers

import (
	"context"
	"encoding/json"
	"html/template"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/strick-j/swa-demo/webapp/internal/db"
	"github.com/strick-j/swa-demo/webapp/internal/foreign"
	"github.com/strick-j/swa-demo/webapp/internal/i18n"
	"github.com/strick-j/swa-demo/webapp/internal/retrieve"
	"github.com/strick-j/swa-demo/webapp/internal/retrieve/ccp"
	"github.com/strick-j/swa-demo/webapp/internal/retrieve/cp"
	"github.com/strick-j/swa-demo/webapp/internal/svid"
)

// DBQuerier reads the demo data through the SPIFFE gateway using this pod's
// X.509-SVID. nil when there is no live agent (demo mode).
type DBQuerier interface {
	Query(ctx context.Context) db.Result
}

// ForeignProber dials a workload in a foreign trust domain and reports the
// (expected) mTLS rejection. nil when there is no live agent / not configured.
type ForeignProber interface {
	Probe(ctx context.Context) foreign.Result
}

// Config holds the runtime configuration for the HTTP server.
type Config struct {
	Audience    string
	TrustDomain string
	SourceLabel string
	// ProbeURL, if set, is the in-cluster URL of the unauthorized probe pod's
	// DB attempt (/probe); the webapp calls it server-side to show the "denied
	// at the gateway" result for the untrusted scenario.
	ProbeURL string
	// UntrustedSVIDURL / UnknownSVIDURL are the /probe-svid URLs of the
	// untrusted (valid SVID, DB-denied) and unknown (no SVID issued) pods. The
	// webapp relays them so one page shows all three identity outcomes.
	UntrustedSVIDURL string
	UnknownSVIDURL   string
	// Demo is true when there is no live agent; the scenarios endpoint then
	// synthesizes illustrative untrusted/unknown outcomes so the switcher is
	// fully demo-able without a cluster.
	Demo bool
	// ExposeProbe registers the /probe and /probe-svid endpoints. They exist so
	// the untrusted/unknown probe pods can surface their own DB/SVID outcome to
	// the main webapp — set it ONLY on those pods. The internet-facing main
	// webapp leaves it false so it never exposes its own DB rows / JWT-SVID.
	ExposeProbe bool
	// Conjur* drive the Secrets Manager page display (authn-jwt tab).
	ConjurServiceID  string
	ConjurSecretPath string
	ConjurSimulated  bool
	// ConjurIAM* drive the authn-iam (AWS STS) tab display.
	ConjurIAMService   string
	ConjurIAMHostID    string
	ConjurIAMSecret    string
	ConjurIAMSimulated bool
}

// Pages holds the parsed HTML templates for each page.
type Pages struct {
	Landing             *template.Template
	SWA                 *template.Template
	SecretsManager      *template.Template
	CredentialProviders *template.Template // CCP (AIMWebService)
	CredentialProvider  *template.Template // CP (local, host bridge)
}

// Deps are the constructor dependencies for a Server. DB, Foreign, Registry,
// CCP, and CP may be nil (demo mode / not configured).
type Deps struct {
	Fetcher  svid.Fetcher
	DB       DBQuerier
	Foreign  ForeignProber
	Registry *retrieve.Registry
	CCP      *ccp.Client
	CP       *cp.Client
	Pages    Pages
	Static   fs.FS
	CPApp    fs.FS // built CP inspector SPA (Vite output), served under /cp/
	Cfg      Config
}

// Server is the HTTP handler set.
type Server struct {
	fetcher  svid.Fetcher
	db       DBQuerier
	foreign  ForeignProber
	registry *retrieve.Registry
	ccp      *ccp.Client
	cp       *cp.Client
	pages    Pages
	static   fs.FS
	cpApp    fs.FS
	cfg      Config
}

// New constructs a Server from its dependencies.
func New(d Deps) *Server {
	return &Server{
		fetcher:  d.Fetcher,
		db:       d.DB,
		foreign:  d.Foreign,
		registry: d.Registry,
		ccp:      d.CCP,
		cp:       d.CP,
		pages:    d.Pages,
		static:   d.Static,
		cpApp:    d.CPApp,
		cfg:      d.Cfg,
	}
}

// Routes returns the configured mux.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleLanding)
	mux.HandleFunc("/lang", s.handleSetLang)
	// The one inspector SPA (Vite base=/cp/, assets under /cp/) serves the whole
	// Credential-Providers + SWA family: /cp (local CP), /credential-providers
	// (CCP), and /swa. The React app picks the provider from the URL path; the
	// /api/cp, /api/ccp, and /api/swa endpoints supply its data. Falls back to the
	// legacy templates when the SPA is absent.
	if s.cpApp != nil {
		mux.Handle("/cp/", http.StripPrefix("/cp/", http.FileServer(http.FS(s.cpApp))))
		mux.HandleFunc("/cp", func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "/cp/", http.StatusFound)
		})
		// CCP + SWA share the same SPA; assets still load from /cp/ (absolute).
		mux.HandleFunc("/credential-providers", s.serveInspectorIndex)
		mux.HandleFunc("/credential-providers/", s.serveInspectorIndex)
		mux.HandleFunc("/swa", s.serveInspectorIndex)
		mux.HandleFunc("/swa/", s.serveInspectorIndex)
		// Secrets Manager (Conjur); the SPA reads the URL hash to pick authn-jwt
		// vs authn-iam (both under /secrets-manager).
		mux.HandleFunc("/secrets-manager", s.serveInspectorIndex)
		mux.HandleFunc("/secrets-manager/", s.serveInspectorIndex)
	} else {
		mux.HandleFunc("/cp", s.handleCredentialProvider)
		mux.HandleFunc("/credential-providers", s.handleCredentialProviders)
		mux.HandleFunc("/swa", s.handleSWA)
		mux.HandleFunc("/secrets-manager", s.handleSecretsManager)
	}
	mux.HandleFunc("/api/catalog", s.handleCatalog)
	mux.HandleFunc("/api/retrieve", s.handleRetrieve)
	mux.HandleFunc("/api/ccp", s.handleCCP)
	mux.HandleFunc("/api/cp", s.handleCP)
	mux.HandleFunc("/api/svid", s.handleSVID)
	mux.HandleFunc("/api/scenarios", s.handleScenarios)
	mux.HandleFunc("/api/swa", s.handleAPISWA)
	mux.HandleFunc("/api/conjur", s.handleConjur)
	mux.HandleFunc("/api/db", s.handleDB)
	// Probe endpoints leak this pod's own DB rows / JWT-SVID; only the internal
	// probe pods expose them (EXPOSE_PROBE_ENDPOINTS=true), never the main webapp.
	if s.cfg.ExposeProbe {
		mux.HandleFunc("/probe", s.handleProbe)
		mux.HandleFunc("/probe-svid", s.handleProbeSVID)
	}
	mux.HandleFunc("/healthz", s.handleHealth)
	if s.static != nil {
		mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(s.static))))
	}
	return securityHeaders(mux)
}

// securityHeaders adds conservative response headers to every response. It stops
// short of a strict Content-Security-Policy on purpose: the Vite/React inspector
// SPA relies on inline styles/scripts that a strict CSP would break, so headers
// here are the ones that are safe without per-asset nonces.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "SAMEORIGIN")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		next.ServeHTTP(w, r)
	})
}

type indexData struct {
	Audience    string
	TrustDomain string
	Source      string
}

func (s *Server) renderPage(w http.ResponseWriter, tmpl *template.Template, data interface{}) {
	if tmpl == nil {
		http.Error(w, "page unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := tmpl.Execute(w, data); err != nil {
		http.Error(w, "template error", http.StatusInternalServerError)
	}
}

// handleLanding renders the family chooser (the CTA walk-through).
func (s *Server) handleLanding(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	var families []retrieve.FamilyInfo
	if s.registry != nil {
		families = s.registry.Catalog()
	}
	s.renderPage(w, s.pages.Landing, struct {
		Families []retrieve.FamilyInfo
		Locale   string
	}{families, i18n.Resolve(r)})
}

// handleSetLang persists the chosen locale in the shared "lang" cookie and
// redirects back. next is restricted to local paths to avoid an open redirect.
func (s *Server) handleSetLang(w http.ResponseWriter, r *http.Request) {
	i18n.SetCookie(w, r.URL.Query().Get("set"))
	next := r.URL.Query().Get("next")
	if !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
		next = "/"
	}
	http.Redirect(w, r, next, http.StatusSeeOther)
}

// handleSWA renders the Secure Workload Access switcher page.
func (s *Server) handleSWA(w http.ResponseWriter, r *http.Request) {
	data := indexData{Audience: s.cfg.Audience, TrustDomain: s.cfg.TrustDomain, Source: s.fetcher.Source()}
	s.renderPage(w, s.pages.SWA, data)
}

// handleSecretsManager renders the Conjur (Secrets Manager SaaS) page, which
// tabs between the authn-jwt and authn-iam (AWS STS) modes.
func (s *Server) handleSecretsManager(w http.ResponseWriter, r *http.Request) {
	data := struct {
		ServiceID    string
		SecretPath   string
		Simulated    bool
		IAMService   string
		IAMHostID    string
		IAMSecret    string
		IAMSimulated bool
	}{
		s.cfg.ConjurServiceID, s.cfg.ConjurSecretPath, s.cfg.ConjurSimulated,
		s.cfg.ConjurIAMService, s.cfg.ConjurIAMHostID, s.cfg.ConjurIAMSecret, s.cfg.ConjurIAMSimulated,
	}
	s.renderPage(w, s.pages.SecretsManager, data)
}

// handleCredentialProviders renders the CCP (AIMWebService) scenario page.
func (s *Server) handleCredentialProviders(w http.ResponseWriter, r *http.Request) {
	data := struct {
		AppID     string
		CertCN    string
		Simulated bool
	}{}
	if s.ccp != nil {
		data.AppID = s.ccp.AppID()
		data.CertCN = s.ccp.CertCN()
		data.Simulated = s.ccp.Simulated()
	} else {
		data.Simulated = true
	}
	s.renderPage(w, s.pages.CredentialProviders, data)
}

// handleCCP runs one CCP scenario (?scenario=authorized|no-cert|denied|dual).
func (s *Server) handleCCP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	if s.ccp == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "CCP not configured"})
		return
	}
	scenario := ccp.Scenario(r.URL.Query().Get("scenario"))
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	writeJSON(w, http.StatusOK, s.ccp.Run(ctx, scenario))
}

// serveInspectorIndex serves the inspector SPA's index.html for a non-/cp route
// (e.g. /credential-providers). The SPA's assets are absolute under /cp/, so the
// same HTML works at any mount point; the React app reads the URL to pick the
// provider (CP vs CCP).
func (s *Server) serveInspectorIndex(w http.ResponseWriter, _ *http.Request) {
	b, err := fs.ReadFile(s.cpApp, "index.html")
	if err != nil {
		http.Error(w, "inspector unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(b)
}

// handleCredentialProvider renders the local Credential Provider scenario page.
func (s *Server) handleCredentialProvider(w http.ResponseWriter, r *http.Request) {
	data := struct {
		AppID string
		Live  bool
	}{}
	if s.cp != nil {
		data.AppID = s.cp.AppID()
		data.Live = s.cp.Live()
	}
	s.renderPage(w, s.pages.CredentialProvider, data)
}

// handleCP runs one CP scenario (?scenario=authorized|invalid-hash|denied|dual).
func (s *Server) handleCP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	if s.cp == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "CP not configured"})
		return
	}
	scenario := cp.Scenario(r.URL.Query().Get("scenario"))
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	writeJSON(w, http.StatusOK, s.cp.Run(ctx, scenario))
}

// handleCatalog returns the family/mode taxonomy as JSON.
func (s *Server) handleCatalog(w http.ResponseWriter, _ *http.Request) {
	if s.registry == nil {
		writeJSON(w, http.StatusOK, []retrieve.FamilyInfo{})
		return
	}
	writeJSON(w, http.StatusOK, s.registry.Catalog())
}

// handleRetrieve runs a secrets-retrieval mode by id and returns its Result.
func (s *Server) handleRetrieve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	mode := r.URL.Query().Get("mode")
	if mode == "" || s.registry == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing or unsupported mode"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	result, ok := s.registry.Retrieve(ctx, mode)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown mode: " + mode})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// handleSVID triggers a JWT-SVID request and returns the decoded result + steps.
func (s *Server) handleSVID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}

	// Mint ONLY for the configured demo audience. Honoring an attacker-chosen
	// ?audience= would make this a token-minting oracle: request audience=conjur
	// and replay the returned JWT-SVID to Conjur as this workload. Reject any
	// audience other than the configured one.
	audience := s.cfg.Audience
	if a := r.URL.Query().Get("audience"); a != "" && a != s.cfg.Audience {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "requested audience is not permitted",
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	result, err := s.fetcher.FetchJWTSVID(ctx, audience)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"error":  "failed to obtain JWT-SVID",
			"detail": err.Error(),
			"source": s.fetcher.Source(),
		})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

type dbResponse struct {
	Authorized   *db.Result `json:"authorized"`
	Unauthorized *db.Result `json:"unauthorized,omitempty"`
}

// handleDB queries Postgres through the SPIFFE gateway with this pod's SVID
// (authorized), and — when a probe is configured — relays the unauthorized
// pod's attempt so a single page shows both outcomes.
func (s *Server) handleDB(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	resp := dbResponse{Authorized: s.selfQuery(ctx)}
	if s.cfg.ProbeURL != "" {
		resp.Unauthorized = s.probeQuery(ctx)
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleProbe runs THIS pod's own DB attempt and returns it. Deployed in the
// unauthorized namespace, it is how the webapp surfaces the denied result.
func (s *Server) handleProbe(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	writeJSON(w, http.StatusOK, s.selfQuery(ctx))
}

// selfQuery runs the DB read with this pod's identity (nil-safe for demo mode).
func (s *Server) selfQuery(ctx context.Context) *db.Result {
	if s.db == nil {
		return &db.Result{Allowed: false, Error: "no SWA agent / demo mode — DB access unavailable"}
	}
	res := s.db.Query(ctx)
	return &res
}

// probeQuery fetches the unauthorized pod's /probe result over cluster HTTP.
func (s *Server) probeQuery(ctx context.Context) *db.Result {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.ProbeURL, nil)
	if err != nil {
		return &db.Result{Allowed: false, Error: "probe request: " + err.Error()}
	}
	httpResp, err := http.DefaultClient.Do(req)
	if err != nil {
		return &db.Result{Allowed: false, Error: "probe unreachable: " + err.Error()}
	}
	defer httpResp.Body.Close()
	var res db.Result
	if err := json.NewDecoder(httpResp.Body).Decode(&res); err != nil {
		return &db.Result{Allowed: false, Error: "probe decode: " + err.Error()}
	}
	return &res
}

// svidProbe is one workload's identity-issuance outcome: either an issued
// JWT-SVID (Issued=true, Result set) or a refusal (Issued=false, Error set).
type svidProbe struct {
	Issued bool         `json:"issued"`
	Result *svid.Result `json:"result,omitempty"`
	Error  string       `json:"error,omitempty"`
}

// scenario is the full story for one workload: what identity it was granted and
// what happened when it reached for the database.
type scenario struct {
	SVID *svidProbe `json:"svid"`
	DB   *db.Result `json:"db,omitempty"`
}

// foreignView is the fourth scenario: our trusted app meets a workload from a
// foreign trust domain (acme.courier) and rejects it at the mTLS trust boundary.
type foreignView struct {
	PeerURI  string `json:"peer_uri"`
	Issuer   string `json:"issuer"`
	OwnID    string `json:"own_id,omitempty"`
	Rejected bool   `json:"rejected"`
	Error    string `json:"error"`
}

// scenariosResponse drives the switcher in the UI.
type scenariosResponse struct {
	Trusted   scenario     `json:"trusted"`
	Untrusted scenario     `json:"untrusted"`
	Unknown   scenario     `json:"unknown"`
	Foreign   *foreignView `json:"foreign"`
}

// swaInfo is the SWA inspector's per-scenario payload: the workload's identity
// outcome + the resource (Postgres via the SPIFFE gateway) it reached.
type swaInfo struct {
	Scenario    string        `json:"scenario"`
	Issued      bool          `json:"issued"`
	SPIFFEID    string        `json:"spiffe_id,omitempty"`
	JWTAlg      string        `json:"jwt_alg,omitempty"`
	JWTKid      string        `json:"jwt_kid,omitempty"`
	Audience    string        `json:"audience,omitempty"`
	ExpiresAt   string        `json:"expires_at,omitempty"`
	Token       string        `json:"token,omitempty"`
	DBAllowed   bool          `json:"db_allowed"`
	DBRows      []db.Shipment `json:"db_rows,omitempty"`
	DBError     string        `json:"db_error,omitempty"`
	PeerURI     string        `json:"peer_uri,omitempty"`
	Issuer      string        `json:"issuer,omitempty"`
	TrustDomain string        `json:"trust_domain,omitempty"`
}

type swaResp struct {
	Family    string  `json:"family"`
	Mode      string  `json:"mode"`
	Retrieved bool    `json:"retrieved"`
	Simulated bool    `json:"simulated"`
	Error     string  `json:"error,omitempty"`
	SWA       swaInfo `json:"swa"`
}

// fillSVID copies the decoded JWT-SVID fields into the swa payload.
func fillSVID(info *swaInfo, sv *svidProbe) {
	if sv == nil {
		return
	}
	info.Issued = sv.Issued
	if sv.Result == nil {
		return
	}
	r := sv.Result
	if info.SPIFFEID == "" {
		info.SPIFFEID = r.SPIFFEID
	}
	info.Token = r.Token
	if len(r.Audience) > 0 {
		info.Audience = r.Audience[0]
	}
	if !r.ExpiresAt.IsZero() {
		info.ExpiresAt = r.ExpiresAt.Format(time.RFC3339)
	}
	if a, ok := r.Header["alg"].(string); ok {
		info.JWTAlg = a
	}
	if k, ok := r.Header["kid"].(string); ok {
		info.JWTKid = k
	}
}

// handleAPISWA runs one SWA identity scenario (?scenario=trusted|untrusted|
// unknown|foreign) and returns a unified payload for the inspector SPA. It reuses
// the same scenario helpers as /api/scenarios, projected to one scenario.
func (s *Server) handleAPISWA(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	audience := s.cfg.Audience
	scenario := r.URL.Query().Get("scenario")
	resp := swaResp{Family: "workload-access", Mode: "swa", Simulated: s.cfg.Demo}
	info := swaInfo{Scenario: scenario, TrustDomain: s.cfg.TrustDomain}

	switch scenario {
	case "trusted":
		fillSVID(&info, s.selfSVID(ctx, audience))
		var dbr *db.Result
		if s.cfg.Demo && s.db == nil {
			dbr = demoRows(s.demoID("swa-demo", "swa-demo-webapp"))
		} else {
			dbr = s.selfQuery(ctx)
		}
		info.DBAllowed, info.DBRows, info.DBError = dbr.Allowed, dbr.Rows, dbr.Error
		resp.Retrieved = dbr.Allowed
		if !dbr.Allowed {
			resp.Error = dbr.Error
		}
	case "untrusted":
		sc := s.untrustedScenario(ctx, audience)
		fillSVID(&info, sc.SVID)
		if sc.DB != nil {
			info.DBAllowed, info.DBRows, info.DBError = sc.DB.Allowed, sc.DB.Rows, sc.DB.Error
			if info.SPIFFEID == "" {
				info.SPIFFEID = sc.DB.SPIFFEID
			}
		}
		resp.Error = firstNonEmpty(info.DBError, "SPIFFE ID not allow-listed at the gateway")
	case "unknown":
		sc := s.unknownScenario(ctx, audience)
		fillSVID(&info, sc.SVID)
		if sc.SVID != nil {
			resp.Error = firstNonEmpty(sc.SVID.Error, "no identity issued for this workload")
		}
	case "foreign":
		fv := s.foreignScenario(ctx)
		info.PeerURI, info.Issuer, info.SPIFFEID = fv.PeerURI, fv.Issuer, fv.PeerURI
		resp.Error = firstNonEmpty(fv.Error, "foreign trust domain — trust roots do not anchor it")
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown scenario: " + scenario})
		return
	}

	resp.SWA = info
	writeJSON(w, http.StatusOK, resp)
}

// firstNonEmpty returns a if non-empty, else b.
func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// conjurInfo is the Secrets Manager (Conjur) inspector payload: the workload
// identity that authenticated, the scoped access-token, and the variable read.
type conjurInfo struct {
	AuthMethod string `json:"auth_method"`
	Identity   string `json:"identity,omitempty"` // spiffe sub (jwt) or caller ARN (iam)
	Audience   string `json:"audience,omitempty"` // jwt
	Issuer     string `json:"issuer,omitempty"`   // jwt
	HostID     string `json:"host_id,omitempty"`  // conjur host the identity maps to
	AwsAccount string `json:"aws_account,omitempty"`
	AwsRegion  string `json:"aws_region,omitempty"`
	SecretName string `json:"secret_name,omitempty"` // variable requested
	TokenScope string `json:"token_scope,omitempty"` // variables the token may read
}

type conjurResp struct {
	Family    string     `json:"family"`
	Mode      string     `json:"mode"`
	Retrieved bool       `json:"retrieved"`
	Simulated bool       `json:"simulated"`
	Error     string     `json:"error,omitempty"`
	Masked    string     `json:"masked,omitempty"`
	Conjur    conjurInfo `json:"conjur"`
}

// deniedConjurVar is the out-of-scope variable used by the denied scenario.
const deniedConjurVar = "data/vault/prod/master-api-key"

// handleConjur runs one Secrets Manager (Conjur) scenario for the inspector:
// ?mode=jwt|iam&scenario=authorized|denied. It reshapes the existing conjur-jwt /
// conjur-iam retrievers into a flat payload. The denied scenario keeps the
// (successful) authentication but refuses an out-of-scope variable read.
func (s *Server) handleConjur(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	mode := "conjur-jwt"
	if r.URL.Query().Get("mode") == "iam" {
		mode = "conjur-iam"
	}
	scenario := r.URL.Query().Get("scenario")

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	if s.registry == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "registry unavailable"})
		return
	}
	res, ok := s.registry.Retrieve(ctx, mode)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown conjur mode"})
		return
	}

	info := conjurInfo{AuthMethod: res.AuthMethod, Identity: res.Identity, SecretName: res.SecretName, TokenScope: res.SecretName}
	if res.JWT != nil {
		if v, ok := res.JWT.Claims["sub"].(string); ok && v != "" {
			info.Identity = v
		}
		if v, ok := res.JWT.Claims["aud"].(string); ok {
			info.Audience = v
		}
		if v, ok := res.JWT.Claims["iss"].(string); ok {
			info.Issuer = v
		}
	}
	if res.AWS != nil {
		info.Identity = firstNonEmpty(res.AWS.CallerARN, info.Identity)
		info.AwsAccount = res.AWS.Account
		info.AwsRegion = res.AWS.Region
		info.HostID = res.AWS.HostID
	}

	resp := conjurResp{Family: "secrets-manager", Mode: mode, Simulated: res.Simulated, Conjur: info}
	switch scenario {
	case "invalid":
		// The presented credential fails authentication before any token is issued.
		resp.Retrieved = false
		if mode == "conjur-iam" {
			resp.Error = "401 Unauthorized — authn-iam rejected the signed request (AWS replay failed: invalid/expired signature, or the ARN is not authorized)"
		} else {
			resp.Error = "401 Unauthorized — authn-jwt rejected the token (JWT validation failed: signature, issuer, audience, or expiry)"
		}
	case "denied":
		// Authentication succeeded and a scoped token was granted, but the token
		// is not permitted to read this out-of-scope variable.
		resp.Retrieved = false
		resp.Conjur.SecretName = deniedConjurVar
		resp.Error = "403 Forbidden — the scoped access token is not authorized to read " + deniedConjurVar
	default:
		resp.Retrieved = res.Retrieved
		resp.Masked = res.Masked
		resp.Error = res.Error
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleScenarios aggregates the three identity outcomes for the switcher: the
// trusted app (this pod), the untrusted app (valid SVID, denied at the DB
// gateway), and the unknown app (refused an SVID entirely). The untrusted and
// unknown results are relayed from their probe pods; in demo mode they are
// synthesized so the switcher works without a cluster.
func (s *Server) handleScenarios(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	audience := s.cfg.Audience

	trusted := scenario{SVID: s.selfSVID(ctx, audience)}
	if s.cfg.Demo && s.db == nil {
		// No live gateway locally; show representative rows so the switcher reads
		// the same as it does in-cluster.
		trusted.DB = demoRows(s.demoID("swa-demo", "swa-demo-webapp"))
	} else {
		trusted.DB = s.selfQuery(ctx)
	}

	resp := scenariosResponse{
		Trusted:   trusted,
		Untrusted: s.untrustedScenario(ctx, audience),
		Unknown:   s.unknownScenario(ctx, audience),
		Foreign:   s.foreignScenario(ctx),
	}
	writeJSON(w, http.StatusOK, resp)
}

// untrustedScenario describes the workload that IS issued a valid SVID but whose
// SPIFFE ID is not allow-listed at the gateway, so its DB read is rejected.
func (s *Server) untrustedScenario(ctx context.Context, audience string) scenario {
	if s.cfg.UntrustedSVIDURL != "" {
		return scenario{
			SVID: s.relaySVID(ctx, s.cfg.UntrustedSVIDURL),
			DB:   s.probeQuery(ctx),
		}
	}
	if s.cfg.Demo {
		return scenario{
			SVID: s.demoSVID("swa-demo-untrusted", "untrusted-app", audience),
			DB: &db.Result{
				Allowed:  false,
				SPIFFEID: s.demoID("swa-demo-untrusted", "untrusted-app"),
				Error:    "remote error: tls: bad certificate",
			},
		}
	}
	return scenario{SVID: &svidProbe{Issued: false, Error: "untrusted probe not configured"}}
}

// unknownScenario describes the workload with no registration policy: it asks
// the Workload API and the SWA Server refuses to issue any identity.
func (s *Server) unknownScenario(ctx context.Context, audience string) scenario {
	if s.cfg.UnknownSVIDURL != "" {
		return scenario{SVID: s.relaySVID(ctx, s.cfg.UnknownSVIDURL)}
	}
	if s.cfg.Demo {
		return scenario{SVID: &svidProbe{
			Issued: false,
			Error:  `rpc error: code = PermissionDenied desc = no identity issued for workload "swa-demo-rogue/rogue-app"`,
		}}
	}
	return scenario{SVID: &svidProbe{Issued: false, Error: "unknown probe not configured"}}
}

// foreignScenario has our trusted app dial the foreign-trust-domain carrier and
// reports the (expected) rejection at the mTLS trust boundary.
func (s *Server) foreignScenario(ctx context.Context) *foreignView {
	if s.foreign != nil {
		r := s.foreign.Probe(ctx)
		return &foreignView{
			PeerURI:  fallback(r.PeerURI, foreign.ACMESPIFFEURI),
			Issuer:   fallback(r.Issuer, "acme.courier root"),
			OwnID:    r.OwnID,
			Rejected: r.Rejected,
			Error:    r.Error,
		}
	}
	// Demo mode (or unconfigured): synthesize the trust-boundary rejection.
	v := &foreignView{
		PeerURI: foreign.ACMESPIFFEURI,
		Issuer:  "acme.courier root",
		Error:   "x509: certificate signed by unknown authority",
	}
	if s.cfg.Demo {
		v.Rejected = true
		v.OwnID = s.demoID("swa-demo", "swa-demo-webapp")
	} else {
		v.Error = "foreign carrier not configured"
	}
	return v
}

// fallback returns v, or def when v is empty.
func fallback(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

// handleProbeSVID runs THIS pod's own JWT-SVID request and returns the outcome.
// Deployed on the untrusted and unknown pods, it is how the webapp surfaces
// their identity results (issued vs refused).
func (s *Server) handleProbeSVID(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	writeJSON(w, http.StatusOK, s.selfSVID(ctx, s.cfg.Audience))
}

// selfSVID fetches this pod's own JWT-SVID, capturing a refusal as Issued=false.
func (s *Server) selfSVID(ctx context.Context, audience string) *svidProbe {
	res, err := s.fetcher.FetchJWTSVID(ctx, audience)
	if err != nil {
		return &svidProbe{Issued: false, Error: err.Error()}
	}
	return &svidProbe{Issued: true, Result: res}
}

// relaySVID fetches a probe pod's /probe-svid outcome over cluster HTTP.
func (s *Server) relaySVID(ctx context.Context, url string) *svidProbe {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return &svidProbe{Issued: false, Error: "probe request: " + err.Error()}
	}
	httpResp, err := http.DefaultClient.Do(req)
	if err != nil {
		return &svidProbe{Issued: false, Error: "probe unreachable: " + err.Error()}
	}
	defer httpResp.Body.Close()
	var p svidProbe
	if err := json.NewDecoder(httpResp.Body).Decode(&p); err != nil {
		return &svidProbe{Issued: false, Error: "probe decode: " + err.Error()}
	}
	return &p
}

// demoSVID synthesizes a valid-looking JWT-SVID for a given ns/sa (demo mode).
func (s *Server) demoSVID(namespace, serviceAcct, audience string) *svidProbe {
	f := svid.NewFake(s.cfg.TrustDomain, "minikube-nodes", namespace, serviceAcct)
	res, err := f.FetchJWTSVID(context.Background(), audience)
	if err != nil {
		return &svidProbe{Issued: false, Error: err.Error()}
	}
	return &svidProbe{Issued: true, Result: res}
}

// demoID builds the SPIFFE ID string for a ns/sa (demo mode display).
func (s *Server) demoID(namespace, serviceAcct string) string {
	return "spiffe://" + s.cfg.TrustDomain + "/minikube-nodes/ns/" + namespace + "/sa/" + serviceAcct
}

// demoRows mirrors the seed shipments so the trusted tab shows rows without a
// live gateway (demo mode only).
func demoRows(spiffeID string) *db.Result {
	return &db.Result{
		Allowed:  true,
		SPIFFEID: spiffeID,
		Rows: []db.Shipment{
			{Ref: "SHP-2049-883", Origin: "Singapore", Destination: "Long Beach", Status: "In transit", Carrier: "Praetor Logistics"},
			{Ref: "SHP-2050-114", Origin: "Rotterdam", Destination: "New York", Status: "Loaded", Carrier: "Meridian Freight"},
			{Ref: "SHP-2050-562", Origin: "Shanghai", Destination: "Hamburg", Status: "Customs", Carrier: "Praetor Logistics"},
			{Ref: "SHP-2051-007", Origin: "Busan", Destination: "Oakland", Status: "Arrived", Carrier: "Transpacific Co"},
			{Ref: "SHP-2051-340", Origin: "Felixstowe", Destination: "Savannah", Status: "In transit", Carrier: "Atlantic Lines"},
		},
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "source": s.fetcher.Source()})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
