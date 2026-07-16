# IAM instance profile for the host. Grants read-only access to the existing S3
# bucket/prefix that holds the SWA image tarballs (no static credentials needed).

locals {
  s3_enabled = var.images_s3_uri != ""
  # Parse "s3://bucket/prefix..." into bucket + prefix.
  s3_clean  = replace(var.images_s3_uri, "s3://", "")
  s3_bucket = element(split("/", local.s3_clean), 0)
  s3_prefix = local.s3_clean == local.s3_bucket ? "" : trimprefix(local.s3_clean, "${local.s3_bucket}/")

  # CP (AAM) installer prefix — may be the same bucket as images, different prefix.
  cp_enabled = var.cp_installer_s3_uri != ""
  cp_clean   = replace(var.cp_installer_s3_uri, "s3://", "")
  cp_bucket  = element(split("/", local.cp_clean), 0)
  cp_prefix  = local.cp_clean == local.cp_bucket ? "" : trimprefix(local.cp_clean, "${local.cp_bucket}/")
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "host" {
  name               = "${var.project}-host-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# Scoped S3 read policy (only created when images_s3_uri is set).
data "aws_iam_policy_document" "s3_read" {
  count = local.s3_enabled ? 1 : 0

  statement {
    sid       = "ListPrefix"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.s3_bucket}"]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = [local.s3_prefix == "" ? "*" : "${local.s3_prefix}/*"]
    }
  }

  statement {
    sid       = "GetObjects"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${local.s3_bucket}/${local.s3_prefix == "" ? "" : "${local.s3_prefix}/"}*"]
  }
}

resource "aws_iam_role_policy" "s3_read" {
  count  = local.s3_enabled ? 1 : 0
  name   = "${var.project}-s3-read"
  role   = aws_iam_role.host.id
  policy = data.aws_iam_policy_document.s3_read[0].json
}

# Scoped S3 read for the CP (AAM) installer prefix. Separate statements (not
# merged with s3_read) so it works whether the installer is in the same bucket as
# the images or a different one — IAM unions the ListBucket prefix conditions.
data "aws_iam_policy_document" "cp_installer_s3_read" {
  count = local.cp_enabled ? 1 : 0

  statement {
    sid       = "ListCpInstallerPrefix"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.cp_bucket}"]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = [local.cp_prefix == "" ? "*" : "${local.cp_prefix}/*"]
    }
  }

  statement {
    sid       = "GetCpInstallerObjects"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${local.cp_bucket}/${local.cp_prefix == "" ? "" : "${local.cp_prefix}/"}*"]
  }
}

resource "aws_iam_role_policy" "cp_installer_s3_read" {
  count  = local.cp_enabled ? 1 : 0
  name   = "${var.project}-cp-installer-s3-read"
  role   = aws_iam_role.host.id
  policy = data.aws_iam_policy_document.cp_installer_s3_read[0].json
}

# STS permission for Conjur authn-iam. The webapp pod authenticates to Conjur
# Cloud AS this host's instance-profile role (IMDS creds -> sign GetCallerIdentity);
# it does not assume a second role, so sts:AssumeRole is intentionally omitted.
# sts:GetCallerIdentity cannot be resource-scoped (AWS allows only "*"), and in
# fact needs no IAM permission at all, but is listed explicitly to mirror
# CyberArk's documented host policy for Conjur workloads.
data "aws_iam_policy_document" "conjur_sts" {
  statement {
    sid       = "ConjurAuthnIam"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "conjur_sts" {
  name   = "${var.project}-conjur-sts"
  role   = aws_iam_role.host.id
  policy = data.aws_iam_policy_document.conjur_sts.json
}

resource "aws_iam_instance_profile" "host" {
  name = "${var.project}-host-profile"
  role = aws_iam_role.host.name
}
