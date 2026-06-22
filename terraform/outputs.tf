output "host_public_ip" {
  description = "Public IP of the demo host."
  value       = aws_instance.host.public_ip
}

output "host_public_dns" {
  description = "Public DNS of the demo host."
  value       = aws_instance.host.public_dns
}

locals {
  # Absolute path to the generated key so it resolves regardless of the CWD from
  # which Ansible / host-exec.sh run (they run from the repo root, not terraform/).
  generated_key_path = var.key_pair_name == "" ? abspath(local_sensitive_file.private_key[0].filename) : ""
}

output "ssh_private_key_path" {
  description = "Absolute path to the generated SSH private key (empty if you supplied your own)."
  value       = local.generated_key_path
}

output "webapp_url" {
  description = "URL for the demo webapp UI once deployed."
  value       = "http://${aws_instance.host.public_ip}:${var.webapp_nodeport}"
}

output "host_role_name" {
  description = "Name of the TARGET host IAM role (S3 image pulls only). Conjur auth uses an API key on the CONTROL host, not this role."
  value       = aws_iam_role.host.name
}

output "host_role_arn" {
  description = "ARN of the target host IAM role (used for S3 read by the minikube host)."
  value       = aws_iam_role.host.arn
}

# Rendered Ansible inventory; `make tf-apply` writes this to ansible/inventory.ini.
output "ansible_inventory" {
  description = "INI inventory for Ansible."
  value       = <<-EOT
    [swa_host]
    ${aws_instance.host.public_ip} ansible_user=${var.ssh_username} ansible_ssh_private_key_file=${var.key_pair_name == "" ? local.generated_key_path : pathexpand("~/.ssh/${var.key_pair_name}.pem")} ansible_ssh_common_args='-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null'

    [swa_host:vars]
    webapp_nodeport=${var.webapp_nodeport}
  EOT
}
