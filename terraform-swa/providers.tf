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

# Zero-config auth: relies on a prior `conjur login` to your Secrets Manager - SaaS
# (Conjur Cloud) tenant. Override with url/access_token or CONJUR_* env if needed.
provider "swa" {}
