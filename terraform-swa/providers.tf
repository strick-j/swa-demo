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
  }
}

# Auth via Conjur AWS IAM (authn-iam): this module runs ON the EC2 host, whose
# instance-profile role is enrolled as a Conjur host. conjur-api-go reads the
# host's ~/.conjurrc (authn_type: aws, service_id) + CONJUR_AUTHN_LOGIN (host_id)
# and signs an STS GetCallerIdentity request to mint a token — no keys, no
# `conjur login`. Only the service URL is passed explicitly here.
provider "swa" {
  url = var.conjur_appliance_url
}
