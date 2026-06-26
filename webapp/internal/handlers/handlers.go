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
	"github.com/strick-j/swa-demo/webapp/internal/svid"
)

// DBQuerier reads the demo data through the SPIFFE gateway using this pod's
// X.509-SVID. nil when there is no live agent (demo mode).
type DBQuerier interface {
	Query(ctx context.Context) db.Result
}

// Config holds the runtime configuration for the HTTP server.
type Config struct {
	Audience    string
	TrustDomain string
	SourceLabel string
	// ProbeURL, if set, is the in-cluster URL of the unauthorized probe pod
	// (/probe); the webapp calls it server-side to show the "denied" result.
	ProbeURL string
}

// Server is the HTTP handler set.
type Server struct {
	fetcher svid.Fetcher
	db      DBQuerier
	tmpl    *template.Template
	static  fs.FS
	cfg     Config
}

// New constructs a Server. db may be nil (demo mode). tmpl and static come from
// the embedded ui package.
func New(fetcher svid.Fetcher, dbq DBQuerier, tmpl *template.Template, static fs.FS, cfg Config) *Server {
	return &Server{fetcher: fetcher, db: dbq, tmpl: tmpl, static: static, cfg: cfg}
}

// Routes returns the configured mux.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/api/svid", s.handleSVID)
	mux.HandleFunc("/api/db", s.handleDB)
	mux.HandleFunc("/probe", s.handleProbe)
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

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "source": s.fetcher.Source()})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
