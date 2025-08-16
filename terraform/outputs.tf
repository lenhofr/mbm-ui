output "site_bucket" {
  value = module.site.bucket_name
}

output "site_bucket_arn" {
  value = module.site.bucket_arn
}

output "site_website_endpoint" {
  # module.site no longer exposes `website_endpoint`; use the regional domain name (CloudFront origin)
  value = module.site.bucket_regional_domain_name
}

output "distribution_id" {
  description = "CloudFront distribution ID for cache invalidations"
  value       = aws_cloudfront_distribution.cdn.id
}
