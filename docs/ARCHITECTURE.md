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
   ┌─────────────────────────────────── namespace: cyberark-swa ───────────────────────────────────┐
   │  SWA Server  ── node attestation, signs SVIDs, holds trust-domain keys                          │
   │  SWA Agent (DaemonSet)  ── workload attestation; serves Workload API on /run/swa-agent/api.sock  │
   └───────────────▲───────────────────────────────────────────────────────────────────────────────┘
                   │ (2) Workload API over unix domain socket (hostPath mount)
   ┌───────────────┴──────────── namespace: swa-demo ──────────────┐
   │  demo-webapp (Go)  ── requests JWT-SVID, renders the flow       │
   │  Service (NodePort 30080)  ── visual UI exposed to the operator │
   └───────────────────────────────────────────────────────────────┘
```

## Two-stage chain of trust

SPIFFE establishes identity through **node attestation** then **workload attestation**:

1. **Node attestation** — the SWA Server verifies the node/cluster identity. For
   Kubernetes this uses a **projected service-account token** that the server
   validates against the cluster's API server (method `k8s_sat`). Configured by
   the **server group**.
2. **Workload attestation** — once the node is trusted, the **SWA Agent**
   inspects pod runtime attributes (namespace, service account, labels) when a
   workload calls the Workload API. The **node group** policy decides which
   workloads receive which SPIFFE IDs.

## JWT-SVID request flow (what the UI shows)

| # | Step | Where |
|---|------|-------|
| 1 | Workload calls the Workload API socket | webapp → `/run/swa-agent/api.sock` |
| 2 | Agent attests pod runtime attributes (`ns=swa-demo`, `sa=swa-demo-webapp`) | SWA Agent |
| 3 | Server validates attributes against node-group policy | SWA Server |
| 4 | Short-lived JWT-SVID minted and returned | Server → Agent → webapp |

The resulting SPIFFE ID is `spiffe://<trust-domain>/ns/swa-demo/sa/swa-demo-webapp`,
carried in the JWT `sub` claim. The webapp decodes the token (header + claims)
and displays validity (`iat`/`exp`).

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

## Trust boundaries / secrets

- Tenant API token, registry pull credentials, and AWS creds live only in `.env`
  (gitignored) and become Terraform vars / Kubernetes secrets at deploy time.
- The agent socket is mounted **read-only** into the webapp pod.
- The Security Group restricts SSH and the NodePort to `admin_cidr`.
