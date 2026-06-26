// Package handlers wires the HTTP layer to a svid.Fetcher. It depends only on the
// svid interface, so it is fully testable without a live SWA Agent.
package handlers

import (
	"context"
	"encoding/json"
	"html/template"
	"io/fs"
	"net/http"
	"time"

	"github.com/strick-j/swa-demo/webapp/internal/db"
	"github.com/strick-j/swa-demo/webapp/internal/foreign"
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
}

// Server is the HTTP handler set.
type Server struct {
	fetcher svid.Fetcher
	db      DBQuerier
	foreign ForeignProber
	tmpl    *template.Template
	static  fs.FS
	cfg     Config
}

// New constructs a Server. dbq and fp may be nil (demo mode). tmpl and static
// come from the embedded ui package.
func New(fetcher svid.Fetcher, dbq DBQuerier, fp ForeignProber, tmpl *template.Template, static fs.FS, cfg Config) *Server {
	return &Server{fetcher: fetcher, db: dbq, foreign: fp, tmpl: tmpl, static: static, cfg: cfg}
}

// Routes returns the configured mux.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/api/svid", s.handleSVID)
	mux.HandleFunc("/api/scenarios", s.handleScenarios)
	mux.HandleFunc("/api/db", s.handleDB)
	mux.HandleFunc("/probe", s.handleProbe)
	mux.HandleFunc("/probe-svid", s.handleProbeSVID)
	mux.HandleFunc("/healthz", s.handleHealth)
	if s.static != nil {
		mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(s.static))))
	}
	return mux
}

type indexData struct {
	Audience    string
	TrustDomain string
	Source      string
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	data := indexData{Audience: s.cfg.Audience, TrustDomain: s.cfg.TrustDomain, Source: s.fetcher.Source()}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := s.tmpl.Execute(w, data); err != nil {
		http.Error(w, "template error", http.StatusInternalServerError)
	}
}

// handleSVID triggers a JWT-SVID request and returns the decoded result + steps.
func (s *Server) handleSVID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}

	audience := s.cfg.Audience
	if a := r.URL.Query().Get("audience"); a != "" {
		audience = a
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
