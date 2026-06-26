#!/usr/bin/env bash
# Build the webapp image into minikube and/or deploy its manifests.
# Usage: deploy-webapp.sh [build|deploy|all]   (default: all)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "${ROOT}/.env" ]] && source "${ROOT}/.env"

: "${WEBAPP_IMAGE:=swa-demo-webapp:dev}"
: "${NS_DEMO:=swa-demo}"
: "${WEBAPP_NODEPORT:=30080}"
ACTION="${1:-all}"

log() { echo -e "\033[34m[webapp]\033[0m $*"; }

# docker-driver minikube keeps the NodePort on the minikube container IP, not the
# host's public interface, so the SG-opened public URL is unreachable without a
# bridge. Forward host:NODEPORT -> minikube:NODEPORT with a transient systemd
# unit running socat (installed by the common ansible role). Idempotent.
expose() {
  local mk_ip
  mk_ip="$(minikube ip 2>/dev/null || true)"
  if [[ -z "${mk_ip}" ]]; then
    log "WARN: could not resolve 'minikube ip'; skipping NodePort forward"
    return
  fi
  log "Bridging host:${WEBAPP_NODEPORT} -> ${mk_ip}:${WEBAPP_NODEPORT} (socat/systemd)"
  sudo systemctl stop swa-webapp-forward 2>/dev/null || true
  sudo systemctl reset-failed swa-webapp-forward 2>/dev/null || true
  sudo systemd-run --unit=swa-webapp-forward --collect \
    socat "TCP-LISTEN:${WEBAPP_NODEPORT},fork,reuseaddr" "TCP:${mk_ip}:${WEBAPP_NODEPORT}"
}

build() {
  log "Building image ${WEBAPP_IMAGE}"
  # Build directly inside minikube's docker so no registry push is needed.
  if command -v minikube >/dev/null; then
    eval "$(minikube -p minikube docker-env)"
  fi
  docker build -t "${WEBAPP_IMAGE}" "${ROOT}/webapp"
  log "Image built in minikube docker context."
}

# Apply the data plane + identity-scenario workloads: Postgres, the SPIFFE mTLS
# gateway, and the two contrast pods (untrusted = valid SVID denied at the
# gateway; rogue = no registration policy, refused an SVID). Idempotent.
deploy_data() {
  log "Applying data plane + scenario workloads (postgres, gateway, untrusted, rogue)"
  kubectl apply -f "${ROOT}/k8s/postgres.yaml"
  kubectl apply -f "${ROOT}/k8s/pg-gateway.yaml"
  kubectl apply -f "${ROOT}/k8s/untrusted-app.yaml"
  kubectl apply -f "${ROOT}/k8s/rogue-app.yaml"
  # The :dev image tag is mutable and these manifests rarely change, so `apply`
  # alone won't restart the pods onto a freshly built binary. Force a roll so
  # the contrast pods always serve the current /probe-svid route.
  kubectl -n swa-demo-untrusted rollout restart deploy/untrusted-app
  kubectl -n swa-demo-rogue rollout restart deploy/rogue-app
  kubectl -n swa-data rollout status deploy/postgres --timeout=120s || true
  kubectl -n swa-data rollout status deploy/pg-gateway --timeout=120s || true
  kubectl -n swa-demo-untrusted rollout status deploy/untrusted-app --timeout=120s || true
  kubectl -n swa-demo-rogue rollout status deploy/rogue-app --timeout=120s || true
}

deploy() {
  deploy_data
  log "Applying webapp manifests to namespace ${NS_DEMO}"
  kubectl apply -f "${ROOT}/k8s/webapp-serviceaccount.yaml"
  kubectl apply -f "${ROOT}/k8s/webapp-deployment.yaml"
  kubectl apply -f "${ROOT}/k8s/webapp-service.yaml"
  # Force a roll so a rebuilt :dev image is picked up even when the manifest is
  # unchanged (mutable tag).
  kubectl -n "${NS_DEMO}" rollout restart deploy/swa-demo-webapp
  kubectl -n "${NS_DEMO}" rollout status deploy/swa-demo-webapp --timeout=120s
  expose
  log "Webapp deployed. URL: http://<host>:${WEBAPP_NODEPORT}"
}

case "${ACTION}" in
  build) build ;;
  deploy) deploy ;;
  all) build; deploy ;;
  *) echo "usage: $0 [build|deploy|all]" >&2; exit 1 ;;
esac
