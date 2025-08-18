Purpose
-------
This note captures the current workspace state, how to resume development, quick verification commands, and prioritized next steps for the RecipeStorage work (branch: `RecipeStorage`). Use this to pick up work in a few days without losing context.

Important context
-----------------
- Branch: `RecipeStorage`
- Last focused area: wiring frontend to the new backend API (presigned S3 image upload + API GET proxy) and keeping storage adapter compatible with remote API.
- Note: You made manual edits to `terraform/backend_api.tf` after the last session — double-check that file before running any Terraform `apply`.

Files you should know about (recent/important)
-----------------------------------------------
Frontend
- `src/components/DetailsModal.tsx` — presigned upload flow: POST `/images` to get a presigned PUT URL, upload file directly, and save returned `url` or API GET key path.
- `src/components/RecipeList.tsx` — resolves `image` field to `${REACT_APP_API_BASE}/images/{key}` when the image looks like a key (no HTTP scheme).
- `src/components/CookModal.tsx` — same image GET-proxy logic as `RecipeList`.
- `src/lib/storage.ts` — remote adapter uses `REACT_APP_API_BASE` when set.

Backend & infra
- `terraform/` — contains the Terraform configuration for S3, DynamoDB, Lambda, API Gateway, IAM, CloudWatch. You modified `terraform/backend_api.tf` manually; review before applying.
- `terraform/lambda/recipes/app.py` — Python Lambda for recipe CRUD and ratings.
- `terraform/lambda/images/app.py` — Python Lambda that returns presigned PUT URLs (POST /images) and presigned GET or proxied GET support.
- `terraform/lambda/tests/` — pytest + moto unit tests for Lambdas (run locally in a virtualenv).

How to resume (zsh-ready commands)
----------------------------------
1) Checkout branch and sync

```bash
cd /Users/robl/dev/static/mbm-ui
git checkout RecipeStorage
git pull --ff-only
```

2) Install frontend dependencies (npm)

```bash
npm install
```

3) Run frontend unit tests (vitest)

```bash
npm test
```

4) Start the dev server with API integration
- Replace the placeholder with your API Gateway base URL (no trailing slash):

```bash
export REACT_APP_API_BASE="https://YOUR_API_BASE"
npm run dev
```

Open the displayed Vite URL (usually http://localhost:5173).

5) Re-run Python Lambda unit tests (optional)

```bash
cd terraform/lambda
python3 -m venv .venv
source .venv/bin/activate
pip install boto3 moto pytest
pytest -q
```

If you have a `requirements.txt` in `terraform/lambda`, prefer `pip install -r requirements.txt`.

6) Terraform (inspect only unless you intend to change infra)

```bash
cd terraform
terraform init
terraform plan
# run terraform apply only if you intend to change infra and you have confirmed the manual edits to backend_api.tf
```

Quick smoke test (manual)
-------------------------
- Start the frontend with `REACT_APP_API_BASE` set (see step 4).
- Create a recipe in the UI, attach an image in DetailsModal, save.
- Confirm the image displays in the list and cook modal.
- Check the S3 bucket (Console or `aws s3 ls`) for the object.
- Inspect CloudWatch logs for the images/recipes Lambdas for any errors.

Troubleshooting tips
--------------------
- If image upload fails, `DetailsModal` currently falls back to the data-URL preview and saves the recipe; check browser console for upload errors.
- If tests fail after edits, run `npm run build` to catch TypeScript issues then `npm test`.
- Before running `terraform apply`, inspect `terraform/backend_api.tf` because you edited it manually — ensure providers, region, and resource names are correct and credentials are configured.

Prioritized next steps (pick one)
---------------------------------
1) Add unit tests for `DetailsModal` to mock POST `/images` and the S3 PUT to verify the upload flow and fallback behavior.
2) Improve UX: show upload progress and explicit error messages in `DetailsModal` if presigned upload fails.
3) Harden presign flow: validate shape of JSON returned from POST `/images`, retry transient errors, and expose errors to the UI.
4) Centralize image URL resolution into a helper in `src/lib` to avoid duplicated logic across components.
5) Add CI step to run frontend tests, Python Lambda tests, and terraform fmt/check.

Notes & assumptions
-------------------
- No live API URL is embedded here. Set `REACT_APP_API_BASE` before running the dev server if you want to integrate with the deployed backend.
- The workspace uses npm for local commands; pnpm is optional but not required.
- Lambda tests rely on `moto` and a Python virtualenv.

