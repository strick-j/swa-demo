variable "project" {
  description = "Project name used for tagging and resource naming."
  type        = string
  default     = "swa-demo"
}

variable "aws_region" {
  description = "AWS region to deploy into. NO default on purpose: an unset region would silently fall back and make Terraform rebuild the entire stack in the wrong region (orphaning the real one). Must be provided explicitly via TF_VAR_aws_region — .env sets it and the make targets source .env. A bare `terraform` run without it will prompt (or error under -input=false) instead of guessing."
  type        = string

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]$", var.aws_region))
    error_message = "Set aws_region explicitly (e.g. us-east-2). Run via `make` or `source .env` first so TF_VAR_aws_region is exported — never a bare `terraform` command."
  }
}

variable "rhel_version" {
  description = "RHEL major version for the AMI lookup (8 or 9)."
  type        = string
  default     = "9"

  validation {
    condition     = contains(["8", "9"], var.rhel_version)
    error_message = "rhel_version must be \"8\" or \"9\"."
  }
}

variable "instance_type" {
  description = "EC2 instance type. Needs >= 4 vCPU / 16GB for minikube + SWA + webapp."
  type        = string
  default     = "m5.xlarge"
}

variable "root_volume_gb" {
  description = "Root EBS volume size in GB."
  type        = number
  default     = 60

  validation {
    condition     = var.root_volume_gb >= 40
    error_message = "root_volume_gb must be at least 40 to fit minikube images."
  }
}

variable "key_pair_name" {
  description = "Existing EC2 key pair name. Leave empty to have Terraform generate one."
  type        = string
  default     = ""
}

variable "ssh_cidrs" {
  description = "CIDRs allowed to reach SSH (22). Keep this tight — your admin /32(s) only, typically 2-3 entries. REQUIRED (no default): SSH must never default to the whole internet; set TF_VAR_ssh_cidrs (e.g. [\"YOUR.IP/32\"])."
  type        = list(string)
  # No default on purpose: force an explicit choice so open SSH can't be shipped
  # by omission. Set it in .env / terraform.tfvars.

  validation {
    condition     = length(var.ssh_cidrs) > 0 && alltrue([for c in var.ssh_cidrs : can(cidrhost(c, 0))])
    error_message = "ssh_cidrs must be a non-empty list of valid CIDR blocks (e.g. [\"203.0.113.4/32\"])."
  }
}

variable "http_cidrs" {
  description = "CIDRs allowed to reach the web demo: the NodePort and the ALB (80/443). Broaden this for viewers/audiences. Set to [] to serve the demo ONLY via http_prefix_list_cidrs."
  type        = list(string)
  default     = ["0.0.0.0/0"]

  validation {
    condition     = alltrue([for c in var.http_cidrs : can(cidrhost(c, 0))])
    error_message = "every entry in http_cidrs must be a valid CIDR block."
  }
}

variable "http_prefix_list_cidrs" {
  description = "CIDRs to place in a customer-managed prefix list for web-demo access (NodePort in no-ALB mode; ALB 80/443 in ALB mode). Use this instead of listing many CIDRs in http_cidrs — a single SG rule references the list, avoiding the rules-per-SG quota. Empty => no prefix list is created. To restrict the demo to ONLY these CIDRs, also set http_cidrs = []."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for c in var.http_prefix_list_cidrs : can(cidrhost(c, 0))])
    error_message = "every entry in http_prefix_list_cidrs must be a valid CIDR block (e.g. \"203.0.113.0/24\")."
  }
}

variable "http_prefix_list_max_entries" {
  description = "Ceiling on the web-demo managed prefix list size. AWS counts this ceiling (NOT the current entry count) against the security group's rules-per-SG quota, so keep it close to your real list size. The value actually used is max(this, number of entries in http_prefix_list_cidrs), so it never drops below the live count."
  type        = number
  default     = 50

  validation {
    condition     = var.http_prefix_list_max_entries >= 1
    error_message = "http_prefix_list_max_entries must be at least 1."
  }
}

variable "web_waf_allow_cidrs" {
  description = "Source CIDRs allowed to reach the ALB, enforced by an AWS WAF IPSet + WebACL (ALB mode only). Purpose-built for LARGE exact-IP allow-lists: an IPSet holds up to 10,000 CIDRs and does NOT consume the security-group rules-per-SG quota (unlike http_prefix_list_cidrs). Each entry MUST be CIDR notation — a single host is x.x.x.x/32. Empty => no WAF is created. When set, keep http_cidrs open ('[\"0.0.0.0/0\"]') so the ALB security group does not block before WAF filters, and do NOT also set http_prefix_list_cidrs."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for c in var.web_waf_allow_cidrs : can(cidrhost(c, 0))])
    error_message = "every entry in web_waf_allow_cidrs must be CIDR notation (e.g. \"203.0.113.4/32\")."
  }
}

# --- HTTPS via ALB (optional) ----------------------------------------------
# Mirrors the lab-visualizer convention: import your (e.g. Squarespace-issued)
# cert into ACM out-of-band and pass its ARN. The ALB + HTTPS listener are
# created only when certificate_arn is set; DNS is external (CNAME domain_name
# at the alb_dns_name output).
variable "domain_name" {
  description = "FQDN for the ALB (e.g. swa.pineappledev.app). Set it to enable HTTPS: Terraform requests a DNS-validated ACM cert for it. Empty => no ALB, plain NodePort HTTP only."
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "Optional override: ARN of a pre-existing/imported ACM cert to use instead of the ACM-managed (DNS-validated) one created for domain_name."
  type        = string
  default     = ""
}

variable "ssl_policy" {
  description = "TLS policy for the ALB HTTPS listener."
  type        = string
  default     = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

variable "webapp_nodeport" {
  description = "NodePort exposed for the demo webapp UI."
  type        = number
  default     = 30080

  validation {
    condition     = var.webapp_nodeport >= 30000 && var.webapp_nodeport <= 32767
    error_message = "webapp_nodeport must be in the Kubernetes NodePort range 30000-32767."
  }
}

variable "vpc_cidr" {
  description = "CIDR for the demo VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "ssh_username" {
  description = "Default SSH user for the RHEL AMI."
  type        = string
  default     = "ec2-user"
}

variable "images_s3_uri" {
  description = <<-EOT
    S3 URI prefix holding the SWA image tarballs (*.tar.gz), e.g.
    s3://my-bucket/swa-images. The host receives read-only access (GetObject +
    scoped ListBucket). Leave empty to skip granting S3 access.
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.images_s3_uri == "" || startswith(var.images_s3_uri, "s3://")
    error_message = "images_s3_uri must be empty or start with s3://."
  }
}
