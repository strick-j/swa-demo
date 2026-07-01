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
installed and running (`aimprv`), and its `JavaPasswordSDK.jar` +
`libjavapasswordsdk.so` (default `/opt/CARKaim/sdk/`). Install the CP manually, or
with the CyberArk `cyberark.aam` Ansible collection
(<https://github.com/cyberark/ansible-security-automation-collection/blob/master/docs/aimprovider.md>);
automation is optional for a one-off.

**Step 1 — `.env`.** Set the host build vars and the CP object coordinates. The
Safe/Object values **default to the CCP demo's** — leave them empty to reuse the
same objects, or set them to point the CP elsewhere:
```sh
export CP_SDK_JAR="/opt/CARKaim/sdk/JavaPasswordSDK.jar"
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
```

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
| Postgres scenario fails: gateway leaf `certificate has expired` (UI mislabels it "SPIFFE ID not allow-listed") | **SWA v1.0.2 bug**: X.509 SVID rotation wedges — server logs `subscriber already exists for: id=<pid>` (subscriber keyed by the hostPID-stable PID; not released before the workload's rotation reconnect). Only the long-lived pg-gateway is hit. | Mitigated: `x509_workload_ttl`=8h (terraform-swa) + the `pg-gateway-recycler` CronJob (`k8s/pg-gateway-recycler.yaml`) rolls pg-gateway every 4h for a fresh PID. To clear a live wedge: `kubectl -n swa-system rollout restart deploy/swa-server` then bounce pg-gateway. Report the subscriber-cleanup bug to CyberArk. |
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
