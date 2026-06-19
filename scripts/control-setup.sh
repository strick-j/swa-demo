#!/usr/bin/env bash
# Prepare the CONTROL host (this machine) to run terraform-swa against Conjur
# Cloud using THIS host's IAM role (Conjur authn-iam):
#   1. pull the SWA bundle from S3 (control host has S3 access),
#   2. install the cyberark/swa Terraform provider into the local plugin dir,
#   3. write ~/.conjurrc (authn_type=aws) + ~/.swa-conjur.env for conjur-api-go.
# Idempotent; safe to re-run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "${ROOT}/.env" ]] && source "${ROOT}/.env"

: "${SWA_IMAGES_S3_URI:?Set SWA_IMAGES_S3_URI (bundle upload location)}"
: "${CONJUR_APPLIANCE_URL:?Set CONJUR_APPLIANCE_URL (e.g. https://<sub>.secretsmgr.cyberark.cloud/api)}"
: "${CONJUR_ACCOUNT:=conjur}"
: "${CONJUR_SERVICE_ID:=default}"
: "${CONJUR_HOST_ID:?Set CONJUR_HOST_ID (host/data/<aws-account-id>/<control-role-name>)}"
: "${AWS_REGION:=us-east-1}"

BUNDLE="${SWA_BUNDLE_DIR:-${HOME}/swa-bundle}"
log() { echo -e "\033[36m[control-setup]\033[0m $*"; }

log "Syncing SWA bundle (charts + provider, excluding images) from ${SWA_IMAGES_S3_URI}"
mkdir -p "${BUNDLE}"
AWS_DEFAULT_REGION="${AWS_REGION}" aws s3 sync "${SWA_IMAGES_S3_URI}" "${BUNDLE}" --exclude "*.tar"

INSTALLER="${BUNDLE}/install-terraform-provider.sh"
[[ -f "${INSTALLER}" ]] || { echo "Provider installer not found at ${INSTALLER}. Upload the full bundle to S3." >&2; exit 1; }
log "Installing the cyberark/swa Terraform provider"
bash "${INSTALLER}"

log "Writing ~/.conjurrc and ~/.swa-conjur.env (authn-iam)"
cat > "${HOME}/.conjurrc" <<EOF
---
appliance_url: ${CONJUR_APPLIANCE_URL}
account: ${CONJUR_ACCOUNT}
authn_type: aws
service_id: ${CONJUR_SERVICE_ID}
EOF
cat > "${HOME}/.swa-conjur.env" <<EOF
export CONJUR_APPLIANCE_URL="${CONJUR_APPLIANCE_URL}"
export CONJUR_ACCOUNT="${CONJUR_ACCOUNT}"
export CONJUR_AUTHN_LOGIN="${CONJUR_HOST_ID}"
export TF_VAR_conjur_appliance_url="${CONJUR_APPLIANCE_URL}"
EOF
chmod 600 "${HOME}/.conjurrc" "${HOME}/.swa-conjur.env"

log "Done. terraform-swa will authenticate to Conjur as ${CONJUR_HOST_ID} via this host's IAM role."
