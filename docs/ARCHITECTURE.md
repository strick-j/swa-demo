# Architecture

## Goal

Demonstrate CyberArk **Secure Workload Access (SWA)** issuing a SPIFFE
**JWT-SVID** to a workload on minikube, with a visual UI of the full lifecycle.

> "Idira" is CyberArk's brand for the **Secrets Manager – SaaS** docs/tenant.
> SWA is the SPIFFE-compliant workload-identity capability of that product.

## Topology (default: server + agent in-cluster)

```
                         ┌──────────────────────────── Secrets Manager – SaaS (tenant) ───────────────────────────┐
                         │  Trust domain  ·  Server group  ·  Node group  ·  Workload inventory  ·  JWKS endpoint   │
                         └───────────────▲───────────────────────────────────────────────────────────────────────┘
                                         │ (1) server auth via projected k8s SA JWT  +  config/inventory sync
AWS  ──Terraform──▶  EC2 RHEL 8/9  ──Ansible──▶  minikube (docker driver)
                                         │
   ┌─────────────────────────────────── namespace: swa-system ──────────────────────────────────────────┐
   │  SWA Server  ── node attestation, signs SVIDs, holds trust-domain keys                                │
   │  SWA Agent (DaemonSet)  ── workload attestation; Workload API on /tmp/swa-agent/public/api.sock        │
   └───────────────▲────────────────────────────────────────────────────────────────────────────────────┘
                   │ (2) Workload API over unix domain socket (hostPath mount)
   ┌───────────────┴──────────── namespace: swa-demo ──────────────┐
   │  demo-webapp (Go)  ── requests JWT-SVID, renders the flow       │
   │  Service (NodePort 30080)  ── visual UI exposed to the operator │
   └───────────────────────────────────────────────────────────────┘
```

## Two-stage chain of trust

SPIFFE establishes identity through **node attestation** then **workload attestation**:

1. **Node attestation** — the SWA Server verifies the node/cluster identity. For
   Kubernetes this uses a **projected service-account token** (method
   `k8s_psat`, audience `swa-server`) validated via the TokenReview API.
   Configured by the **server group** (`node_attestation.k8s_psat.clusters`).
2. **Workload attestation** — once the node is trusted, the **SWA Agent**
   inspects pod runtime attributes (namespace, service account, labels) when a
   workload calls the Workload API. The **node group** policy + SPIFFE ID
   template decide which workloads receive which SPIFFE IDs.

Tenant-side resources (trust domain, server group, server, node group) are
managed by the official **`cyberark/swa` Terraform provider** in `terraform-swa/`,
applied **on the control host** so the provider authenticates to Conjur Cloud with
a **short-lived Conjur access token**. The `cyberark/conjur` provider first reads
the CyberArk Identity OAuth client out of Conjur, then `data.external.conjur_token`
exchanges it via the Identity OIDC flow (`scripts/conjur-token.sh`) for the swa
provider's token — no static secret in `.env`, no `conjur login`. The server
registration emits an **`authn_id`**, bridged to the target
(`outputs.env`) and consumed by the swa-server Helm chart. (`tenant/*.sh` REST
scripts remain as a fallback.)

> **Two-host split:** the control host runs Terraform + `terraform-swa` (has S3 +
> Conjur access); the target host runs minikube/SWA/webapp and pulls images from
> S3 with its own role. `scripts/host-exec.sh`/`host-push.sh` bridge between them
> over SSH (connection from Terraform outputs).

## JWT-SVID request flow (what the UI shows)

| # | Step | Where |
|---|------|-------|
| 1 | Workload calls the Workload API socket | webapp → `/tmp/swa-agent/public/api.sock` |
| 2 | Agent attests pod runtime attributes (`ns=swa-demo`, `sa=swa-demo-webapp`) | SWA Agent |
| 3 | Server validates attributes against node-group policy | SWA Server |
| 4 | Short-lived JWT-SVID minted and returned | Server → Agent → webapp |

The resulting SPIFFE ID follows the node-group template
`spiffe://<trust-domain>/<node-group>/ns/swa-demo/sa/swa-demo-webapp`, carried in
the JWT `sub` claim. The webapp decodes the token (header + claims) and displays
validity (`iat`/`exp`).

## Why these choices

- **Server + agent in minikube via Helm** — lowest-risk path that matches the
  CyberArk k8s getting-started guide; a single tool (Helm) drives both. The
  optional VM-native server topology is documented in
  [VM-SERVER-VARIANT.md](VM-SERVER-VARIANT.md).
- **Go + go-spiffe/v2** — first-class Workload API SDK; single static binary;
  tiny distroless image that loads straight into minikube.
- **Interface seam (`internal/svid`)** — the HTTP/UI layer depends only on a
  `Fetcher` interface, so it tests without a live agent and falls back to a
  `DEMO_MODE` Fake when no socket is present.

## Image distribution (no registry)

SWA images ship as arch-specific `*.tar` (e.g. `swa-server-1.0.0-amd64.tar`) and
are hosted in **your S3 bucket**. The EC2 host reads them via an **IAM instance
profile** (scoped `s3:GetObject` — no static keys), Ansible loads each
`*-amd64.tar` into minikube (`docker load` in minikube's docker-env), and the
repo:tag is **auto-detected** into `~/.swa-images`. Helm references those tags
with `pullPolicy: Never`, so the cluster never contacts a registry and no
`imagePullSecret` exists (mirrors the bundle's own `kind-load-images` pattern).
The webapp image is likewise built straight into minikube's docker. See
[RUNBOOK.md](RUNBOOK.md) for the upload step.

## Trust boundaries / secrets

- Tenant API token and AWS creds live only in `.env` (gitignored) and become
  Terraform vars / Kubernetes secrets at deploy time. Image pulls need **no**
  credentials (loaded locally); S3 read is via the host's IAM instance profile.
- The agent socket is mounted **read-only** into the webapp pod.
- The Security Group restricts SSH, the NodePort, and the ALB (80/443) to `admin_cidrs`.
- Optional HTTPS: set `certificate_arn` (an imported ACM cert) + `domain_name` to
  front the webapp with an ALB (TLS termination); CNAME `domain_name` at the
  `alb_dns_name` output. Left empty, only the plain-HTTP NodePort is exposed.
