# Mobile Image Upload Debugging

## Summary of the Issue

Image uploads from mobile devices (specifically Safari on iOS) are failing, while uploads from desktop browsers work correctly. The user can select an image on their mobile device, but after saving the recipe, the image does not appear, and the old image (or no image) remains.

## What Works

- Image uploads from desktop browsers (e.g., Chrome, Firefox, Safari on macOS).
- The entire recipe creation/editing process, except for the image upload on mobile.

## What Fails

- The final step of the image upload process on mobile devices. The pre-signed URL is generated, but the `PUT` request to S3 seems to fail silently or is handled incorrectly by AWS.

## Troubleshooting Steps Taken

### 1. Frontend Code Verification

**Hypothesis:** The `fetch` request to the pre-signed S3 URL was missing the `Content-Type` header, which is often required by S3 for direct uploads.

**Action:** We inspected the code in `src/components/DetailsModal.tsx` and confirmed that the `Content-Type` header is being correctly set from the file's type.

**Relevant Code:**
```typescript
// src/components/DetailsModal.tsx

const resp = await fetch(`${apiBase}/images`, { 
  method: 'POST', 
  body: JSON.stringify({ filename: imageFile.name }), 
  headers: { ...auth.authHeader(), 'Content-Type': 'application/json' } 
});

if (resp.ok) {
  const data = await resp.json();
  // The critical fetch call to S3
  await fetch(data.uploadUrl, { 
    method: 'PUT', 
    body: imageFile, 
    headers: { 'Content-Type': imageFile.type } 
  });
  imageUrl = data.key;
}
```

**Result:** The code was correct. We forced a redeployment to ensure this code was live in production, but the issue persisted. This ruled out a stale frontend deployment.

### 2. S3 Bucket CORS Policy

**Hypothesis:** The S3 bucket for image uploads did not have a CORS policy that allowed the `Content-Type` header from the client.

**Action:** We added a new `aws_s3_bucket_cors_configuration` resource to the Terraform configuration in `terraform/backend_api.tf`. This policy explicitly allows `PUT` and `POST` methods and all headers (`*`) from any origin (`*`).

**Relevant Code:**
```terraform
# terraform/backend_api.tf

resource "aws_s3_bucket_cors_configuration" "images" {
  bucket = aws_s3_bucket.images.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "POST"]
    allowed_origins = ["*"]
    expose_headers  = []
    max_age_seconds = 3000
  }
}
```

**Result:** The changes were merged and deployed to production. However, the mobile image upload issue was not resolved.

## Current Hypothesis & Next Steps

Since both the frontend code and the direct S3 CORS policy appear to be correct, the issue may lie in the infrastructure between the client and the S3 bucket. The next component to investigate is the **AWS CloudFront distribution**.

It is possible that CloudFront is not configured to forward the necessary headers (`Content-Type`, `Authorization`, etc.) to the API Gateway and S3 origins. We should inspect the `aws_cloudfront_distribution` resource in `terraform/main.tf` and check the `forwarded_values` for the relevant cache behaviors, specifically for the `/api/*` path that leads to the backend.

## Implemented Fix

To improve compatibility with iOS Safari and other mobile upload edge cases, we added support for S3 Presigned POST in addition to the existing Presigned PUT:

- Backend (`terraform/lambda/images/app.py`):
  - The POST `/images` endpoint now generates both a presigned PUT URL and a presigned POST (with fields and conditions that allow `Content-Type` starting with `image/`).
  - The request body now accepts `{ filename, type }` and uses `type` to seed the `Content-Type` field in the POST policy.
  - Response now returns: `{ uploadUrl, postUrl, fields, key, url }`.

- Frontend (`src/components/DetailsModal.tsx`):
  - When saving with an image, the client requests a presign with both filename and file type.
  - The client prefers the presigned POST path (FormData with returned fields + file). If the POST upload fails, we fall back to the presigned PUT.
  - We continue to set the `Content-Type` header on PUT uploads.

Rationale: Some iOS Safari versions and PWA contexts have inconsistent behavior when performing cross-origin PUT uploads to S3 with specific headers. Presigned POST is the AWS-recommended pattern for browser uploads and avoids several quirks by sending the file via a multipart form with signed policy fields.

## Rollout Notes

1. Apply Terraform to update the Lambda package and ensure the latest code is deployed for the images function.
2. Redeploy the SPA and invalidate CloudFront so the updated frontend is served everywhere.
3. Verify uploads on iOS Safari (standalone PWA mode and in-browser), as well as Android Chrome.

If issues persist after this change, the next items to inspect are:
- CloudFront behavior for the API origin (if proxied through CF); ensure headers are forwarded or bypass CF for API calls.
- HEIC image handling (some devices produce HEIC); S3 will store it, but downstream display may need conversion server-side if browsers don’t support it.
- Service Worker interference: confirm the SW doesn’t intercept cross-origin requests to S3/postUrl (current SW only caches same-origin GETs).
