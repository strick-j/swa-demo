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
	JWT        *JWTInfo    `json:"jwt,omitempty"`
	AWS        *AWSInfo    `json:"aws,omitempty"`
	CCP        *CCPInfo    `json:"ccp,omitempty"`
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
