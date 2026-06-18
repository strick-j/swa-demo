#!/usr/bin/env bash
# End-to-end health check. Runs the cluster checks on the host, then probes the
# public webapp URL from wherever you invoke it. Exit non-zero on any failure.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
TF_DIR="${ROOT}/terraform"
# shellcheck disable=SC1091
[[ -f "${ROOT}/.env" ]] && source "${ROOT}/.env"

fail=0
ok()   { echo -e "  \033[32m✓\033[0m $*"; }
bad()  { echo -e "  \033[31m✗\033[0m $*"; fail=1; }
head() { echo -e "\033[36m== $* ==\033[0m"; }

# If running locally, exec the cluster checks on the host; if already on host
# (no terraform/aws), run them directly.
on_host() {
  if command -v minikube >/dev/null && command -v kubectl >/dev/null; then
    bash -c "$1"
  else
    bash "${ROOT}/scripts/host-exec.sh" "$1"
  fi
}

head "minikube node"
if on_host "kubectl get nodes --no-headers | grep -q ' Ready '"; then
  ok "node Ready"
else
  bad "node not Ready"
fi

head "SWA server + agent pods"
if on_host "kubectl -n ${NS_SWA:-swa-system} get pods --no-headers | grep -vq 'Running\\|Completed' ; test \$? -ne 0"; then
  ok "all ${NS_SWA:-swa-system} pods Running"
else
  bad "some ${NS_SWA:-swa-system} pods not Running"
fi

head "Agent Workload API socket"
if on_host "test -S /tmp/swa-agent/public/api.sock"; then
  ok "socket present at /tmp/swa-agent/public/api.sock"
else
  bad "Workload API socket missing"
fi

head "webapp rollout"
if on_host "kubectl -n ${NS_DEMO:-swa-demo} rollout status deploy/swa-demo-webapp --timeout=10s"; then
  ok "webapp rolled out"
else
  bad "webapp not ready"
fi

head "webapp HTTP"
URL=""
if command -v terraform >/dev/null && [[ -d "${TF_DIR}/.terraform" ]]; then
  URL="$(terraform -chdir="${TF_DIR}" output -raw webapp_url 2>/dev/null || true)"
fi
if [[ -n "${URL}" ]]; then
  if curl -fsS --max-time 8 "${URL}/healthz" >/dev/null; then ok "healthz 200 at ${URL}"; else bad "healthz failed at ${URL}"; fi
else
  echo "  (skipped public probe; no terraform outputs here)"
fi

echo
if [[ "${fail}" -eq 0 ]]; then
  echo -e "\033[32mAll checks passed.\033[0m"
else
  echo -e "\033[31mOne or more checks failed.\033[0m"
fi
exit "${fail}"
