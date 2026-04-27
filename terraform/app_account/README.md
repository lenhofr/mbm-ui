Terraform — quick start and safety notes

This file documents how to use the `terraform/envs/staging` configuration in this repo, how to configure the remote S3 backend (your existing shared bucket), and how to run plan/apply locally for development.

1) Backend

We already include a backend configuration in `terraform/envs/staging/backend.tf` that points at the shared S3 bucket in us-east-1:

- bucket: `tf-state-common-217354297026-us-east-1`
- key: `mbm-ui/staging/terraform.tfstate`
- region: `us-east-1`

Don't commit any secrets into the repo. If you need a DynamoDB table for state locking, create it and set `dynamodb_table` in `backend.tf`.

2) Local prerequisites

- Terraform CLI (recommended >= 1.5.x)
- AWS CLI configured with credentials that have permissions to read/write the S3 backend and manage resources created by the TF configs.

3) Configure local environment

Set the AWS environment variables (example for macOS / zsh):

```bash
export AWS_ACCESS_KEY_ID=YOUR_KEY
export AWS_SECRET_ACCESS_KEY=YOUR_SECRET
export AWS_REGION=us-east-1
```

If you prefer AWS profiles, ensure `AWS_PROFILE` is set and the profile has the right permissions.

4) Initialize & run plan (local)

Change to the staging env and run:

```bash
cd terraform/envs/staging
terraform init
terraform plan -out=tfplan
terraform show -no-color tfplan > plan.txt
```

- `terraform init` will configure the S3 backend (it will prompt you to migrate local state if you previously had local state).
- `terraform plan` writes an on-disk plan. `plan.txt` is a shareable plain text snapshot of the diff.

5) Apply locally (manual)

If you're satisfied with the plan, run:

```bash
terraform apply tfplan
```

This is intentionally manual here — the repository CI may run automated applies on `main` based on your settings.

6) Safety options (recommended but not implemented automatically)

- Make `terraform apply` manual in CI (prefer `workflow_dispatch`) and require human approval in production.
- Require a label (e.g., `infra-apply`) on the PR to permit an automated apply.
- Use branch protection on `main` so apply only runs after required checks pass.
- Use GitHub OIDC + a short-lived role for the CI runner instead of long-lived access keys.
- Enable DynamoDB state locking for the S3 backend to prevent concurrent runs in CI.
- Have a separate non-prod staging workspace and a production workspace with different state keys.

7) Troubleshooting

- If `terraform init` prompts to migrate state, verify the current remote bucket and key are correct before proceeding.
- If a plan fails due to permissions, confirm your AWS credentials have permission for the resources Terraform will manage and for the S3 backend.

8) Local iteration pattern

- Make changes to the TF module or envs.
- Run `terraform fmt -check -recursive`.
- Run `terraform init && terraform plan -out=tfplan` and inspect `plan.txt`.
- When satisfied, `terraform apply tfplan` (or let CI apply if configured).

If you'd like, I can add a small `scripts/` helper to run these commands consistently and a short `terraform/variables.example.tfvars` file that shows required variable names without secrets.
