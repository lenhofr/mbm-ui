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

# Minimal CloudFront distribution. Customize viewer_certificate, logging, and behaviors as needed.
resource "aws_cloudfront_distribution" "cdn" {
  enabled = true

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
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    # Use the ACM certificate issued in us-east-1 for the custom domain
    acm_certificate_arn      = aws_acm_certificate.site_cert.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
  # add domain aliases for the distribution
  aliases = ["mealsbymaggie.com", "www.mealsbymaggie.com"]

  # minimal price class
  price_class = "PriceClass_100"

  tags = {
    Name = "mbm-site-cdn"
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
  }
}

resource "aws_s3_bucket_policy" "site_policy" {
  bucket = module.site.bucket_name
  policy = data.aws_iam_policy_document.allow_cloudfront_get.json
}
