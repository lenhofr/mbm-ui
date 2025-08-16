variable "bucket_name" {
  type = string
}

resource "aws_s3_bucket" "site" {
  bucket = var.bucket_name

  # Keep bucket private by default. ACLs are managed via aws_s3_bucket_acl when needed.
  # Avoid deprecated nested configuration blocks on the bucket resource.
  force_destroy = false
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

output "bucket_arn" {
  value = aws_s3_bucket.site.arn
}

output "bucket_name" {
  value = aws_s3_bucket.site.id
}

output "bucket_regional_domain_name" {
  value       = aws_s3_bucket.site.bucket_regional_domain_name
  description = "Regional S3 domain name for the bucket (use as CloudFront origin)"
  depends_on  = [aws_s3_bucket.site]
}

# Deprecated website endpoint (kept only for backward compatibility/testing)
output "website_endpoint_deprecated" {
  value       = aws_s3_bucket.site.website_endpoint
  description = "(Deprecated) S3 website endpoint — use only for direct S3 website hosting tests"
  depends_on  = [aws_s3_bucket.site]
  sensitive   = true
}
