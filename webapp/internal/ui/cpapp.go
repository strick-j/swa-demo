package ui

import (
	"embed"
	"io/fs"
)

// cpAppFS holds the built CP inspector single-page app (Vite output). The
// webapp/ui-cp React sources compile into cpapp/ during the image build; a
// committed placeholder index.html keeps `go build`/tests working without Node.
//
//go:embed all:cpapp
var cpAppFS embed.FS

// CPApp returns the built CP inspector app filesystem rooted at "cpapp".
func CPApp() (fs.FS, error) {
	return fs.Sub(cpAppFS, "cpapp")
}
