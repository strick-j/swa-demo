# Security group: SSH from ssh_cidrs, demo NodePort from http_cidrs; full egress (tenant/registry over 443).

resource "aws_security_group" "host" {
  name        = "${var.project}-host-sg"
  description = "swa-demo host: SSH (ssh_cidrs) + demo NodePort (http_cidrs) inbound"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${var.project}-host-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  for_each          = toset(var.ssh_cidrs)
  security_group_id = aws_security_group.host.id
  description       = "SSH from admin"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}

# Public cleartext NodePort access — ONLY when there is no ALB. When the ALB is
# enabled it terminates TLS and reaches the NodePort via host_from_alb (below),
# so we drop the public :30080 rule to stop the HTTPS front door being bypassed
# in cleartext. With no ALB, the NodePort is the only entry, so it stays open.
resource "aws_vpc_security_group_ingress_rule" "nodeport" {
  for_each          = local.alb_enabled ? toset([]) : toset(var.http_cidrs)
  security_group_id = aws_security_group.host.id
  description       = "Demo webapp NodePort from http_cidrs (no-ALB only)"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = var.webapp_nodeport
  to_port           = var.webapp_nodeport
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.host.id
  description       = "All egress (tenant + registry over 443)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
