#!/usr/bin/env bash
# Deploy SWA Server + Agent into minikube via the bundled Helm charts. Runs ON
# the host. Images are pre-loaded into minikube (ansible swa_images), repo:tags
# auto-detected from ~/.swa-images. authn_id + trust domain come from the
# terraform-swa outputs (preferred) or .env. Idempotent.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "${ROOT}/.env" ]] && source "${ROOT}/.env"
# Tenant outputs (authn_id, trust domain, cluster, node group) pushed from the
# local terraform-swa apply (see Makefile `swa` target / host-push.sh).
# shellcheck disable=SC1091
if [[ -f "${ROOT}/outputs.env" ]]; then set -a; source "${ROOT}/outputs.env"; set +a; fi

: "${NS_SWA:=swa-system}"
: "${NS_DEMO:=swa-demo}"
: "${SWA_CONTROLPLANE_URL:=${SWA_TENANT_URL:-}}"
: "${SWA_CONTROLPLANE_URL:?Set SWA_CONTROLPLANE_URL (or SWA_TENANT_URL)}"

log() { echo -e "\033[35m[swa]\033[0m $*"; }

# --- Pull tenant config from terraform-swa outputs when available ----------
TFSWA="${ROOT}/terraform-swa"
tfout() { terraform -chdir="${TFSWA}" output -raw "$1" 2>/dev/null || true; }
if [[ -d "${TFSWA}/.terraform" ]]; then
  SWA_AUTHN_ID="${SWA_AUTHN_ID:-$(tfout authn_id)}"
  SWA_TRUST_DOMAIN="${SWA_TRUST_DOMAIN:-$(tfout trust_domain_name)}"
  SWA_CLUSTER_NAME="${SWA_CLUSTER_NAME:-$(tfout cluster_name)}"
  SWA_NODE_GROUP="${SWA_NODE_GROUP:-$(tfout node_group_name)}"
fi
: "${SWA_TRUST_DOMAIN:?trust domain not set (run terraform-swa or set SWA_TRUST_DOMAIN)}"
: "${SWA_AUTHN_ID:?authn_id not set (run terraform-swa apply or set SWA_AUTHN_ID)}"
: "${SWA_CLUSTER_NAME:=minikube}"
: "${SWA_NODE_GROUP:=minikube-nodes}"

# --- Resolve pre-loaded image references -----------------------------------
IMAGES_FILE="${SWA_IMAGES_FILE:-${HOME}/.swa-images}"
detect() { [[ -f "${IMAGES_FILE}" ]] && grep -iE "$1" "${IMAGES_FILE}" | head -n1 || true; }
SWA_SERVER_IMAGE="${SWA_SERVER_IMAGE:-$(detect 'server')}"
SWA_AGENT_IMAGE="${SWA_AGENT_IMAGE:-$(detect 'agent')}"
: "${SWA_SERVER_IMAGE:?No server image in ${IMAGES_FILE}; set SWA_SERVER_IMAGE}"
: "${SWA_AGENT_IMAGE:?No agent image in ${IMAGES_FILE}; set SWA_AGENT_IMAGE}"
SWA_SERVER_IMAGE_REPO="${SWA_SERVER_IMAGE%:*}"; SWA_SERVER_IMAGE_TAG="${SWA_SERVER_IMAGE##*:}"
SWA_AGENT_IMAGE_REPO="${SWA_AGENT_IMAGE%:*}";   SWA_AGENT_IMAGE_TAG="${SWA_AGENT_IMAGE##*:}"
log "Server image: ${SWA_SERVER_IMAGE}"
log "Agent image:  ${SWA_AGENT_IMAGE}"

export NS_SWA NS_DEMO SWA_CONTROLPLANE_URL SWA_AUTHN_ID SWA_TRUST_DOMAIN \
  SWA_CLUSTER_NAME SWA_NODE_GROUP \
  SWA_SERVER_IMAGE_REPO SWA_SERVER_IMAGE_TAG SWA_AGENT_IMAGE_REPO SWA_AGENT_IMAGE_TAG

# --- Resolve bundled chart packages ----------------------------------------
chart() { ls "${ROOT}/helm/charts/$1"*.tgz 2>/dev/null | head -n1 || true; }
: "${SWA_SERVER_CHART:=$(chart swa-server)}"
: "${SWA_AGENT_CHART:=$(chart swa-agent)}"
: "${SWA_SERVER_CHART:?Place the bundle's swa-server-*.tgz in helm/charts/ (make vendor-charts)}"
: "${SWA_AGENT_CHART:?Place the bundle's swa-agent-*.tgz in helm/charts/ (make vendor-charts)}"

# --- Deploy ----------------------------------------------------------------
log "Applying namespaces"
kubectl apply -f "${ROOT}/helm/namespaces.yaml"

render() { envsubst < "$1" > "$2"; }
SERVER_VALUES="$(mktemp)"; AGENT_VALUES="$(mktemp)"
trap 'rm -f "${SERVER_VALUES}" "${AGENT_VALUES}"' EXIT
render "${ROOT}/helm/swa-server/values.yaml.tmpl" "${SERVER_VALUES}"
render "${ROOT}/helm/swa-agent/values.yaml.tmpl"  "${AGENT_VALUES}"

# Optional control-plane bootstrap token (token.json) for the server.
SERVER_TOKEN_ARGS=()
if [[ -n "${SWA_CONTROLPLANE_TOKEN_FILE:-}" && -f "${SWA_CONTROLPLANE_TOKEN_FILE}" ]]; then
  log "Including control-plane token from ${SWA_CONTROLPLANE_TOKEN_FILE}"
  SERVER_TOKEN_ARGS=(--set-file "controlPlane.token=${SWA_CONTROLPLANE_TOKEN_FILE}")
fi

log "Installing SWA Server (${SWA_SERVER_CHART})"
helm upgrade --install swa-server "${SWA_SERVER_CHART}" \
  --namespace "${NS_SWA}" --create-namespace \
  -f "${SERVER_VALUES}" "${SERVER_TOKEN_ARGS[@]}" --wait --timeout 5m

log "Installing SWA Agent (${SWA_AGENT_CHART})"
helm upgrade --install swa-agent "${SWA_AGENT_CHART}" \
  --namespace "${NS_SWA}" \
  -f "${AGENT_VALUES}" --wait --timeout 5m

log "Waiting for SWA pods to be Ready"
kubectl -n "${NS_SWA}" wait --for=condition=Ready pod --all --timeout=180s
kubectl -n "${NS_SWA}" get pods -o wide
