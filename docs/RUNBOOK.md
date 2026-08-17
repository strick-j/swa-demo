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
metadata hop limit **= 3**: under the docker driver the pod is two hops from the
host — `pod → minikube node-container → host` — so 2 still times out). Both are
**in-place** updates — no instance replacement. Always `source .env` first so the
region is correct:

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

## 3b. Enable the **Central Credential Provider (CCP)** demo

The `/credential-providers` page runs four AIMWebService scenarios over mTLS:
**1** authorized retrieval, **2** no-cert (authn deny), **3** denied safe (authz
deny), **4** dual-account (active-account resolution). Simulated until configured.

**Step 1 — client cert.** Generate a self-signed client cert + store the Secret,
and grab its identity to register in CyberArk:
```bash
make ccp-cert        # prints CN + Serial (hex) + SHA1 + the full public PEM (ccp-client.crt)
```

**Step 2 — CyberArk side.**
- **IIS**: on the AIMWebService site, enable **Require SSL** + client certificates
  (this is what makes IIS request the cert; without it you get `APPEX003E`).
- Import the **public cert** (`ccp-client.crt`) into the CCP host's **Trusted Root**
  store (self-signed ⇒ it's its own CA).
- On the **Application** (`AppID`): add **certificate** authentication mapped by
  **Serial Number** (and/or CN); grant it the authorized Safe. For scenario 3,
  have a Safe it is NOT permitted for; for scenario 4, a dual-account pair.

**Step 3 — firewall.** Allow inbound `443/tcp` from the demo host's egress IP —
both the host and the webapp pod egress as it:
```bash
scripts/host-exec.sh "curl -s https://checkip.amazonaws.com"   # e.g. 3.143.218.152/32
```

**Step 4 — `.env`** (injected on deploy):
```sh
export CCP_BASE_URL="https://<ccp-host-or-ip>"
export CCP_APP_ID="<app id>"
export CCP_SAFE="<authorized safe>"        CCP_OBJECT="<object>"
export CCP_DENIED_SAFE="<no-access safe>"  CCP_DENIED_OBJECT="<object>"   # scenario 3
export CCP_DUAL_QUERY="Safe=<safe>;VirtualUsername=<name>"                # scenario 4
export CCP_INSECURE_SKIP_VERIFY="true"     # CCP server uses an internal/self-signed CA
```

**Step 5 — deploy:** `make webapp-deploy`, then open `/credential-providers`.

### CCP gotchas (Go client vs IIS/AIMWebService)

These were all needed to make the Go webapp behave like a working `curl --cert` /
PowerShell `-Certificate`. Each shows up as a *different* error as you go deeper:

| Symptom | Cause | Fix |
|---|---|---|
| `APPEX003E` (generic CP error) | IIS not requesting/forwarding the client cert | enable **Require SSL** + client certs on the AIMWebService site |
| `connection reset by peer` mid-TLS (curl works) | Go offers HTTP/2 (ALPN `h2`); the IIS/LB/WAF tier resets on it | client forces HTTP/1.1 (`ForceAttemptHTTP2=false` + empty `TLSNextProto`) — in `ccp` package |
| `local error: tls: no renegotiation` | IIS requests the cert via TLS **renegotiation**; Go refuses by default | `Renegotiation=RenegotiateFreelyAsClient` — in `ccp` package |
| `x509: certificate signed by unknown authority` / expired | CCP server cert is internal-CA/self-signed (or was expired) | `CCP_INSECURE_SKIP_VERIFY=true` (demo); renew the server cert if expired |
| cert-auth denied while curl works | Go's `Certificates` only sends a cert matching the server's acceptable-CA list; self-signed doesn't match | client uses `GetClientCertificate` to present unconditionally — in `ccp` package |

Handy diagnostics (run on the target host; the cert/key land in `/tmp`):
```bash
# does presenting the cert to the real endpoint work? (mimics the webapp)
scripts/host-exec.sh 'CCP=<ip>; APP=<app>; SAFE=<safe>; OBJ=<obj>; kubectl -n swa-demo get secret ccp-client-tls -o jsonpath="{.data.tls\.crt}" | base64 -d > /tmp/c.crt; kubectl -n swa-demo get secret ccp-client-tls -o jsonpath="{.data.tls\.key}" | base64 -d > /tmp/c.key; curl -sk --cert /tmp/c.crt --key /tmp/c.key "https://$CCP/AIMWebService/api/Accounts?AppID=$APP&Safe=$SAFE&Object=$OBJ" -w "\nHTTP %{http_code}\n"'
# read the cert's Serial / CN for the CyberArk mapping
scripts/host-exec.sh "kubectl -n swa-demo get secret ccp-client-tls -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -serial -subject -fingerprint -sha1"
```

## 3c. Enable the **Credential Provider (CP)** demo

The `/cp` page runs four scenarios against a Credential Provider **installed on the
host** (not a container): **1** authorized retrieval, **2** invalid hash (authn
deny), **3** denied safe (authz deny), **4** dual-account. Unlike the CCP, the CP
authenticates the **calling application** by its characteristics (application
**hash** + path + OS user) rather than a client certificate.

**Architecture.** The webapp runs in a pod and cannot load the host SDK, so it
POSTs a scenario to a host **cp-bridge** (a systemd service) at
`host.minikube.internal:8890`. The bridge runs the matching Java caller as a
subprocess — so each scenario's calling application has its own hash — and relays
the caller's JSON. The secret is hashed on the host; only its length + digest
cross the bridge, so the raw credential never leaves the host.

```
pod (Go cp retriever)  ──HTTP──►  cp-bridge (host)  ──exec──►  cp-caller.jar ─┐
   POST /api/cp                    host.minikube.internal:8890   (registered)  │ JavaPasswordSDK
                                                      └──exec──►  rogue jar ────┤   │
                                                                (unregistered)  │   ▼
                                                                                └► Credential Provider
```

**Two callers = the hash factor.** `build.sh` produces `cp-caller.jar` (its hash
is registered on the CP Application) and `cp-rogue.jar` (different content,
installed at a different path, **not** registered). Scenario 2 runs the rogue jar
with the same App/Safe as scenario 1 — the CP rejects it on the calling
application's hash/path.

**Prereqs (host).** A JDK (`javac`/`jar` — the CP ships only a JRE, so
`cp-bridge-install` auto-installs a `-devel` JDK if missing), the CyberArk **Credential Provider**
installed and running (`aimprv`), and its `javapasswordsdk.jar` +
`libjavapasswordsdk.so` (default `/opt/CARKaim/sdk/`). Install the CP manually, or
with the CyberArk `cyberark.aam` Ansible collection
(<https://github.com/cyberark/ansible-security-automation-collection/blob/master/docs/aimprovider.md>);
automation is optional for a one-off.

**Staging the CP installer from S3.** A host rebuild wipes a manually-installed CP,
so keep the AAM installer in S3 and let Ansible re-stage it on every `make configure`.
Upload the installer to a **distinct prefix in the same bucket** as the images
(`cp-installer/`, not `swa-images/`):
```bash
aws s3 cp AAM-RHELinux-Intel64-Rls-v14.2.6.zip s3://my-bucket/cp-installer/
```
Set `CP_INSTALLER_S3_URI` (+ `TF_VAR_cp_installer_s3_uri`) in `.env` to that prefix.
Because it is a **new prefix**, the host role needs an S3 read grant for it —
Terraform adds a scoped `${project}-cp-installer-s3-read` policy from
`cp_installer_s3_uri`, so **re-run `terraform apply` (or `make tf-apply`) after
setting it**, exactly like the per-version `swa-images` prefix. Then the
`cp_installer` role (`make configure`) syncs the zip to
`/home/ec2-user/cp-installer/`. Leave `CP_INSTALLER_S3_URI` empty to skip both the
grant and the sync.

**Installing the CP — `make cp-install`.** The `cp_installer` role also hand-rolls
the install (gated on `cp_install_enabled`, set by this target). We hand-roll
rather than use the CyberArk `cyberark.pas.aimprovider` role because that role
provisions the App Provider user over the on-prem PAS Web Services SDK/REST, which
**Privilege Cloud does not expose** — so we provision locally with `CreateCredFile`
against the Privilege Cloud Vault address in `vault.ini`. The target runs the
manual 7-step flow: stage/extract → render `aimparms` → render `vault.ini` →
fetch the installer credential → `CreateCredFile` → `rpm -ihv CARKaim-*.rpm` →
enable `aimprv`, then asserts the `/opt/CARKaim/{sdk,bin}` artifacts the
cp-bridge/app-hash steps assume.

Set in `.env` first:
```bash
export CP_VAULT_ADDRESS="<privilege-cloud-vault-address>"   # ADDRESS in vault.ini; host needs egress on 1858
# Installer (provisioning) cred — pull from Secrets Manager SaaS by Conjur path:
export CP_PROVISION_USER_PATH="data/vault/<safe>/<account>/username"
export CP_PROVISION_PASS_PATH="data/vault/<safe>/<account>/password"
# ...or the .env fallback (kept off argv), if you can't fetch from Conjur:
# export CP_PROVISION_USER="..."; export CP_PROVISION_PASS="..."
```
The credential fetch reuses the same Identity-OIDC → Conjur token flow as
`make tenant-tf` (via `scripts/conjur-secret.sh`, run on the control host), so the
existing `CONJUR_*` / `IDENTITY_*` vars must be set. Then:
```bash
make cp-install
```
Notes:
- The **provisioning user** must be a Privilege Cloud identity permitted to add
  the CP component / create the provider user.
- Exact `aimparms` keys, `CreateCredFile` flags, the RPM name, and the vault.ini
  fields are **CP-version-specific** — the CyberArk **Credential Provider install
  guide** for your version (docs.cyberark.com → *Credential Providers* → *Install
  the Credential Provider*) is authoritative. The role's defaults
  (`ansible/roles/cp_installer/defaults/main.yml`) are the tuning point; override
  via `.env`/`-e` as needed.
- Idempotent: `CreateCredFile` and the RPM are guarded by `creates:`, so re-running
  `make cp-install` is a no-op once installed. `CP_PROVISION_*` are handled with
  `no_log`; note `CreateCredFile` briefly places the password on argv on the host.

**Step 1 — `.env`.** Set the host build vars and the CP object coordinates. The
Safe/Object values **default to the CCP demo's** — leave them empty to reuse the
same objects, or set them to point the CP elsewhere:
```sh
export CP_SDK_JAR="/opt/CARKaim/sdk/javapasswordsdk.jar"
export CP_RUN_USER=""                 # OS user the bridge runs as (blank = host user)
export CP_APP_ID="SWA-CP-Demo"        # a hash-auth Application, separate from the CCP one
export CP_BRIDGE_URL="http://host.minikube.internal:8890"
# Safe/Object — leave empty to inherit CCP_SAFE/CCP_OBJECT + CCP_DENIED_*:
export CP_SAFE="" CP_OBJECT="" CP_DENIED_SAFE="" CP_DENIED_OBJECT=""
export CP_DUAL_QUERY="Safe=<safe>;Folder=Root;Object=<obj>"  CP_DUAL_VIRTUAL="<name>"
```

**Step 2 — install the bridge (host).**
```bash
make cp-bridge-install     # builds jars, installs /opt/swa-cp + systemd cp-bridge, renders
                           # /etc/swa-cp/cp-bridge.env from .env (CCP fallback), starts it
```
The bridge env file is regenerated from `.env` on every run. To hand-edit
`/etc/swa-cp/cp-bridge.env` directly instead, set `CP_BRIDGE_ENV_KEEP=1`.

**Step 3 — CyberArk side.**
- Create the CP **Application** (e.g. `SWA-CP-Demo`).
- Get the **application hash** with CyberArk's `JavaAIMGetAppInfo` utility (this is
  CyberArk's own algorithm — not a plain sha256; the SHA-256 `build.sh` prints is
  only the illustrative UI fingerprint):
  ```bash
  make cp-app-hash            # runs /opt/CARKaim/bin/javaaimgetappinfo.jar on cp-caller.jar
  # add --rogue to confirm the rogue jar hashes differently:
  scripts/host-exec.sh "bash scripts/cp-app-hash.sh --rogue"
  ```
- Add **authentication** characteristics on the Application: the **hash** from
  above, the **OS user** the bridge runs as, and the **path**
  `/opt/swa-cp/cp-caller.jar`. Do **not** register `cp-rogue.jar`.
- Grant the Application the authorized **Safe** (scenarios 1, 2, 4) — the same Safe
  the CCP demo uses if you left `CP_SAFE` empty. For scenario 3 have a Safe it is
  **not** permitted for; for scenario 4 a **dual-account** pair.

**Step 4 — deploy:** `make webapp-deploy` (injects `CP_BRIDGE_URL` + `CP_APP_ID`
onto the pod), then open `/cp`.

### CP diagnostics

```bash
# bridge health + a scenario, from the host
scripts/host-exec.sh "systemctl --no-pager status cp-bridge | head; curl -s localhost:8890/healthz; echo; curl -s -XPOST 'localhost:8890/cp?scenario=authorized'"
# does the POD reach the bridge? (host.minikube.internal must resolve in-cluster)
scripts/host-exec.sh "kubectl -n swa-demo exec deploy/swa-demo-webapp -- sh -c 'wget -qO- --post-data= http://host.minikube.internal:8890/healthz'"
# tail the caller/CP errors
scripts/host-exec.sh "journalctl -u cp-bridge --no-pager -n 50"
# force the CP to refresh its cache (after changing app hash/path/Safe perms in
# PVWA, or a Vault password rotation) — restarts the provider so it refetches now
make cp-cache-refresh
```

## Restricting inbound web access (large IP allow-lists)

`http_cidrs` gates the web demo (NodePort in no-ALB mode; ALB 80/443 in ALB mode)
and is fine for a handful of viewer CIDRs. For **big** allow-lists, pick by mode:

| Situation | Use | Why |
| --- | --- | --- |
| **ALB mode**, many exact IPs you can't aggregate | **WAF IPSet** — `TF_VAR_web_waf_allow_cidrs` (`terraform/waf.tf`) | Holds up to **10,000 CIDRs**, **does not touch the SG rules-per-SG quota**, default-blocks the rest at L7. This is the recommended path for 60+ `/32`s. Keep `http_cidrs='["0.0.0.0/0"]'` so the SG doesn't block before WAF filters; don't also set `http_prefix_list_cidrs`. |
| **NodePort mode** (no ALB), many IPs | **Managed prefix list** — `TF_VAR_http_prefix_list_cidrs` (`terraform/prefix_lists.tf`) | One SG rule for the whole list. But a referenced prefix list consumes its **`max_entries` ceiling** (not its live count) against the **default 60 rules-per-SG quota** — so 60+ entries need a Service Quota increase (VPC → *Inbound or outbound rules per security group*). Set `http_cidrs='[]'` to restrict to the list only. |

Key facts that trip people up:
- **Don't `/24`-aggregate to save rules** if the block contains hosts you don't
  control — that authorizes them. Keep exact `/32`s and use WAF (ALB) instead.
- **Prefix lists count `max_entries`, not current entries**, against the SG quota,
  and in ALB mode the list is referenced twice (80 + 443) = 2× — which is exactly
  why WAF (no SG-quota impact) is preferred whenever an ALB is in front.
- WAF adds a small cost (~$5/mo per WebACL + ~$1/mo per rule + request charges).

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
| Postgres scenario fails: gateway leaf `certificate has expired` (UI mislabels it "SPIFFE ID not allow-listed") | **SWA v1.0.2 bug** (historical): X.509 SVID rotation wedged — server logged `subscriber already exists for: id=<pid>` (subscriber keyed by the hostPID-stable PID; not released before the workload's rotation reconnect); the long-lived pg-gateway then served an expired leaf. See `docs/SWA-SVID-ROTATION-BUG.md`. | **Not confirmed fixed on v1.0.3.** The agent still requires `hostPID`/`hostNetwork` (tested 2026-07-23 — dropping them breaks workload attestation), so the stable-PID precondition for the wedge remains; the wedge itself was not retested. The proactive resync CronJob (and manual `make swa-resync`) were **removed** — the CronJob was failing (`ContainerCannotRun`) and never worked reliably. If a wedge recurs, restart the chain in order (swa-server → pg-gateway → swa-demo-webapp) and reopen the bug with CyberArk. |
| CP page: "CP bridge not configured" | `CP_BRIDGE_URL` empty on the pod | set it in `.env`, `make webapp-deploy`; confirm with `kubectl -n swa-demo exec deploy/swa-demo-webapp -- env \| grep CP_BRIDGE` |
| CP page: "cp-bridge unreachable" | pod can't reach the host, or bridge down | `systemctl status cp-bridge`; check the pod resolves `host.minikube.internal` (see CP diagnostics); ensure the SG/host firewall allows the pod→host:8890 path |
| CP scenario 1 denied (`APPAP` error) though hash is registered | OS-user / path characteristic mismatch, or CP not running | ensure `cp-bridge` `User=` matches the CP App's OS-user; jar path is `/opt/swa-cp/cp-caller.jar`; `aimprv` is up; re-check the registered hash |
| CP scenario 2 unexpectedly succeeds | rogue jar's hash/path got registered | it must stay unregistered at `/opt/swa-cp/rogue/cp-caller.jar` — do not add it to the App |
| minikube won't start | docker group / resources | re-login for docker group; ensure instance ≥ 4 vCPU / 16 GB |
| node not Ready | k8s version / driver | check `minikube logs`; pinned to v1.34 (SWA range 1.33–1.35) |

## Notes

- The webapp falls back to a **DEMO_MODE** Fake SVID if the agent socket is
  absent, so the UI always renders — check the "svid source" line on the page to
  confirm whether you are seeing a **live** or **demo** SVID.
- All host-side steps run over SSH via `scripts/host-exec.sh`, which reads the
  host IP/key from Terraform outputs.
- The `postgres-gateway-only` NetworkPolicy (`k8s/postgres-netpol.yaml`) enforces
  that only `pg-gateway` may reach Postgres — but **only under a NetworkPolicy-
  capable CNI**. minikube's default CNI does not enforce it; start the cluster
  with `minikube start --cni=calico` (cluster recreate) to make it effective.
  Applied without such a CNI it is inert (harmless), not enforcing.

## Encrypted remote state (S3)

By default both Terraform modules use **local** state — which stores the
generated SSH private key (`terraform/`) and the Conjur SCA client secret + a
live Conjur access token (`terraform-swa/`) in cleartext on disk. Move them to an
encrypted, versioned S3 backend. One-time setup:

**1. Create the bucket (once), with SSE + versioning + public access blocked:**
```bash
export TF_STATE_BUCKET="CHANGEME-swa-demo-tfstate"   # globally unique
export AWS_REGION="us-east-2"                         # match your deploy region
aws s3api create-bucket --bucket "$TF_STATE_BUCKET" --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"
aws s3api put-bucket-versioning --bucket "$TF_STATE_BUCKET" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$TF_STATE_BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'
aws s3api put-public-access-block --bucket "$TF_STATE_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
# Locking: `use_lockfile = true` (in backend.hcl) needs Terraform >= 1.10 and no
# extra infra. For older Terraform, create a DynamoDB lock table instead:
#   aws dynamodb create-table --table-name swa-demo-tf-locks \
#     --attribute-definitions AttributeName=LockID,AttributeType=S \
#     --key-schema AttributeName=LockID,KeyType=HASH --billing-mode PAY_PER_REQUEST
```

**2. Point the backend at your bucket + migrate — for EACH module:**
Edit the committed `backend.tf` in `terraform/` and `terraform-swa/`, replacing
the `CHANGEME-swa-demo-tfstate` bucket with `$TF_STATE_BUCKET` (both use the same
bucket; the `key` differs per module). Then migrate:
```bash
cd terraform            # then repeat in terraform-swa
terraform init -migrate-state    # answer "yes" to copy local state up to S3
rm -f terraform.tfstate terraform.tfstate.backup
```
Backend blocks can't use variables, so the bucket is inline — that's why you edit
it directly rather than via a var.

**3. Commit the provider lock files** (now un-gitignored) so provider hashes are
pinned in VCS: `git add terraform/.terraform.lock.hcl terraform-swa/.terraform.lock.hcl`.

After migration, `make tf-init` / `make tenant-tf` work unchanged — plain
`terraform init` reads the committed `backend.tf`.
