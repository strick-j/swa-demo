#!/usr/bin/env bash
# Compute the CyberArk application HASH of the CP caller jar(s) with CyberArk's
# JavaAIMGetAppInfo utility, so you can paste it into the CP Application's hash
# authentication in PVWA. Run ON the host where the Credential Provider is
# installed (invoke via `scripts/host-exec.sh "bash scripts/cp-app-hash.sh"` or
# `make cp-app-hash`).
#
# NOTE: this is CyberArk's own algorithm — NOT a plain sha256 of the jar. The
# SHA-256 that build.sh prints is only the illustrative fingerprint shown in the
# UI; register THIS value.
#
# Env:
#   CP_JAVA_AIM_JAR  JavaAIMGetAppInfo utility (default /opt/CARKaim/bin/javaaimgetappinfo.jar)
#   CP_CALLER_JAR    the REGISTERED caller jar   (default /opt/swa-cp/cp-caller.jar)
#   CP_ROGUE_JAR     the UNregistered caller jar (default /opt/swa-cp/rogue/cp-caller.jar)
#   CP_HASH_ARGS     override the utility args (default: hash -cp <jar>)
#   JAVA_BIN         java executable (default java)
# Flags:
#   --rogue          also print the rogue jar's hash (to confirm it differs)
set -euo pipefail

JAVA_BIN="${JAVA_BIN:-java}"
AIM_JAR="${CP_JAVA_AIM_JAR:-/opt/CARKaim/bin/javaaimgetappinfo.jar}"
CALLER_JAR="${CP_CALLER_JAR:-/opt/swa-cp/cp-caller.jar}"
ROGUE_JAR="${CP_ROGUE_JAR:-/opt/swa-cp/rogue/cp-caller.jar}"
WITH_ROGUE=0
[[ "${1:-}" == "--rogue" ]] && WITH_ROGUE=1

log() { echo -e "\033[35m[cp-app-hash]\033[0m $*"; }

if [[ ! -f "${AIM_JAR}" ]]; then
  echo "ERROR: JavaAIMGetAppInfo not found at ${AIM_JAR}." >&2
  echo "       It ships with the Credential Provider (UNIX: /opt/CARKaim/bin/javaaimgetappinfo.jar)." >&2
  echo "       Set CP_JAVA_AIM_JAR to its path." >&2
  exit 1
fi

# Compute + print the hash for one jar. The default invocation follows the
# documented 'hash -cp <classpath>' form; override with CP_HASH_ARGS if your CP
# version differs.
hash_one() {
  local jar="$1" label="$2"
  if [[ ! -f "${jar}" ]]; then
    log "SKIP ${label}: ${jar} not found (run 'make cp-bridge-install' first)"
    return
  fi
  local args
  # shellcheck disable=SC2206
  args=(${CP_HASH_ARGS:-hash -cp "${jar}"})
  log "${label}: ${jar}"
  echo "  \$ ${JAVA_BIN} -jar ${AIM_JAR} ${args[*]}"
  "${JAVA_BIN}" -jar "${AIM_JAR}" "${args[@]}"
  echo
}

log "Computing CyberArk application hash via ${AIM_JAR}"
echo
hash_one "${CALLER_JAR}" "REGISTERED caller (paste this hash on the CP Application)"
if [[ "${WITH_ROGUE}" -eq 1 ]]; then
  hash_one "${ROGUE_JAR}" "UNregistered rogue (do NOT register — must differ)"
fi
log "Add the REGISTERED hash under the Application's Authentication → Hash in PVWA."
