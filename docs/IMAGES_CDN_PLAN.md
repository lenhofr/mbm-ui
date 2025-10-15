# Images CDN Plan (CloudFront + S3)

## Why
- Faster image loads via edge caching and fewer request hops
- Consistent, cacheable URLs independent of presigned GET redirects
- Tighter bucket security with Origin Access Control (OAC)

## Goals
- Serve public recipe images via CloudFront at a stable base URL (e.g., https://images.<your-domain>/)
- Keep uploads exactly as they are today (browser → S3 using presigned POST/PUT via Lambda)
- Lock down direct S3 public access and rely on CloudFront for reads
- Preserve long-lived caching headers on objects (already added: `Cache-Control: public, max-age=31536000, immutable`)

## Current State (as of today)
- Uploads: Browser requests presign to API (`POST /images`), then uploads to S3 via presigned POST (preferred) with PUT fallback.
- Reads: App uses the presigned GET redirect route (`GET /images/{key}`), returning a 302 to S3 presigned URL.
- Cache: Client-side resize reduces payloads; S3 objects include long-lived `Cache-Control`.

## Target Architecture
- Upload path: unchanged (browser → Lambda for presign → S3 POST/PUT)
- Read path: App constructs stable URLs using a CloudFront distribution in front of the images S3 bucket
  - Example: `VITE_IMAGES_BASE=https://images.example.com`
  - Image URL: `${VITE_IMAGES_BASE}/${key}`
- Security: S3 bucket denies public access; only CloudFront OAC can read objects

```
Browser ──upload──> S3 (presigned POST/PUT)   [UNCHANGED]
Browser ──GET──> CloudFront ──OAC──> S3       [NEW]
```

## Terraform Work Items

1) Create (or reuse) an images S3 bucket
- If we already have a dedicated images bucket, keep it.
- Ensure public access blocks are enabled.

2) Add CloudFront Origin Access Control (OAC)
- Allows CloudFront to fetch private S3 content without public bucket ACLs.

3) CloudFront Distribution for images
- Origin: the images S3 bucket with the OAC attached
- Cache policy: optimized for images
  - Respect `Cache-Control` from S3
  - Compress (gzip/brotli) where applicable
- Response headers policy (optional): add security headers
- Logging: enable standard logs to our logging bucket (optional but recommended)

4) S3 Bucket Policy for OAC
- Explicitly allow only the CloudFront distribution (via OAC) to GetObject

5) App configuration
- Add `VITE_IMAGES_BASE` to build-time env (and wire a helper in the UI)
- Replace read paths to use `${VITE_IMAGES_BASE}/${key}` instead of presigned GET redirects

6) Optional: Custom domain + TLS
- Create `images.example.com` in Route 53
- ACM certificate in us-east-1
- Attach to CloudFront distribution

---

## Example Terraform Sketch
Note: Names and references should be aligned with our existing Terraform modules and variables.

### Origin Access Control
```hcl
resource "aws_cloudfront_origin_access_control" "images_oac" {
  name                              = "images-oac"
  description                       = "OAC for images S3 origin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
```

### CloudFront Distribution (Images)
```hcl
resource "aws_cloudfront_distribution" "images_cdn" {
  enabled             = true

  origins {
    domain_name = aws_s3_bucket.images_bucket.bucket_regional_domain_name
    origin_id   = "images-s3-origin"

    origin_access_control_id = aws_cloudfront_origin_access_control.images_oac.id
  }

  default_cache_behavior {
    target_origin_id       = "images-s3-origin"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods = ["GET", "HEAD"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
  }

  price_class = "PriceClass_100"

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    # Option A: Default CloudFront cert (no custom domain)
    cloudfront_default_certificate = true

    # Option B: Custom domain
    # acm_certificate_arn            = aws_acm_certificate.images_cert.arn
    # ssl_support_method             = "sni-only"
    # minimum_protocol_version       = "TLSv1.2_2021"
  }

  # Optional logging
  # logging_config {
  #   bucket = aws_s3_bucket.logs.bucket_domain_name
  #   prefix = "cloudfront/images/"
  # }
}

# Common AWS-managed policies (data sources)
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}
```

