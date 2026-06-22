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

# Auth via Conjur API key (authn_type: authn): conjur-api-go reads
# CONJUR_AUTHN_LOGIN (the Conjur identity) + CONJUR_AUTHN_API_KEY from the
# environment (exported by scripts/control-setup.sh into ~/.swa-conjur.env,
# which `make tenant-tf` sources) to mint a token — no `conjur login`. Only the
# service URL is passed explicitly here.
provider "swa" {
  url = var.conjur_appliance_url
}
