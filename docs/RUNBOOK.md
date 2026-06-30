# Runbook

## Prerequisites (local)

- Terraform ≥ 1.5
- **Ansible ≥ 2.15 on Python 3.** If your system `ansible-playbook` is missing or
  stuck on Python 2 (`ImportError: No module named module_utils...`), run
  `make ansible-venv` once — it creates a `.venv-ansible/` with a modern Ansible +
  collections, and `make configure`/`make up` use it automatically.
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

## 2. One-time setup — upload the bundle + provision an Identity OIDC client

Two hosts are involved: the **control host** (where you run `make` — needs S3
access via its IAM role + a CyberArk Identity OAuth client) and the **target host**
(the minikube box created by Terraform — pulls images from S3 with its own role).

Upload the **whole** release bundle to your S3 prefix (images, charts, provider,
installer):

```bash
aws s3 cp "$SWA_RELEASE_DIR"/ s3://my-bucket/swa-images/ --recursive
```

Tenant side (once): (a) store a CyberArk Identity confidential OAuth client in
Conjur (its `username`/`password` = client_id/client_secret), trusted by Conjur's
`authn-oidc/<service>` authenticator; (b) give the control host a bootstrap Conjur
identity the `conjur` provider can log in as. Set in `.env` (as `TF_VAR_*`):
`conjur_authn_type` (e.g. keyless `iam`), `conjur_authn_service_id`,
`conjur_host_id`, `conjur_sca_username_path`, `conjur_sca_password_path`,
`identity_tenant_id`, `conjur_oidc_service_id` (usually `cyberark`), plus
`CONJUR_APPLIANCE_URL` + `CONJUR_ACCOUNT`. **No static OAuth secret in `.env`, no
`conjur login`** — the conjur provider reads the client creds from Conjur and
`make tenant-tf` mints a fresh Conjur access token per apply (Identity OIDC).
Secrets read this way are persisted to Terraform state — protect your backend.

## 3. Bring up (phase by phase, or all at once)

```bash
make tf-apply       # Phase 1 (control): VPC + RHEL EC2 + IAM; writes ansible/inventory.ini
make configure      # Phase 2 (target): minikube + load images (S3) + vendor charts
make control-setup  # Phase 3a (control): install SWA provider + write ~/.conjurrc
make tenant-tf      # Phase 3b (control): mint Conjur token (Identity OIDC) + cyberark/swa apply -> authn_id
make swa            # Phase 3c: bridge authn_id to target + helm install SWA server + agent
make webapp-build   # Phase 4a: build image in target's minikube docker
make webapp-deploy  # Phase 4b: deploy webapp manifests
make verify         # Phase 5: health-check every layer
make demo           # open the UI
```

`make tenant` is the REST-script fallback if you prefer not to use the provider.

Or simply: `make up` (runs all of the above; assumes the one-time setup), then `make demo`.

## 3. Use the demo

Open `http://<host-ip>:30080`, click **Request JWT-SVID from SWA Agent**. The UI
animates the four lifecycle steps then shows the SPIFFE ID, validity window, and
decoded JWT header/claims.

## 3a. Enable the Conjur **AWS STS (authn-iam)** demo

The Secrets Manager page has two Conjur tabs: **JWT auth** (authn-jwt, lit up by
the SWA agent + `CONJUR_APPLIANCE_URL` in `.env`) and **AWS STS** (authn-iam).
Each runs **simulated** until configured. Below brings the AWS STS tab live; it
reuses the JWT secret. Prereqs: the JWT demo working, and an existing **AWS IAM
authenticator** in the tenant (note its `<service-id>`).

The webapp pod authenticates to Conjur with the **target host's instance-profile
role** (`swa-demo-host-role`) via IMDS — a *different* identity than the control
host the `conjur` provider uses. So the Conjur workload must map that role's ARN.

**Step 1 — Conjur: create the workload + grant the secret + link the authenticator.**
The authn-iam workload id is `<aws-account-id>/<iam-role-name>`. Load to your
branch (`POST {tenant}/api/policies/conjur/policy/data%2Fswa`):

```yaml
- !policy
  id: aws
  body:
    - !host
      id: <aws-account-id>/swa-demo-host-role        # e.g. 475601244925/swa-demo-host-role

# Reuse the JWT secret — just add the IAM host as a second reader
- !permit
  role: !host /data/swa/aws/<aws-account-id>/swa-demo-host-role
  privilege: [ read, execute ]
  resource: !variable /data/swa/secrets/myapp/api-key
```

