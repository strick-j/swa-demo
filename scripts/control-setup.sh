#!/usr/bin/env bash
# Prepare the CONTROL host (this machine) to run terraform-swa against Conjur
# Cloud using a Conjur identity + API key (authn_type=authn):
#   1. pull the SWA bundle from S3 (control host has S3 access),
#   2. install the cyberark/swa Terraform provider into the local plugin dir,
#   3. write ~/.conjurrc (authn_type=authn) + ~/.swa-conjur.env for conjur-api-go.
# Idempotent; safe to re-run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "${ROOT}/.env" ]] && source "${ROOT}/.env"

: "${SWA_IMAGES_S3_URI:?Set SWA_IMAGES_S3_URI (bundle upload location)}"
: "${CONJUR_APPLIANCE_URL:?Set CONJUR_APPLIANCE_URL (e.g. https://<sub>.secretsmgr.cyberark.cloud/api)}"
: "${CONJUR_ACCOUNT:=conjur}"
: "${CONJUR_AUTHN_TYPE:=authn}"
: "${CONJUR_SERVICE_ID:=default}"
: "${CONJUR_AUTHN_LOGIN:?Set CONJUR_AUTHN_LOGIN (the Conjur identity, e.g. host/data/<app>/<host>)}"
: "${CONJUR_AUTHN_API_KEY:?Set CONJUR_AUTHN_API_KEY (the API key for CONJUR_AUTHN_LOGIN)}"
: "${AWS_REGION:=us-east-1}"

BUNDLE="${SWA_BUNDLE_DIR:-${HOME}/swa-bundle}"
log() { echo -e "\033[36m[control-setup]\033[0m $*"; }

log "Syncing SWA bundle (charts + provider, excluding images) from ${SWA_IMAGES_S3_URI}"
mkdir -p "${BUNDLE}"
AWS_DEFAULT_REGION="${AWS_REGION}" aws s3 sync "${SWA_IMAGES_S3_URI}" "${BUNDLE}" --exclude "*.tar"

INSTALLER="${BUNDLE}/install-terraform-provider.sh"
[[ -f "${INSTALLER}" ]] || { echo "Provider installer not found at ${INSTALLER}. Upload the full bundle to S3." >&2; exit 1; }
# The bundle installer selects the provider binary with
# `find -name 'terraform-provider-swa_v*' | head -1`, which also matches the
# detached `.sig` signature shipped alongside the linux_amd64 binary. Depending
# on filesystem ordering it can install the .sig as the "binary", after which
# Terraform tries to exec it and fails with "exec format error". Terraform
# verifies providers via the lock-file hashes, not these detached sigs, so drop
# them from the synced bundle before installing.
log "Removing detached provider signatures so the installer can't pick them up"
find "${BUNDLE}/terraform-provider" -name 'terraform-provider-swa_v*.sig' -delete 2>/dev/null || true
log "Installing the cyberark/swa Terraform provider"
bash "${INSTALLER}"

log "Writing ~/.conjurrc and ~/.swa-conjur.env (authn API-key)"
cat > "${HOME}/.conjurrc" <<EOF
---
appliance_url: ${CONJUR_APPLIANCE_URL}
account: ${CONJUR_ACCOUNT}
authn_type: ${CONJUR_AUTHN_TYPE}
service_id: ${CONJUR_SERVICE_ID}
EOF
# conjur-api-go (used by the cyberark/swa provider) reads these from ~/.conjurrc
# AND from the environment. Export the login + API key so the provider can
# authenticate with the 'authn' (username/API-key) method at `terraform apply`
# time even if it doesn't read ~/.conjurrc. CONJUR_AUTHN_API_KEY is a secret;
# the file is chmod 600 below.
cat > "${HOME}/.swa-conjur.env" <<EOF
export CONJUR_APPLIANCE_URL="${CONJUR_APPLIANCE_URL}"
export CONJUR_ACCOUNT="${CONJUR_ACCOUNT}"
export CONJUR_AUTHN_TYPE="${CONJUR_AUTHN_TYPE}"
export CONJUR_AUTHN_SERVICE_ID="${CONJUR_SERVICE_ID}"
export CONJUR_AUTHN_LOGIN="${CONJUR_AUTHN_LOGIN}"
export CONJUR_AUTHN_API_KEY="${CONJUR_AUTHN_API_KEY}"
export TF_VAR_conjur_appliance_url="${CONJUR_APPLIANCE_URL}"
EOF
chmod 600 "${HOME}/.conjurrc" "${HOME}/.swa-conjur.env"

log "Done. terraform-swa will authenticate to Conjur as ${CONJUR_AUTHN_LOGIN} (authn_type=${CONJUR_AUTHN_TYPE})."
