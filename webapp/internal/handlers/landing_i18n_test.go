package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/strick-j/swa-demo/webapp/internal/retrieve"
	"github.com/strick-j/swa-demo/webapp/internal/ui"
)

// newLandingServer builds a Server with the real landing template and an empty
// registry (Catalog() still returns the full family/mode taxonomy).
func newLandingServer(t *testing.T) *Server {
	t.Helper()
	tmpl, err := ui.Page("landing.html")
	if err != nil {
		t.Fatalf("parse landing.html: %v", err)
	}
	return New(Deps{
		Registry: retrieve.NewRegistry(),
		Pages:    Pages{Landing: tmpl},
	})
}

func getLanding(t *testing.T, srv *Server, cookie string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: "lang", Value: cookie})
	}
	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET / (lang=%q): status %d", cookie, rec.Code)
	}
	return rec.Body.String()
}

// TestLandingLocalized checks that the landing page renders in the locale from
// the lang cookie across every translated region: static prose (problem cards),
// the html-markup fragments (intro), and the registry-driven solutions cards
// whose keys are built via printf from .Family / .Mode.
func TestLandingLocalized(t *testing.T) {
	srv := newLandingServer(t)

	cases := []struct {
		cookie string
		// wantAll are strings that MUST appear for this locale, spanning a
		// static card, the html intro, a family tagline, and a mode summary.
		wantAll []string
	}{
		{
			cookie: "", // no cookie → English default
			wantAll: []string{
				"The problem",                   // problem.eyebrow
				"Keys everywhere",               // problem.card1.title
				"who</em> is asking",            // problem.intro_html (markup preserved)
				"Vault-backed retrieval",        // family.credential-providers.tagline
				"Four trust scenarios: trusted", // mode.swa.summary (live branch)
				"Explore →",                     // mode.explore (live branch)
			},
		},
		{
			cookie: "es-419",
			wantAll: []string{
				"El problema",
				"Claves por todas partes",
				"quién</em> está solicitando",
				"Recuperación respaldada por Vault",
				"Cuatro escenarios de confianza",
				"Explorar →",
			},
		},
		{
			cookie: "pt-BR",
			wantAll: []string{
				"O problema",
				"Chaves por toda parte",
				"quem</em> está pedindo",
				"Recuperação apoiada pelo Vault",
				"Quatro cenários de confiança",
				"Explorar →",
			},
		},
	}

	for _, tc := range cases {
		body := getLanding(t, srv, tc.cookie)
		for _, want := range tc.wantAll {
			if !strings.Contains(body, want) {
				t.Errorf("lang=%q: rendered landing missing %q", tc.cookie, want)
			}
		}
	}
}

// TestLandingHTMLLangAttr confirms the <html lang> attribute tracks the locale.
func TestLandingHTMLLangAttr(t *testing.T) {
	srv := newLandingServer(t)
	for _, loc := range []string{"es-419", "pt-BR"} {
		body := getLanding(t, srv, loc)
		if !strings.Contains(body, `<html lang="`+loc+`">`) {
			t.Errorf("lang=%q: missing <html lang=%q>", loc, loc)
		}
	}
}
