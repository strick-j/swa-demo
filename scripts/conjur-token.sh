#!/usr/bin/env bash
# Mint a short-lived Conjur access token for the cyberark/swa Terraform provider
# using the CyberArk Identity OIDC client-credentials flow — no static Conjur API
# key required. Two exchanges (mirrors the Bruno/JS reference flow):
#   1. Identity platform token: client_credentials grant against
#      https://<IDENTITY_TENANT_ID>.id.cyberark.cloud/oauth2/platformtoken
#   2. Conjur access token: POST that platform token as `id_token` to Conjur's
#      authn-oidc authenticate endpoint
#      (<APPLIANCE_URL>/authn-oidc/<service>/<account>/authenticate).
#
# Two modes:
#   (default)    Read config from the environment (.env) and print the RAW Conjur
#                access token (JSON) to stdout. Handy for manual debugging.
#   --external   Terraform `external` data source protocol: read the query object
#                (client_id, client_secret, identity_tenant_id, appliance_url,
#                account, service_id) as JSON on stdin and print {"token": "..."}.
#                Used by terraform-swa/conjur-auth.tf so the client creds can come
#                straight from Conjur instead of .env.
#
# conjur-api-go (inside the provider) base64-encodes the token for the
# Authorization header, so we deliberately fetch the RAW (non-base64) form.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"

MODE="standalone"
[[ "${1:-}" == "--external" ]] && MODE="external"

PYBIN="$([ -x "${ROOT}/.venv-ansible/bin/python" ] && echo "${ROOT}/.venv-ansible/bin/python" || command -v python3 || true)"
: "${PYBIN:?python3 is required}"

# All diagnostics go to stderr so stdout carries only the token / JSON result.
log() { echo "[conjur-token] $*" >&2; }

if [[ "${MODE}" == "external" ]]; then
  # Terraform sends the query map as a JSON object on stdin.
  QUERY="$(cat)"
  q() { QUERY="${QUERY}" "${PYBIN}" -c 'import json,os,sys; print(json.loads(os.environ["QUERY"]).get(sys.argv[1], ""))' "$1"; }
  CONJUR_OIDC_CLIENT_ID="$(q client_id)"
  CONJUR_OIDC_CLIENT_SECRET="$(q client_secret)"
  IDENTITY_TENANT_ID="$(q identity_tenant_id)"
  CONJUR_APPLIANCE_URL="$(q appliance_url)"
  CONJUR_ACCOUNT="$(q account)"
  CONJUR_OIDC_SERVICE_ID="$(q service_id)"
else
  # shellcheck disable=SC1091
  [[ -f "${ROOT}/.env" ]] && source "${ROOT}/.env"
fi

: "${IDENTITY_TENANT_ID:?Set IDENTITY_TENANT_ID (the <tenant>.id.cyberark.cloud subdomain)}"
: "${CONJUR_OIDC_CLIENT_ID:?Missing client_id (Identity OAuth confidential client id)}"
: "${CONJUR_OIDC_CLIENT_SECRET:?Missing client_secret (its client secret)}"
: "${CONJUR_APPLIANCE_URL:?Set CONJUR_APPLIANCE_URL (https://<sub>.secretsmgr.cyberark.cloud/api)}"
: "${CONJUR_ACCOUNT:=conjur}"
: "${CONJUR_OIDC_SERVICE_ID:=cyberark}"

PLATFORM_URL="https://${IDENTITY_TENANT_ID}.id.cyberark.cloud/oauth2/platformtoken"
log "Requesting Identity platform token (client_credentials) from ${PLATFORM_URL}"
PLATFORM_RESP="$(curl -fsS -X POST "${PLATFORM_URL}" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode "client_id=${CONJUR_OIDC_CLIENT_ID}" \
  --data-urlencode "client_secret=${CONJUR_OIDC_CLIENT_SECRET}")" \
  || { log "platform token request failed (check IDENTITY_TENANT_ID + client id/secret)"; exit 1; }

PLATFORM_TOKEN="$(PLATFORM_RESP="${PLATFORM_RESP}" "${PYBIN}" - <<'PY'
import json, os, sys
try:
    data = json.loads(os.environ["PLATFORM_RESP"])
except json.JSONDecodeError:
    sys.stderr.write("ERROR: platform token response was not JSON\n")
    sys.exit(1)
token = data.get("access_token", "")
if not token:
    sys.stderr.write("ERROR: no access_token in platform token response\n")
    sys.exit(1)
print(token)
PY
)"

AUTHN_URL="${CONJUR_APPLIANCE_URL%/}/authn-oidc/${CONJUR_OIDC_SERVICE_ID}/${CONJUR_ACCOUNT}/authenticate"
log "Exchanging platform token for a Conjur access token at ${AUTHN_URL}"
# Capture body + HTTP status (don't use -f, which hides the body) so a non-200
# surfaces Conjur's actual reason (e.g. identity not permitted on the authenticator).
AUTHN_RESP="$(curl -sS -w $'\n%{http_code}' -X POST "${AUTHN_URL}" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "id_token=${PLATFORM_TOKEN}")" \
  || { log "Conjur authn-oidc authenticate request failed (network/TLS)"; exit 1; }
AUTHN_CODE="${AUTHN_RESP##*$'\n'}"
CONJUR_TOKEN="${AUTHN_RESP%$'\n'*}"
if [[ "${AUTHN_CODE}" != "200" ]]; then
  log "authn-oidc authenticate returned HTTP ${AUTHN_CODE}"
  log "Conjur response body: ${CONJUR_TOKEN:-<empty>}"
  log "Check: is ${CONJUR_AUTHN_LOGIN:-the OAuth client identity} permitted on authn-oidc/${CONJUR_OIDC_SERVICE_ID}, and is service_id/account/appliance_url correct?"
  exit 1
fi

[[ -n "${CONJUR_TOKEN}" ]] || { log "empty Conjur token response"; exit 1; }
log "Conjur access token acquired."

if [[ "${MODE}" == "external" ]]; then
  # Emit the Terraform external data source result: a flat object of strings.
  CONJUR_TOKEN="${CONJUR_TOKEN}" "${PYBIN}" -c 'import json,os; print(json.dumps({"token": os.environ["CONJUR_TOKEN"]}))'
else
  printf '%s' "${CONJUR_TOKEN}"
fi
