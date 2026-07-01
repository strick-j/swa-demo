package retrieve

import "strings"

import "testing"

func TestMask_RevealsPreviewHidesRemainder(t *testing.T) {
	raw := "super-secret-password-123"
	masked := Mask([]byte(raw))
	// The leading PreviewLen chars ARE shown (to match against the Vault/Conjur).
	if !strings.HasPrefix(masked, raw[:PreviewLen]) {
		t.Errorf("masked output should start with the %d-char preview %q: %q", PreviewLen, raw[:PreviewLen], masked)
	}
	// The full secret and everything past the preview must NOT appear.
	if strings.Contains(masked, raw) {
		t.Fatalf("masked output contains the full secret: %q", masked)
	}
	for _, frag := range []string{"secret", "password", "123"} {
		if strings.Contains(masked, frag) {
			t.Errorf("masked output leaked hidden fragment %q: %q", frag, masked)
		}
	}
	if !strings.Contains(masked, "sha256") || !strings.Contains(masked, "chars") {
		t.Errorf("masked output missing length/hash summary: %q", masked)
	}
}

func TestMask_Deterministic(t *testing.T) {
	a := Mask([]byte("same"))
	b := Mask([]byte("same"))
	if a != b {
		t.Errorf("mask not deterministic: %q vs %q", a, b)
	}
	if Mask([]byte("same")) == Mask([]byte("different")) {
		t.Error("different secrets produced the same mask")
	}
}

func TestMask_Empty(t *testing.T) {
	if got := Mask(nil); got != "(empty)" {
		t.Errorf("Mask(nil) = %q, want (empty)", got)
	}
}

func TestCatalog_SWAAlwaysAvailable(t *testing.T) {
	cat := NewRegistry().Catalog()
	var found bool
	for _, f := range cat {
		for _, m := range f.Modes {
			if m.Mode == "swa" {
				found = true
				if !m.Available {
					t.Error("swa mode should be available")
				}
			}
		}
	}
	if !found {
		t.Error("catalog missing swa mode")
	}
}

// The K8s sidecar mode was retired in favor of SWA JWT auth; the IAM (AWS STS)
// mode replaces it as the second Conjur example.
func TestCatalog_ConjurModes(t *testing.T) {
	modes := map[string]bool{}
	for _, f := range NewRegistry().Catalog() {
		for _, m := range f.Modes {
			modes[m.Mode] = true
		}
	}
	if modes["conjur-k8s"] {
		t.Error("conjur-k8s (K8s sidecar) should have been removed from the catalog")
	}
	if !modes["conjur-iam"] {
		t.Error("catalog missing conjur-iam (AWS STS) mode")
	}
	if !modes["conjur-jwt"] {
		t.Error("catalog missing conjur-jwt mode")
	}
}
