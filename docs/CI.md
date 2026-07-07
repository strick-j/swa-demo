# CI & branch protection

All changes flow through **branch → PR → gated merge to `main`**. CI runs on
GitHub Actions (`.github/workflows/`). Workflows are path-filtered, so a PR only
runs the checks relevant to what it touched.

## Workflows

| Workflow | Trigger paths | Jobs | Gate |
|----------|---------------|------|------|
| `go.yml` | `webapp/**` | gofmt, `go vet`, `go test -race -cover`, govulncheck | **blocking** |
| `ui.yml` | `webapp/ui-cp/**` | pnpm typecheck, test (vitest), build | **blocking** |
| `terraform.yml` | `terraform/**`, `terraform-swa/**` | fmt (both modules), validate (`terraform/`), tflint (`terraform/`) | **blocking** |
| `security.yml` | any PR | trivy-fs (vuln+secret) | **blocking** |
| | | trivy-config (misconfig) | advisory (baseline) |
| | | gitleaks (secrets) | **blocking** |
| | | hadolint (Dockerfile) | advisory |
| `shell.yml` | `**/*.sh` | shellcheck (severity=error) | **blocking** |
| `ansible-lint.yml` | `ansible/**` | ansible-lint | advisory |

Notes:
- `terraform-swa/` can't `init`/`validate` in CI — its `cyberark/swa` provider is
  installed locally from the SWA bundle (not on any registry). It gets `fmt` only.
- `trivy-config` is advisory to start because several k8s findings are
  deliberately deferred (see `.trivyignore`). Flip its `exit-code` to `"1"` once
  the baseline is triaged.
- Action + tool versions (trivy-action, tflint, terraform) are pinned; bump as
  needed.

## Run the checks locally

```bash
# Go
cd webapp && gofmt -l . && go vet ./... && go test ./... -race -cover \
  && go run golang.org/x/vuln/cmd/govulncheck@latest ./...
# UI
cd webapp/ui-cp && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build
# Terraform
cd terraform && terraform fmt -check -recursive && terraform init -backend=false \
  && terraform validate && tflint --init && tflint
# Shell
shellcheck scripts/*.sh tenant/*.sh
# Security (if installed locally)
trivy fs . && trivy config .
```

## Branch protection on `main`

Apply **after** the first PR is green (so the required check names exist). Solo
repo: 0 required approvals (GitHub blocks self-approval, so requiring 1 would
deadlock). Confirm the `contexts` strings match the check names shown on a PR —
they are the job `name:` values — and adjust if GitHub renders them as
`<workflow> / <job>`.

```bash
gh api -X PUT repos/strick-j/swa-demo/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["go", "ui", "fmt", "validate", "tflint", "trivy-fs", "gitleaks", "shellcheck"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

Verify it took: `gh api repos/strick-j/swa-demo/branches/main/protection --jq '.required_status_checks.contexts'`,
then confirm a direct `git push origin main` is rejected.
