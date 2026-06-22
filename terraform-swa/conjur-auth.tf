# Conjur-backed auth for the SWA provider.
#
# 1. Read the CyberArk Identity OAuth client (client_id/secret) from Conjur. The
#    secret values are marked sensitive but, like all Terraform data sources,
#    are persisted to state — protect/encrypt your state backend accordingly.
# 2. Exchange them for a short-lived Conjur access token via the Identity OIDC
#    client-credentials flow (scripts/conjur-token.sh, run as an `external` data
#    source so it can consume the Conjur-sourced creds). The token is consumed
#    by the swa provider (providers.tf).

data "conjur_secret" "sca_username" {
  name = var.conjur_sca_username_path
}

data "conjur_secret" "sca_password" {
  name = var.conjur_sca_password_path
}

# client_id = sca_username, client_secret = sca_password.
data "external" "conjur_token" {
  program = ["bash", "${path.module}/../scripts/conjur-token.sh", "--external"]

  query = {
    client_id          = data.conjur_secret.sca_username.value
    client_secret      = data.conjur_secret.sca_password.value
    identity_tenant_id = var.identity_tenant_id
    appliance_url      = var.conjur_appliance_url
    account            = var.conjur_account
    service_id         = var.conjur_oidc_service_id
  }
}
