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

variable "admin_cidr" {
  description = "CIDR allowed to reach SSH (22) and the demo NodePort. Use your /32."
  type        = string
  default     = "0.0.0.0/0"

  validation {
    condition     = can(cidrhost(var.admin_cidr, 0))
    error_message = "admin_cidr must be a valid CIDR block."
  }
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
