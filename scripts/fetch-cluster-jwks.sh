#!/usr/bin/env bash
# Fetch the minikube cluster's OIDC issuer + JWKS (service-account token signing
# keys) and write them as Terraform vars for terraform-swa. Needed because the
# Secrets Manager - SaaS control plane cannot reach minikube's JWKS endpoint, so
# the SWA server's JWT authenticator must be configured with inline public_keys.
#
# Uses Python (stdlib json) rather than jq, so no extra packages are needed on the
# control host.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
OUT="${ROOT}/terraform-swa/cluster-jwks.auto.tfvars.json"

# Prefer the venv's Python; fall back to system python3.
PYBIN="$([ -x "${ROOT}/.venv-ansible/bin/python" ] && echo "${ROOT}/.venv-ansible/bin/python" || command -v python3 || true)"
: "${PYBIN:?python3 is required}"

# Run kubectl on the host (which has cluster access); fall back to SSH (control
# host has no local cluster).
kraw() {
  if command -v kubectl >/dev/null && kubectl cluster-info >/dev/null 2>&1; then
    kubectl get --raw "$1"
  else
    bash "${ROOT}/scripts/host-exec.sh" "kubectl get --raw '$1'"
  fi
}

echo "Fetching cluster OIDC issuer and JWKS..."
CONFIG_JSON="$(kraw /.well-known/openid-configuration)"
JWKS_JSON="$(kraw /openid/v1/jwks)"

# public_keys format expected by the provider: a JSON STRING of
# {"type":"jwks","value":{"keys":[...]}}. Build issuer + public_keys with Python.
export CONFIG_JSON JWKS_JSON
"${PYBIN}" - "${OUT}" <<'PY'
import json, os, sys

out = sys.argv[1]
config = json.loads(os.environ["CONFIG_JSON"])
jwks = json.loads(os.environ["JWKS_JSON"])

issuer = config.get("issuer", "")
if not issuer:
    sys.stderr.write("ERROR: empty issuer from OIDC discovery\n")
    sys.exit(1)

public_keys = json.dumps({"type": "jwks", "value": jwks}, separators=(",", ":"))
with open(out, "w") as f:
    json.dump({"server_issuer": issuer, "server_public_keys": public_keys}, f)

print("  issuer:", issuer)
PY

echo "Wrote ${OUT}"
