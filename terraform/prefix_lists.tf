# Customer-managed prefix list for web-demo inbound access. Lets you allow many
# viewer/admin CIDRs through a single security-group rule — per-CIDR rules would
# otherwise blow past the rules-per-SG quota. Entries are managed here from
# var.http_prefix_list_cidrs; the whole feature is gated on that list being
# non-empty.
#
# The list gates the same paths as http_cidrs, in whichever mode is active:
#   - no-ALB mode: the host NodePort (var.webapp_nodeport)
#   - ALB mode:    the ALB HTTP (80) + HTTPS (443) listeners
# It is ADDITIVE to http_cidrs. To serve the demo ONLY to these CIDRs, set
# http_cidrs = [] so the open default (0.0.0.0/0) is dropped.

locals {
  http_prefix_list_enabled = length(var.http_prefix_list_cidrs) > 0
}

resource "aws_ec2_managed_prefix_list" "web" {
  count          = local.http_prefix_list_enabled ? 1 : 0
  name           = "${var.project}-web-allow"
  address_family = "IPv4"
  # max() guarantees max_entries never drops below the current entry count (AWS
  # rejects shrinking a prefix list below its live entries). Tune the ceiling via
  # http_prefix_list_max_entries — remember it counts against the SG rule quota.
  max_entries = max(var.http_prefix_list_max_entries, length(var.http_prefix_list_cidrs))

  dynamic "entry" {
    for_each = toset(var.http_prefix_list_cidrs)
    content {
      cidr = entry.value
    }
  }

  tags = {
    Name = "${var.project}-web-allow"
  }
}

# --- no-ALB mode: NodePort on the host SG ----------------------------------
resource "aws_vpc_security_group_ingress_rule" "nodeport_prefix_list" {
  count             = local.http_prefix_list_enabled && !local.alb_enabled ? 1 : 0
  security_group_id = aws_security_group.host.id
  description       = "Demo webapp NodePort from web prefix list (no-ALB only)"
  prefix_list_id    = aws_ec2_managed_prefix_list.web[0].id
  ip_protocol       = "tcp"
  from_port         = var.webapp_nodeport
  to_port           = var.webapp_nodeport
}

# --- ALB mode: HTTP + HTTPS on the ALB SG ----------------------------------
resource "aws_vpc_security_group_ingress_rule" "alb_https_prefix_list" {
  count             = local.http_prefix_list_enabled && local.alb_enabled ? 1 : 0
  security_group_id = aws_security_group.alb[0].id
  description       = "HTTPS from web prefix list"
  prefix_list_id    = aws_ec2_managed_prefix_list.web[0].id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "alb_http_prefix_list" {
  count             = local.http_prefix_list_enabled && local.alb_enabled ? 1 : 0
  security_group_id = aws_security_group.alb[0].id
  description       = "HTTP from web prefix list (redirected to HTTPS)"
  prefix_list_id    = aws_ec2_managed_prefix_list.web[0].id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}
