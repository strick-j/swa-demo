# terraform-swa — SWA tenant configuration

Configures the tenant side of SWA using the official **`cyberark/swa`** Terraform
provider (shipped in the SWA release bundle), creating:

`swa_trust_domain` → `swa_server_group` (k8s_psat) → `swa_server` (→ `authn_id`) → `swa_node_group`

This replaces the hand-rolled `tenant/*.sh` REST scripts (kept as a fallback).

## Auth: runs on the CONTROL host, uses a Conjur OIDC access token

This module is applied **on the control host** (where you run `make`). Auth is a
chain, all in-graph — **no static OAuth secret in `.env`, no `conjur login`**:

1. The `cyberark/conjur` provider authenticates to Conjur with a bootstrap
   method you choose (`conjur_authn_type`, e.g. keyless `iam` with the control
   host's role) and reads the CyberArk Identity OAuth client out of Conjur
   (`conjur_secret` data sources: `sca_username` = client_id, `sca_password` =
   client_secret — see `conjur-auth.tf`).
2. `data.external.conjur_token` runs `scripts/conjur-token.sh`, which exchanges
   those creds via the Identity OIDC client-credentials flow (platform token →
   Conjur `authn-oidc` authenticate) for a short-lived Conjur access token.
3. The `cyberark/swa` provider uses that token as its `access_token`.

`scripts/control-setup.sh` (`make control-setup`) prepares the control host:

- pulls the bundle from S3 + installs the `cyberark/swa` provider,
- writes `~/.conjurrc` (`appliance_url`, `account`).

`make tenant-tf` then runs `terraform init` (which fetches the `conjur` +
`external` providers from the registry) and `terraform apply`.

Prerequisites (your tenant side): (a) a bootstrap identity the `conjur` provider
can log in as (`conjur_host_id` + the matching authenticator); (b) the CyberArk
Identity OAuth client stored in Conjur at `conjur_sca_username_path` /
`conjur_sca_password_path` and trusted by Conjur's `authn-oidc/<service>`
authenticator; (c) `identity_tenant_id`. All set in `.env` as `TF_VAR_*`.

> **State note:** secrets read by the `conjur` provider are persisted to
> Terraform state. Use an encrypted/remote backend for anything beyond a demo.

## Apply (via make)

```bash
make control-setup # control: install provider + write ~/.conjurrc
make fetch-jwks    # control: kubectl over SSH to the target -> cluster-jwks.auto.tfvars.json
make tenant-tf     # control: mint Conjur token (Identity OIDC) + terraform init + apply
```

`make swa` then bridges the `authn_id` / `trust_domain` outputs to the target
(`outputs.env`) where `deploy-swa.sh` Helm-installs the SWA server + agent.

To run by hand on the control host:

```bash
set -a; . ./.env; set +a
export TF_VAR_conjur_appliance_url="$CONJUR_APPLIANCE_URL"
cd terraform-swa && terraform init && terraform apply
```

To debug just the OIDC token exchange in isolation (reads `CONJUR_OIDC_CLIENT_ID`
/ `CONJUR_OIDC_CLIENT_SECRET` / `IDENTITY_TENANT_ID` from the environment rather
than from Conjur):

```bash
CONJUR_OIDC_CLIENT_ID=... CONJUR_OIDC_CLIENT_SECRET=... IDENTITY_TENANT_ID=... \
  bash scripts/conjur-token.sh   # prints the raw Conjur access token
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
