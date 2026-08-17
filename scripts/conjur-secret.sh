#!/usr/bin/env bash
# Read a single secret VALUE from CyberArk Secrets Manager SaaS (Conjur Cloud) by
# variable path, and print it to stdout. Auth reuses scripts/conjur-token.sh — the
# Identity OIDC client-credentials flow that mints a short-lived Conjur access
# token (no static Conjur API key). Diagnostics go to stderr so stdout carries
# ONLY the secret value (safe for `register:` / command substitution).
#
# Usage:
#   scripts/conjur-secret.sh <variable-path>
#     e.g. scripts/conjur-secret.sh data/vault/MySafe/InstallerUser/password
#
# Requires (from .env, same as conjur-token.sh): IDENTITY_TENANT_ID,
# CONJUR_OIDC_CLIENT_ID, CONJUR_OIDC_CLIENT_SECRET, CONJUR_APPLIANCE_URL,
# CONJUR_ACCOUNT (default "conjur"), CONJUR_OIDC_SERVICE_ID (default "cyberark").
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"

log() { echo "[conjur-secret] $*" >&2; }

VAR_PATH="${1:-}"
[[ -n "${VAR_PATH}" ]] || { log "usage: $0 <variable-path>"; exit 2; }

# shellcheck disable=SC1091
[[ -f "${ROOT}/.env" ]] && source "${ROOT}/.env"

: "${CONJUR_APPLIANCE_URL:?Set CONJUR_APPLIANCE_URL (https://<sub>.secretsmgr.cyberark.cloud/api)}"
: "${CONJUR_ACCOUNT:=conjur}"

PYBIN="$([ -x "${ROOT}/.venv-ansible/bin/python" ] && echo "${ROOT}/.venv-ansible/bin/python" || command -v python3 || true)"
: "${PYBIN:?python3 is required}"

# Mint the base64-encoded Conjur access token (header-ready form) via the existing
# OIDC flow. conjur-token.sh prints diagnostics to stderr and the token to stdout.
log "Minting Conjur access token (Identity OIDC) via conjur-token.sh"
CONJUR_TOKEN="$(bash "${HERE}/conjur-token.sh")" \
  || { log "failed to mint Conjur access token (see conjur-token.sh output above)"; exit 1; }
[[ -n "${CONJUR_TOKEN}" ]] || { log "empty Conjur token"; exit 1; }

# Conjur REST: GET /secrets/{account}/variable/{identifier}, identifier URL-encoded
# (slashes become %2F). Keep the token out of argv by handing it to curl via a
# 0600 temp header file (visible to any local user via `ps` otherwise).
ENC_PATH="$(VAR_PATH="${VAR_PATH}" "${PYBIN}" -c \
  'import os,urllib.parse; print(urllib.parse.quote(os.environ["VAR_PATH"], safe=""))')"
SECRET_URL="${CONJUR_APPLIANCE_URL%/}/secrets/${CONJUR_ACCOUNT}/variable/${ENC_PATH}"

umask 077
HDR_FILE="$(mktemp)"
trap 'rm -f "${HDR_FILE}"' EXIT
printf 'Authorization: Token token="%s"\n' "${CONJUR_TOKEN}" > "${HDR_FILE}"

log "Fetching secret ${VAR_PATH} from ${CONJUR_APPLIANCE_URL%/}"
# Capture body + HTTP status (no -f, which would hide the body) so a non-200
# surfaces Conjur's actual reason (e.g. identity not permitted on the variable).
RESP="$(curl -sS -w $'\n%{http_code}' -H @"${HDR_FILE}" "${SECRET_URL}")" \
  || { log "secret fetch request failed (network/TLS)"; exit 1; }
CODE="${RESP##*$'\n'}"
BODY="${RESP%$'\n'*}"
if [[ "${CODE}" != "200" ]]; then
  log "GET secret returned HTTP ${CODE}"
  log "Conjur response body: ${BODY:-<empty>}"
  log "Check: does the OIDC identity have 'read'/'execute' on variable ${VAR_PATH}, and is the path (incl. any data/ prefix) correct?"
  exit 1
fi

# The value is the raw response body. Print it verbatim (no trailing newline) so
# command substitution / `register:` gets exactly the secret.
printf '%s' "${BODY}"
