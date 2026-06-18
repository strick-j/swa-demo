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

	"github.com/strick-j/swa-demo/webapp/internal/svid"
)

// Config holds the runtime configuration for the HTTP server.
type Config struct {
	Audience    string
	TrustDomain string
	SourceLabel string
}

// Server is the HTTP handler set.
type Server struct {
	fetcher svid.Fetcher
	tmpl    *template.Template
	static  fs.FS
	cfg     Config
}

// New constructs a Server. tmpl and static come from the embedded ui package.
func New(fetcher svid.Fetcher, tmpl *template.Template, static fs.FS, cfg Config) *Server {
	return &Server{fetcher: fetcher, tmpl: tmpl, static: static, cfg: cfg}
}

// Routes returns the configured mux.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/api/svid", s.handleSVID)
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

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "source": s.fetcher.Source()})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
