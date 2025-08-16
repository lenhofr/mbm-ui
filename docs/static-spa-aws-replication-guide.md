# Static SPA on AWS with Terraform + GitHub Actions — Replication Guide

This guide captures everything needed to replicate this project’s architecture for another app: private S3 + CloudFront (OAC), ACM cert (us-east-1), Route53, access logging, SPA-friendly error handling, and CI/CD (plan on PR, apply + deploy on main).

Use this as a checklist and copy/paste reference when spinning up a new site.

## What you get
- Private S3 bucket for site files (versioned, encrypted, public access blocked)
- CloudFront in front of S3 with Origin Access Control (OAC)
- SPA routing: 403/404 -> /index.html
- ACM certificate in us-east-1 and Route53 alias A/AAAA records
- CloudFront Function to redirect www -> apex
- CloudFront access logs to a separate S3 bucket with lifecycle
- GitHub Actions:
  - PRs: Terraform fmt check + plan -> comment on PR
  - Main: Terraform apply + Vite build + S3 sync + CloudFront invalidation + summary
- Local pre-commit hook: terraform fmt -recursive -check

## Prereqs
- AWS account and CLI access with permissions for S3, CloudFront, Route53, ACM
- Domain hosted in Route53 (optional but recommended for custom domain)
- Terraform CLI >= 1.5 and AWS provider ~> 5.0
- Node.js 18+ (project uses Vite + React)

## Repo layout to copy
```
terraform/
  backend.tf          # S3 remote state config
  providers.tf        # primary + us-east-1 provider alias
  variables.tf        # aws_region, bucket_name
  main.tf             # OAC, CloudFront, logging, bucket policy
  acm.tf              # ACM cert (us-east-1), DNS validation, CF Function, Route53 alias records
  outputs.tf          # site bucket, ARN, origin endpoint
  modules/
    s3-static-site/
      main.tf         # S3 bucket + controls (versioning, encryption, ownership, public access block)

.github/workflows/
  terraform-plan.yml  # PR-only plan + comment
  deploy.yml          # push to main apply + build + deploy + invalidate

scripts/
  pre-commit.sh       # terraform fmt -recursive -check

src/ (your SPA)
```

## Variables to change for a new app
- Domain: in `terraform/acm.tf` (domain_name, SANs) and `data "aws_route53_zone"` lookup
- Bucket name: in `terraform/variables.tf` (or `locals` in `main.tf`) and tags
- Paths and names in workflows (optional): artifact names, job names

## Terraform highlights (current project)
- OAC + CloudFront distribution with SPA fallback and logging (`terraform/main.tf`)
  - default_root_object = index.html
  - custom_error_response for 403/404 -> 200 /index.html
  - function_association (viewer-request) -> redirect www to apex
  - logging_config -> S3 logs bucket (prefix cloudfront/)
- S3 logs bucket with lifecycle to expire logs (90 days)
- S3 site bucket via `modules/s3-static-site` (versioning + AES256 encryption + public access block + ownership controls)
- Bucket policy permits CloudFront access by:
  - Allow service principal cloudfront.amazonaws.com with SourceArn = distribution ARN and SourceAccount = account ID
  - Allow OAC SourceArn = origin-access-control ARN
- ACM certificate in us-east-1 with DNS validation (provider alias `aws.us_east_1`)
- Route53 alias A/AAAA for apex + www to CloudFront

## CI/CD behavior (current project)
- `terraform-plan.yml` (PR only):
  - Runs terraform fmt -check -recursive
  - terraform init, validate, plan
  - Attaches plan summary or error logs as a PR comment
- `deploy.yml` (push to main + manual dispatch):
  - terraform init, apply
  - terraform outputs -> get site bucket, distribution ID, origin endpoint
  - Node setup, build (Vite)
  - aws s3 sync dist -> site bucket
  - cloudfront create-invalidation '/*'
  - Summarize + (if applicable) comment apply result to associated PR

Tip: Consider switching to GitHub OIDC for short-lived credentials later; see `docs/github-oidc.md`.

## Local formatting pre-check
- `scripts/pre-commit.sh` ensures `terraform fmt -recursive -check` passes before commit.
- Enable locally:
```bash
npm run install-hooks
```
- Run manually:
```bash
npm run tf:fmt:check
```

## Bootstrap steps for a new app (high level)
1) Copy the `terraform/`, `.github/workflows/`, and `scripts/` folders; adjust names, tags, and variables.
2) Update `terraform/backend.tf` to point to your remote state bucket/key.
3) Update `terraform/variables.tf` and/or `main.tf` locals with the new bucket name and region.
4) In `terraform/acm.tf` set your domain(s); ensure the hosted zone exists or import it to state.
5) Run locally:
```bash
cd terraform
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```
6) Build and deploy the app artifacts (CI will do this on main):
```bash
npm ci
npm run build
aws s3 sync dist s3://<your-bucket> --delete
aws cloudfront create-invalidation --distribution-id <CF_ID> --paths '/*'
```
7) Verify DNS (dig or your browser). Expect 5–30 min for propagation sometimes.