### S3 Bucket Policy for OAC
```hcl
data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "images_bucket_policy" {
  statement {
    sid     = "AllowCloudFrontOACRead"
    effect  = "Allow"
    actions = ["s3:GetObject"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    resources = [
      "${aws_s3_bucket.images_bucket.arn}/*"
    ]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.images_cdn.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "images" {
  bucket = aws_s3_bucket.images_bucket.id
  policy = data.aws_iam_policy_document.images_bucket_policy.json
}
```

### Route 53 + ACM (optional custom domain)
```hcl
# Certificate must be in us-east-1 for CloudFront
resource "aws_acm_certificate" "images_cert" {
  domain_name       = "images.example.com"
  validation_method = "DNS"
}

resource "aws_route53_record" "images_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.images_cert.domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  }
  zone_id = aws_route53_zone.primary.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.value]
}

resource "aws_acm_certificate_validation" "images_cert_validation" {
  certificate_arn         = aws_acm_certificate.images_cert.arn
  validation_record_fqdns = [for record in aws_route53_record.images_cert_validation : record.fqdn]
}

resource "aws_route53_record" "images_alias" {
  zone_id = aws_route53_zone.primary.zone_id
  name    = "images.example.com"
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.images_cdn.domain_name
    zone_id                = aws_cloudfront_distribution.images_cdn.hosted_zone_id
    evaluate_target_health = false
  }
}
```

---

## App Wiring
- Add `VITE_IMAGES_BASE` to `.env` (and production environment variables)
  - Example: `VITE_IMAGES_BASE=https://images.example.com`
- In the UI, construct read URLs as `${VITE_IMAGES_BASE}/${key}`
- Keep upload flow unchanged (still uses presigned POST/PUT to S3)

### Example helper
```ts
export function imageUrlFor(key: string) {
  const base = import.meta.env.VITE_IMAGES_BASE || "";
  return base ? `${base.replace(/\/$/, "")}/${key.replace(/^\//, "")}` : key;
}
```

### Migration strategy
1) Deploy the images CloudFront distribution (can start without custom domain)
2) Set `VITE_IMAGES_BASE` to the CloudFront domain in non-prod (e.g., `https://dXXXX.cloudfront.net`)
3) Validate a few image loads end-to-end
4) Optionally wire custom domain + ACM
5) Roll out to prod by setting `VITE_IMAGES_BASE` accordingly
6) Remove the presigned GET read path from the app once all clients are updated (optional)

### Validation checklist
- Cache headers: CloudFront respects `Cache-Control` from S3
- First byte time: improved vs direct S3 URL
- Origin auth: S3 objects are private; direct GET 403; CloudFront GET 200
- CORS: Not typically required for basic image GETs; if used from JS in canvas, confirm CORS headers

### Rollback plan
- Flip the app back to presigned GET read path (existing)
- CloudFront distribution can remain idle until re-enabled

### Cost considerations
- CloudFront egress charges; typically offset by lower S3 GETs and improved UX
- Consider PriceClass_100 to limit edge footprint initially
- Enable logs temporarily during rollout, then disable or sample

### Security notes
- Keep S3 public access blocks ON
- Use OAC, not legacy OAI
- No query strings/headers/cookies forwarded unless needed (default cache policy is fine for static images)

### FAQ
- Q: Do we need a new bucket? A: No, we can reuse the existing images bucket.
- Q: Do uploads change? A: No, uploads remain via presigned POST/PUT directly to S3.
- Q: Do we need CORS for reads? A: Not for <img> tags. Only needed for JS pixel access/canvas tainting.
- Q: What about WebP/AVIF? A: Out of scope for this step; can be layered later via Lambda@Edge or pre-generated variants.

---

## Next Steps
- Implement Terraform resources listed above behind a feature flag/workspace variable
- Add UI helper and `VITE_IMAGES_BASE`
- Roll out to a non-prod environment, validate, then promote
