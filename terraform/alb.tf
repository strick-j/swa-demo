# Optional HTTPS front door (lab-visualizer convention). Created only when
# certificate_arn is set: import your external/Squarespace cert into ACM
# out-of-band and pass the ARN. The ALB terminates TLS and forwards plain HTTP
# to the instance's NodePort bridge (:webapp_nodeport — the socat->minikube hop
# that deploy-webapp.sh sets up). DNS is external: CNAME var.domain_name at the
# alb_dns_name output. Leave certificate_arn empty and nothing here is created.

locals {
  alb_enabled = var.certificate_arn != ""
}

resource "aws_security_group" "alb" {
  count       = local.alb_enabled ? 1 : 0
  name        = "${var.project}-alb-sg"
  description = "swa-demo ALB: HTTP/HTTPS from admin CIDRs"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${var.project}-alb-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  for_each          = local.alb_enabled ? toset(var.admin_cidrs) : toset([])
  security_group_id = aws_security_group.alb[0].id
  description       = "HTTPS from admin"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  for_each          = local.alb_enabled ? toset(var.admin_cidrs) : toset([])
  security_group_id = aws_security_group.alb[0].id
  description       = "HTTP from admin (redirected to HTTPS)"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_all" {
  count             = local.alb_enabled ? 1 : 0
  security_group_id = aws_security_group.alb[0].id
  description       = "ALB to targets"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# Let the ALB reach the instance's NodePort bridge (host SG ingress from ALB SG).
resource "aws_vpc_security_group_ingress_rule" "host_from_alb" {
  count                        = local.alb_enabled ? 1 : 0
  security_group_id            = aws_security_group.host.id
  description                  = "Webapp NodePort from ALB"
  referenced_security_group_id = aws_security_group.alb[0].id
  ip_protocol                  = "tcp"
  from_port                    = var.webapp_nodeport
  to_port                      = var.webapp_nodeport
}

resource "aws_lb" "main" {
  count              = local.alb_enabled ? 1 : 0
  name               = "${var.project}-alb"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb[0].id]
  subnets            = [aws_subnet.public.id, aws_subnet.public_b.id]

  tags = {
    Name = "${var.project}-alb"
  }
}

resource "aws_lb_target_group" "webapp" {
  count       = local.alb_enabled ? 1 : 0
  name        = "${var.project}-webapp-tg"
  port        = var.webapp_nodeport
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  health_check {
    path                = "/healthz"
    protocol            = "HTTP"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
  }

  tags = {
    Name = "${var.project}-webapp-tg"
  }
}

resource "aws_lb_target_group_attachment" "webapp" {
  count            = local.alb_enabled ? 1 : 0
  target_group_arn = aws_lb_target_group.webapp[0].arn
  target_id        = aws_instance.host.id
  port             = var.webapp_nodeport
}

resource "aws_lb_listener" "https" {
  count             = local.alb_enabled ? 1 : 0
  load_balancer_arn = aws_lb.main[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = var.ssl_policy
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.webapp[0].arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count             = local.alb_enabled ? 1 : 0
  load_balancer_arn = aws_lb.main[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}
