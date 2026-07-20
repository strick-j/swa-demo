package i18n

import (
	"sort"
	"testing"
)

// TestCatalogParity guards the localization guarantee: every target locale must
// define exactly the same key set as the source-of-truth English catalog. A
// missing key silently falls back to English (masking untranslated copy); an
// extra key is dead weight or a typo. Both fail the build.
func TestCatalogParity(t *testing.T) {
	en, ok := catalogs[Default]
	if !ok {
		t.Fatalf("no %q catalog", Default)
	}
	for _, loc := range Supported {
		if loc == Default {
			continue
		}
		got := catalogs[loc]
		if missing := keysMissing(en, got); len(missing) > 0 {
			t.Errorf("%s: missing %d key(s) present in %s: %v", loc, len(missing), Default, missing)
		}
		if extra := keysMissing(got, en); len(extra) > 0 {
			t.Errorf("%s: has %d key(s) absent from %s: %v", loc, len(extra), Default, extra)
		}
	}
}

// keysMissing returns the keys in want that have no entry in have, sorted.
func keysMissing(want, have map[string]string) []string {
	var missing []string
	for k := range want {
		if _, ok := have[k]; !ok {
			missing = append(missing, k)
		}
	}
	sort.Strings(missing)
	return missing
}

// TestTFallback documents the degradation chain: locale → Default → raw key.
func TestTFallback(t *testing.T) {
	if got := T("es-419", "landing.nav.brand"); got == "" {
		t.Error("known key resolved to empty")
	}
	if got := T("pt-BR", "does.not.exist"); got != "does.not.exist" {
		t.Errorf("missing key should echo itself, got %q", got)
	}
}
