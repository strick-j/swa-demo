package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"html/template"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/strick-j/swa-demo/webapp/internal/svid"
)

// stubFetcher implements svid.Fetcher for tests.
type stubFetcher struct {
	result *svid.Result
	err    error
	gotAud string
}

func (s *stubFetcher) Source() string { return "stub" }

func (s *stubFetcher) FetchJWTSVID(_ context.Context, audience string) (*svid.Result, error) {
	s.gotAud = audience
	if s.err != nil {
		return nil, s.err
	}
	return s.result, nil
}

func newTestServer(f svid.Fetcher) *Server {
	tmpl := template.Must(template.New("index.html").Parse(`aud={{.Audience}} src={{.Source}}`))
	return New(f, nil, tmpl, nil, Config{Audience: "default-aud", TrustDomain: "td.example", SourceLabel: "stub"})
}

func TestHandleSVID_Success(t *testing.T) {
	want := &svid.Result{
		SPIFFEID:  "spiffe://td.example/ns/swa-demo/sa/webapp",
		Token:     "h.p.s",
		Claims:    map[string]interface{}{"sub": "spiffe://td.example/ns/swa-demo/sa/webapp"},
		Audience:  []string{"default-aud"},
		IssuedAt:  time.Now(),
		ExpiresAt: time.Now().Add(time.Minute),
		Steps:     []svid.Step{{Name: "Workload request", Status: "ok"}},
	}
	stub := &stubFetcher{result: want}
	srv := newTestServer(stub)

	req := httptest.NewRequest(http.MethodPost, "/api/svid", nil)
	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var got svid.Result
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.SPIFFEID != want.SPIFFEID {
		t.Errorf("spiffe id = %q, want %q", got.SPIFFEID, want.SPIFFEID)
	}
	if len(got.Steps) != 1 {
		t.Errorf("steps = %d, want 1", len(got.Steps))
	}
	if stub.gotAud != "default-aud" {
		t.Errorf("audience = %q, want default-aud", stub.gotAud)
	}
}

func TestHandleSVID_AudienceOverride(t *testing.T) {
	stub := &stubFetcher{result: &svid.Result{SPIFFEID: "x"}}
	srv := newTestServer(stub)

	req := httptest.NewRequest(http.MethodPost, "/api/svid?audience=custom", nil)
	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, req)

	if stub.gotAud != "custom" {
		t.Errorf("audience = %q, want custom", stub.gotAud)
	}
}

func TestHandleSVID_FetchError(t *testing.T) {
	stub := &stubFetcher{err: errors.New("boom")}
	srv := newTestServer(stub)

	req := httptest.NewRequest(http.MethodPost, "/api/svid", nil)
	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "boom") {
		t.Errorf("body missing detail: %s", rec.Body.String())
	}
}

func TestHandleSVID_MethodNotAllowed(t *testing.T) {
	srv := newTestServer(&stubFetcher{result: &svid.Result{}})
	req := httptest.NewRequest(http.MethodGet, "/api/svid", nil)
	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
}

func newScenarioServer(f svid.Fetcher, cfg Config) *Server {
	tmpl := template.Must(template.New("index.html").Parse(`x`))
	return New(f, nil, tmpl, nil, cfg)
}

// In demo mode with no probe URLs configured, the switcher must still produce
// all three outcomes: trusted issued (from the fetcher), untrusted synthesized
// as issued-but-DB-denied, and unknown synthesized as no-identity.
func TestHandleScenarios_DemoSynthesis(t *testing.T) {
	stub := &stubFetcher{result: &svid.Result{SPIFFEID: "spiffe://td.example/ns/swa-demo/sa/webapp"}}
	srv := newScenarioServer(stub, Config{Audience: "a", TrustDomain: "td.example", Demo: true})

	req := httptest.NewRequest(http.MethodPost, "/api/scenarios", nil)
	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var got scenariosResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Trusted.SVID == nil || !got.Trusted.SVID.Issued {
		t.Errorf("trusted should be issued: %+v", got.Trusted.SVID)
	}
	if got.Untrusted.SVID == nil || !got.Untrusted.SVID.Issued {
		t.Errorf("untrusted should be issued: %+v", got.Untrusted.SVID)
	}
	if got.Untrusted.DB == nil || got.Untrusted.DB.Allowed {
		t.Errorf("untrusted DB should be denied: %+v", got.Untrusted.DB)
	}
	if got.Unknown.SVID == nil || got.Unknown.SVID.Issued {
		t.Errorf("unknown should NOT be issued: %+v", got.Unknown.SVID)
	}
	if got.Unknown.SVID.Error == "" {
		t.Error("unknown should carry a refusal error")
	}
}

func TestHandleScenarios_MethodNotAllowed(t *testing.T) {
	srv := newScenarioServer(&stubFetcher{result: &svid.Result{}}, Config{Demo: true})
	req := httptest.NewRequest(http.MethodGet, "/api/scenarios", nil)
	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
}

// /probe-svid reports this pod's own outcome: a refusal surfaces as Issued=false.
func TestHandleProbeSVID_Refused(t *testing.T) {
	srv := newScenarioServer(&stubFetcher{err: errors.New("no identity issued")}, Config{Audience: "a"})
	req := httptest.NewRequest(http.MethodGet, "/probe-svid", nil)
	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got svidProbe
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Issued {
		t.Error("expected Issued=false for a refusal")
	}
	if !strings.Contains(got.Error, "no identity issued") {
		t.Errorf("error = %q, want it to mention the refusal", got.Error)
	}
}

func TestHandleHealth(t *testing.T) {
	srv := newTestServer(&stubFetcher{result: &svid.Result{}})
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "ok") {
		t.Errorf("health body = %s", rec.Body.String())
	}
}

func TestHandleIndex(t *testing.T) {
	srv := newTestServer(&stubFetcher{result: &svid.Result{}})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "aud=default-aud") {
		t.Errorf("index body = %s", rec.Body.String())
	}
}
