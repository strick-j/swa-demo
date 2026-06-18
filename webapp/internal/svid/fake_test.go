package svid

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestFakeFetchJWTSVID(t *testing.T) {
	f := NewFake("td.example.com", "minikube-nodes", "swa-demo", "swa-demo-webapp")
	fixed := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	f.now = func() time.Time { return fixed }

	res, err := f.FetchJWTSVID(context.Background(), "my-aud")
	if err != nil {
		t.Fatalf("FetchJWTSVID: %v", err)
	}

	wantID := "spiffe://td.example.com/minikube-nodes/ns/swa-demo/sa/swa-demo-webapp"
	if res.SPIFFEID != wantID {
		t.Errorf("SPIFFEID = %q, want %q", res.SPIFFEID, wantID)
	}
	if !res.ExpiresAt.After(res.IssuedAt) {
		t.Errorf("ExpiresAt %v not after IssuedAt %v", res.ExpiresAt, res.IssuedAt)
	}
	if len(res.Steps) != 4 {
		t.Errorf("steps = %d, want 4", len(res.Steps))
	}
	if got := res.Audience; len(got) != 1 || got[0] != "my-aud" {
		t.Errorf("audience = %v, want [my-aud]", got)
	}

	// Token must be a decodable 3-part JWT whose claims carry the SPIFFE id.
	parts := strings.Split(res.Token, ".")
	if len(parts) != 3 {
		t.Fatalf("token parts = %d, want 3", len(parts))
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("decode claims: %v", err)
	}
	var claims map[string]interface{}
	if err := json.Unmarshal(raw, &claims); err != nil {
		t.Fatalf("unmarshal claims: %v", err)
	}
	if claims["sub"] != wantID {
		t.Errorf("claims.sub = %v, want %q", claims["sub"], wantID)
	}
}

func TestFakeSource(t *testing.T) {
	f := NewFake("td", "ng", "ns", "sa")
	if !strings.Contains(f.Source(), "demo") {
		t.Errorf("Source = %q, want to contain 'demo'", f.Source())
	}
}
