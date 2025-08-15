output "site_bucket" {
  value = module.site.bucket_name
}

output "site_bucket_arn" {
  value = module.site.bucket_arn
}

output "site_website_endpoint" {
  value = module.site.website_endpoint
}
