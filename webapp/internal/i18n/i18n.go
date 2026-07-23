// Package i18n provides the webapp's server-side localization: a small embedded
// message catalog per locale, request-locale resolution (cookie, then
// Accept-Language), and the html/template helpers (t / tHTML) the page templates
// call. The active locale lives in a non-HttpOnly "lang" cookie so the React
// inspector SPA reads the same value client-side — one source of truth for both
// stacks. See docs/i18n-glossary.md.
package i18n

import (
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"strings"
)

//go:embed locales/*.json
var localeFS embed.FS

// CookieName is the shared locale cookie read by the server and the SPA.
const CookieName = "lang"

// Default is the fallback locale and the source-of-truth language.
const Default = "en"

// Supported lists every locale that has a catalog, most-specific first. It is
// also the set the switcher and Accept-Language matching are limited to.
var Supported = []string{"en", "es-419", "pt-BR"}

// catalogs holds each locale's flat key→string map, loaded once at init.
var catalogs = map[string]map[string]string{}

func init() {
	for _, loc := range Supported {
		b, err := localeFS.ReadFile("locales/" + loc + ".json")
		if err != nil {
			// Embedded at build time; a missing catalog is a programming error.
			panic(fmt.Sprintf("i18n: missing catalog for %q: %v", loc, err))
		}
		m := map[string]string{}
		if err := json.Unmarshal(b, &m); err != nil {
			panic(fmt.Sprintf("i18n: bad catalog %q: %v", loc, err))
		}
		catalogs[loc] = m
	}
}

// IsSupported reports whether loc has a catalog.
func IsSupported(loc string) bool {
	_, ok := catalogs[loc]
	return ok
}

// Resolve picks the active locale for a request: the lang cookie if valid, else
// the best Accept-Language match, else Default.
func Resolve(r *http.Request) string {
	if c, err := r.Cookie(CookieName); err == nil && IsSupported(c.Value) {
		return c.Value
	}
	return fromAcceptLanguage(r.Header.Get("Accept-Language"))
}

// fromAcceptLanguage matches a header like "es-419,es;q=0.9,en;q=0.8" against
// the supported set, preferring an exact tag, then the primary subtag (any es-*
// → es-419, any pt-* → pt-BR). q-values are honored only by header order, which
// is sufficient for the demo's needs.
func fromAcceptLanguage(header string) string {
	for _, part := range strings.Split(header, ",") {
		tag := strings.TrimSpace(part)
		if i := strings.IndexByte(tag, ';'); i >= 0 { // drop ;q=…
			tag = strings.TrimSpace(tag[:i])
		}
		if tag == "" {
			continue
		}
		if IsSupported(tag) {
			return tag
		}
		primary := strings.ToLower(tag)
		if i := strings.IndexByte(primary, '-'); i >= 0 {
			primary = primary[:i]
		}
		switch primary {
		case "es":
			return "es-419"
		case "pt":
			return "pt-BR"
		case "en":
			return "en"
		}
	}
	return Default
}

// T returns the string for key in locale, falling back to Default and then to
// the raw key so a missing translation degrades to English (or is visibly the
// key) rather than a blank.
func T(locale, key string) string {
	if m, ok := catalogs[locale]; ok {
		if v, ok := m[key]; ok {
			return v
		}
	}
	if m, ok := catalogs[Default]; ok {
		if v, ok := m[key]; ok {
			return v
		}
	}
	return key
}

// THTML is T for catalog values that intentionally carry trusted markup (keys
// ending in _html). Catalog content is author-controlled, never user input.
func THTML(locale, key string) template.HTML {
	return template.HTML(T(locale, key)) //nolint:gosec // trusted, author-authored catalog
}

// TemplateFuncs are the i18n helpers exposed to html/template. Templates call
// them with the page's locale, e.g. {{ t .Locale "landing.nav.cta" }}.
func TemplateFuncs() template.FuncMap {
	return template.FuncMap{
		"t":     T,
		"tHTML": THTML,
	}
}

// SetCookie writes the locale cookie (one year) when loc is supported. It is not
// HttpOnly on purpose: the SPA reads it to choose its own catalog. Secure is set
// only when the request arrived over HTTPS (directly or via a TLS-terminating
// proxy) — setting it unconditionally would make browsers drop the cookie on the
// plain-HTTP NodePort demo, breaking the language switcher.
func SetCookie(w http.ResponseWriter, r *http.Request, loc string) bool {
	if !IsSupported(loc) {
		return false
	}
	secure := r != nil && (r.TLS != nil ||
		strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"))
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    loc,
		Path:     "/",
		MaxAge:   60 * 60 * 24 * 365,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
	return true
}
