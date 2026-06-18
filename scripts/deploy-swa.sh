#!/usr/bin/env bash
# Deploy SWA Server + Agent into minikube via Helm. Intended to run ON the host.
# Images are pre-loaded into minikube from S3 tarballs (see ansible swa_images
# role); their repo:tags are auto-detected from ~/.swa-images. No registry or
# imagePullSecret is used. Idempotent: safe to re-run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"

# shellcheck disable=SC1091
[[ -f "${ROOT}/.env" ]] && source "${ROOT}/.env"

: "${NS_SWA:=cyberark-swa}"
: "${NS_DEMO:=swa-demo}"
: "${SWA_TENANT_URL:?Set SWA_TENANT_URL}"
: "${SWA_TRUST_DOMAIN:?Set SWA_TRUST_DOMAIN}"

log() { echo -e "\033[35m[swa]\033[0m $*"; }

# --- Resolve pre-loaded image references ----------------------------------
IMAGES_FILE="${SWA_IMAGES_FILE:-${HOME}/.swa-images}"
detect() { # $1 = case-insensitive keyword to match in the loaded image list
  [[ -f "${IMAGES_FILE}" ]] && grep -iE "$1" "${IMAGES_FILE}" | head -n1 || true
}
# Explicit env overrides win; otherwise pick by 'server'/'agent' in the repo name.
SWA_SERVER_IMAGE="${SWA_SERVER_IMAGE:-$(detect 'server')}"
SWA_AGENT_IMAGE="${SWA_AGENT_IMAGE:-$(detect 'agent')}"
: "${SWA_SERVER_IMAGE:?No server image found in ${IMAGES_FILE}; set SWA_SERVER_IMAGE}"
: "${SWA_AGENT_IMAGE:?No agent image found in ${IMAGES_FILE}; set SWA_AGENT_IMAGE}"

# Split "repo:tag" on the LAST colon (handles registry host:port prefixes).
SWA_SERVER_IMAGE_REPO="${SWA_SERVER_IMAGE%:*}"; SWA_SERVER_IMAGE_TAG="${SWA_SERVER_IMAGE##*:}"
SWA_AGENT_IMAGE_REPO="${SWA_AGENT_IMAGE%:*}";   SWA_AGENT_IMAGE_TAG="${SWA_AGENT_IMAGE##*:}"
log "Server image: ${SWA_SERVER_IMAGE}"
log "Agent image:  ${SWA_AGENT_IMAGE}"

# authn_id: prefer env, else the file written by tenant/03-register-server.sh.
if [[ -z "${SWA_AUTHN_ID:-}" && -f "${ROOT}/tenant/.authn_id" ]]; then
  SWA_AUTHN_ID="$(cat "${ROOT}/tenant/.authn_id")"
fi
: "${SWA_AUTHN_ID:?Run tenant/03-register-server.sh first (no authn_id found)}"

export NS_SWA NS_DEMO SWA_TENANT_URL SWA_TRUST_DOMAIN SWA_SERVER_GROUP SWA_AUTHN_ID \
  SWA_SERVER_IMAGE_REPO SWA_SERVER_IMAGE_TAG SWA_AGENT_IMAGE_REPO SWA_AGENT_IMAGE_TAG

# --- Resolve chart references (local .tgz preferred, else OCI/repo) ---------
local_chart() { ls "${ROOT}/helm/charts/$1"*.tgz 2>/dev/null | head -n1 || true; }
: "${SWA_SERVER_CHART:=$(local_chart swa-server)}"
: "${SWA_AGENT_CHART:=$(local_chart swa-agent)}"
: "${SWA_SERVER_CHART:?No server chart: place helm/charts/swa-server*.tgz or set SWA_SERVER_CHART}"
: "${SWA_AGENT_CHART:?No agent chart: place helm/charts/swa-agent*.tgz or set SWA_AGENT_CHART}"

# --- Deploy ----------------------------------------------------------------
log "Applying namespaces"
kubectl apply -f "${ROOT}/helm/namespaces.yaml"

render() { envsubst < "$1" > "$2"; }
SERVER_VALUES="$(mktemp)"; AGENT_VALUES="$(mktemp)"
trap 'rm -f "${SERVER_VALUES}" "${AGENT_VALUES}"' EXIT
render "${ROOT}/helm/swa-server/values.yaml.tmpl" "${SERVER_VALUES}"
render "${ROOT}/helm/swa-agent/values.yaml.tmpl"  "${AGENT_VALUES}"

log "Installing SWA Server (${SWA_SERVER_CHART})"
helm upgrade --install swa-server "${SWA_SERVER_CHART}" \
  --namespace "${NS_SWA}" -f "${SERVER_VALUES}" --wait --timeout 5m

log "Installing SWA Agent (${SWA_AGENT_CHART})"
helm upgrade --install swa-agent "${SWA_AGENT_CHART}" \
  --namespace "${NS_SWA}" -f "${AGENT_VALUES}" --wait --timeout 5m

log "Waiting for SWA pods to be Ready"
kubectl -n "${NS_SWA}" wait --for=condition=Ready pod --all --timeout=180s
kubectl -n "${NS_SWA}" get pods -o wide
