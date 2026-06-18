#!/usr/bin/env bash
# Print (and on macOS, open) the demo webapp URL.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
TF_DIR="${ROOT}/terraform"

URL="$(terraform -chdir="${TF_DIR}" output -raw webapp_url 2>/dev/null || true)"
if [[ -z "${URL}" ]]; then
  echo "No webapp_url output found. Has 'make tf-apply' run?" >&2
  exit 1
fi

echo "Demo UI: ${URL}"
echo "Click 'Request JWT-SVID from SWA Agent' to run the flow."

if [[ "$(uname)" == "Darwin" ]]; then
  open "${URL}" 2>/dev/null || true
fi