## Common pitfalls and fixes
- AccessDenied via CloudFront:
  - Ensure OAC is attached to the origin in the distribution
  - Bucket policy must allow cloudfront.amazonaws.com with SourceArn = distribution ARN and/or OAC ARN
- SPA routes 404/403:
  - Ensure custom_error_response blocks map to 200 /index.html and default_root_object is set
- Certificate not issued:
  - Confirm DNS validation records exist in Route53 for each domain/SAN
  - ACM must be in us-east-1 for CloudFront
- Logs not appearing:
  - CloudFront logs can take minutes to an hour; confirm logging_config bucket/prefix and bucket policy/ownership
- PR workflow formatting failures:
  - Run `terraform fmt -recursive` locally; install pre-commit hook

## Security and cost tips
- Keep S3 private; use OAC, not public reads
- Enforce SSE (AES256 or KMS)
- Lifecycle on logs to control cost (e.g., 30–180 days)
- Consider OIDC for CI credentials (see `docs/github-oidc.md`)
- Start with PriceClass_100 for CloudFront to lower cost; raise as needed

## Minimal contract for reuse
Inputs:
- Domain name(s), AWS account ID, region
- Unique bucket name prefix
- Route53 hosted zone

Outputs (from Terraform):
- site_bucket, site_bucket_arn, site_website_endpoint (regional S3 domain used as CloudFront origin)
- CloudFront distribution ID (accessible via `aws_cloudfront_distribution.cdn.id` if you choose to output)

Success criteria:
- HTTPS site loads via apex domain
- www redirects to apex
- Deep SPA routes render via index.html fallback
- Logs present in logs bucket (prefix cloudfront/)
- CI:
  - PR -> plan comment
  - Main -> apply + deploy + invalidate

## Next improvements (optional)
- Add WAF web ACL
- Add custom response headers (HSTS, CSP) via CloudFront
- Add Route53 health checks and DNS failover (if multi-origin)
- Split staging and production workspaces
- Switch CI to OIDC-based role assumption

---
Keep this guide in sync with your Terraform and workflows. When creating a new app, copy the pieces and adjust domain/bucket names, then run the PR plan workflow and merge to main to deploy.

## Try it: replicate this setup quickly

Below are copy-paste commands for a clean clone scenario. Replace placeholders in ALL_CAPS.

```bash
# 1) Clone and install
git clone <THIS_REPO_URL> my-new-spa && cd my-new-spa
npm ci

# 2) Configure Terraform backend (edit terraform/backend.tf)
#    - Set your state bucket name and key path

# 3) Update variables (fast path)
#    - Edit terraform/variables.tf (bucket_name, aws_region) OR terraform/main.tf locals {}
#    - Edit terraform/acm.tf (domain_name, SANs, Route53 zone lookup)

# 4) Initialize and plan
cd terraform
terraform init
terraform fmt -recursive
terraform plan -out=tfplan
terraform show -no-color tfplan | sed -n '1,200p'

# 5) Apply infra (be careful; this provisions real resources)
terraform apply tfplan

# 6) Build and deploy front end (from repo root)
cd ..
npm run build
aws s3 sync dist s3://<YOUR_BUCKET_NAME> --delete
aws cloudfront create-invalidation --distribution-id <YOUR_CF_ID> --paths '/*'

# 7) Check DNS and TLS
#    - dig +short yourdomain.com
#    - open https://yourdomain.com in a browser
```

If you prefer to avoid manual edits, see the template generator below.

## Template generator (experimental)

This repo includes a small scaffolding script that copies the essential Terraform and workflow files to a new directory and performs token replacements (domain, bucket, tags). It can also initialize a fresh package.json and write a tailored README.

Add your values and run:

```bash
# From repo root
npm run scaffold:spa -- \
  --target ../my-new-spa \
  --app-name "Awesome Recipes" \
  --bucket-name awesome-recipes-site-123456789012 \
  --domain awesome-recipes.example.com \
  --region us-east-1 \
  --init-package \
  --readme \
  --with-spa

# Then review the generated files in ../my-new-spa and follow the Try it steps there.
```

Flags
- --target: output directory (created if missing)
- --app-name: used for tags and human-readable names
- --bucket-name: exact S3 bucket name for the site (must be globally unique)
- --domain: apex domain (www subdomain is auto-derived as www.DOMAIN)
- --region: primary AWS region (ACM for CloudFront remains us-east-1)
- --init-package: create a basic package.json with helpful Terraform scripts and install-hooks
- --readme: generate a README.md tailored with your app name, domain, bucket, and region
- --with-spa: copy a minimal React/Vite SPA skeleton into the target (index.html, src/main.tsx, vite config)

What it does
- Copies terraform/, .github/workflows/{terraform-plan.yml,deploy.yml}, and scripts/pre-commit.sh
- Replaces default domain (mealsbymaggie.com) with your domain and www subdomain
- Replaces default bucket name with your provided bucket name
- Updates simple Name tags to reflect the app name
 - Appends the app name to workflow `name:` fields for clarity (e.g., "Deploy Static Site - Awesome Recipes")

Notes
- Inspect the generated terraform/backend.tf to point at your remote state bucket/key.
- You can still switch CI to GitHub OIDC later; see docs/github-oidc.md.
