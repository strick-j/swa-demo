# terraform-swa — SWA tenant configuration

Configures the tenant side of SWA using the official **`cyberark/swa`** Terraform
provider (shipped in the SWA release bundle), creating:

`swa_trust_domain` → `swa_server_group` (k8s_psat) → `swa_server` (→ `authn_id`) → `swa_node_group`

This replaces the hand-rolled `tenant/*.sh` REST scripts (kept as a fallback).

## Prerequisites

1. **Install the provider** from the release bundle (one time):
   ```bash
   "$SWA_RELEASE_DIR"/install-terraform-provider.sh
   # or:  make swa-provider-install   (set SWA_RELEASE_DIR in .env)
   ```
2. **Authenticate to your tenant** (zero-config provider):
   ```bash
   conjur login        # to your Secrets Manager - SaaS (Conjur Cloud) tenant
   ```

## Apply

```bash
cp terraform.tfvars.example terraform.tfvars   # adjust names if desired
# Populate server_issuer + server_public_keys from the live cluster
# (control plane can't reach minikube's JWKS):
../scripts/fetch-cluster-jwks.sh               # writes cluster-jwks.auto.tfvars.json
terraform init
terraform apply
```

`make tenant-tf` runs init+apply and exports `authn_id` / `trust_domain` into the
Helm deploy.

## Why `public_keys` instead of `jwks_uri`

The SWA server authenticates to the control plane with a projected
service-account JWT (audience `conjur`). The control plane validates it against
the cluster's signing keys — but it cannot reach minikube's JWKS endpoint over
the network. So we extract the cluster's issuer + JWKS and register them inline
via `server_public_keys`. On a publicly reachable cluster you could set
`server_jwks_uri` instead.

## Outputs

| Output | Used by |
|--------|---------|
| `authn_id` (sensitive) | swa-server Helm chart `controlPlane.auth.authnID` |
| `trust_domain_name` | swa-agent Helm chart `trustDomain.name` |
| `cluster_name` | swa-agent Helm chart `nodeAttestor.k8s_psat.cluster` |
