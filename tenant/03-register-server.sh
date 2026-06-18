#!/usr/bin/env bash
# Register an SWA Server in the server group and capture its authn_id, which the
# Helm chart needs so the in-cluster server can authenticate back to the tenant.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SERVER_NAME="${SWA_SERVER_NAME:-minikube-server-1}"

log "Registering SWA server '${SERVER_NAME}' in group '${SWA_SERVER_GROUP}'..."

body="$(cat <<JSON
{
  "name": "${SERVER_NAME}",
  "serverGroup": "${SWA_SERVER_GROUP}",
  "trustDomain": "${SWA_TRUST_DOMAIN}"
}
JSON
)"

resp="$(api POST "${SWA_API_SERVERS}" "$body")"

# Extract authn_id from the response (field name may be authnId/authn_id/id).
authn_id="$(grep -oE '"authn[_]?[Ii]d"[[:space:]]*:[[:space:]]*"[^"]+"' <<<"$resp" \
  | head -n1 | sed -E 's/.*"([^"]+)"$/\1/')"

if [[ -z "${authn_id}" ]]; then
  echo "ERROR: could not parse authn_id from registration response:" >&2
  echo "$resp" >&2
  exit 1
fi

printf '%s' "${authn_id}" > "${AUTHN_ID_FILE}"
log "Server registered. authn_id written to ${AUTHN_ID_FILE}"
log "Add this to .env as SWA_AUTHN_ID=${authn_id} (or it is read from the file by deploy-swa.sh)."
