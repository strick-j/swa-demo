#!/usr/bin/env bash
# Run a command on the demo host inside the staged project dir (~/swa-demo).
# Connection details are read from Terraform outputs.
# Usage: scripts/host-exec.sh "<remote command>"
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
TF_DIR="${ROOT}/terraform"
# shellcheck disable=SC1091
[[ -f "${ROOT}/.env" ]] && source "${ROOT}/.env"

SSH_USER="${TF_VAR_ssh_username:-ec2-user}"
IP="$(terraform -chdir="${TF_DIR}" output -raw host_public_ip)"
KEY="$(terraform -chdir="${TF_DIR}" output -raw ssh_private_key_path)"

# StrictHostKeyChecking=no + /dev/null known-hosts works on old OpenSSH too
# (accept-new needs >= 7.6, absent on Amazon Linux 2 / RHEL 7 control hosts).
ssh_opts=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
if [[ -n "${KEY}" && -f "${KEY}" ]]; then
  ssh_opts+=(-i "${KEY}")
elif [[ -n "${TF_VAR_key_pair_name:-}" ]]; then
  ssh_opts+=(-i "${HOME}/.ssh/${TF_VAR_key_pair_name}.pem")
fi

remote_cmd="${*:-true}"
exec ssh "${ssh_opts[@]}" "${SSH_USER}@${IP}" "cd ~/swa-demo && ${remote_cmd}"
