locals {
  bucket_name = "mqm-ui-infra-217354297026"
}

module "site" {
  source      = "./modules/s3-static-site"
  bucket_name = local.bucket_name
}

# CloudFront wiring: Origin Access Control (OAC) + distribution skeleton + bucket policy
resource "aws_cloudfront_origin_access_control" "oac" {
  name                              = "mbm-site-oac"
  origin_access_control_origin_type = "s3"
  signing_protocol                  = "sigv4"
  signing_behavior                  = "always"
}

# Current AWS caller identity (used for policy conditions)
data "aws_caller_identity" "current" {}

# Minimal CloudFront distribution. Customize viewer_certificate, logging, and behaviors as needed.
resource "aws_cloudfront_distribution" "cdn" {
  enabled = true

  aliases = ["mealsbymaggie.com", "www.mealsbymaggie.com"]

  default_root_object = "index.html"

  origin {
    domain_name = module.site.bucket_regional_domain_name
    origin_id   = "s3-site-origin"

    origin_access_control_id = aws_cloudfront_origin_access_control.oac.id
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "s3-site-origin"

    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    # CloudFront Function association to redirect www -> root
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.redirect_www.arn
    }
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.site_cert.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  # minimal price class
  price_class = "PriceClass_100"

  tags = {
    Name = "mbm-site-cdn"
  }

  logging_config {
    bucket          = aws_s3_bucket.cf_logs.bucket_regional_domain_name
    include_cookies = false
    prefix          = "cloudfront/"
  }
}

# Bucket for CloudFront access logs
resource "aws_s3_bucket" "cf_logs" {
  bucket        = "${local.bucket_name}-cf-logs"
  force_destroy = false

  tags = {
    Name = "mbm-site-cf-logs"
  }

  # Lifecycle rule: expire CloudFront access logs under the configured prefix to control costs.
  lifecycle_rule {
    id      = "expire-cloudfront-logs"
    enabled = true
    prefix  = "cloudfront/"

    expiration {
      days = 90
    }

    noncurrent_version_expiration {
      days = 90
    }
  }
}

resource "aws_s3_bucket_public_access_block" "cf_logs" {
  bucket = aws_s3_bucket.cf_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cf_logs" {
  bucket = aws_s3_bucket.cf_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_ownership_controls" "cf_logs" {
  bucket = aws_s3_bucket.cf_logs.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

# Allow CloudFront OAC to GetObject from the bucket
data "aws_iam_policy_document" "allow_cloudfront_get" {
  statement {
    sid    = "AllowCloudFrontServicePrincipal"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${module.site.bucket_arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.cdn.arn]
    }

    # Also require the CloudFront request to originate from this AWS account
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  # Also allow requests signed by the CloudFront Origin Access Control (OAC)
  statement {
    sid    = "AllowCloudFrontOAC"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${module.site.bucket_arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = ["arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:origin-access-control/${aws_cloudfront_origin_access_control.oac.id}"]
    }
  }
}

resource "aws_s3_bucket_policy" "site_policy" {
  bucket = module.site.bucket_name
  policy = data.aws_iam_policy_document.allow_cloudfront_get.json
}
