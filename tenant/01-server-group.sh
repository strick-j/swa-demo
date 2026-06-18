#!/usr/bin/env bash
# Create the server group: logical grouping of SWA Servers for the trust domain,
# defining allowed node types and attestation methods.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

log "Ensuring server group '${SWA_SERVER_GROUP}' exists..."

existing="$(api GET "${SWA_API_SERVER_GROUPS}?trustDomain=${SWA_TRUST_DOMAIN}" || echo '{}')"
if grep -q "\"${SWA_SERVER_GROUP}\"" <<<"$existing"; then
  log "Server group already present; skipping create."
  exit 0
fi

# Kubernetes service-account-token attestation for a minikube cluster.
body="$(cat <<JSON
{
  "name": "${SWA_SERVER_GROUP}",
  "trustDomain": "${SWA_TRUST_DOMAIN}",
  "nodeAttestationMethods": ["k8s_sat"],
  "description": "minikube SWA server group"
}
JSON
)"

api POST "${SWA_API_SERVER_GROUPS}" "$body" >/dev/null
log "Server group '${SWA_SERVER_GROUP}' created."
