# swa-demo — one-command orchestration across Terraform, Ansible, Helm, and the webapp.
# Usage: `make help`. All targets read configuration from .env (see .env.example).

SHELL := /bin/bash
.DEFAULT_GOAL := help

# .env is SHELL syntax (export VAR="value"), also `source`d by the scripts. Do
# NOT `include` it in make — make would keep the quotes as literal characters
# (e.g. TF_VAR_admin_cidr="\"1.2.3.4/32\""). Instead, source it inside recipes
# that shell out to terraform/ansible. ENVSH exports every var (incl. TF_VAR_*)
# with proper shell quote handling.
ENVSH := set -a; [ -f ./.env ] && . ./.env; set +a

TF_DIR      := terraform
ANSIBLE_DIR := ansible
WEBAPP_DIR  := webapp
INVENTORY   := $(ANSIBLE_DIR)/inventory.ini

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z0-9_./-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Phase 0 — preflight
# ---------------------------------------------------------------------------
.PHONY: preflight
preflight: ## Verify required CLIs and .env exist
	@command -v terraform >/dev/null || { echo "terraform not found"; exit 1; }
	@command -v ansible-playbook >/dev/null || { echo "ansible not found"; exit 1; }
	@test -f .env || { echo "Missing .env (cp .env.example .env)"; exit 1; }
	@echo "preflight OK"

.PHONY: lint
lint: ## Lint terraform + ansible + go
	cd $(TF_DIR) && terraform fmt -check -recursive && terraform validate || true
	command -v tflint >/dev/null && (cd $(TF_DIR) && tflint) || echo "tflint not installed, skipping"
	command -v ansible-lint >/dev/null && ansible-lint $(ANSIBLE_DIR) || echo "ansible-lint not installed, skipping"
	cd $(WEBAPP_DIR) && gofmt -l . && go vet ./... || true

# ---------------------------------------------------------------------------
# Phase 1 — Terraform (AWS RHEL host)
# ---------------------------------------------------------------------------
.PHONY: tf-init tf-plan tf-apply tf-destroy
tf-init: ## terraform init
	$(ENVSH); cd $(TF_DIR) && terraform init

tf-plan: tf-init ## terraform plan
	$(ENVSH); cd $(TF_DIR) && terraform plan

tf-apply: tf-init ## terraform apply (creates EC2) and writes ansible inventory
	$(ENVSH); cd $(TF_DIR) && terraform apply -auto-approve
	cd $(TF_DIR) && terraform output -raw ansible_inventory > ../$(INVENTORY)
	@echo "Wrote $(INVENTORY)"

tf-destroy: ## Tear down all AWS infra
	$(ENVSH); cd $(TF_DIR) && terraform destroy -auto-approve

# ---------------------------------------------------------------------------
# Phase 2 — Ansible (host config + minikube)
# ---------------------------------------------------------------------------
.PHONY: configure
configure: ## Run Ansible: host + minikube + images + terraform/provider + Conjur authn-iam
	$(ENVSH); ansible-playbook -i $(INVENTORY) $(ANSIBLE_DIR)/site.yml \
	  -e images_s3_uri="$$SWA_IMAGES_S3_URI" \
	  -e aws_region="$$AWS_REGION" \
	  -e conjur_appliance_url="$$CONJUR_APPLIANCE_URL" \
	  -e conjur_account="$$CONJUR_ACCOUNT" \
	  -e conjur_service_id="$$CONJUR_SERVICE_ID" \
	  -e conjur_host_id="$$CONJUR_HOST_ID"

# ---------------------------------------------------------------------------
# Phase 3 — Tenant wiring + SWA server/agent, all on the host. terraform-swa
# authenticates to Conjur with the instance-profile IAM role; deploy-swa.sh
# reads its authn_id / trust-domain outputs directly (same host).
# ---------------------------------------------------------------------------
SWA_RELEASE_DIR ?= $(HOME)/Downloads/Secure Workload Access/Secure Workload Access/swa-release-v1.0.0
TFSWA_DIR := terraform-swa

.PHONY: vendor-charts fetch-jwks tenant-tf tenant swa
vendor-charts: ## (Local only) copy bundled SWA helm charts into helm/charts/ for `helm template`
	mkdir -p helm/charts && cp "$(SWA_RELEASE_DIR)"/helm/*.tgz helm/charts/
	@echo "Vendored: $$(ls helm/charts/*.tgz)"

fetch-jwks: ## Fetch cluster issuer + JWKS for the server JWT (on host)
	bash scripts/host-exec.sh "bash scripts/fetch-cluster-jwks.sh"

# Runs ON the host: conjur-api-go authenticates via the instance-profile IAM role
# (~/.conjurrc authn_type=aws + CONJUR_AUTHN_LOGIN). No `conjur login` needed.
tenant-tf: fetch-jwks ## Apply tenant resources via cyberark/swa provider (host IAM auth)
	bash scripts/host-exec.sh "set -a; . ~/.swa-conjur.env; set +a; cd terraform-swa && terraform init -input=false && terraform apply -auto-approve"

tenant: ## (Fallback) create tenant resources via REST scripts on the host
	bash scripts/host-exec.sh "bash tenant/00-trust-domain.sh && bash tenant/01-server-group.sh && bash tenant/02-node-group.sh && bash tenant/03-register-server.sh"

swa: ## Helm-install SWA server + agent into minikube (on host; reads terraform-swa outputs)
	bash scripts/host-exec.sh "bash scripts/deploy-swa.sh"

# ---------------------------------------------------------------------------
# Phase 4 — Demo webapp
# ---------------------------------------------------------------------------
.PHONY: webapp-build webapp-test webapp-deploy
webapp-build: ## Build webapp container inside the host's minikube docker
	bash scripts/host-exec.sh "bash scripts/deploy-webapp.sh build"

webapp-test: ## Run Go unit tests with coverage (local)
	cd $(WEBAPP_DIR) && go test ./... -cover

webapp-deploy: ## Deploy webapp manifests into the demo namespace
	bash scripts/host-exec.sh "bash scripts/deploy-webapp.sh deploy"

# ---------------------------------------------------------------------------
# Phase 5 — End to end
# ---------------------------------------------------------------------------
.PHONY: up down verify demo
up: preflight webapp-test tf-apply configure tenant-tf swa webapp-build webapp-deploy verify ## Full bring-up
	@echo "swa-demo is up. Run 'make demo' to open the UI."
	@echo "Assumes the SWA bundle is uploaded to SWA_IMAGES_S3_URI and Conjur authn-iam"
	@echo "is enabled for the host role (CONJUR_* in .env)."

down: tf-destroy ## Tear everything down
	@echo "Destroyed."

verify: ## Health-check every layer
	bash scripts/verify.sh

demo: ## Print the demo UI URL (and open it on macOS)
	bash scripts/demo.sh
