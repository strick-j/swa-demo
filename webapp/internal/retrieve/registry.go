package retrieve

import "context"

// ModeInfo describes a mode for the catalog the UI renders. Available is false
// for modes that are planned but not yet wired (rendered as "coming soon").
type ModeInfo struct {
	Mode      string `json:"mode"`
	Label     string `json:"label"`
	Auth      string `json:"auth"`
	Summary   string `json:"summary"`
	Href      string `json:"href,omitempty"` // page link, empty when not navigable
	Available bool   `json:"available"`
}

// FamilyInfo is one card on the landing page.
type FamilyInfo struct {
	Family  Family     `json:"family"`
	Title   string     `json:"title"`
	Tagline string     `json:"tagline"`
	Modes   []ModeInfo `json:"modes"`
}

// Registry holds the wired retrievers keyed by mode id and serves the catalog.
type Registry struct {
	retrievers map[string]Retriever
}

// NewRegistry builds an empty registry.
func NewRegistry() *Registry {
	return &Registry{retrievers: map[string]Retriever{}}
}

// Register adds a retriever (last registration for a mode wins).
func (r *Registry) Register(rt Retriever) {
	r.retrievers[rt.Mode()] = rt
}

// Get returns the retriever for a mode, or nil.
func (r *Registry) Get(mode string) Retriever {
	return r.retrievers[mode]
}

// Has reports whether a mode is wired.
func (r *Registry) Has(mode string) bool {
	_, ok := r.retrievers[mode]
	return ok
}

// Retrieve runs a mode by id; returns ok=false when the mode is unknown.
func (r *Registry) Retrieve(ctx context.Context, mode string) (Result, bool) {
	rt := r.retrievers[mode]
	if rt == nil {
		return Result{}, false
	}
	return rt.Retrieve(ctx), true
}

// Catalog returns the family/mode taxonomy for the landing page, marking each
// mode Available when a retriever for it is registered.
func (r *Registry) Catalog() []FamilyInfo {
	cat := []FamilyInfo{
		{
			Family:  FamilyCredentialProviders,
			Title:   "Credential Providers",
			Tagline: "Vault-backed retrieval — an agent on the host (CP) or a REST call to a Central Credential Provider (CCP).",
			Modes: []ModeInfo{
				{Mode: "cp", Label: "Credential Provider", Auth: "host identity", Summary: "Agent on the host (not a container) serves cached Vault credentials via the local SDK/CLI.", Available: false},
				{Mode: "ccp", Label: "Central Credential Provider", Auth: "client cert / allowed machine", Summary: "REST call to AIMWebService on a dedicated host; no local agent.", Available: false},
			},
		},
		{
			Family:  FamilySecretsManager,
			Title:   "Secrets Manager SaaS",
			Tagline: "Conjur Cloud — authenticate with a workload-native identity, then fetch a secret over the API.",
			Modes: []ModeInfo{
				{Mode: "conjur-jwt", Label: "Conjur · JWT auth", Auth: "authn-jwt", Href: "/secrets-manager", Summary: "Present a workload JWT-SVID to Conjur authn-jwt, then read a variable.", Available: false},
				{Mode: "conjur-iam", Label: "Conjur · AWS STS", Auth: "authn-iam", Summary: "Authenticate with the workload's AWS IAM role via authn-iam.", Available: false},
				{Mode: "conjur-k8s", Label: "Conjur · K8s sidecar", Auth: "authn-k8s", Summary: "Secrets Provider sidecar pulls the secret into a shared volume.", Available: false},
			},
		},
		{
			Family:  FamilyWorkloadAccess,
			Title:   "Secure Workload Access",
			Tagline: "SPIFFE workload identity — ephemeral SVIDs authorize access; no stored credential at all.",
			Modes: []ModeInfo{
				{Mode: "swa", Label: "SPIFFE SVID → gateway", Auth: "x509-svid / jwt-svid", Href: "/swa", Summary: "Four trust scenarios: trusted, untrusted, unknown, foreign.", Available: true},
			},
		},
	}
	for fi := range cat {
		for mi, m := range cat[fi].Modes {
			if r.Has(m.Mode) {
				cat[fi].Modes[mi].Available = true
			}
		}
	}
	return cat
}
