# IAM instance profile for the host. Grants read-only access to the existing S3
# bucket/prefix that holds the SWA image tarballs (no static credentials needed).

locals {
  s3_enabled = var.images_s3_uri != ""
  # Parse "s3://bucket/prefix..." into bucket + prefix.
  s3_clean  = replace(var.images_s3_uri, "s3://", "")
  s3_bucket = element(split("/", local.s3_clean), 0)
  s3_prefix = local.s3_clean == local.s3_bucket ? "" : trimprefix(local.s3_clean, "${local.s3_bucket}/")
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

# STS permissions for Conjur authn-iam. The webapp pod authenticates to Conjur
# Cloud with this host's instance-profile identity: it signs (and the conjur
# client exercises) sts:GetCallerIdentity, and assumes a role as part of the
# flow. GetCallerIdentity needs no IAM permission of its own, but is listed
# explicitly to mirror CyberArk's documented host policy for Conjur workloads.
data "aws_iam_policy_document" "conjur_sts" {
  statement {
    sid       = "ConjurAuthnIam"
    actions   = ["sts:AssumeRole", "sts:GetCallerIdentity"]
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
