# swa-demo — one-command orchestration across Terraform, Ansible, Helm, and the webapp.
# Usage: `make help`. All targets read configuration from .env (see .env.example).

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Load .env if present and export everything to sub-processes.
ifneq (,$(wildcard ./.env))
include .env
export
endif

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
	cd $(TF_DIR) && terraform init

tf-plan: tf-init ## terraform plan
	cd $(TF_DIR) && terraform plan

tf-apply: tf-init ## terraform apply (creates EC2) and writes ansible inventory
	cd $(TF_DIR) && terraform apply -auto-approve
	cd $(TF_DIR) && terraform output -raw ansible_inventory > ../$(INVENTORY)
	@echo "Wrote $(INVENTORY)"

tf-destroy: ## Tear down all AWS infra
	cd $(TF_DIR) && terraform destroy -auto-approve

# ---------------------------------------------------------------------------
# Phase 2 — Ansible (host config + minikube)
# ---------------------------------------------------------------------------
.PHONY: configure
configure: ## Run Ansible: configure host + start minikube
	ansible-playbook -i $(INVENTORY) $(ANSIBLE_DIR)/site.yml

# ---------------------------------------------------------------------------
# Phase 3 — Tenant wiring + SWA server/agent (Helm). These run ON the host,
# which has minikube/kubectl/helm and egress to the tenant + registry.
# ---------------------------------------------------------------------------
.PHONY: tenant swa
tenant: ## Create trust domain/server group/node group + register server in tenant
	bash scripts/host-exec.sh "bash tenant/00-trust-domain.sh && bash tenant/01-server-group.sh && bash tenant/02-node-group.sh && bash tenant/03-register-server.sh"

swa: ## Helm-install SWA server + agent into minikube (on host)
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
up: preflight webapp-test tf-apply configure tenant swa webapp-build webapp-deploy verify ## Full bring-up
	@echo "swa-demo is up. Run 'make demo' to open the UI."

down: tf-destroy ## Tear everything down
	@echo "Destroyed."

verify: ## Health-check every layer
	bash scripts/verify.sh

demo: ## Print the demo UI URL (and open it on macOS)
	bash scripts/demo.sh
