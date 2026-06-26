package retrieve

import "strings"

import "testing"

func TestMask_NeverLeaksPlaintext(t *testing.T) {
	raw := "super-secret-password-123"
	masked := Mask([]byte(raw))
	if strings.Contains(masked, raw) {
		t.Fatalf("masked output contains the raw secret: %q", masked)
	}
	// Must not reveal even a substring of the secret (no last-4, etc.).
	for _, frag := range []string{"super", "secret", "123", "word"} {
		if strings.Contains(masked, frag) {
			t.Errorf("masked output leaked fragment %q: %q", frag, masked)
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
