terraform {
  required_version = ">= 1.5.0"

  required_providers {
    swa = {
      # Installed locally from the SWA release bundle via
      # ./install-terraform-provider.sh (not the public registry); Terraform
      # discovers it in ~/.terraform.d/plugins. This version MUST match what the
      # installer prints (update if you use a different bundle).
      source  = "cyberark/swa"
      version = "0.1.0-c2081762-821"
    }
    # Reads the CyberArk Identity OAuth client (client_id/secret) out of Conjur
    # so no static secret lives in .env. Pulled from the public registry, so
    # `terraform init` on the control host needs registry access.
    conjur = {
      source  = "cyberark/conjur"
      version = "~> 0.7"
    }
    # Runs scripts/conjur-token.sh to mint the SWA access token (see conjur-auth.tf).
    external = {
      source  = "hashicorp/external"
      version = "~> 2.3"
    }
  }
}

# Bootstrap auth used ONLY to read the SCA OIDC client creds from Conjur. Keep
# this keyless where possible (e.g. authn_type=iam with the control host's
# role); all fields are variable-driven so you can pick whatever your tenant
# enables. See conjur-auth.tf for how the creds are then exchanged for the SWA
# token.
provider "conjur" {
  appliance_url = var.conjur_appliance_url
  account       = var.conjur_account
  authn_type    = var.conjur_authn_type
  service_id    = var.conjur_authn_service_id
  host_id       = var.conjur_host_id
}

# The SWA provider authenticates with a short-lived Conjur access token. By
# default that token is minted in-graph by data.external.conjur_token (Identity
# OIDC flow using the Conjur-sourced client creds). Set TF_VAR_conjur_access_token
# to bypass the flow with a pre-minted token (debugging).
provider "swa" {
  url          = var.conjur_appliance_url
  access_token = var.conjur_access_token != "" ? var.conjur_access_token : data.external.conjur_token.result.token
}
