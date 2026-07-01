# swa-demo

Automated, end-to-end demo of **CyberArk Secure Workload Access (SWA)** on
**minikube** — plus a visual "secrets retrieval" webapp that contrasts SWA with
the other ways a workload can obtain a credential from CyberArk: the local
**Credential Provider (CP)**, the **Central Credential Provider (CCP)**, and
**Conjur Cloud** (Secrets Manager – SaaS).

Each mode narrates its full request → authentication → authorization → retrieval
lifecycle and renders a **masked proof-of-retrieval**: a short 6-char preview plus
the value's length and SHA-256 — enough to match by eye against the Vault/Conjur
(and watch it change on rotation) without exposing the full secret.

> "Idira" is CyberArk's brand for the **Secrets Manager – SaaS** product/docs.
> This project targets an Idira / Secrets Manager – SaaS tenant.

## What it builds

```
AWS (Terraform)          RHEL host (Ansible)           minikube
┌──────────────┐         ┌───────────────────┐         ┌────────────────────────────────┐
│ VPC + subnet │         │ RHEL 8/9 EC2      │         │ ns swa-system                  │
│ SG, IGW      │ ──────▶ │ docker + minikube │ ──────▶ │   SWA Server → tenant          │
│ EC2 host     │         │ kubectl + helm    │         │   SWA Agent (DaemonSet)        │
└──────────────┘         │                   │         │ ns swa-demo                    │
                         │ CyberArk CP       │◀── cp ──│   demo-webapp → Agent (socket) │
                         │ + cp-bridge :8890 │         │   └ SVID + retrieval UI        │
                         └───────────────────┘         │ ns swa-data                    │
                                                       │   pg-gateway (X.509 mTLS)      │
                                                       └────────────────────────────────┘
```

## Retrieval modes (the webapp)

The webapp is a landing **chooser** over four CyberArk retrieval families. Modes
render an illustrative/simulated result until their backend is configured (SWA
works out of the box via demo mode; **CP is live-only** — it really calls the
host Credential Provider).

| Family | Mode | Authenticates by | Use-case scenarios |
|--------|------|------------------|--------------------|
| **Credential Providers** (Vault-backed) | **CP** — local Credential Provider (Java SDK via host bridge) | application **hash** / path / OS user | 1 authorized · 2 invalid hash (authn deny) · 3 denied safe (authz deny) · 4 dual account |
| | **CCP** — Central Credential Provider (AIMWebService) | client **certificate** (mTLS) | 1 authorized · 2 no cert (authn deny) · 3 denied safe (authz deny) · 4 dual account |
| **Secrets Manager – SaaS** (Conjur Cloud) | **Conjur · JWT** | `authn-jwt` (workload JWT-SVID) | present a JWT-SVID, read a variable |
| | **Conjur · AWS STS** | `authn-iam` | sign `sts:GetCallerIdentity`; Conjur verifies the ARN, read a variable |
| **Secure Workload Access** (SPIFFE) | **SPIFFE SVID → gateway** | `x509-svid` / `jwt-svid` | trusted · untrusted (allow-list deny) · unknown (no SVID issued) · foreign trust domain |

The **CP** and **CCP** scenarios are deliberately symmetric — same four use cases,
with the client certificate (CCP) swapped for the calling application's hash (CP).
The SWA family additionally drives a Postgres **X.509-SVID mTLS** gateway that
authorizes by SPIFFE ID (`ns swa-data`).

### The CP host bridge

The Credential Provider is installed **on the minikube host**; a container can't
load its native SDK, so the pod POSTs a scenario to a small host **cp-bridge**
(`host.minikube.internal:8890`). The bridge runs the matching Java caller as a
subprocess — so each scenario's calling application has its own hash — and returns
non-secret metadata plus the secret's preview/length/SHA-256 (the full value never
leaves the host). A **registered** `cp-caller.jar` vs an **unregistered**
`cp-rogue.jar` (different content + path) is what the "invalid hash" scenario
demonstrates. See [`hostbridge/cp/`](hostbridge/cp/) and **RUNBOOK § 3c**.

## Components / phases

