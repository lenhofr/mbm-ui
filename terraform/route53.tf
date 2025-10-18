resource "aws_route53_zone" "mealsbymaggie" {
  name          = "mealsbymaggie.com."
  comment       = "Imported hosted zone for mealsbymaggie.com"
  force_destroy = false
  # This resource is intended to be imported into state using the hosted zone id.
}

# SES: Domain identity for sending from mealsbymaggie.com
resource "aws_sesv2_email_identity" "mbm_domain" {
  email_identity = "mealsbymaggie.com"
}

# Publish Easy DKIM CNAME records that SES requests for this identity
# SES Easy DKIM issues exactly 3 tokens; use a static count to avoid plan-time unknown-length errors
resource "aws_route53_record" "ses_dkim" {
  count   = 3
  zone_id = aws_route53_zone.mealsbymaggie.zone_id
  name    = "${aws_sesv2_email_identity.mbm_domain.dkim_signing_attributes[0].tokens[count.index]}._domainkey.mealsbymaggie.com"
  type    = "CNAME"
  ttl     = 1800
  records = ["${aws_sesv2_email_identity.mbm_domain.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

# Optional: Custom MAIL FROM domain improves deliverability and alignment
resource "aws_sesv2_email_identity_mail_from_attributes" "mbm_mail_from" {
  email_identity         = aws_sesv2_email_identity.mbm_domain.email_identity
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
  mail_from_domain       = "mail.mealsbymaggie.com"
}

# MAIL FROM required DNS records
resource "aws_route53_record" "ses_mail_from_mx" {
  zone_id = aws_route53_zone.mealsbymaggie.zone_id
  name    = aws_sesv2_email_identity_mail_from_attributes.mbm_mail_from.mail_from_domain
  type    = "MX"
  ttl     = 1800
  records = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
}

resource "aws_route53_record" "ses_mail_from_txt" {
  zone_id = aws_route53_zone.mealsbymaggie.zone_id
  name    = aws_sesv2_email_identity_mail_from_attributes.mbm_mail_from.mail_from_domain
  type    = "TXT"
  ttl     = 1800
  records = ["v=spf1 include:amazonses.com -all"]
}
