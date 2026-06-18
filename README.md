# swa-demo

Automated, end-to-end demo of **CyberArk Secure Workload Access (SWA)** issuing
SPIFFE **JWT-SVIDs** to a workload running on **minikube**, with a visual UI that
shows the full request → attestation → JWT-SVID lifecycle.

> "Idira" is CyberArk's brand for the **Secrets Manager – SaaS** product/docs.
> This project targets an Idira / Secrets Manager – SaaS tenant.

## What it builds

```
AWS (Terraform)            RHEL host (Ansible)         minikube
┌──────────────┐          ┌───────────────────┐       ┌────────────────────────────┐
│ VPC + subnet │          │ RHEL 8/9 EC2      │       │ ns cyberark-swa            │
│ SG, IGW      │ ───────▶ │ docker + minikube │ ────▶ │  SWA Server ──▶ tenant      │
│ EC2 host     │          │ kubectl + helm    │       │  SWA Agent (DaemonSet)      │
└──────────────┘          └───────────────────┘       │ ns swa-demo                 │
                                                       │  demo-webapp ──socket──▶ Agent
                                                       │   └─ JWT-SVID + visual UI   │
                                                       └────────────────────────────┘
```

## Components / phases

| Phase | Dir | What |
|-------|-----|------|
| 0 | root | Scaffolding, `.env`, `Makefile`, lint |
| 1 | `terraform/` | AWS VPC + RHEL EC2 host |
| 2 | `ansible/` | Host config + minikube + kubectl/helm |
| 3 | `tenant/`, `helm/`, `scripts/deploy-swa.sh` | Tenant trust domain/groups + SWA server & agent |
| 4 | `webapp/`, `k8s/` | Go SPIFFE webapp + visual JWT-SVID UI |
| 5 | `scripts/`, `Makefile` | `make up` / `make down` glue, verify, demo |

## Quick start

```bash
cp .env.example .env        # fill in AWS, tenant, registry, trust-domain values
make preflight              # check CLIs + .env
make up                     # terraform -> ansible -> tenant -> swa -> webapp -> verify
make demo                   # open the visual UI
make down                   # tear down AWS infra
```

## Prerequisites

- Terraform >= 1.5, Ansible >= 2.15, AWS CLI configured, Go >= 1.22 (local build), `kubectl`, `helm`.
- An active **Secrets Manager – SaaS** tenant with the **Admin** role.
- **SWA** SKU entitlement (Palo Alto Networks Marketplace) + registry pull credentials.
- AWS account/credentials permitted to create VPC/EC2 resources.

## Security

No secrets are committed. All credentials live in `.env` (gitignored), Terraform
variables, and Kubernetes secrets created at deploy time. See `.env.example` for
the full variable contract.

## Documentation

- `docs/ARCHITECTURE.md` — detailed identity flow and attestation model *(Phase 5)*
- `docs/RUNBOOK.md` — step-by-step operation + troubleshooting *(Phase 5)*
- `docs/VM-SERVER-VARIANT.md` — optional VM-native (systemd) SWA Server topology *(Phase 5)*
