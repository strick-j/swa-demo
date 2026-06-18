# terraform-swa — SWA tenant configuration

Configures the tenant side of SWA using the official **`cyberark/swa`** Terraform
provider (shipped in the SWA release bundle), creating:

`swa_trust_domain` → `swa_server_group` (k8s_psat) → `swa_server` (→ `authn_id`) → `swa_node_group`

This replaces the hand-rolled `tenant/*.sh` REST scripts (kept as a fallback).

## Auth: runs on the host, uses the instance-profile IAM role

This module is applied **on the EC2 host** (over SSH). The host's IAM role is
enrolled as a Conjur **authn-iam** host, so the `cyberark/swa` provider (via
conjur-api-go) mints a Conjur token from the instance identity — **no
`conjur login`, no API keys**. The Ansible `swa_tooling` role provisions this:

- installs Terraform + the `cyberark/swa` provider (from the bundle in S3),
- writes `~/.conjurrc` (`authn_type: aws`, `service_id`),
- writes `~/.swa-conjur.env` (`CONJUR_APPLIANCE_URL`, `CONJUR_ACCOUNT`,
  `CONJUR_AUTHN_LOGIN=<host_id>`).

Prerequisites (your tenant side): the `conjur/authn-iam/<service_id>`
authenticator is enabled and the host role is enrolled as a host
(`host/data/<aws-account-id>/<role-name>`). `<role-name>` is the Terraform output
`host_role_name`.

## Apply (via make)

```bash
make fetch-jwks    # on host: writes cluster-jwks.auto.tfvars.json (issuer + public_keys)
make tenant-tf     # on host: sources ~/.swa-conjur.env, terraform init + apply
```

`deploy-swa.sh` (also on the host) reads this module's `authn_id` / `trust_domain`
outputs directly — no cross-host bridge needed.

To run by hand on the host:

```bash
set -a; . ~/.swa-conjur.env; set +a
cd ~/swa-demo/terraform-swa && terraform init && terraform apply
```

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
