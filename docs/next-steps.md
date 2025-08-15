# Next steps — UI & Infrastructure

This document collects prioritized UI improvements and a pragmatic Terraform + AWS hosting roadmap for the project. Use it as a living checklist and link-of-record for next work.

---

## Quick checklist (short-term first)

- [ ] Add instructions field to `DetailsModal` (done)
- [ ] Make cook-mode full-featured (step navigation, timers, checklist)
- [ ] Add recipe edit/reorder for instructions
- [ ] Add tests for: add/edit recipes, cook-mode open/close, ingredients toggle behavior
- [ ] Create CI pipeline for build + deploy to staging (see infra section)
- [ ] Prepare Terraform code for S3/CloudFront hosting and remote state

---

## UI next steps — prioritized

1. Cook mode polish (High)
   - Step-by-step view: present one instruction at a time with "next/prev" controls.
   - Checkboxes per ingredient and per step; persist the checked state for the session (localStorage) so cooks can track progress.
   - Optional step timers with presets (e.g., 5/10/30 minutes) and a small timer UI.
   - Printer-friendly view: clean layout suitable for print/PDF.

2. Instruction editing UX (High)
   - Allow reordering steps with drag-and-drop (use `react-beautiful-dnd` or `@dnd-kit/core`).
   - Inline step editing (double-click or edit button) with autosave and undo.

3. Small card improvements (Medium)
   - Show first instruction preview on the card (1-line excerpt) to give a quick sense.
   - Add keyboard shortcuts: Enter to open selected card, Esc to close modals, j/k to navigate cards in cook-mode.
   - Better image handling: show placeholder blur, add client-side cropping or recommended aspect ratio.

4. Accessibility & semantics (High)
   - Ensure all modals have focus trap and aria attributes (role=dialog, aria-modal, labelledby). Already present; expand tests.
   - Add visible focus styles, high contrast mode, and proper heading order.
   - Ensure color contrast meets WCAG AA for primary actions and important copy.

5. Testing & quality (High)
   - Add unit tests for `RecipeList`, `DetailsModal`, and `CookModal` using Vitest + React Testing Library.
   - Add an end-to-end smoke test with Playwright to validate flow: add recipe -> open cook mode -> mark ingredient done.
   - Add Storybook for visual regression of key components (cards, modal, cook-mode).

6. Performance & bundle (Medium)
   - Audit bundle with `vite build --report` and remove unused libs.
   - Lazy-load heavy assets (images) with native `loading=lazy` and consider using an image CDN later.

7. Design system / tokens (Medium)
   - Extract CSS variables used in `styles.css` into a clear token file (colors, spacing, radii, shadows).
   - Consider a small component library in `src/components/ui/*` for buttons, inputs, modals to ensure consistent styling.

8. Small polish items (Low)
   - Micro-interactions: subtle motion for adding tags, saving recipes, button press states.
   - Onboarding tooltip for first-run explaining cook-mode and quick add.

---

## Terraform -> AWS hosting: recommended architecture (static SPA)

Goal: host the Vite-built static assets reliably and securely in AWS with fast global delivery.

Recommended components:
- S3 (private) to store the built site (artifact bucket).
- CloudFront distribution in front of S3 for low-latency global CDN.
- ACM certificate (provisioned in `us-east-1` for CloudFront) for TLS.
- Route53 (optional) to manage DNS and alias the site to CloudFront.
- CI/CD (GitHub Actions) to build, run tests, and deploy artifacts to S3 and invalidate CloudFront cache.
- Terraform to manage infra, with remote state in an S3 backend + DynamoDB locking (or use Terraform Cloud).

Why this setup?
- Simple, cost-effective for static SPAs.
- CloudFront provides caching, TLS, WAF integration later, and global edge performance.
- Terraform remote state + locking reduces drift and enables team collaboration.

---

## Terraform project layout (suggested)

```
terraform/
├─ README.md
├─ envs/
│  ├─ staging/
│  │  ├─ main.tf
│  │  ├─ variables.tf
│  │  └─ backend.tf
│  └─ production/
│     ├─ main.tf
│     ├─ variables.tf
│     └─ backend.tf
├─ modules/
│  ├─ s3-static-site/
│  │  ├─ main.tf
│  │  ├─ outputs.tf
│  │  └─ variables.tf
│  ├─ cloudfront/
│  ├─ route53/
│  └─ acm/
└─ scripts/
   └─ deploy.sh  (optional helper for local testing)
```

Module responsibilities:
- `s3-static-site`: create S3 bucket, bucket policy (blocked public, grant CloudFront origin access), bucket lifecycle rules (optional), enforce encryption.
- `cloudfront`: create distribution, origin access (OAI/OAC), default cache behaviors, CORS headers, custom error responses (index.html fallback for SPA), logging bucket.
- `acm`: request/validate certificate (DNS validation via Route53 if same account), handle cleanups.
- `route53`: manage DNS records and alias to CloudFront.

Remote state:
- Use an S3 bucket + DynamoDB table for locking (one per environment) or use Terraform Cloud/Enterprise if you prefer.

---

## Minimal Terraform resources you’ll implement (timeline)

