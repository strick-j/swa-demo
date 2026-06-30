#!/usr/bin/env bash
# Generate a self-signed CLIENT certificate the webapp presents to the CCP
# (AIMWebService) over mTLS, and store it as the k8s Secret the webapp mounts
# (ccp-client-tls in NS_DEMO). Register the printed CN / SHA1 thumbprint with
# your CCP Application's certificate authentication so it trusts this client.
# Run ON the target host (needs kubectl + openssl). Idempotent.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "${ROOT}/.env" ]] && source "${ROOT}/.env"

: "${NS_DEMO:=swa-demo}"
CN="${CCP_CLIENT_CN:-swa-demo-webapp}"
DAYS="${CCP_CLIENT_DAYS:-825}"

log() { echo -e "\033[36m[ccp-cert]\033[0m $*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

log "Generating self-signed client cert (CN=${CN}, ${DAYS}d, clientAuth)"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "${TMP}/tls.key" -out "${TMP}/tls.crt" -days "${DAYS}" \
  -subj "/CN=${CN}" -addext "extendedKeyUsage=clientAuth" 2>/dev/null

log "Storing as Secret ccp-client-tls in namespace ${NS_DEMO}"
kubectl -n "${NS_DEMO}" create secret tls ccp-client-tls \
  --cert="${TMP}/tls.crt" --key="${TMP}/tls.key" \
  --dry-run=client -o yaml | kubectl apply -f -

THUMB="$(openssl x509 -in "${TMP}/tls.crt" -noout -fingerprint -sha1 | sed 's/.*=//')"
log "Done. Register this client with your CCP Application's cert authentication:"
echo "    CN:           ${CN}"
echo "    SHA1 thumb:   ${THUMB}"
log "Then 'make webapp-deploy' to roll the pod so it mounts the cert."
