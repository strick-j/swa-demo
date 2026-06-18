#!/usr/bin/env bash
# Create (idempotently) the SWA trust domain in the tenant.
# Docs: Get started > Secure workloads with SWA > Understand SPIFFE workload identities.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

log "Ensuring trust domain '${SWA_TRUST_DOMAIN}' exists..."

existing="$(api GET "${SWA_API_TRUST_DOMAINS}" || echo '{}')"
if grep -q "\"${SWA_TRUST_DOMAIN}\"" <<<"$existing"; then
  log "Trust domain already present; skipping create."
  exit 0
fi

body="$(cat <<JSON
{
  "name": "${SWA_TRUST_DOMAIN}",
  "description": "swa-demo trust domain for minikube workloads"
}
JSON
)"

api POST "${SWA_API_TRUST_DOMAINS}" "$body" >/dev/null
log "Trust domain '${SWA_TRUST_DOMAIN}' created."
