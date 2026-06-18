#!/usr/bin/env bash
# Shared helpers for tenant control-plane scripts.
#
# These wrap the Secrets Manager - SaaS (Idira) REST API used to define SWA
# resources: trust domains, server groups, node groups, and server registration.
#
# IMPORTANT: The exact API base path and resource routes are version-specific.
# Confirm them against your tenant docs (Get started > Secure workloads with SWA).
# Every route is defined ONCE here via the SWA_API_* vars so there is a single
# place to adjust if your tenant version differs.

set -euo pipefail

# --- Load .env if present (so scripts work standalone, not just via make) ---
_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${_here}/../.env" ]]; then
  # shellcheck disable=SC1091
  source "${_here}/../.env"
fi

: "${SWA_TENANT_URL:?Set SWA_TENANT_URL in .env}"
: "${SWA_TENANT_API_TOKEN:?Set SWA_TENANT_API_TOKEN in .env}"
: "${SWA_TRUST_DOMAIN:?Set SWA_TRUST_DOMAIN in .env}"
: "${SWA_SERVER_GROUP:?Set SWA_SERVER_GROUP in .env}"
: "${SWA_NODE_GROUP:?Set SWA_NODE_GROUP in .env}"

# API route prefixes (single source of truth; adjust per tenant version/docs).
SWA_API_BASE="${SWA_TENANT_URL%/}/api/swa/v1"
SWA_API_TRUST_DOMAINS="${SWA_API_BASE}/trust-domains"
SWA_API_SERVER_GROUPS="${SWA_API_BASE}/server-groups"
SWA_API_NODE_GROUPS="${SWA_API_BASE}/node-groups"
SWA_API_SERVERS="${SWA_API_BASE}/servers"

AUTHN_ID_FILE="${_here}/.authn_id"

# api METHOD URL [JSON_BODY] -> prints response body, fails on HTTP >= 400.
api() {
  local method="$1" url="$2" body="${3:-}"
  local args=(-sS -X "$method" -w '\n%{http_code}'
    -H "Authorization: Bearer ${SWA_TENANT_API_TOKEN}"
    -H "Content-Type: application/json"
    -H "Accept: application/json")
  [[ -n "$body" ]] && args+=(-d "$body")

  local out http
  out="$(curl "${args[@]}" "$url")"
  http="$(tail -n1 <<<"$out")"
  out="$(sed '$d' <<<"$out")"

  if [[ "$http" -ge 400 ]]; then
    echo "ERROR: ${method} ${url} -> HTTP ${http}" >&2
    echo "$out" >&2
    return 1
  fi
  echo "$out"
}

log() { echo -e "\033[36m[tenant]\033[0m $*"; }
