// Package ui embeds the webapp's HTML template and static assets so the service
// ships as a single self-contained binary.
package ui

import (
	"embed"
	"html/template"
	"io/fs"
)

//go:embed templates/index.html
var templateFS embed.FS

//go:embed static/*
var staticFS embed.FS

// IndexTemplate parses and returns the index page template.
func IndexTemplate() (*template.Template, error) {
	return template.ParseFS(templateFS, "templates/index.html")
}

// StaticFS returns the embedded static asset filesystem rooted at "static".
func StaticFS() (fs.FS, error) {
	return fs.Sub(staticFS, "static")
}
