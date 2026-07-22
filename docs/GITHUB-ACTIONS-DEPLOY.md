# GitHub Actions Deployment — Migration Plan & RUNBOOK

Move `swa-demo` from a **control host in AWS** (pull repo → `.env` → `make up`) to
a **GitHub Actions** pipeline, so no persistent control host is needed.

**Decisions (agreed):**

| Area | Choice |
| --- | --- |
| Target transport | **AWS SSM** (no SSH, port 22 closed) |
| Deployer → AWS auth | **Native GitHub → AWS OIDC** (no static AWS keys) |
| App / CyberArk secrets | **Conjur `authn-jwt` via GitHub OIDC** (fetched by the CyberArk Conjur Action) |
| State topology | **State bucket + OIDC provider in each environment's own AWS account** |
| Environments | `dev` branch → **dev account**; `main` branch → **prod account** |

> Status: **plan only** — no code has been changed yet. This doc is the spec to
> build against. File paths reference the current repo.

---

## 1. Target architecture

```
 GitHub push (dev|main)
        │  OIDC id-token (id-token: write)
        ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ GitHub Actions job  (environment: dev | production)           │
 │                                                              │
 │ 1. configure-aws-credentials  ──OIDC──▶ AWS IAM deploy role  │  (per account)
 │ 2. cyberark/conjur-action     ──OIDC──▶ Conjur authn-jwt     │  (per env host)
 │      └─ fetch: SCA client id/secret, CCP cert, DB pw, …      │
 │ 3. compose env  (GitHub vars + Conjur secrets)               │
 │ 4. make tf-apply → configure → tenant → swa → webapp → verify│
 │      · Terraform  → S3 state in THIS account                 │
 │      · Ansible / host steps → target EC2 via **SSM**         │
 └──────────────────────────────────────────────────────────────┘
        │ builds / drives
        ▼
   Target EC2 (RHEL + minikube)  ── unchanged demo infra ──
```

The **target EC2 + minikube demo stack is unchanged.** We are replacing the
control plane (who runs Terraform/Ansible, how it authenticates, how it reaches
the target), not the demo itself.

---

## 2. One-time setup (per environment: dev account, then prod account)

Do all of section 2 **twice** — once in the dev account, once in the prod account.
Differences are only names/ARNs/URLs.

### 2.1 AWS — GitHub OIDC provider + deploy role

1. **OIDC identity provider** (once per account):
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
2. **Deploy IAM role** `swa-demo-deploy` with a trust policy scoped to this repo
   **and** this environment (so dev creds can't be minted from `main`, and vice
   versa):

   ```json
   {
     "Effect": "Allow",
     "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
     "Action": "sts:AssumeRoleWithWebIdentity",
     "Condition": {
       "StringEquals": {
         "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
         "token.actions.githubusercontent.com:sub": "repo:strick-j/swa-demo:environment:dev"
       }
     }
   }
   ```
   Prod role uses `:environment:production`. (Scoping by `environment:` is stronger
   than `ref:` because GitHub Environments enforce approvals/branch policies.)
3. **Permissions** for the deploy role: what `terraform/` + `terraform-swa/`
   create/read — EC2, VPC/SG, IAM (instance profile + role), ELB/ALB, WAF, ACM,
   S3 (state bucket + the SWA-images/cp-installer buckets), and **SSM**
   (`ssm:SendCommand`, `ssm:GetCommandInvocation`, `ssm:StartSession` as needed).
   Start from a broad managed set in dev, tighten for prod.
4. **State bucket** (this account): globally-unique, versioned, SSE, restrictive
   bucket policy. This replaces the single hardcoded `pineapple.dev` bucket.

### 2.2 Target EC2 — enable SSM, close SSH

- Add `arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore` to the target's
  instance profile in `terraform/iam.tf`.
- RHEL 9 ships the SSM agent; confirm it's enabled (add to `ansible/` bootstrap if
  a rebuild is needed). RHEL 8 may need the agent installed.
- Remove/void the SSH ingress: make `TF_VAR_ssh_cidrs` optional/empty and drop the
  generated keypair (`local_file`/`tls_private_key`) once SSM is in place. Keep an
  emergency break-glass path documented (SSM Session Manager shell).

### 2.3 Conjur — `authn-jwt` for GitHub OIDC

