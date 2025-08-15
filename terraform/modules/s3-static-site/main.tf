variable "bucket_name" {
  type = string
}

resource "aws_s3_bucket" "site" {
  bucket = var.bucket_name
  acl    = "private"

  server_side_encryption_configuration {
    rule {
      apply_server_side_encryption_by_default {
        sse_algorithm = "AES256"
      }
    }
  }

  versioning {
    enabled = true
  }
}

output "bucket_arn" {
  value = aws_s3_bucket.site.arn
}

output "bucket_name" {
  value = aws_s3_bucket.site.id
}

output "website_endpoint" {
  value       = aws_s3_bucket.site.website_endpoint
  description = "S3 website endpoint (if website hosting enabled)"
  depends_on  = [aws_s3_bucket.site]
}
