# AWS WAF allow-list for the ALB (ALB mode only). Purpose-built for large,
# exact-IP allow-lists: a WAFv2 IPSet holds up to 10,000 CIDRs and does NOT count
# against the security-group rules-per-SG quota (unlike a prefix list referenced
# in an SG rule). The WebACL default-blocks and allows only requests whose source
# IP is in the IPSet, enforced at L7 on the ALB — so no CIDR aggregation and no
# quota-increase request are needed.
#
# Usage: set web_waf_allow_cidrs to your /32 list and keep http_cidrs OPEN
# ('["0.0.0.0/0"]') so the ALB security group does not block before WAF filters.
# Do NOT also use http_prefix_list_cidrs in this mode — WAF is the allow-list.
#
# Scope is REGIONAL (an ALB is a regional resource); the WebACL is created in the
# same region as the ALB. Cost: ~$5/mo per WebACL + ~$1/mo per rule + request
# charges — negligible for a demo, but non-zero.

locals {
  waf_enabled = local.alb_enabled && length(var.web_waf_allow_cidrs) > 0
}

resource "aws_wafv2_ip_set" "web_allow" {
  count              = local.waf_enabled ? 1 : 0
  name               = "${var.project}-web-allow"
  description        = "Source IPs allowed to reach the swa-demo ALB"
  scope              = "REGIONAL"
  ip_address_version = "IPV4"
  addresses          = var.web_waf_allow_cidrs

  tags = {
    Name = "${var.project}-web-allow"
  }
}

resource "aws_wafv2_web_acl" "web" {
  count       = local.waf_enabled ? 1 : 0
  name        = "${var.project}-web-acl"
  description = "Default-block, allow only source IPs in the web-allow IPSet"
  scope       = "REGIONAL"

  default_action {
    block {}
  }

  rule {
    name     = "allow-ipset"
    priority = 0

    action {
      allow {}
    }

    statement {
      ip_set_reference_statement {
        arn = aws_wafv2_ip_set.web_allow[0].arn
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-web-allow"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project}-web-acl"
    sampled_requests_enabled   = true
  }

  tags = {
    Name = "${var.project}-web-acl"
  }
}

resource "aws_wafv2_web_acl_association" "web" {
  count        = local.waf_enabled ? 1 : 0
  resource_arn = aws_lb.main[0].arn
  web_acl_arn  = aws_wafv2_web_acl.web[0].arn
}
