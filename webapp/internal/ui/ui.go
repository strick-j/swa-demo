// Package ui embeds the webapp's HTML templates and static assets so the service
// ships as a single self-contained binary.
package ui

import (
	"embed"
	"html/template"
	"io/fs"
)

//go:embed templates/*.html
var templateFS embed.FS

//go:embed static/*
var staticFS embed.FS

// Page parses a single page template by file name (e.g. "landing.html").
func Page(name string) (*template.Template, error) {
	return template.ParseFS(templateFS, "templates/"+name)
}

// IndexTemplate parses the SWA switcher page. Retained for compatibility with
// existing callers/tests; equivalent to Page("swa.html").
func IndexTemplate() (*template.Template, error) {
	return Page("swa.html")
}

// StaticFS returns the embedded static asset filesystem rooted at "static".
func StaticFS() (fs.FS, error) {
	return fs.Sub(staticFS, "static")
}
