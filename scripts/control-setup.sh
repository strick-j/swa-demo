#!/usr/bin/env bash
# Prepare the CONTROL host (this machine) to run terraform-swa against Conjur
# Cloud. Auth uses a short-lived Conjur access token minted per-apply by
# scripts/conjur-token.sh (CyberArk Identity OIDC flow) — no static API key:
#   1. pull the SWA bundle from S3 (control host has S3 access),
#   2. install the cyberark/swa Terraform provider into the local plugin dir,
#   3. write ~/.conjurrc (appliance_url + account) for conjur-api-go.
# Idempotent; safe to re-run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "${ROOT}/.env" ]] && source "${ROOT}/.env"

: "${SWA_IMAGES_S3_URI:?Set SWA_IMAGES_S3_URI (bundle upload location)}"
: "${CONJUR_APPLIANCE_URL:?Set CONJUR_APPLIANCE_URL (e.g. https://<sub>.secretsmgr.cyberark.cloud/api)}"
: "${CONJUR_ACCOUNT:=conjur}"
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

# Minimal ~/.conjurrc so conjur-api-go knows the appliance URL + account. The
# access token itself is minted per-apply by scripts/conjur-token.sh (Identity
# OIDC flow) and passed to the provider as TF_VAR_conjur_access_token — no
# credentials are written here.
log "Writing ~/.conjurrc (appliance_url + account)"
cat > "${HOME}/.conjurrc" <<EOF
---
appliance_url: ${CONJUR_APPLIANCE_URL}
account: ${CONJUR_ACCOUNT}
EOF
chmod 600 "${HOME}/.conjurrc"

log "Done. 'make tenant-tf' mints a Conjur access token (Identity OIDC) at apply time."
