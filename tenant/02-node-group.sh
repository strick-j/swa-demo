#!/usr/bin/env bash
# Create the node group: rules for node + workload attestation that control which
# workloads receive SVIDs. We scope issuance to the demo namespace + service account.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

: "${NS_DEMO:=swa-demo}"
WEBAPP_SA="${WEBAPP_SA:-swa-demo-webapp}"

log "Ensuring node group '${SWA_NODE_GROUP}' exists..."

existing="$(api GET "${SWA_API_NODE_GROUPS}?serverGroup=${SWA_SERVER_GROUP}" || echo '{}')"
if grep -q "\"${SWA_NODE_GROUP}\"" <<<"$existing"; then
  log "Node group already present; skipping create."
  exit 0
fi

# Workload attestation: issue a SPIFFE ID to pods in NS_DEMO using WEBAPP_SA.
# The resulting SPIFFE ID template maps namespace/service-account into the path.
body="$(cat <<JSON
{
  "name": "${SWA_NODE_GROUP}",
  "serverGroup": "${SWA_SERVER_GROUP}",
  "trustDomain": "${SWA_TRUST_DOMAIN}",
  "workloadSelectors": [
    { "type": "k8s", "key": "ns", "value": "${NS_DEMO}" },
    { "type": "k8s", "key": "sa", "value": "${WEBAPP_SA}" }
  ],
  "spiffeIdTemplate": "spiffe://${SWA_TRUST_DOMAIN}/ns/${NS_DEMO}/sa/${WEBAPP_SA}",
  "jwtSvid": { "enabled": true }
}
JSON
)"

api POST "${SWA_API_NODE_GROUPS}" "$body" >/dev/null
log "Node group '${SWA_NODE_GROUP}' created (workloads: ns=${NS_DEMO}, sa=${WEBAPP_SA})."
