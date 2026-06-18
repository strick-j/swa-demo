# RHEL AMI lookup (Red Hat official owner) + the demo host.

data "aws_ami" "rhel" {
  most_recent = true
  owners      = ["309956199498"] # Red Hat

  filter {
    name   = "name"
    values = ["RHEL-${var.rhel_version}.*_HVM-*-x86_64-*-Hourly2-GP3"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Optionally generate a key pair when one is not supplied.
resource "tls_private_key" "generated" {
  count     = var.key_pair_name == "" ? 1 : 0
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "generated" {
  count      = var.key_pair_name == "" ? 1 : 0
  key_name   = "${var.project}-key"
  public_key = tls_private_key.generated[0].public_key_openssh
}

resource "local_sensitive_file" "private_key" {
  count           = var.key_pair_name == "" ? 1 : 0
  content         = tls_private_key.generated[0].private_key_pem
  filename        = "${path.module}/${var.project}-key.pem"
  file_permission = "0600"
}

locals {
  key_name = var.key_pair_name != "" ? var.key_pair_name : aws_key_pair.generated[0].key_name
}

resource "aws_instance" "host" {
  ami                         = data.aws_ami.rhel.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.host.id]
  key_name                    = local.key_name
  iam_instance_profile        = aws_iam_instance_profile.host.name
  associate_public_ip_address = true

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
    encrypted   = true
  }

  metadata_options {
    http_tokens   = "required" # IMDSv2 only
    http_endpoint = "enabled"
  }

  tags = {
    Name = "${var.project}-host"
    Role = "minikube-swa"
  }
}
