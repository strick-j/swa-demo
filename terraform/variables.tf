variable "project" {
  description = "Project name used for tagging and resource naming."
  type        = string
  default     = "swa-demo"
}

variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
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

variable "admin_cidrs" {
  description = "CIDRs allowed to reach SSH (22), the demo NodePort, and the ALB (80/443). Use your /32(s)."
  type        = list(string)
  default     = ["0.0.0.0/0"]

  validation {
    condition     = alltrue([for c in var.admin_cidrs : can(cidrhost(c, 0))])
    error_message = "every entry in admin_cidrs must be a valid CIDR block."
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
