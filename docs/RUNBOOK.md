# Runbook

## Prerequisites (local)

- Terraform ≥ 1.5, Ansible ≥ 2.15 (`ansible-galaxy collection install -r ansible/requirements.yml`)
- AWS CLI configured (`aws sts get-caller-identity` works)
- Go ≥ 1.22 (for local `make webapp-test`), `kubectl`, `helm` (used on the host)
- SSH client

## Prerequisites (CyberArk)

- Active **Secrets Manager – SaaS** tenant + **Admin** role → set `SWA_TENANT_URL`, `SWA_TENANT_API_TOKEN`.
- **SWA** SKU entitlement. The server/agent images arrive as `*.tar.gz`.
- Upload those tarballs to an S3 prefix and set `SWA_IMAGES_S3_URI`
  (e.g. `s3://my-bucket/swa-images`). The host's IAM instance profile gets
  read access automatically; Ansible loads them into minikube — **no registry**.
- If the Helm **charts** are not pullable, drop `swa-server*.tgz` / `swa-agent*.tgz`
  into `helm/charts/`.
- Confirm the SWA **REST API routes** for your tenant version (see "Version-specific
  values" below).

### Upload the image tarballs

```bash
aws s3 cp swa-server.tar.gz s3://my-bucket/swa-images/
aws s3 cp swa-agent.tar.gz  s3://my-bucket/swa-images/
# any number of *.tar.gz under the prefix are auto-detected and loaded
```

## 1. Configure

```bash
cp .env.example .env          # fill in AWS, tenant, registry, trust-domain
cp terraform/terraform.tfvars.example terraform/terraform.tfvars   # optional
make preflight
make webapp-test              # fast local gate before provisioning
```

## 2. Bring up (phase by phase, or all at once)

```bash
make tf-apply     # Phase 1: VPC + RHEL EC2; writes ansible/inventory.ini
make configure    # Phase 2: host config + minikube; stages project to ~/swa-demo
make tenant       # Phase 3a: trust domain + server/node groups + register server
make swa          # Phase 3b: helm install SWA server + agent
make webapp-build # Phase 4a: build image in minikube docker
make webapp-deploy# Phase 4b: deploy webapp manifests
make verify       # Phase 5: health-check every layer
make demo         # open the UI
```

Or simply: `make up` (runs all of the above), then `make demo`.

## 3. Use the demo

Open `http://<host-ip>:30080`, click **Request JWT-SVID from SWA Agent**. The UI
animates the four lifecycle steps then shows the SPIFFE ID, validity window, and
decoded JWT header/claims.

## 4. Tear down

```bash
make down         # terraform destroy (removes all AWS infra)
```

## Version-specific values to confirm

These are centralized so you only edit them in one place:

| Item | File | Notes |
|------|------|-------|
| Tenant REST routes | `tenant/lib.sh` (`SWA_API_*`) | trust-domains / server-groups / node-groups / servers |
| `authn_id` field name | `tenant/03-register-server.sh` | parser handles `authnId`/`authn_id`/`id` |
| Image tarballs | `SWA_IMAGES_S3_URI` | auto-loaded; tags auto-detected to `~/.swa-images` |
| Helm charts | `helm/charts/*.tgz` or `.env` (`SWA_SERVER_CHART`/`SWA_AGENT_CHART`) | local package vs OCI ref |
| Chart value keys | `helm/swa-*/values.yaml.tmpl` | verify with `helm show values <chart>` |
| Attestation method | `tenant/01-server-group.sh` | `k8s_sat` for minikube |

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `make tenant` HTTP 401/404 | wrong API base/route or token | check `SWA_TENANT_URL`, token scope, adjust `SWA_API_*` in `tenant/lib.sh` |
| pod `ErrImageNeverPull` | image not loaded / tag mismatch | check `~/.swa-images` on host vs `helm/swa-*` repo:tag; re-run `make configure` (loads tarballs) |
| `make configure` S3 AccessDenied | instance profile / wrong prefix | verify `SWA_IMAGES_S3_URI` and that `TF_VAR_images_s3_uri` was set at `tf-apply` |
| `helm install` chart not found | chart ref/package missing | place `helm/charts/swa-*.tgz` or set `SWA_*_CHART` |
| webapp shows "demo (no agent socket)" | socket not mounted / agent down | confirm DaemonSet Running and `/run/swa-agent/api.sock` exists on the node |
| webapp 502 on `/api/svid` | agent reachable but issuance denied | check node-group workload selectors match `ns=swa-demo, sa=swa-demo-webapp` |
| minikube won't start | docker group / resources | re-login for docker group; ensure instance ≥ 4 vCPU / 16 GB |
| node not Ready | k8s version / driver | check `minikube logs`; pinned to v1.34 (SWA range 1.33–1.35) |

## Notes

- The webapp falls back to a **DEMO_MODE** Fake SVID if the agent socket is
  absent, so the UI always renders — check the "svid source" line on the page to
  confirm whether you are seeing a **live** or **demo** SVID.
- All host-side steps run over SSH via `scripts/host-exec.sh`, which reads the
  host IP/key from Terraform outputs.
