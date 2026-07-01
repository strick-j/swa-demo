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
#   CP_SDK_JAR    javapasswordsdk.jar (default /opt/CARKaim/sdk/javapasswordsdk.jar)
#   CP_RUN_USER   OS user the service runs as, and the user registered on the CP
#                 Application's OS-user characteristic (default: current user)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
BRIDGE_SRC="${ROOT}/hostbridge/cp"

CP_SDK_JAR="${CP_SDK_JAR:-/opt/CARKaim/sdk/javapasswordsdk.jar}"
CP_RUN_USER="${CP_RUN_USER:-$(id -un)}"
PREFIX="/opt/swa-cp"
ENV_DIR="/etc/swa-cp"
UNIT="/etc/systemd/system/cp-bridge.service"

log() { echo -e "\033[35m[cp-bridge]\033[0m $*"; }

# The CP ships a JRE (runtime), but compiling the caller/bridge needs a JDK
# (javac + jar). Install one if it is missing. The bridge itself only needs `java`.
ensure_jdk() {
  if command -v javac >/dev/null && command -v jar >/dev/null; then
    return 0
  fi
  log "javac/jar not found — installing a JDK"
  local pm=""
  if command -v dnf >/dev/null; then
    pm="sudo dnf install -y"
  elif command -v yum >/dev/null; then
    pm="sudo yum install -y"
  else
    echo "ERROR: no dnf/yum available; install a JDK manually (needs javac + jar)." >&2
    exit 1
  fi
  local pkg
  for pkg in java-17-openjdk-devel java-11-openjdk-devel java-1.8.0-openjdk-devel \
             java-17-amazon-corretto-devel java-11-amazon-corretto-devel; do
    log "trying ${pkg}"
    if ${pm} "${pkg}" >/dev/null 2>&1 && command -v javac >/dev/null && command -v jar >/dev/null; then
      log "installed ${pkg}"
      return 0
    fi
  done
  echo "ERROR: could not install a JDK automatically. Install one manually, e.g.:" >&2
  echo "         sudo yum install -y java-11-openjdk-devel   # or your distro's -devel JDK" >&2
  exit 1
}

ensure_jdk

log "Building jars (SDK: ${CP_SDK_JAR})"
CP_SDK_JAR="${CP_SDK_JAR}" bash "${BRIDGE_SRC}/build.sh"

log "Installing jars to ${PREFIX} (registered) + ${PREFIX}/rogue (unregistered)"
sudo install -d -m 0755 "${PREFIX}" "${PREFIX}/rogue" "${ENV_DIR}"
sudo install -m 0644 "${BRIDGE_SRC}/out/cp-bridge.jar" "${PREFIX}/cp-bridge.jar"
sudo install -m 0644 "${BRIDGE_SRC}/out/cp-caller.jar" "${PREFIX}/cp-caller.jar"
sudo install -m 0644 "${BRIDGE_SRC}/out/cp-rogue.jar" "${PREFIX}/rogue/cp-caller.jar"

# Render the bridge env file from the passed-in config (driven by the control-host
# .env). The four Safe/Object values fall back to the CCP demo's — set
# CP_BRIDGE_ENV_KEEP=1 to preserve a hand-edited file instead.
if [[ "${CP_BRIDGE_ENV_KEEP:-0}" == "1" && -f "${ENV_DIR}/cp-bridge.env" ]]; then
  log "Keeping existing ${ENV_DIR}/cp-bridge.env (CP_BRIDGE_ENV_KEEP=1)"
else
  cp_safe="${CP_SAFE:-${CCP_SAFE:-}}"
  cp_object="${CP_OBJECT:-${CCP_OBJECT:-}}"
  cp_denied_safe="${CP_DENIED_SAFE:-${CCP_DENIED_SAFE:-}}"
  cp_denied_object="${CP_DENIED_OBJECT:-${CCP_DENIED_OBJECT:-}}"
  log "Rendering ${ENV_DIR}/cp-bridge.env (safe=${cp_safe:-<unset>} object=${cp_object:-<unset>}; denied safe=${cp_denied_safe:-<unset>})"
  sudo tee "${ENV_DIR}/cp-bridge.env" >/dev/null <<EOF
# Rendered by scripts/install-cp-bridge.sh from the control-host .env.
# Edit .env (not this file) and re-run 'make cp-bridge-install', or set
# CP_BRIDGE_ENV_KEEP=1 to hand-edit here instead.
CP_BRIDGE_ADDR=${CP_BRIDGE_ADDR:-0.0.0.0:8890}
CP_APP_ID=${CP_APP_ID:-}
CP_SAFE=${cp_safe}
CP_OBJECT=${cp_object}
CP_FOLDER=${CP_FOLDER:-Root}
CP_DENIED_SAFE=${cp_denied_safe}
CP_DENIED_OBJECT=${cp_denied_object}
CP_DUAL_QUERY=${CP_DUAL_QUERY:-}
CP_DUAL_VIRTUAL=${CP_DUAL_VIRTUAL:-}
CP_SDK_JAR=${CP_SDK_JAR}
CP_CALLER_JAR=${PREFIX}/cp-caller.jar
CP_ROGUE_JAR=${PREFIX}/rogue/cp-caller.jar
EOF
  sudo chmod 0640 "${ENV_DIR}/cp-bridge.env"
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
