package ui

import (
	"bytes"
	"io/fs"
	"testing"
)

func TestIndexTemplateRenders(t *testing.T) {
	tmpl, err := IndexTemplate()
	if err != nil {
		t.Fatalf("IndexTemplate: %v", err)
	}
	var buf bytes.Buffer
	data := struct{ Audience, TrustDomain, Source string }{"aud", "td", "src"}
	if err := tmpl.Execute(&buf, data); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if !bytes.Contains(buf.Bytes(), []byte("td")) {
		t.Error("rendered template missing trust domain")
	}
}

func TestStaticFSHasAssets(t *testing.T) {
	sfs, err := StaticFS()
	if err != nil {
		t.Fatalf("StaticFS: %v", err)
	}
	for _, name := range []string{"app.js", "style.css"} {
		if _, err := fs.Stat(sfs, name); err != nil {
			t.Errorf("missing static asset %s: %v", name, err)
		}
	}
}
