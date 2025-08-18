# Production readiness and hardening guide

A pragmatic checklist to take this SPA + API stack from “works” to “production-ready.” Tackle top items first; iterate over time.

## TL;DR checklist
- [ ] Canonical redirect URI (apex only) and consistent login entry point
- [ ] Tight CORS (origins, methods, headers) on API Gateway
- [ ] Security headers at CloudFront (CSP, HSTS, X-Frame-Options, etc.)
- [ ] GitHub Actions OIDC → AssumeRole (drop long-lived AWS keys)
- [ ] Separate dev/stage/prod stacks and approvals
- [ ] API logs, metrics, and CloudWatch alarms (5xx, latency)
- [ ] DynamoDB: avoid full scans, add GSIs and pagination
- [ ] IAM least privilege for Lambdas (narrow actions/resources)
- [ ] DynamoDB PITR enabled; S3 versioning/lifecycle policies
- [ ] WAF in front of API/CloudFront (rate limiting, IP rules)

---

## Authentication (Cognito)
- Use a single canonical redirect domain (apex) to avoid host changes that break PKCE sessionStorage.
- Keep callback/logout URLs in Terraform variables; restrict to your domains.
- Token storage:
  - Current: id/access tokens in localStorage (simple, common for SPAs).
  - Stronger: exchange code via a tiny backend and set httpOnly, Secure, SameSite cookies.
- Keep scopes minimal (openid email profile). Keep token lifetimes modest.

## API Gateway + Lambda
- CORS:
  - Restrict allow_origins to your domains; allow only required methods/headers.
  - Cache preflight responses (max_age) reasonably.
- Routing/validation:
  - Validate inputs (types, lengths). Return helpful 4xx on bad input.
  - Enforce request size limits where appropriate (images go direct to S3 via presign—good).
- Observability:
  - Enable API Gateway access logs.
  - Use structured JSON logs in Lambdas; add correlation IDs.
  - Alarms: 5xx rate, p95 latency, throttles, DLQ visibility if used.
- WAF: attach AWS WAF to API Gateway for basic protections and rate limiting.

## Data layer (DynamoDB)
- Avoid Scan for large tables; prefer Query via a key design that supports access patterns.
- Add GSIs for non-key lookups (e.g., by tag/owner) if needed.
- Implement pagination on list endpoints.
- Turn on Point-in-Time Recovery (PITR) for tables.

## Storage (S3) and CDN (CloudFront)
- S3 site bucket:
  - Versioning + lifecycle (already present in module; confirm settings).
- CloudFront:
  - Add security headers via response headers policy or function:
    - Content-Security-Policy (script-src 'self' Cognito domain)
    - Strict-Transport-Security
    - X-Content-Type-Options: nosniff
    - X-Frame-Options: DENY
    - Referrer-Policy, Permissions-Policy
  - Consider WAF on distribution.
  - Keep www→apex redirect; avoid redirect during OAuth callback if you ever use www for redirects.

## CI/CD (GitHub Actions)
- Use OIDC to assume an AWS role (no static keys). See `docs/github-oidc.md`.
- Split environments:
  - Separate state/workspaces/stacks per env.
  - Plans on PRs; applies on protected branches with approvals.
- Build-time config:
  - Current workflow exports Terraform outputs into Vite envs (good).
  - Optional: runtime config.json if you need to change endpoints without rebuilds.

## IAM and security
- Narrow Lambda IAM policies to specific ARNs/actions.
- S3 images bucket: ensure Put/Get/Delete are scoped to needed prefixes; continue using presigned URLs.
- Rotate credentials; keep client IDs in repo variables (not secrets) as they’re not sensitive.

## Testing
- Unit tests for Lambdas (present) and UI (present)—extend with:
  - E2E login + write-path tests.
  - Contract tests for API responses.

## Cost and performance
- CloudFront cache policies for static assets; long max-age + immutable filenames.
- Optimize images and prefer modern formats when feasible.
- Use CloudWatch metrics and CUR to watch spend.

## “Later” enhancements
- Add refresh tokens via backend cookie flow if you need longer sessions.
- Multi-tenant or multi-user authZ model if you expand beyond personal use.
- Blue/green deploys for static site (S3 object version switch or dual buckets).

---

## Pointers to current repo
- Terraform outputs: API/Cognito values flow into the Vite build via `.github/workflows/deploy.yml`.
- www→apex redirect handled via CloudFront Function in `terraform/acm.tf`.
- Public reads, auth-only writes enforced by API Gateway JWT authorizer and split routes.
- Image uploads use S3 presigned URLs from the images Lambda.

> Keep this doc as a living checklist and tick items off as you harden the stack.
