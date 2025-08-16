# mbm-ui

Meals by Maggie — React/Vite Single Page Application (SPA) with AWS static hosting (S3 + CloudFront) managed by Terraform.

## Quickstart

Prereqs
- Node.js 18+ and npm
- Terraform CLI 1.5+
- AWS CLI configured (an account and creds with permissions)

Local dev
```bash
npm install
npm run dev
```

Tests
```bash
npm test
```

Build & preview
```bash
npm run build
npm run preview
```

## Infrastructure & deploy

- Terraform code lives in `terraform/`. See `terraform/README.md` for backend setup, plan/apply, and safety notes.
- High level flow:
   1) Provision infra (S3 site bucket, CloudFront, certs/aliases) with Terraform.
   2) Build the SPA and upload to the site bucket.
   3) Invalidate CloudFront to roll out changes globally.

Manual frontend deploy (after infra exists)
```bash
# Build the app
npm run build

# Replace with your bucket and distribution id
export SITE_BUCKET=s3://<your-site-bucket>
export CF_DISTRIBUTION_ID=<your-distribution-id>

# Sync static assets and invalidate cache
aws s3 sync dist "$SITE_BUCKET" --delete
aws cloudfront create-invalidation --distribution-id "$CF_DISTRIBUTION_ID" --paths '/*'
```

## Repo utilities

- Pre-commit hooks (terraform fmt):
```bash
npm run install-hooks
```

- Project scaffolder (template generator):
```bash
npm run scaffold:spa -- --help
```

## Architecture & roadmap (original, preserved)

Here’s a high-level plan to deploy a Single Page Application (SPA) for storing recipes, pictures, and ratings on AWS using S3, CloudFront, and Lambda:

1. Frontend (SPA)
Framework: Use React, Vue, Angular, or plain HTML/JS.
Deployment: Host static files (HTML, JS, CSS, images) on an S3 bucket.
Setup: Make the S3 bucket public for read access or use CloudFront to serve the content securely.
2. CloudFront
Use CloudFront as a CDN to distribute your SPA globally.
Connect CloudFront to your S3 bucket.
(Optional) Configure error handling to serve index.html for all routes (important for SPAs with client-side routing).
3. Backend (API)
Lambda Functions: Use AWS Lambda (with API Gateway) to provide backend endpoints for:

Storing/retrieving recipes
Storing/retrieving ratings
Handling image uploads (store images in another S3 bucket)
API Gateway: Set up REST or HTTP endpoints to trigger Lambda functions.

4. Data Storage
Recipes/Ratings: Use DynamoDB or another AWS database for storing structured data.
Images: Store images in an S3 bucket.
5. Authentication (Optional)
Use Amazon Cognito for user authentication (sign up, sign in, etc.).
6. Deployment Flow
Build your SPA locally.
Upload the build artifacts to the S3 bucket.
Invalidate the CloudFront cache to ensure new content is served.
Set up Lambda/API Gateway for backend.
Connect your frontend app to the backend endpoints.
Sample Architecture Diagram

```
[Browser] 
    | 
    v
[CloudFront CDN] 
    |
    v
[S3 Bucket (SPA files)]   [API Gateway]---->[Lambda Functions]---->[DynamoDB (Data)]
                                                 | 
                                                 v
                                 [S3 Bucket (Images)]
```

Keep using this section as the living roadmap for future work (API, auth, uploads).

## Notes on CI/CD

This repo can use GitHub Actions to: (a) run Terraform plan on PRs, and (b) apply + deploy on main merges. If/when enabled, workflows would live in `.github/workflows/` and use AWS OIDC or access keys. See the Q&A below.

## Q&A

What does “wire GitHub Actions for plan/deploy” mean?
- Add two workflow files under `.github/workflows/`:
   - `terraform-plan.yml`: on pull requests, run `terraform fmt -check` and `terraform plan`, then post the plan as a PR comment.
   - `deploy.yml`: on pushes to `main`, run `terraform apply`, build the SPA, `aws s3 sync` to the site bucket, and `cloudfront create-invalidation`.
- Configure auth for the workflows: either GitHub OIDC + an AWS role, or short-lived access keys.
- Optionally restrict applies via manual approvals, labels, or protected branches.
