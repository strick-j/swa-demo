#!/usr/bin/env bash
# Build the CP host bridge + callers. Run ON the host where the Credential
# Provider (and its JavaPasswordSDK) are installed.
#
# Produces (in ./out):
#   cp-bridge.jar   the HTTP dispatcher (CpBridge)
#   cp-caller.jar   the REGISTERED caller (its hash is provisioned on the CP App)
#   cp-rogue.jar    an UNregistered caller (different content + install path)
#
# Requires: a JDK (javac/jar) and the SDK jar shipped with the Credential Provider.
# Usage: CP_SDK_JAR=/opt/CARKaim/sdk/JavaPasswordSDK.jar bash build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_JAR="${CP_SDK_JAR:-/opt/CARKaim/sdk/JavaPasswordSDK.jar}"
OUT="${HERE}/out"

if ! command -v javac >/dev/null; then
  echo "ERROR: javac not found — install a JDK (the CP SDK needs a JRE anyway)." >&2
  exit 1
fi
if [[ ! -f "${SDK_JAR}" ]]; then
  echo "ERROR: JavaPasswordSDK.jar not found at ${SDK_JAR}." >&2
  echo "       Set CP_SDK_JAR to the SDK jar shipped with the Credential Provider." >&2
  exit 1
fi

rm -rf "${OUT}" "${HERE}/classes"
mkdir -p "${OUT}" "${HERE}/classes"

echo "==> compiling CpCaller + CpBridge against ${SDK_JAR}"
javac -cp "${SDK_JAR}" -d "${HERE}/classes" "${HERE}/CpCaller.java" "${HERE}/CpBridge.java"

echo "==> packaging cp-bridge.jar (executable)"
jar cfe "${OUT}/cp-bridge.jar" CpBridge -C "${HERE}/classes" CpBridge.class

echo "==> packaging cp-caller.jar (registered)"
jar cf "${OUT}/cp-caller.jar" -C "${HERE}/classes" CpCaller.class

echo "==> packaging cp-rogue.jar (unregistered — differs by content)"
cp "${OUT}/cp-caller.jar" "${OUT}/cp-rogue.jar"
# Append a marker so the rogue jar's bytes (and thus its hash) differ from the
# registered jar. Combined with a different install path, this guarantees the
# CP treats it as a distinct — and unregistered — calling application.
printf 'unregistered swa-cp demo caller\n' > "${HERE}/classes/ROGUE.txt"
jar uf "${OUT}/cp-rogue.jar" -C "${HERE}/classes" ROGUE.txt

echo
echo "Built:"
ls -1 "${OUT}"
echo
echo "Registered-caller SHA-256 (ILLUSTRATIVE — this is the UI fingerprint, NOT the"
echo "CyberArk app hash). Register the value from JavaAIMGetAppInfo instead:"
echo "  make cp-app-hash   (runs /opt/CARKaim/bin/javaaimgetappinfo.jar)"
sha256sum "${OUT}/cp-caller.jar" 2>/dev/null || shasum -a 256 "${OUT}/cp-caller.jar"