Link the host to the existing authenticator — REST (no policy):

```
POST {tenant}/api/groups/conjur%2Fauthn-iam%2F<service-id>%2Fapps/members
Accept: application/x.secretsmgr.v2+json   ·   Content-Type: application/json
{ "id": "data/swa/aws/<aws-account-id>/swa-demo-host-role", "kind": "host" }
```
…or in policy: `!grant role: !group conjur/authn-iam/<service-id>/apps  member: !host <aws-account-id>/swa-demo-host-role`
(confirm the group name — it is authenticator-specific).

**Step 2 — `.env`: point the webapp at it** (shares `CONJUR_APPLIANCE_URL` /
`CONJUR_ACCOUNT` with JWT):

```sh
export CONJUR_AUTHN_IAM_SERVICE_ID="<service-id>"               # bare id -> authn-iam/<service-id>
export CONJUR_IAM_HOST_ID="host/data/swa/aws/<aws-account-id>/swa-demo-host-role"
export CONJUR_IAM_SECRET_PATH="${CONJUR_JWT_SECRET_PATH}"       # reuse the JWT secret
```
(Test `CONJUR_IAM_HOST_ID` with and without the leading `host/` — `conjur-api-go`
is finicky about it.)

**Step 3 — update the host IAM permissions** (the role needs `sts:GetCallerIdentity`
— it authenticates as itself, so no `AssumeRole` — and the pod needs the IMDS
metadata hop limit ≥ 2). Both are **in-place** updates — no instance replacement.
Always `source .env` first so the region is correct:

```bash
cd ~/swa-demo && source .env
echo "region=$TF_VAR_aws_region"                # MUST be your real region (e.g. us-east-2)
terraform -chdir=terraform plan                 # expect: ~ conjur_sts policy + hop_limit; 0 destroyed
terraform -chdir=terraform apply
```
> If the plan shows resources **destroyed** or a region you don't expect, STOP —
> `.env` wasn't sourced and `aws_region` is wrong (see Troubleshooting).

**Step 4 — redeploy** (injects the new `CONJUR_IAM_*` onto the pod from `.env`):

```bash
make webapp-deploy
```

**Verify.** Open the Secrets Manager page → **AWS STS** tab → it should read
**Retrieved ✓** (no "simulated"), showing the caller ARN → host mapping → masked
secret. Because both tabs read the same variable, the masked `sha256` summary
matches the JWT tab — proof two auth paths reached the same secret.

## 4. Tear down

```bash
make down         # terraform destroy (removes all AWS infra)
```

## Version-specific values to confirm

These are centralized so you only edit them in one place:

| Item | File | Notes |
|------|------|-------|
| Tenant resources (primary) | `terraform-swa/` | cyberark/swa provider; Conjur OIDC access-token auth |
| Conjur auth | `conjur` provider + `data.external.conjur_token` (`conjur-auth.tf`) | reads OAuth client from Conjur, mints a short-lived access token per apply (no static key) |
| Provider version pin | `terraform-swa/providers.tf` | must match `install-terraform-provider.sh` output |
| Server JWT to control plane | `terraform-swa` `server_*` vars | minikube → inline `public_keys` via `fetch-cluster-jwks.sh` |
| Tenant REST routes (fallback) | `tenant/lib.sh` (`SWA_API_*`) | only if using REST scripts instead of provider |
| Image tarballs | `SWA_IMAGES_S3_URI` | `*-amd64.tar`, auto-loaded; tags to `~/.swa-images` |
| Helm charts | `helm/charts/*.tgz` (`make vendor-charts`) | from the release bundle |
| Control-plane token | `SWA_CONTROLPLANE_TOKEN_FILE` | optional `--set-file controlPlane.token` |
| Chart value keys | `helm/swa-*/values.yaml.tmpl` | verify with `helm show values <chart>` |
| Attestation method | `tenant/01-server-group.sh` | `k8s_sat` for minikube |

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `make tenant-tf` auth/401 from Conjur | conjur-provider bootstrap, secret path, or OIDC exchange failed | check `conjur_authn_type`/`conjur_host_id` can read `conjur_sca_*_path`; verify `identity_tenant_id` + `conjur_oidc_service_id`; debug the exchange with `CONJUR_OIDC_CLIENT_ID=.. CONJUR_OIDC_CLIENT_SECRET=.. IDENTITY_TENANT_ID=.. bash scripts/conjur-token.sh` |
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
