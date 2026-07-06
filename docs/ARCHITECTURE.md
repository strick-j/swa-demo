# Architecture

## Goal

Demonstrate CyberArk **Secure Workload Access (SWA)** issuing SPIFFE SVIDs to a
workload on minikube, with a visual UI of the full lifecycle — and set it side by
side with the **other ways a workload can obtain a credential from CyberArk**: the
local **Credential Provider (CP)**, the **Central Credential Provider (CCP)**, and
**Conjur Cloud**. SWA is the centerpiece; the other families exist so the UI can
contrast "ephemeral identity, no stored secret" against "authenticate, then fetch a
stored secret."

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

## Secrets-retrieval families (the webapp)

Beyond the SWA flow above, the webapp is a landing **chooser** over four CyberArk
retrieval families, all behind one seam — `internal/retrieve.Retriever` — so the
HTTP/UI layer treats every mode identically: run it, get a narrated lifecycle plus
a **masked proof-of-retrieval**. The raw secret never reaches the browser or logs;
only a short **6-char preview + length + SHA-256** (`retrieve.Mask`) is surfaced —
enough to match by eye against the source of truth and to see it change on
rotation. Modes render an illustrative/simulated result until their backend is
configured (SWA works via `DEMO_MODE`; **CP is live-only**).

| Family | Mode | Authenticates the workload by | Then |
|--------|------|-------------------------------|------|
| Secure Workload Access | SPIFFE SVID → gateway | ephemeral `x509`/`jwt` SVID (node + workload attestation) | authorize by SPIFFE ID — **no stored secret** |
| Secrets Manager – SaaS | Conjur · JWT / Conjur · AWS STS | `authn-jwt` (JWT-SVID) / `authn-iam` (signed `sts:GetCallerIdentity`) | read a Conjur variable over the API |
| Credential Providers | CCP (AIMWebService) | client **certificate** (mTLS) mapped to an Application | authorize App → Safe, return the account |
| Credential Providers | CP (local) | application **hash** / path / OS user of the calling process | authorize App → Safe, return the account |

CP and CCP are deliberately symmetric — the same four use cases (authorized · authn
deny · authz/denied-safe · dual-account), with the client certificate (CCP) swapped
for the calling application's hash (CP).

### The CP host bridge (an out-of-cluster component)

The Credential Provider authenticates the **calling application** by measuring the
process that invokes its SDK (hash + path + OS user). A container can't load the
host's native SDK — and even if it could, its identity would be the pod's, not a
host application's. So the real caller runs **on the host**, and the pod reaches it
through a thin HTTP bridge:

```
 ns swa-demo (minikube)                    RHEL host
 ┌──────────────────────┐   POST /cp     ┌───────────────────────────────────────────┐
 │ webapp: cp Retriever  │ ─────────────▶ │ cp-bridge (systemd, JDK)  :8890            │
 │ (Go, in the pod)      │  host.minikube │   exec java -cp javapasswordsdk.jar:<jar>  │
 │                       │  .internal:8890│        CpCaller  ──JavaPasswordSDK──▶ CP ──▶ Vault
 │  masked result ◀──────┼── JSON ────────┤   scenario → registered cp-caller.jar      │
 └──────────────────────┘  {preview,len,  │            → OR unregistered cp-rogue.jar  │
                            sha256,acct…}  └───────────────────────────────────────────┘
```

Design points:

- **Per-scenario subprocess.** The bridge `exec`s a fresh JVM per request so each
  scenario's *calling application* has its own hash. A **registered**
  `cp-caller.jar` vs an **unregistered** `cp-rogue.jar` (different content + install
  path, `/opt/swa-cp/rogue/`) is exactly what the "invalid hash" scenario proves.
- **Secret stays on the host.** `CpCaller` hashes the retrieved value on the host
  and emits only its preview/length/SHA-256 — the full credential never crosses the
  bridge. The bridge holds the Safe/Object coordinates in its own env (rendered from
  `.env`, defaulting to the CCP demo's), so no object names travel from the cluster.
- **Hash registration.** The runtime hash the CP computes equals the output of
  CyberArk's `javaaimgetappinfo.jar GetHash` (`scripts/cp-app-hash.sh`); that value
  is registered on the Application in PVWA. If it isn't authorized, the provider
  logs `APPAP133E … Hash "…" is unauthorized` and the retrieval fails.
- **JDK, not just a JRE.** The CP ships a runtime only; `cp-bridge-install`
  compiles the caller/bridge, so it installs a `-devel` JDK if `javac`/`jar` are
  absent. The bridge itself needs only `java`.

See `hostbridge/cp/` and **RUNBOOK § 3c**.

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
- **Retrieved secrets are never returned in full** — the browser and logs only ever
  see the masked preview/length/SHA-256. On the CP path the value is hashed on the
  host, so the full credential never crosses the cp-bridge into the cluster.
- The **cp-bridge** binds a host-only interface (`host.minikube.internal:8890`) and
  runs the caller as the OS user registered on the CP Application; it holds the
  Safe/Object coordinates on the host, not in the cluster.
- The Security Group restricts SSH (22) to `ssh_cidrs`, and the NodePort + ALB (80/443) to `http_cidrs`.
- Optional HTTPS: set `domain_name` and Terraform requests a DNS-validated,
  auto-renewing **ACM** cert for an ALB that terminates TLS. Add the
  `acm_validation_records` at your DNS host (ACM then issues the cert), then CNAME
  `domain_name` at the `alb_dns_name` output. `certificate_arn` is an optional
  override (pre-imported cert). Left empty, only the plain-HTTP NodePort is exposed.
