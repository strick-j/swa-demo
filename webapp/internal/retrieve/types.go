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

// JWTInfo is a decoded JWT presented to the backend (e.g. the JWT-SVID sent to
// Conjur authn-jwt). Surfaced so the exact claims Conjur keys on are visible.
type JWTInfo struct {
	Token  string                 `json:"token"`  // compact JWT
	Header map[string]interface{} `json:"header"` // decoded header
	Claims map[string]interface{} `json:"claims"` // decoded claims (sub/aud/iss/…)
}

// AWSInfo is the AWS caller identity presented to Conjur authn-iam. Conjur
// verifies it by replaying the workload's signed sts:GetCallerIdentity request
// and maps the ARN to a Conjur host. Surfaced so the exact identity Conjur keys
// on is visible — the authn-iam analogue of JWTInfo.
type AWSInfo struct {
	CallerARN string `json:"caller_arn"`        // arn from sts:GetCallerIdentity
	Account   string `json:"account,omitempty"` // AWS account id
	UserID    string `json:"user_id,omitempty"` // STS UserId
	Region    string `json:"region,omitempty"`  // signing region
	HostID    string `json:"host_id,omitempty"` // Conjur host the ARN maps to
}

// CCPInfo is the request/identity context for a Central Credential Provider
// (AIMWebService) retrieval. It carries only non-secret metadata — the client
// identity the CCP authorizes on and the account fields it returns alongside the
// (masked) secret — so the UI can show who asked and what came back.
type CCPInfo struct {
	AppID           string `json:"app_id"`                     // the CCP Application id
	CertCN          string `json:"cert_cn,omitempty"`          // client-cert subject CN presented (mTLS)
	Safe            string `json:"safe,omitempty"`             // safe queried
	Query           string `json:"query,omitempty"`            // object name or custom-property query
	Account         string `json:"account,omitempty"`          // returned account UserName (NOT the secret)
	Address         string `json:"address,omitempty"`          // returned account Address/target
	VirtualUsername string `json:"virtual_username,omitempty"` // dual-account fronting identity
	DualActive      string `json:"dual_active,omitempty"`      // active account + status/index the pair resolved to
}

// CPInfo is the request/identity context for a (local) CyberArk Credential
// Provider retrieval via the host-side Java caller. Unlike the CCP, the CP
// authenticates the CALLING APPLICATION by its characteristics (application
// hash, path, OS user) rather than a client certificate. It carries only
// non-secret metadata so the UI can show which application asked and what came
// back alongside the (masked) secret.
type CPInfo struct {
	AppID           string `json:"app_id"`                     // the CP Application id
	AppHash         string `json:"app_hash,omitempty"`         // hash the CP authenticated the caller by (short prefix)
	CallerPath      string `json:"caller_path,omitempty"`      // path of the calling application (the jar)
	OSUser          string `json:"os_user,omitempty"`          // OS user the caller ran as
	Safe            string `json:"safe,omitempty"`             // safe queried
	Query           string `json:"query,omitempty"`            // object name or dual-account query
	Account         string `json:"account,omitempty"`          // returned account UserName (NOT the secret)
	Address         string `json:"address,omitempty"`          // returned account Address/target
	VirtualUsername string `json:"virtual_username,omitempty"` // dual-account fronting identity
	DualActive      string `json:"dual_active,omitempty"`      // active account + status/index the pair resolved to
}

// Result is the outcome of a retrieval attempt. It never carries the FULL secret
// — only Masked, a short leading preview plus length + SHA-256 built by Mask().
type Result struct {
	Family     Family      `json:"family"`
	Mode       string      `json:"mode"`        // stable id, e.g. "conjur-jwt"
	ModeLabel  string      `json:"mode_label"`  // display, e.g. "Conjur · JWT auth"
	AuthMethod string      `json:"auth_method"` // e.g. "authn-jwt"
	Identity   string      `json:"identity"`    // who we authenticated as
	SecretName string      `json:"secret_name"` // the variable/account path (NOT the value)
	Masked     string      `json:"masked"`      // safe proof-of-retrieval summary
	JWT        *JWTInfo    `json:"jwt,omitempty"`
	AWS        *AWSInfo    `json:"aws,omitempty"`
	CCP        *CCPInfo    `json:"ccp,omitempty"`
	CP         *CPInfo     `json:"cp,omitempty"`
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

// PreviewLen is how many leading characters of a secret are shown in a masked
// summary. A short preview lets an operator eyeball the value against the Vault /
// Conjur (and see it change across a rotation) while the remainder stays hidden.
const PreviewLen = 6

// Mask turns a raw secret into a summary safe for display and logs: a short
// leading preview (first PreviewLen chars), its length, and a short SHA-256
// prefix. It reveals only the preview — the rest of the value never appears — so
// it both proves a real, consistent value was fetched AND can be matched by eye
// against the source of truth. Callers must discard the raw value immediately
// after.
func Mask(raw []byte) string {
	if len(raw) == 0 {
		return "(empty)"
	}
	sum := sha256.Sum256(raw)
	return MaskSummary(len(raw), hex.EncodeToString(sum[:]), Preview(raw))
}

// Preview returns the first PreviewLen characters of raw (fewer if shorter). It
// is the only plaintext a masked summary exposes.
func Preview(raw []byte) string {
	if len(raw) <= PreviewLen {
		return string(raw)
	}
	return string(raw[:PreviewLen])
}

// MaskSummary builds the same summary as Mask from a length, a hex SHA-256, and a
// short plaintext preview that were computed elsewhere. This lets a retriever
// whose backend runs off-process (e.g. the CP host bridge, which hashes the
// secret on the host and returns only its length, digest, and PreviewLen-char
// preview) present an identical summary WITHOUT the full secret crossing the
// wire. n<=0 or an empty digest yields the empty marker.
func MaskSummary(n int, sha256hex, preview string) string {
	if n <= 0 || sha256hex == "" {
		return "(empty)"
	}
	if len(sha256hex) > 6 {
		sha256hex = sha256hex[:6]
	}
	// Show the preview, then "…" only when there is more value beyond it.
	lead := "••••"
	if preview != "" {
		lead = preview
		if n > len([]rune(preview)) {
			lead += "…"
		}
	}
	return fmt.Sprintf("%s %d chars · sha256 %s…", lead, n, sha256hex)
}
