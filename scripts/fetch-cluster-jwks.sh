#!/usr/bin/env bash
# Fetch the minikube cluster's OIDC issuer + JWKS (service-account token signing
# keys) and write them as Terraform vars for terraform-swa. Needed because the
# Secrets Manager - SaaS control plane cannot reach minikube's JWKS endpoint, so
# the SWA server's JWT authenticator must be configured with inline public_keys.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
OUT="${ROOT}/terraform-swa/cluster-jwks.auto.tfvars.json"

# Run kubectl on the host (which has cluster access); fall back to local kubectl.
kraw() {
  if command -v kubectl >/dev/null && kubectl cluster-info >/dev/null 2>&1; then
    kubectl get --raw "$1"
  else
    bash "${ROOT}/scripts/host-exec.sh" "kubectl get --raw '$1'"
  fi
}

echo "Fetching cluster OIDC issuer and JWKS..."
ISSUER="$(kraw /.well-known/openid-configuration | jq -r '.issuer')"
JWKS="$(kraw /openid/v1/jwks)"

[[ -n "${ISSUER}" && "${ISSUER}" != "null" ]] || { echo "ERROR: empty issuer" >&2; exit 1; }

# public_keys format expected by the provider: a JSON STRING of
# {"type":"jwks","value":{"keys":[...]}}.
PUBLIC_KEYS="$(jq -cn --argjson jwks "${JWKS}" '{type:"jwks", value:$jwks}')"

jq -n --arg issuer "${ISSUER}" --arg pk "${PUBLIC_KEYS}" \
  '{server_issuer:$issuer, server_public_keys:$pk}' > "${OUT}"

echo "Wrote ${OUT}"
echo "  issuer: ${ISSUER}"
