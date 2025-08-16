data "aws_route53_zone" "site" {
  name         = "mealsbymaggie.com."
  private_zone = false
}

resource "aws_acm_certificate" "site_cert" {
  provider                  = aws.us_east_1
  domain_name               = "mealsbymaggie.com"
  subject_alternative_names = ["www.mealsbymaggie.com"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.site_cert.domain_validation_options : dvo.domain_name => dvo
  }

  zone_id = data.aws_route53_zone.site.zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  ttl     = 60
  records = [each.value.resource_record_value]
}

resource "aws_acm_certificate_validation" "site_cert_validation" {
  provider        = aws.us_east_1
  certificate_arn = aws_acm_certificate.site_cert.arn

  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}
