#!/usr/bin/env bash
# Collect the evidence bundle for the SWA X.509-SVID rotation wedge and package
# it for CyberArk. Runs all captures on the demo host via scripts/host-exec.sh
# (SSH -> kubectl against the minikube cluster), records the exact command behind
# every artifact, folds in the written bug report, and tars the whole thing up.
#
# Background: docs/SWA-SVID-ROTATION-BUG.md — the long-lived ghostunnel gateway
# never rotates its SVID because the SWA server rejects the re-subscribe with
# "subscriber already exists for: id=<pid>".
#
# Usage: scripts/collect-svid-bug-logs.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"

# Capture window for every log pull. 24h so we cover a full day of rotation
# boundaries regardless of when the wedge started.
SINCE="24h"

# Namespaces (keep them straight — server/agent vs. the gateway).
SWA_SYS="swa-system"   # swa-server Deployment + swa-agent DaemonSet
SWA_DATA="swa-data"    # pg-gateway (the wedged ghostunnel workload)

# Timestamped bundle dir. Stamp is UTC to match the server log timestamps.
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BUNDLE="svid-rotation-bug-${STAMP}"
OUTDIR="${ROOT}/${BUNDLE}"
mkdir -p "${OUTDIR}"

COMMANDS="${OUTDIR}/COMMANDS.txt"
: > "${COMMANDS}"

hexec() { bash "${ROOT}/scripts/host-exec.sh" "$@"; }

# run <artifact-file> <human description> <remote command>
# Records the command in COMMANDS.txt, then runs it on the host and tees the
# combined stdout/stderr into the artifact so a failed pull is still evidence.
run() {
  local file="$1" desc="$2" cmd="$3"
  local path="${OUTDIR}/${file}"
  {
    echo "### ${file}"
    echo "# ${desc}"
    echo "scripts/host-exec.sh '${cmd}'"
    echo
  } >> "${COMMANDS}"

  echo "==> ${desc}"
  {
    echo "# ${desc}"
    echo "# capture window: --since=${SINCE}   collected: ${STAMP}"
    echo "# scripts/host-exec.sh '${cmd}'"
    echo "# ----------------------------------------------------------------------"
  } > "${path}"
  if hexec "${cmd}" >> "${path}" 2>&1; then
    echo "    ok -> ${BUNDLE}/${file}"
  else
    echo "    WARN: command exited non-zero (kept output) -> ${BUNDLE}/${file}"
  fi
}

echo "Collecting SWA X.509-SVID rotation-wedge evidence (--since=${SINCE})"
echo "Bundle: ${OUTDIR}"
echo

# --- Full raw logs (primary artifacts) -------------------------------------
run "swa-server.log" \
  "SWA server — full raw log (${SWA_SYS})" \
  "kubectl -n ${SWA_SYS} logs deploy/swa-server --since=${SINCE} --timestamps"

run "swa-agent.log" \
  "SWA agent — full raw log (${SWA_SYS})" \
  "kubectl -n ${SWA_SYS} logs ds/swa-agent --since=${SINCE} --timestamps"

run "pg-gateway.log" \
  "ghostunnel pg-gateway — full raw log (${SWA_DATA})" \
  "kubectl -n ${SWA_DATA} logs deploy/pg-gateway --since=${SINCE} --timestamps"

# --- Filtered "smoking gun" evidence ---------------------------------------
run "server-collision.txt" \
  "SWA server — subscriber collision + issuance for OTHER workloads but never pg-gateway" \
  "kubectl -n ${SWA_SYS} logs deploy/swa-server --since=${SINCE} | grep -iE 'SVIDIssued.*X509|subscriber already|Shutting down svid stream'"

run "agent-retry-loop.txt" \
  "SWA agent — the rejected X.509 fetch/retry loop" \
  "kubectl -n ${SWA_SYS} logs ds/swa-agent --since=${SINCE} | grep -iE 'Fetching x509|subscriber already|Failed to (stream|get SVID)'"

run "wedged-pids.txt" \
  "SWA server — distinct PIDs colliding on re-subscribe (subscriber == PID)" \
  "kubectl -n ${SWA_SYS} logs deploy/swa-server --since=${SINCE} | grep -i 'subscriber already' | grep -oE 'id=[0-9]+' | sort -u"

run "gateway-expiry.txt" \
  "ghostunnel pg-gateway — expired-leaf / rotation symptoms" \
  "kubectl -n ${SWA_DATA} logs deploy/pg-gateway --since=${SINCE} | grep -iE 'expired|svid|rotat'"

# --- Environment snapshot ---------------------------------------------------
run "pods.txt" \
  "Pod inventory (server/agent + gateway) with age/restarts" \
  "kubectl -n ${SWA_SYS} get pods -o wide; echo; kubectl -n ${SWA_DATA} get pods -o wide -l app=pg-gateway"

# --- Fold in the written report --------------------------------------------
cp "${ROOT}/docs/SWA-SVID-ROTATION-BUG.md" "${OUTDIR}/SWA-SVID-ROTATION-BUG.md"

cat > "${OUTDIR}/README.txt" <<EOF
SWA X.509-SVID rotation-wedge evidence bundle
Collected: ${STAMP} (UTC)   Capture window: --since=${SINCE}

Contents:
  SWA-SVID-ROTATION-BUG.md  the full bug report (summary, root cause, fix request)
  COMMANDS.txt              every command run to produce the artifacts below
  swa-server.log            full raw SWA server log
  swa-agent.log             full raw SWA agent log
  pg-gateway.log            full raw ghostunnel gateway log
  server-collision.txt      filtered: subscriber collision + selective issuance
  agent-retry-loop.txt      filtered: agent's rejected retry loop
  wedged-pids.txt           distinct colliding PIDs (subscriber key == PID)
  gateway-expiry.txt        filtered: expired-leaf / rotation symptoms
  pods.txt                  pod inventory (age + restart counts)

All captures were taken on the demo host via scripts/host-exec.sh
(SSH -> kubectl against the single-node minikube cluster).
EOF

# --- Package ----------------------------------------------------------------
TARBALL="${ROOT}/${BUNDLE}.tar.gz"
tar -czf "${TARBALL}" -C "${ROOT}" "${BUNDLE}"

echo
echo "Bundle dir : ${OUTDIR}"
echo "Tarball    : ${TARBALL}"
echo "Attach the tarball to the CyberArk ticket."
