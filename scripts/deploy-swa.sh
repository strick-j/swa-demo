#!/usr/bin/env bash
# Deploy SWA Server + Agent into minikube via Helm. Intended to run ON the host
# (it talks to the local minikube). Idempotent: safe to re-run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"

# shellcheck disable=SC1091
[[ -f "${ROOT}/.env" ]] && source "${ROOT}/.env"

: "${NS_SWA:=cyberark-swa}"
: "${NS_DEMO:=swa-demo}"
: "${SWA_TENANT_URL:?Set SWA_TENANT_URL}"
: "${SWA_IMAGE_REGISTRY:?Set SWA_IMAGE_REGISTRY}"
: "${SWA_TRUST_DOMAIN:?Set SWA_TRUST_DOMAIN}"

# Helm chart coordinates (OCI or classic repo). Confirm against SWA docs / your
# entitlement. Override in .env if your tenant publishes different refs.
: "${SWA_HELM_REPO:=oci://${SWA_IMAGE_REGISTRY}/charts}"
: "${SWA_SERVER_CHART:=${SWA_HELM_REPO}/swa-server}"
: "${SWA_AGENT_CHART:=${SWA_HELM_REPO}/swa-agent}"
: "${SWA_SERVER_IMAGE_TAG:=latest}"
: "${SWA_AGENT_IMAGE_TAG:=latest}"

# authn_id: prefer env, else the file written by tenant/03-register-server.sh.
if [[ -z "${SWA_AUTHN_ID:-}" && -f "${ROOT}/tenant/.authn_id" ]]; then
  SWA_AUTHN_ID="$(cat "${ROOT}/tenant/.authn_id")"
fi
: "${SWA_AUTHN_ID:?Run tenant/03-register-server.sh first (no authn_id found)}"
export NS_SWA NS_DEMO SWA_TENANT_URL SWA_IMAGE_REGISTRY SWA_TRUST_DOMAIN \
  SWA_SERVER_GROUP SWA_AUTHN_ID SWA_SERVER_IMAGE_TAG SWA_AGENT_IMAGE_TAG

log() { echo -e "\033[35m[swa]\033[0m $*"; }

# 1. Namespaces
log "Applying namespaces"
kubectl apply -f "${ROOT}/helm/namespaces.yaml"

# 2. Registry pull secret in both namespaces
for ns in "${NS_SWA}" "${NS_DEMO}"; do
  log "Creating image pull secret in ${ns}"
  kubectl -n "${ns}" create secret docker-registry swa-registry \
    --docker-server="${SWA_IMAGE_REGISTRY%%/*}" \
    --docker-username="${SWA_REGISTRY_USERNAME:?}" \
    --docker-password="${SWA_REGISTRY_PASSWORD:?}" \
    --dry-run=client -o yaml | kubectl apply -f -
done

# 3. Render values from templates
render() { envsubst < "$1" > "$2"; }
SERVER_VALUES="$(mktemp)"; AGENT_VALUES="$(mktemp)"
trap 'rm -f "${SERVER_VALUES}" "${AGENT_VALUES}"' EXIT
render "${ROOT}/helm/swa-server/values.yaml.tmpl" "${SERVER_VALUES}"
render "${ROOT}/helm/swa-agent/values.yaml.tmpl"  "${AGENT_VALUES}"

# 4. Install/upgrade SWA Server, then Agent
log "Installing SWA Server (${SWA_SERVER_CHART})"
helm upgrade --install swa-server "${SWA_SERVER_CHART}" \
  --namespace "${NS_SWA}" -f "${SERVER_VALUES}" --wait --timeout 5m

log "Installing SWA Agent (${SWA_AGENT_CHART})"
helm upgrade --install swa-agent "${SWA_AGENT_CHART}" \
  --namespace "${NS_SWA}" -f "${AGENT_VALUES}" --wait --timeout 5m

log "Waiting for SWA pods to be Ready"
kubectl -n "${NS_SWA}" wait --for=condition=Ready pod --all --timeout=180s

log "SWA Server + Agent deployed:"
kubectl -n "${NS_SWA}" get pods -o wide
