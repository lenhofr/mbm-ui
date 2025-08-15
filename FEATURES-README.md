Meals by Maggie — Features & Deployment Notes

This short, focused README summarizes the new UI features (search + cook view) added to the `mbm-ui` repo and provides practical notes for making the code robust for future remote storage and AWS hosting.

Quick feature summary

- Search
  - Debounced fuzzy search (Fuse.js) across title, description, tags, ingredients, and instructions.
  - Tokenized queries: support for `tag:<term>` and `ing:<term>` tokens to scope searches.
  - Tag autocomplete: when typing `tag:` the UI shows a suggestion dropdown (keyboard navigation: ArrowUp/ArrowDown, Enter to accept, Esc to close).
  - Clear search button and keyboard shortcut (Ctrl/Cmd+K) to focus the search input.
- Cook mode
  - Read-only, printer-friendly cook modal for step-by-step cooking instructions.
  - Keyboard-friendly: modals have keyboard shortcuts and focus mechanics (Esc to close).

Where to look in code

- `src/App.tsx` — main app, search handling, tag suggestions and keyboard shortcut, Fuse.js usage.
- `src/components/RecipeList.tsx` — renders the recipe cards and highlighting (search matches).
- `src/components/CookModal.tsx` — read-only cook view and print styles.
- `src/styles.css` — UI styles including the tag suggestion dropdown.

Local dev & tests

- Start dev server: `npm run dev` (Vite)
- Run tests: `npm test` (Vitest)

Preparing for remote storage and AWS hosting

Goals: allow the app to later store recipes/images remotely (S3, DynamoDB) and run reliably behind a CDN.

Design considerations and recommended changes

1) Decouple data layer from UI
   - Introduce a simple data access module (e.g. `src/lib/storage.ts`) that exports async functions: `listRecipes()`, `getRecipe(id)`, `createRecipe(r)`, `updateRecipe(id,r)`, `deleteRecipe(id)`.
   - For now implement a local adapter (in-memory or localStorage). Later implement an AWS adapter that calls API endpoints.
   - Keep components unaware of storage details: they should call the storage API and handle promise results.

2) Use an API backend (short-term: Lambda + API Gateway)
   - Build small REST endpoints for recipes and image uploads. Use Lambda functions (Node/Python) behind API Gateway.
   - For uploads, generate presigned S3 URLs on the backend; the frontend uploads directly to S3.

3) Image uploads and hosting
   - Use a separate S3 bucket for images with proper lifecycle rules and SSE enabled.
   - Use presigned PUT URLs from the backend to avoid exposing write credentials.

4) Idempotency, retries, and optimistic UI
   - For remote writes, implement retries with exponential backoff on transient network failures.
   - Use optimistic UI updates with local rollback on failure.

5) Offline & local-first behavior
   - Continue to support localStorage as a fallback and for offline editing.
   - Consider a background sync worker to reconcile local changes with remote store.

6) Authentication & per-user storage
   - If recipes will be per-user, integrate Amazon Cognito or another auth provider.
   - Protect backend endpoints with JWT scopes / Cognito authorizers.

7) Security and least privilege IAM
   - Backend services (Lambda) should have least-privilege IAM roles.
   - Use S3 bucket policies and CloudFront origin access (OAC/OAI) to restrict access.

8) Observability and monitoring
   - Add CloudWatch logs/metrics for Lambda.
   - Configure S3 access logs and CloudFront logging.

9) Infrastructure as Code
   - Use Terraform to provision S3, CloudFront, ACM, Route53, API Gateway, and DynamoDB.
   - Keep remote state in an S3 bucket with DynamoDB locking.

Quick checklist for an AWS-hosted plan

- [ ] Create backend API to expose recipe CRUD and presigned uploads.
- [ ] Implement `src/lib/storage.ts` interface and swap local adapter for remote adapter.
- [ ] Prepare CORS policy on API Gateway for the SPA origin.
- [ ] Configure S3 buckets with encryption, versioning, and lifecycle rules.
- [ ] Provision CloudFront distribution with ACM TLS certificate.
- [ ] Add CI to build and deploy `dist/` to S3 and invalidate CloudFront cache.

How I validated the codebase now

- Ran unit tests: `npm test` — all tests passed locally in this session.
- TypeScript checked (`npx -y tsc --noEmit`) — no type errors.

Next small improvements I can implement quickly

- Add `src/lib/storage.ts` local adapter, plus a stub remote adapter and an env switch.
- Add Playwright smoke test that confirms search + tag-suggestion UI works end-to-end (script scaffolded at `scripts/screenshot-dropdown.mjs`).
- Add CI job entry in `.github/workflows/` for tests and a build step.

If you want, I can scaffold the `src/lib/storage.ts` adapter and the Terraform skeleton next. Let me know which you prefer.
