output "trust_domain_name" {
  description = "Trust domain name (feed to agent trustDomain.name)."
  value       = swa_trust_domain.this.name
}

output "server_group_name" {
  value = swa_server_group.this.name
}

output "node_group_name" {
  value = swa_node_group.this.name
}

output "cluster_name" {
  value = var.cluster_name
}

# Consumed by the swa-server Helm chart: controlPlane.auth.authnID.
output "authn_id" {
  description = "Opaque authenticator id for the registered server."
  value       = swa_server.this.authn_id
  sensitive   = true
}
