# terraform-swa — SWA tenant configuration

Configures the tenant side of SWA using the official **`cyberark/swa`** Terraform
provider (shipped in the SWA release bundle), creating:

`swa_trust_domain` → `swa_server_group` (k8s_psat) → `swa_server` (→ `authn_id`) → `swa_node_group`

This replaces the hand-rolled `tenant/*.sh` REST scripts (kept as a fallback).

## Auth: runs on the CONTROL host, uses a Conjur API key

This module is applied **on the control host** (where you run `make`). The
`cyberark/swa` provider (via conjur-api-go) authenticates to Conjur Cloud with a
Conjur identity + API key (`authn_type: authn`) — **no `conjur login`** needed.
`scripts/control-setup.sh` (`make control-setup`) provisions this on the control
host:

- pulls the bundle from S3 + installs the `cyberark/swa` provider,
- writes `~/.conjurrc` (`authn_type: authn`, `service_id`),
- writes `~/.swa-conjur.env` (`CONJUR_APPLIANCE_URL`, `CONJUR_ACCOUNT`,
  `CONJUR_AUTHN_TYPE`, `CONJUR_AUTHN_LOGIN`, `CONJUR_AUTHN_API_KEY`).

Prerequisites (your tenant side): a Conjur identity (host or workload) and its
API key, set in `.env` as `CONJUR_AUTHN_LOGIN` + `CONJUR_AUTHN_API_KEY`.

## Apply (via make)

```bash
make control-setup # control: install provider + write ~/.conjurrc
make fetch-jwks    # control: kubectl over SSH to the target -> cluster-jwks.auto.tfvars.json
make tenant-tf     # control: sources ~/.swa-conjur.env, terraform init + apply
```

`make swa` then bridges the `authn_id` / `trust_domain` outputs to the target
(`outputs.env`) where `deploy-swa.sh` Helm-installs the SWA server + agent.

To run by hand on the control host:

```bash
set -a; . ~/.swa-conjur.env; set +a
cd terraform-swa && terraform init && terraform apply
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
