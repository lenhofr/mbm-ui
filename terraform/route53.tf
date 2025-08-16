resource "aws_route53_zone" "mealsbymaggie" {
  name          = "mealsbymaggie.com."
  comment       = "Imported hosted zone for mealsbymaggie.com"
  force_destroy = false
  # This resource is intended to be imported into state using the hosted zone id.
}
