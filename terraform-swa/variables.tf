# Tenant-side SWA configuration via the cyberark/swa provider.
# Mirrors the values consumed by the Helm charts so the two stay in sync.

variable "conjur_appliance_url" {
  description = <<-EOT
    Conjur Cloud / Secrets Manager - SaaS API URL, e.g.
    https://<subdomain>.secretsmgr.cyberark.cloud/api. Used as the swa provider
    `url`.
  EOT
  type        = string
  default     = ""
}

variable "conjur_access_token" {
  description = <<-EOT
    Optional pre-minted Conjur access token (raw JSON) for the swa provider.
    Leave empty (default) to have data.external.conjur_token mint one in-graph
    via the Identity OIDC flow. Set TF_VAR_conjur_access_token only to bypass
    that flow (debugging).
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

# --- Conjur provider bootstrap (reads the SCA OIDC client creds from Conjur) ---

variable "conjur_account" {
  description = "Conjur account (organization). Usually 'conjur' for Conjur Cloud."
  type        = string
  default     = "conjur"
}

variable "conjur_authn_type" {
  description = <<-EOT
    How the conjur provider authenticates to read the SCA secrets, e.g. 'iam'
    (keyless, via the control host's role), 'jwt', 'oidc', or the default
    api-key. Must be a method your tenant has enabled for this identity.
  EOT
  type        = string
  default     = "iam"
}

variable "conjur_authn_service_id" {
  description = "Authenticator service id for the conjur provider's authn_type (e.g. the authn-iam/authn-jwt service)."
  type        = string
  default     = ""
}

variable "conjur_host_id" {
  description = "Conjur host id the conjur provider logs in as (e.g. host/data/<app>/<host>)."
  type        = string
  default     = ""
}

variable "conjur_sca_username_path" {
  description = "Conjur path whose value is the Identity OAuth client_id (the SCA 'username' secret)."
  type        = string
  default     = ""
}

variable "conjur_sca_password_path" {
  description = "Conjur path whose value is the Identity OAuth client_secret (the SCA 'password' secret)."
  type        = string
  default     = ""
}

# --- CyberArk Identity OIDC exchange (mints the SWA access token) ---

variable "identity_tenant_id" {
  description = "CyberArk Identity tenant subdomain for the platform-token endpoint (<id>.id.cyberark.cloud)."
  type        = string
  default     = ""
}

variable "conjur_oidc_service_id" {
  description = "Conjur authn-oidc service id used to mint the SWA token (.../authn-oidc/<service>/<account>/authenticate). Usually 'cyberark'."
  type        = string
  default     = "cyberark"
}

variable "trust_domain" {
  description = "SWA trust domain name (must match the agent's trustDomain.name)."
  type        = string
  default     = "swa-demo.example.com"
}

variable "jwt_token_ttl" {
  description = "TTL (seconds) for issued JWT-SVIDs."
  type        = number
  default     = 300
}

variable "jwt_signing_key_ttl" {
  description = "TTL (seconds) for the trust domain JWT signing keys."
  type        = number
  default     = 86400
}

variable "server_group" {
  description = "SWA server group name."
  type        = string
  default     = "minikube-servers"
}

variable "node_group" {
  description = "SWA node group name."
  type        = string
  default     = "minikube-nodes"
}

variable "cluster_name" {
  description = "k8s_psat cluster name. Must match the agent's nodeAttestor.k8s_psat.cluster."
  type        = string
  default     = "minikube"
}

variable "agent_service_accounts" {
  description = "Allowed agent service accounts for PSAT node attestation (namespace/name)."
  type        = list(string)
  default     = ["swa-system/swa-agent"]
}

variable "psat_audience" {
  description = "Expected audience of the agent PSAT token (chart default is swa-server)."
  type        = list(string)
  default     = ["swa-server"]
}

variable "workload_namespace" {
  description = "Namespace of the demo workload (for the node-group SPIFFE ID template)."
  type        = string
  default     = "swa-demo"
}

variable "workload_service_account" {
  description = "Service account of the demo workload."
  type        = string
  default     = "swa-demo-webapp"
}

variable "node_group_spiffe_template" {
  description = "SPIFFE ID template for issued workload identities."
  type        = string
  default     = "spiffe://{{ .trustdomain }}/{{ .nodegroup }}/ns/{{ .k8s.ns }}/sa/{{ .k8s.sa }}"
}

variable "server_name" {
  description = "Name of the SWA server registration."
  type        = string
  default     = "minikube-server-1"
}

# --- How the in-cluster SWA Server authenticates to the control plane (JWT) ---
variable "server_subject" {
  description = "Expected subject of the server's projected SA token (audience 'conjur')."
  type        = string
  default     = "system:serviceaccount:swa-system:swa-server"
}

variable "server_audience" {
  description = "Expected audience of the server's control-plane JWT (chart uses 'conjur')."
  type        = string
  default     = "conjur"
}

variable "server_issuer" {
  description = "OIDC issuer of the cluster's service-account tokens (from fetch-cluster-jwks.sh)."
  type        = string
  default     = ""
}

variable "server_jwks_uri" {
  description = "JWKS URI for the server JWT. Use only if the control plane can reach the cluster."
  type        = string
  default     = ""
}

variable "server_public_keys" {
  description = <<-EOT
    Inline JWKS for the server JWT, for when the control plane CANNOT reach the
    cluster (the minikube case). Format:
    {"type":"jwks","value":{"keys":[...]}} as a JSON string.
    Populated by scripts/fetch-cluster-jwks.sh into cluster-jwks.auto.tfvars.json.
  EOT
  type        = string
  default     = ""
}
