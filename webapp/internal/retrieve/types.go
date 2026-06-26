// Package retrieve defines a common abstraction over the demo's secrets-
// retrieval modes (CyberArk Credential Provider, Central Credential Provider,
// Conjur Cloud / Secrets Manager SaaS, and Secure Workload Access). Every mode
// implements Retriever and is rendered identically by the UI: a narrated
// lifecycle plus a MASKED proof-of-retrieval. The raw secret value never leaves
// a Retriever — only a non-reversible masked summary is surfaced.
package retrieve

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/strick-j/swa-demo/webapp/internal/svid"
)

// Family groups modes by the CyberArk backend that ultimately holds the secret.
type Family string

const (
	FamilyCredentialProviders Family = "credential-providers" // Vault-backed (CP, CCP)
	FamilySecretsManager      Family = "secrets-manager"      // Conjur Cloud
	FamilyWorkloadAccess      Family = "workload-access"      // SPIFFE / SWA
)

// Result is the outcome of a retrieval attempt. It deliberately carries NO raw
// secret — only Masked, a non-reversible summary built by Mask().
type Result struct {
	Family     Family      `json:"family"`
	Mode       string      `json:"mode"`        // stable id, e.g. "conjur-jwt"
	ModeLabel  string      `json:"mode_label"`  // display, e.g. "Conjur · JWT auth"
	AuthMethod string      `json:"auth_method"` // e.g. "authn-jwt"
	Identity   string      `json:"identity"`    // who we authenticated as
	SecretName string      `json:"secret_name"` // the variable/account path (NOT the value)
	Masked     string      `json:"masked"`      // safe proof-of-retrieval summary
	Retrieved  bool        `json:"retrieved"`
	Simulated  bool        `json:"simulated"` // true when no live backend was configured
	Steps      []svid.Step `json:"steps"`
	Error      string      `json:"error,omitempty"`
}

// Retriever performs one secrets-retrieval mode.
type Retriever interface {
	// Mode returns the stable id used to select this retriever.
	Mode() string
	// Retrieve runs the mode and returns a Result (never a raw secret).
	Retrieve(ctx context.Context) Result
}

// Mask turns a raw secret into a non-reversible summary safe for display and
// logs: its length and a short SHA-256 prefix. It never reveals any plaintext
// (not even last-4), so it proves a real, consistent value was fetched without
// leaking content. Callers must discard the raw value immediately after.
func Mask(raw []byte) string {
	if len(raw) == 0 {
		return "(empty)"
	}
	sum := sha256.Sum256(raw)
	return fmt.Sprintf("•••• %d chars · sha256 %s…", len(raw), hex.EncodeToString(sum[:])[:6])
}
