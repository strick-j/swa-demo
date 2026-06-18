# SWA tenant resources: trust domain -> server group -> server -> node group.
# Apply order is handled by Terraform via the reference graph.

resource "swa_trust_domain" "this" {
  name = var.trust_domain

  jwt = {
    signature_algorithm = "ES256"
    signing_key_type    = "EC_P256"
    signing_key_ttl     = var.jwt_signing_key_ttl
    token_ttl           = var.jwt_token_ttl
  }

  x509 = {
    workload_ttl = 3600
  }
}

resource "swa_server_group" "this" {
  name              = var.server_group
  description       = "minikube SWA server group (k8s_psat)"
  trust_domain_name = swa_trust_domain.this.name

  node_attestation = {
    k8s_psat = {
      clusters = {
        (var.cluster_name) = {
          service_account_allow_list = var.agent_service_accounts
          audience                   = var.psat_audience
          allowed_pod_label_keys     = ["swa_nodegroup"]
        }
      }
    }
  }
}

# The in-cluster SWA Server's authenticator. Exposes authn_id, consumed by the
# swa-server Helm chart (controlPlane.auth.authnID).
resource "swa_server" "this" {
  name            = var.server_name
  server_group_id = swa_server_group.this.id

  auth = {
    type     = "JWT"
    subject  = var.server_subject
    audience = var.server_audience
    issuer   = var.server_issuer
    # Exactly one of jwks_uri / public_keys is used; the other stays null.
    jwks_uri    = var.server_jwks_uri != "" ? var.server_jwks_uri : null
    public_keys = var.server_public_keys != "" ? var.server_public_keys : null
  }
}

resource "swa_node_group" "this" {
  name              = var.node_group
  trust_domain_name = swa_trust_domain.this.name
  server_group_name = swa_server_group.this.name
  workload_type     = "kubernetes"
  description       = "minikube workloads (ns=${var.workload_namespace})"

  workload_configuration = {
    spiffe_id_template = var.node_group_spiffe_template

    # Restrict issuance to the demo workload's namespace + service account.
    workload_registration_policies = [
      "k8s.ns == '${var.workload_namespace}' && k8s.sa == '${var.workload_service_account}'"
    ]
  }
}
