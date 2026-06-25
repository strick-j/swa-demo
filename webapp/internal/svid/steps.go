package svid

import (
	"fmt"
	"strings"
	"time"
)

// StepInputs carries the facts used to narrate the identity-issuance lifecycle.
// Shared by the live (spiffe) and demo (fake) fetchers so the story is identical.
type StepInputs struct {
	Source      string // workload API socket addr, or "demo (...)"
	Audience    string
	Namespace   string
	ServiceAcct string
	SPIFFEID    string
	Alg         string
	Kid         string
	TTL         time.Duration
	Start       time.Time
}

// LifecycleSteps returns the four narrated stages of a workload-identity
// JWT-SVID issuance: the app asks (holding no credential), the agent observes
// the pod, the server validates against node-group policy, and a short-lived,
// audience-bound JWT-SVID is minted. Each step carries a `Meta` caption with the
// concrete mechanics (socket, attestor, policy, alg/kid/ttl).
func LifecycleSteps(in StepInputs) []Step {
	t := in.Start.UnixMilli()

	nsSa := ""
	if in.Namespace != "" && in.ServiceAcct != "" {
		nsSa = fmt.Sprintf(" · ns=%s · sa=%s", in.Namespace, in.ServiceAcct)
	}

	reqMeta := strings.TrimSpace(in.Source)
	if in.Audience != "" {
		reqMeta = strings.TrimSpace(reqMeta + " · aud=" + in.Audience)
	}

	issuedMeta := ""
	if in.Alg != "" {
		issuedMeta = "alg=" + in.Alg
	}
	if in.Kid != "" {
		issuedMeta = strings.TrimSpace(issuedMeta + " · kid=" + shortKid(in.Kid))
	}
	issuedMeta = strings.TrimSpace(issuedMeta + " · aud-bound")
	if in.TTL > 0 {
		issuedMeta += " · ttl=" + in.TTL.Round(time.Second).String()
	}

	return []Step{
		{
			Name:     "Workload request",
			Detail:   "The app holds no stored credential. It opens the SWA Agent Workload API over the Unix socket and asks for a JWT-SVID for its audience.",
			Meta:     reqMeta,
			Status:   "ok",
			AtMillis: t,
		},
		{
			Name:     "Workload attestation",
			Detail:   "The agent identifies the calling pod from its Kubernetes runtime attributes — namespace and service account. The app asserts nothing; its identity is observed, not presented.",
			Meta:     strings.TrimSpace("k8s attestor" + nsSa),
			Status:   "ok",
			AtMillis: t + 12,
		},
		{
			Name:     "Server validation",
			Detail:   "The agent's node identity (k8s_psat projected SA token) is verified by the SWA Server, which checks the attested attributes against the node-group registration policy before allowing issuance.",
			Meta:     strings.TrimSpace("k8s_psat · node-group policy" + nsSa),
			Status:   "ok",
			AtMillis: t + 28,
		},
		{
			Name:     "JWT-SVID issued",
			Detail:   "The server mints a short-lived JWT-SVID for the workload's SPIFFE ID, signed by the trust-domain JWKS and bound to the requested audience. It expires in minutes and is never written to disk.",
			Meta:     issuedMeta,
			Status:   "ok",
			AtMillis: t + 41,
		},
	}
}

// shortKid truncates a key id for display (kid values are long base64url).
func shortKid(k string) string {
	if len(k) > 10 {
		return k[:8] + "…"
	}
	return k
}

// ParseNsSa extracts the namespace + service account from a SWA SPIFFE ID of the
// form spiffe://<trust-domain>/<node-group>/ns/<ns>/sa/<sa>. Returns empty
// strings when the path doesn't match.
func ParseNsSa(id string) (ns, sa string) {
	i := strings.Index(id, "/ns/")
	if i < 0 {
		return "", ""
	}
	rest := id[i+len("/ns/"):]
	j := strings.Index(rest, "/sa/")
	if j < 0 {
		return "", ""
	}
	ns = rest[:j]
	sa = rest[j+len("/sa/"):]
	if k := strings.IndexByte(sa, '/'); k >= 0 {
		sa = sa[:k]
	}
	return ns, sa
}