If you'd like, I can: add a minimal unit test for `DetailsModal` now, or implement a `HELP.md` with more developer-oriented troubleshooting commands (CloudWatch queries, AWS CLI snippets). Say which and I'll implement it.

Quick-mitigations: TODOs & rollback (important)
------------------------------------------------
We applied short-term mitigations (shared-secret header and shorter S3 presign TTL) to reduce public abuse. These are temporary and must be rolled back when you implement the proper long-term solution (Cognito/JWT authorizer + WAF). Below are exact files and Terraform resources touched and step-by-step rollback instructions.

What we changed (temporary)
- Code (repo):
	- `terraform/lambda/recipes/app.py` — added a quick check for header `x-api-key` against `API_SHARED_SECRET` (TODO: remove when proper auth added).
	- `terraform/lambda/images/app.py` — added same header check and reduced presign `ExpiresIn` from 3600 -> 300 seconds.
- Terraform (infra):
	- `terraform/backend_api.tf` — injected `API_SHARED_SECRET = random_password.api_secret.result` into Lambda environment variables and added creation of `random_password.api_secret`.
	- Terraform was applied, which created `random_password.api_secret` and updated both Lambdas in-place to use the new env var and new code bundles.

Why this is temporary
- The shared-secret header is a stopgap (security-by-obscurity) and should never replace proper auth. Presign TTLs were shortened to limit exposure, but attackers still can get upload URLs while the secret is compromised.

Rollback checklist (what to revert)
1) Code changes to remove quick auth and restore original presign TTLs:
	 - `terraform/lambda/recipes/app.py` — remove the `x-api-key` header check block and its TODO comment.
	 - `terraform/lambda/images/app.py` — remove `x-api-key` header check block, restore `ExpiresIn` values to 3600 (or desired original), and remove TODO.
2) Terraform changes to remove the random secret and env var injection:
	 - `terraform/backend_api.tf` — remove the `random_password "api_secret"` resource and remove `API_SHARED_SECRET = random_password.api_secret.result` from the Lambda `environment.variables` blocks.

Safe rollback steps (recommended sequence)
1) Create a local branch for the rollback work and commit any current local changes:

```bash
cd /Users/robl/dev/static/mbm-ui
git checkout -b rollback-quick-auth
git add -A
git commit -m "wip: checkpoint before rollback" || true
```

2) Revert the handler code changes (two options):
- If you have the previous commit that contained the original handler files, revert that commit (recommended):

```bash
# find the commit hash where those files were changed, then:
git revert <commit-hash> -n   # revert but do not commit yet
git add terraform/lambda/recipes/app.py terraform/lambda/images/app.py
git commit -m "revert: remove quick header-check and restore presign TTLs"
```

- If you don't have a revertable commit, manually edit the two files and remove the header-check blocks and restore `ExpiresIn` to 3600, then commit.

3) Revert the terraform changes to remove the `random_password` and env var references:

```bash
# edit terraform/backend_api.tf to remove the random_password resource and the API_SHARED_SECRET lines
git add terraform/backend_api.tf
git commit -m "revert: remove temporary API_SHARED_SECRET random resource and env var"

cd terraform
terraform init
terraform plan   # review the plan carefully
terraform apply  # this will update Lambdas in-place and remove the random_password resource
```

Alternative (targeted destroy):
- If you want to delete only the generated random secret resource first without changing files, you can run (from `terraform` folder):

```bash
terraform destroy -target=random_password.api_secret
```

but you'll still need to remove the env var references in `backend_api.tf` and update the Lambda handlers' code to remove checks; otherwise the lambdas will expect a secret and reject requests.

4) Confirm changes and re-deploy code bundles if needed
- After the terraform apply completes, verify lambdas are updated and accept unauthenticated requests only if you intend that (or better, that the proper authorizer is in place).

Verification and cleanup
- Check Terraform state & outputs:

```bash
terraform output
```

- Confirm Lambda behavior with curl (once secret removed):

```bash
curl -i https://<http_api>/recipes
```

Notes / TODO (for the long-term auth work)
- TODO: Replace shared-secret + manual IP blocks with Cognito (or OIDC) and attach a JWT authorizer to HTTP API routes.
- TODO: Add AWS WAF with rate-based rules in front of the HTTP API to throttle high request rates and block suspicious sources.
- TODO: Add request schema validation and size limits in Lambda code to reject oversized payloads.
- TODO: Add CloudWatch Alarms and Billing budgets for DynamoDB write spikes and S3 PutObject spikes.

Keep this section until proper auth and WAF are implemented; remove it only after long-term mitigations are in place and tested.
