#!/usr/bin/env bash
# Install the CP host bridge as a systemd service. Run ON the host where the
# CyberArk Credential Provider and its JavaPasswordSDK are installed (invoke via
# `scripts/host-exec.sh "bash scripts/install-cp-bridge.sh"` from the control
# machine, or directly on the host from the staged ~/swa-demo copy).
#
# Idempotent: rebuilds the jars, refreshes the install, (re)starts the service.
# Leaves an existing /etc/swa-cp/cp-bridge.env untouched so your CyberArk object
# coordinates survive re-runs.
#
# Env:
#   CP_SDK_JAR    JavaPasswordSDK.jar (default /opt/CARKaim/sdk/JavaPasswordSDK.jar)
#   CP_RUN_USER   OS user the service runs as, and the user registered on the CP
#                 Application's OS-user characteristic (default: current user)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
BRIDGE_SRC="${ROOT}/hostbridge/cp"

CP_SDK_JAR="${CP_SDK_JAR:-/opt/CARKaim/sdk/JavaPasswordSDK.jar}"
CP_RUN_USER="${CP_RUN_USER:-$(id -un)}"
PREFIX="/opt/swa-cp"
ENV_DIR="/etc/swa-cp"
UNIT="/etc/systemd/system/cp-bridge.service"

log() { echo -e "\033[35m[cp-bridge]\033[0m $*"; }

log "Building jars (SDK: ${CP_SDK_JAR})"
CP_SDK_JAR="${CP_SDK_JAR}" bash "${BRIDGE_SRC}/build.sh"

log "Installing jars to ${PREFIX} (registered) + ${PREFIX}/rogue (unregistered)"
sudo install -d -m 0755 "${PREFIX}" "${PREFIX}/rogue" "${ENV_DIR}"
sudo install -m 0644 "${BRIDGE_SRC}/out/cp-bridge.jar" "${PREFIX}/cp-bridge.jar"
sudo install -m 0644 "${BRIDGE_SRC}/out/cp-caller.jar" "${PREFIX}/cp-caller.jar"
sudo install -m 0644 "${BRIDGE_SRC}/out/cp-rogue.jar" "${PREFIX}/rogue/cp-caller.jar"

if [[ ! -f "${ENV_DIR}/cp-bridge.env" ]]; then
  log "Seeding ${ENV_DIR}/cp-bridge.env — EDIT it with your CyberArk App/Safe/Object values"
  sudo install -m 0640 "${BRIDGE_SRC}/cp-bridge.env.example" "${ENV_DIR}/cp-bridge.env"
else
  log "Keeping existing ${ENV_DIR}/cp-bridge.env"
fi

log "Installing systemd unit (User=${CP_RUN_USER})"
sed "s/__CP_RUN_USER__/${CP_RUN_USER}/" "${BRIDGE_SRC}/cp-bridge.service" | sudo tee "${UNIT}" >/dev/null

log "Enabling + starting cp-bridge"
sudo systemctl daemon-reload
sudo systemctl enable --now cp-bridge
sudo systemctl restart cp-bridge

sleep 1
log "Status:"
systemctl --no-pager --lines=5 status cp-bridge || true
log "Health:"
curl -s "http://127.0.0.1:$(grep -E '^CP_BRIDGE_ADDR' "${ENV_DIR}/cp-bridge.env" | cut -d: -f2 | tr -d ' ' 2>/dev/null || echo 8890)/healthz" || true
echo
log "Done. Set CP_BRIDGE_URL=http://host.minikube.internal:8890 in .env, then 'make webapp-deploy'."