1. Enable an **`authn-jwt`** authenticator (e.g. service id `authn-jwt/github`)
   trusting GitHub:
   - `jwks-uri`: `https://token.actions.githubusercontent.com/.well-known/jwks`
   - `token-app-property`: `sub` (or use `identity-path` + claim mapping)
   - `issuer`: `https://token.actions.githubusercontent.com`
   - enforced claims: `aud` (set the workflow's `--jwt-aud`), `repository`.
2. **A Conjur host per environment**, annotated to pin the GitHub claims, e.g.:
   ```
   - !host
     id: swa-demo-deploy-prod
     annotations:
       authn-jwt/github/repository: strick-j/swa-demo
       authn-jwt/github/environment: production   # or ref: refs/heads/main
   ```
   Grant each host **read** on only its environment's secrets (separate
   branch/safe per env — dev host can't read prod secrets).
3. Store the secrets the deploy needs (section 4) under each env's branch/safe.
   The existing **Identity-OIDC → SWA token** flow (`scripts/conjur-token.sh`)
   stays; we just source its inputs (SCA `client_id`/`client_secret`) from these
   Conjur reads instead of the EC2-role `conjur` provider.

### 2.4 GitHub — Environments, variables, protections

- Create Environments **`dev`** and **`production`**.
  - `production`: **required reviewers** + restrict to the `main` branch.
  - `dev`: restrict to the `dev` branch.
- Per-environment **Variables** (non-secret config; see table in §4). Includes the
  AWS role ARN, region, Conjur URLs/host, state bucket, CIDRs, S3 URIs, etc.
- No long-lived secrets in GitHub if avoidable — AWS via OIDC, CyberArk via Conjur.
  (Only a bootstrap value that truly can't be keyless would live in GH Secrets.)

---

## 3. Repo changes required

Grouped by area, with the specific files.

### 3.1 Terraform (`terraform/`, `terraform-swa/`)
- **`backend.tf` → partial backend.** Remove the hardcoded `bucket`/`key`/`region`;
  pass them at init: `terraform init -backend-config=bucket=… -backend-config=key=terraform/swa-demo/<env>/main.tfstate -backend-config=region=…`. Per-env `.hcl` files (`backends/dev.s3.hcl`, `backends/prod.s3.hcl`) are the tidiest.
- **`iam.tf`** — attach `AmazonSSMManagedInstanceCore` to the instance profile.
- **SSH removal** — gate `tls_private_key`/`local_file`/keypair + the `22` SG rule
  behind a `var.enable_ssh` (default false); SSM replaces it.
- **`terraform-swa` CI auth path** — in CI, **bypass the `conjur` provider +
  `data.external.conjur_token`**: pass `TF_VAR_conjur_access_token` (minted by
  `scripts/conjur-token.sh` from Conjur-fetched SCA creds). Keep the provider path
  for local/legacy use behind a flag. This sidesteps the `conjur` 0.7.1
  `authn_type=aws` (EC2-only) limitation.
- `providers.tf` AWS block is unchanged (OIDC creds arrive via the standard chain
  from `configure-aws-credentials`).

### 3.2 Scripts (`scripts/`)
- **`host-exec.sh` / `host-push.sh`** — rewrite to use **SSM** instead of
  SSH/SCP: resolve the instance id from a Terraform output (add `host_instance_id`
  to `terraform/outputs.tf`), then `aws ssm send-command` (run commands) and S3
  staging for file pushes (`aws ssm` + `aws s3 cp`, or `aws s3 sync` of the repo to
  the target). Keep the same call signatures so the Makefile targets don't change.
- **`control-setup.sh`** — already S3-driven; runs on the runner. Add bundle
  caching. `~/.conjurrc` is still fine (no secret written).
- **`conjur-token.sh`** — no change; used in standalone mode in CI with inputs from
  the Conjur Action.
- Everything else (`deploy-swa.sh`, `deploy-webapp.sh`, `gen-ccp-cert.sh`, …) runs
  **on the target via SSM** unchanged.

### 3.3 Ansible (`ansible/`)
- Switch the connection to the **`community.aws.aws_ssm`** connection plugin (or
  wrap the `site.yml` invocation as an SSM document). Inventory becomes the
  instance id, not a public IP. `ansible.cfg` gains the SSM plugin config + an S3
  bucket for the plugin's file transport.

### 3.4 Makefile
- Relax `preflight` (`test -f .env`) to allow a **`.env`-less** run when the env is
  already exported (CI composes it from GH vars + Conjur).
- `tf-init`/`tenant-tf` must accept **`-backend-config`** (env-specific).
- No target logic changes otherwise — the CI job calls the same targets
  (`tf-apply configure tenant-tf swa webapp-build webapp-deploy verify`).

### 3.5 New workflow — `.github/workflows/deploy.yml`
- `permissions: { id-token: write, contents: read }`.
- Triggers: `push` on `dev` and `main` (+ `workflow_dispatch` with a `destroy`
  option).
- Map branch → environment: `dev`→`dev`, `main`→`production`.
- Job outline (single job or split by phase; splitting gives clearer approvals):
  1. `actions/checkout`
  2. `aws-actions/configure-aws-credentials` (`role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}`, `aws-region: ${{ vars.AWS_REGION }}`)
  3. `cyberark/conjur-action` (OIDC/authn-jwt) → fetch SCA creds, CCP cert, DB pw, tenant token → masked env
  4. export non-secret config from `vars.*`
  5. setup tools (terraform, ansible venv, go, kubectl/helm as needed), `control-setup`
  6. `make tf-apply configure tenant-tf swa webapp-build webapp-deploy verify` (with per-env `-backend-config`)
- Keep existing CI workflows (`terraform.yml` fmt/validate, `go`, `ui`,
  `security`, `shell`, `ansible-lint`) as pre-merge gates.

---

## 4. Config & secrets inventory (`.env` → where it goes)

**GitHub Environment *variables* (non-secret, per env):**
`AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, all `TF_VAR_*` (region, instance_type,
root_volume_gb, rhel_version, project, `ssh_cidrs`→empty, `http_cidrs`,
domain/cert, images/cp-installer S3 grants), `SWA_CONTROLPLANE_URL`,
`SWA_TRUST_DOMAIN`, `SWA_*` names, `CONJUR_APPLIANCE_URL`, `CONJUR_ACCOUNT`,
`CONJUR_AUTHN_JWT_SERVICE_ID`, `CONJUR_*` service ids / paths (non-secret refs),
`CCP_BASE_URL`/`CCP_APP_ID`/safes/objects, `CP_*` app-ids/safes, `NS_*`,
`SWA_IMAGES_S3_*`, `CP_INSTALLER_S3_URI`, `SWA_RELEASE_VERSION`, webapp vars,
`STATE_BUCKET`, `TFSTATE_KEY_PREFIX`.

**Conjur secrets (fetched via authn-jwt at run time), per env branch/safe:**
Identity OAuth `client_id` + `client_secret` (SCA), CCP client TLS cert/key
(`ccp-client-tls`), any demo DB password, `SWA_TENANT_API_TOKEN` (REST fallback),
`SWA_CONTROLPLANE_TOKEN_FILE` contents (if the tenant requires it), and any other
credential currently implied by `.env`.

**Not stored anywhere (keyless):** AWS deployer creds (GitHub→AWS OIDC), the
target EC2's runtime Conjur `authn-iam` (instance role, unchanged), the Conjur
access token for the SWA provider (minted per run).

---

## 5. Migration sequence (recommended)

1. **Bootstrap dev only**: create dev account OIDC provider, deploy role, state
   bucket; move `terraform/` + `terraform-swa/` to partial backends; migrate the
   existing state into the dev bucket (`terraform init -migrate-state`).
2. **SSM cutover**: add SSM to the instance profile, rewrite `host-exec`/`host-push`
   + Ansible connection; validate `make configure`/`webapp-deploy` over SSM from a
   laptop first (still using local AWS creds).
3. **Conjur authn-jwt**: stand up the authenticator + dev host + secrets; prove the
   Conjur Action fetch + `conjur-token.sh` standalone mint locally.
4. **`deploy.yml` for `dev`**: wire OIDC + Conjur + the make chain; iterate until a
   push to `dev` brings the stack up green.
5. **Promote to prod**: repeat the account bootstrap in the prod account, add the
   `production` Environment (with approvals), map `main`.
6. **Decommission** the control host; document break-glass (SSM shell) in RUNBOOK.

---

## 6. Teardown, rollback, cost
- Add a `workflow_dispatch` **destroy** path (`make down` per env) so demo EC2s
  don't linger without a human host. Consider auto-teardown for `dev` on a schedule.
- Rollback = re-run a prior green SHA (Terraform state is authoritative; the target
  is re-driven idempotently). Note the **`swa_server` replace → re-bridge `authn_id`**
  behavior: the pipeline always re-bridges, so a re-run is safe.

## 7. Open questions / assumptions
- **Runner egress to SSM/AWS**: GitHub-hosted runners reach public AWS endpoints
  fine over OIDC+SSM; no VPC peering needed. Confirm no org policy blocks this.
- **`community.aws.aws_ssm` maturity** for the full `site.yml` — if it's fiddly,
  the fallback is to package the target-side steps as **SSM documents** invoked
  from the workflow rather than running Ansible over SSM.
- **`conjur` TF provider vs Action**: plan drops the provider in CI. If you'd
  rather keep it, we must validate a provider version that supports
  `authn_type=jwt`.
- **Two accounts, shared repo**: environment-scoped OIDC `sub` prevents cross-env
  credential minting; confirm branch protections so only `main` can target prod.
- **State migration**: the current single state (`.../main/…` in `pineapple.dev`,
  us-east-2) maps to which env? Assumed **prod**; dev starts fresh.

---

## 8. Effort estimate (rough)
- Terraform backend param + SSM/IAM + SSH gating: ~0.5–1 day.
- `host-exec`/`host-push` → SSM + Ansible SSM connection: ~1–2 days (most risk).
- Conjur authn-jwt setup + Action wiring + `terraform-swa` CI auth path: ~1 day.
- `deploy.yml` (dev), iterate to green: ~1–2 days.
- Prod account bootstrap + promotion + teardown/docs: ~0.5–1 day.
