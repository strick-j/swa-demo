# Optional variant: VM-native SWA Server on the RHEL host

The default deployment runs **both** the SWA Server and Agent inside minikube via
Helm (lowest-risk, single-tool path). CyberArk also supports running the **SWA
Server as a system service on a VM**, with the **Agent** as a Kubernetes
DaemonSet. This matches the literal "server on the RHEL host, agent in the
minikube namespace" topology.

Use this variant when you want to demonstrate the hybrid model or keep the server
lifecycle independent of the cluster.

## What changes

```
RHEL host (systemd)                 minikube
┌──────────────────────┐           ┌─────────────────────────────┐
│ swa-server.service    │◀──gRPC──▶ │ SWA Agent (DaemonSet)        │
│  (VM node attestation)│           │  Workload API socket          │
└──────────┬───────────┘           │ demo-webapp ──socket──▶ Agent │
           │ k8s SA token / X.509  └─────────────────────────────┘
           ▼
   Secrets Manager – SaaS tenant
```

## Implementation outline (not wired into `make up` by default)

1. **Ansible role `swa_server_vm`** (new):
   - Pull the SWA Server binary/package from your entitlement.
   - Render `/etc/swa-server/config.yaml` from `.env` (tenant URL, trust domain,
     server group, `authn_id`).
   - Install a `swa-server.service` unit; `enable --now`.
   - Open the server's listen port in `firewalld` to the minikube CIDR only.
2. **Server registration** — same `tenant/03-register-server.sh`; the captured
   `authn_id` feeds the VM config instead of the Helm values.
3. **Agent values** — point `helm/swa-agent/values.yaml.tmpl` `server.address` at
   the host's in-cluster-reachable address (e.g. `host.minikube.internal:<port>`)
   instead of the in-cluster Service DNS name.
4. **Node attestation** — for a VM server attesting a minikube node, confirm the
   server can reach the cluster API for `k8s_sat` validation (or use the
   JWKS-unreachable path with extracted public keys).

## Switching

Add `swa_server_vm` to `ansible/site.yml` roles, drop the `swa-server` Helm
release from `scripts/deploy-swa.sh` (keep only `swa-agent`), and set
`server.address` in the agent values to the host endpoint. Everything downstream
(webapp, tenant config) is unchanged.

> This file documents the path; the roles/values above are intentionally **not**
> created yet to keep the default flow simple. Ask to scaffold `swa_server_vm`
> if you want this variant implemented.