| Phase | Dir | What |
|-------|-----|------|
| 0 | root | Scaffolding, `.env`, `Makefile`, lint |
| 1 | `terraform/` | AWS VPC + RHEL EC2 host + IAM (S3 image read) |
| 2 | `ansible/` | Host config + minikube + load SWA images from S3 |
| 3 | `terraform-swa/` (provider), `helm/`, `scripts/deploy-swa.sh` | Tenant trust domain/groups/server via cyberark/swa + SWA server & agent. `tenant/` REST scripts are a fallback. |
| 4 | `webapp/`, `k8s/`, `hostbridge/` | Go retrieval webapp (SWA + CP/CCP/Conjur), visual UI, and the host CP bridge |
| 5 | `scripts/`, `Makefile` | `make up` / `make down` glue, verify, demo |

## Quick start

```bash
cp .env.example .env        # fill in AWS, tenant, registry, trust-domain values
make preflight              # check CLIs + .env
make up                     # terraform -> ansible -> tenant -> swa -> webapp -> verify
make demo                   # open the visual UI (landing chooser)
make down                   # tear down AWS infra
```

The SWA and (once configured) Conjur/CCP modes come up with `make up`. Enabling the
other families is opt-in:

```bash
# Central Credential Provider (AIMWebService)
make ccp-cert               # generate the client cert + store the Secret
# ... register the cert on the CCP App, set CCP_* in .env, then:
make webapp-deploy

# Local Credential Provider (host bridge)  — CP must be installed on the host
make cp-bridge-install      # build jars + install the systemd cp-bridge (auto-installs a JDK)
make cp-app-hash            # print the app hash to register on the CP Application in PVWA
# ... register the hash + grant the Safe, set CP_BRIDGE_URL/CP_APP_ID in .env, then:
make webapp-build webapp-deploy
```

CP Safe/Object coordinates default to the CCP demo's (`CCP_SAFE`/`CCP_OBJECT`,
`CCP_DENIED_*`) so both families can point at the same objects; override with the
`CP_*` vars in `.env`. Full walk-throughs are in **RUNBOOK §§ 3a–3c**.

## Prerequisites

- Terraform >= 1.5, Ansible >= 2.15, AWS CLI configured, Go >= 1.25 (local build; matches `go.mod` / the `golang:1.25` build image), `kubectl`, `helm`.
- An active **Secrets Manager – SaaS** tenant with the **Admin** role.
- **SWA** SKU entitlement (Palo Alto Networks Marketplace). Images are delivered as
  `*.tar.gz` and hosted in **your S3 bucket** — no registry needed; the host loads
  them into minikube directly (set `SWA_IMAGES_S3_URI`).
- AWS account/credentials permitted to create VPC/EC2/IAM resources.

Optional, per retrieval family:

- **CP demo** — a CyberArk **Credential Provider** installed on the host (with its
  `javapasswordsdk.jar` + `libjavapasswordsdk.so` and the `javaaimgetappinfo.jar`
  hash utility). A JDK is auto-installed by `cp-bridge-install` if only the CP's JRE
  is present.
- **CCP demo** — reachable **AIMWebService** endpoint + a client-cert-mapped App.
- **Conjur modes** — a Conjur Cloud service with `authn-jwt` and/or `authn-iam`.

## Security

No secrets are committed. All credentials live in `.env` (gitignored), Terraform
variables, and Kubernetes secrets created at deploy time. Retrieved secrets are
never returned in full to the browser or logs — only the masked preview/length/hash
summary (the CP path hashes on the host, so the full value never leaves it). See
`.env.example` for the full variable contract.

## Documentation

- `docs/ARCHITECTURE.md` — detailed identity flow and attestation model
- `docs/RUNBOOK.md` — step-by-step operation + troubleshooting, incl. the Conjur
  (§ 3a), CCP (§ 3b), and CP (§ 3c) enablement sequences
- `docs/SWA-SVID-ROTATION-BUG.md` — the X.509-SVID rotation wedge report + mitigations
- `docs/VM-SERVER-VARIANT.md` — optional VM-native (systemd) SWA Server topology
- `hostbridge/cp/README.md` — the CP host bridge (caller jars, dispatcher, contract)