Phase 1 — staging (quick, low-risk)
- Create backend S3 bucket and DynamoDB for state locking.
- Module: `s3-static-site` (staging) -> creates private S3 bucket with versioning and encryption.
- Module: `cloudfront` (staging) -> CloudFront distribution with an origin access control to S3.
- Add `backend.tf` to env to point Terraform at the S3 backend.
- Manual: create a DNS record in Route53 (or test via CloudFront domain).

Phase 2 — production + automation
- Repeat modules for production with production names and tags.
- Create ACM certificate in `us-east-1` and validate via Route53.
- Create Route53 records and optionally health checks.
- Add WAF web ACL (optional) and logging to S3.

Phase 3 — CI/CD and promotion
- Build pipeline in GitHub Actions:
  - On push to `main` run tests and `vite build`.
  - Sync `dist/` to S3 (aws s3 sync) or use `aws cloudfront create-invalidation` after upload.
  - Tag releases and promote staging -> prod via Terraform apply in `envs/production`.
- Secure secrets via GitHub Actions secrets or use OIDC to let GitHub Actions assume a role in AWS (recommended).

---

## Example CI/CD flow (high level)

1. Pull request -> run tests + preview build (optional deploy to preview environment using a unique CloudFront path or a per-PR bucket).
2. Merge to `main` -> run tests, build, deploy to staging S3, invalidate CloudFront.
3. After manual QA, run Terraform apply in production and deploy build artifacts to production S3.

Helpful commands for local testing

```bash
# Build locally
npm ci
npm run build

# Sync to AWS (example; requires AWS CLI config or OIDC from CI)
aws s3 sync dist/ s3://<your-bucket> --delete
# Invalidate CloudFront
aws cloudfront create-invalidation --distribution-id <CF_ID> --paths "/*"
```

---

## Security & operational notes

- Always enable S3 encryption (SSE-S3 or SSE-KMS for stricter requirements).
- Block public ACLs on S3 and use CloudFront Origin Access to restrict direct bucket reads.
- Use least-privilege IAM roles for CI, preferably with GitHub Actions OIDC to avoid long-lived credentials.
- Use Terraform state locking and encryption for the remote state bucket.
- Set lifecycle rules for logs and build artifacts to control costs.

---

## Cost guidance

- S3 costs: storage + requests (negligible for small static site).
- CloudFront: CDN costs vary with traffic; small personal projects typically incur under a few dollars a month.
- ACM: certificates are free.
- Terraform remote state S3 + DynamoDB: small, fixed costs.

---

## Recommended first steps (concrete)

1. Create `terraform/` folder with `envs/staging` and a simple `s3-static-site` module. Use the naming pattern `mbm-ui-staging-site`.
2. Configure remote state backend pointing to a new bucket (create this manually or with a short script).
3. Add a GitHub Actions workflow that builds and, on success, uploads `dist/` to the staging S3 bucket and invalidates CloudFront.
4. Create a small `docs/deployment.md` describing deployment steps and how to provision the Terraform backend.

---

## Closing notes

I kept recommendations conservative and low-friction to let you test a staging deployment quickly, then harden for production. If you want, I can:

- Scaffold the `terraform/` directory and create the initial `s3-static-site` module and `envs/staging/main.tf` with a backend config.
- Add a GitHub Actions workflow that builds and deploys to staging (with OIDC role assumption setup instructions).

Tell me whether you'd like me to scaffold Terraform files now (I can generate the TF modules and a CI workflow), and whether you want Route53/ACM included in the first pass or deferred to after staging verification.

---

## Architecture diagrams (Mermaid)

Below are two Mermaid diagrams: the runtime hosting architecture and the Terraform/CI responsibilities. GitHub renders Mermaid blocks in Markdown.

### Runtime AWS architecture

```mermaid
flowchart LR
   subgraph Users
      U[Users (browsers)]
   end

   U -->|HTTPS| CF["CloudFront (CDN)"]
   CF -->|Origin| S3["S3 bucket (site assets)"]
   CF -->|TLS cert| ACM["ACM (us-east-1)"]
   CF -->|WAF (optional)| WAF["AWS WAF"]
   Route["Route53 (optional)"] -->|Alias| CF

   subgraph CI
      GH["GitHub Actions"] -->|build & upload| S3
      GH -->|invalidate| CF
   end

   classDef infra fill:#f9f6ff,stroke:#d7c5e6;
   class CF,S3,ACM,WAF,Route infra;
```

### Terraform / CI responsibilities

```mermaid
flowchart TB
   TF["Terraform codebase (terraform/)"] --> Modules["modules/"]
   Modules --> S3mod["s3-static-site module"]
   Modules --> CFmod["cloudfront module"]
   Modules --> ACMmod["acm module"]
   Modules --> R53mod["route53 module"]

   TF --> Backend["remote state: S3 + DynamoDB"]

   GH["GitHub Actions (CI)"] -->|build| Artifacts["dist/"]
   Artifacts -->|sync| S3
   GH -->|terraform apply (staging)| TF
   GH -->|invalidate| CF

   classDef tf fill:#eef9f2,stroke:#c7e7d3;
   class TF,Modules,Backend tf;
```

If you'd like, I can add these diagrams as separate files (`docs/diagrams/*.md`) or export SVGs for documentation pages.
