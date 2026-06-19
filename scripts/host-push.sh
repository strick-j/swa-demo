#!/usr/bin/env bash
# Copy a local file into the staged project dir (~/swa-demo) on the target host.
# Connection details come from Terraform outputs (same as host-exec.sh). Used to
# bridge terraform-swa outputs (authn_id, trust domain) from the control host to
# the target host for deploy-swa.sh.
# Usage: scripts/host-push.sh <local-file> [remote-relative-path]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
TF_DIR="${ROOT}/terraform"
# shellcheck disable=SC1091
[[ -f "${ROOT}/.env" ]] && source "${ROOT}/.env"

SRC="${1:?usage: host-push.sh <local-file> [remote-rel-path]}"
DEST_REL="${2:-$(basename "$SRC")}"

SSH_USER="${TF_VAR_ssh_username:-ec2-user}"
IP="$(terraform -chdir="${TF_DIR}" output -raw host_public_ip)"
KEY="$(terraform -chdir="${TF_DIR}" output -raw ssh_private_key_path)"

scp_opts=(-o StrictHostKeyChecking=accept-new)
if [[ -n "${KEY}" && -f "${KEY}" ]]; then
  scp_opts+=(-i "${KEY}")
elif [[ -n "${TF_VAR_key_pair_name:-}" ]]; then
  scp_opts+=(-i "${HOME}/.ssh/${TF_VAR_key_pair_name}.pem")
fi

exec scp "${scp_opts[@]}" "${SRC}" "${SSH_USER}@${IP}:swa-demo/${DEST_REL}"
