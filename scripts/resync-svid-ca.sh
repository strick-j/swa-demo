#!/usr/bin/env bash
# Re-sync the SPIFFE trust chain after a Firefly CA rotation wedge.
#
# Symptom this fixes: the live "Trusted workload" scenario fails with
#   x509svid: could not verify leaf certificate: x509: certificate signed by
#   unknown authority (... "firefly root")
# i.e. pg-gateway's server SVID no longer chains to the "firefly root" in the
# webapp's trust bundle. A gateway-only bounce is NOT enough — the issuer
# (swa-server) has to be restarted first, then the gateway and webapp re-fetch.
#
# Restart order matters: issuer -> gateway -> client.
#   1. swa-server  (re-establishes the Firefly issuer / releases stale subs)
#   2. pg-gateway  (fresh server SVID under the current CA)
#   3. webapp      (fresh X509Source -> current trust bundle)
#
# Obsolete once Idira's persistent SaaS CA ships (~July 2026) — rotation stops
# being a thing then. Namespaces/deploys are overridable via env if they differ.
#
# Usage: scripts/resync-svid-ca.sh   (from laptop OR on the host)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "${ROOT}/.env" ]] && source "${ROOT}/.env"

SWA_SERVER_NS="${SWA_SERVER_NS:-swa-system}"
SWA_SERVER_DEPLOY="${SWA_SERVER_DEPLOY:-swa-server}"
GATEWAY_NS="${GATEWAY_NS:-swa-data}"
GATEWAY_DEPLOY="${GATEWAY_DEPLOY:-pg-gateway}"
WEBAPP_NS="${WEBAPP_NS:-swa-demo}"
WEBAPP_DEPLOY="${WEBAPP_DEPLOY:-swa-demo-webapp}"
WEBAPP_NODEPORT="${WEBAPP_NODEPORT:-30080}"

fail=0
ok()   { echo -e "  \033[32m✓\033[0m $*"; }
bad()  { echo -e "  \033[31m✗\033[0m $*"; fail=1; }
head() { echo -e "\033[36m== $* ==\033[0m"; }

# Run a command on the cluster: directly if we're on the host (kubectl present),
# else over SSH via host-exec.sh. Mirrors scripts/verify.sh.
on_host() {
  if command -v kubectl >/dev/null 2>&1; then
    bash -c "$1"
  else
    bash "${ROOT}/scripts/host-exec.sh" "$1"
  fi
}

roll() { # ns deploy
  local ns="$1" dep="$2"
  head "restart ${ns}/${dep}"
  if on_host "kubectl -n ${ns} rollout restart deploy/${dep} && kubectl -n ${ns} rollout status deploy/${dep} --timeout=180s"; then
    ok "${dep} rolled"
  else
    bad "${dep} did not roll — confirm its ns/name (override via *_NS / *_DEPLOY env): kubectl get deploy -A | grep -i swa"
  fi
}

roll "${SWA_SERVER_NS}" "${SWA_SERVER_DEPLOY}"
roll "${GATEWAY_NS}"    "${GATEWAY_DEPLOY}"
roll "${WEBAPP_NS}"     "${WEBAPP_DEPLOY}"

head "verify trusted retrieval"
# The host has no jq; grep the compact JSON for the retrieved flag.
resp="$(on_host "curl -s -XPOST 'http://localhost:${WEBAPP_NODEPORT}/api/swa?scenario=trusted'")"
if printf '%s' "${resp}" | grep -qiE '"retrieved"[[:space:]]*:[[:space:]]*true'; then
  ok "trusted retrieval succeeded — trust chain re-synced"
else
  bad "trusted still failing"
  printf '%s\n' "${resp}" | tr ',' '\n' | grep -iE 'retrieved|db_error|error' || printf '%s\n' "${resp}"
  echo "  If db_error still shows 'firefly root'/ECDSA, the issuer CA is inconsistent —"
  echo "  inspect: scripts/host-exec.sh \"kubectl -n ${SWA_SERVER_NS} logs deploy/${SWA_SERVER_DEPLOY} --tail=120 | grep -iE 'firefly|ca|rotat|bundle'\""
fi

exit "${fail}"
