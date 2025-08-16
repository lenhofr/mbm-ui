# GitHub Actions → AWS OIDC (notes & plan)

Status
------
This document captures a recommended migration plan from long-lived AWS secrets in GitHub Actions to using GitHub OIDC (short-lived credentials via sts:AssumeRoleWithWebIdentity).

Goal
----
- Remove AWS access keys from GitHub Secrets (reduce blast radius).
- Use tightly-scoped IAM roles with OIDC trust conditions limited to this repository and branch/workflow where practical.
- Use one role for Terraform (plan/apply) and a narrower role for deployment (S3 sync + CloudFront invalidation).

Checklist
---------
- [ ] Create / verify IAM OIDC provider for token.actions.githubusercontent.com in the AWS account.
- [ ] Create IAM role(s) with a trust policy referencing the OIDC provider and repo-specific `sub` conditions.
- [ ] Attach least-privilege policies: `terraform-role` (Terraform needs) and `deploy-role` (S3 + CloudFront).
- [ ] Update GitHub Actions workflows to set `role-to-assume` in `aws-actions/configure-aws-credentials` steps.
- [ ] Test with `workflow_dispatch` or a temporary test branch. Validate in CloudTrail.
- [ ] Remove AWS secrets from repo when testing is complete and confident.

Quick CLI steps (one-time)
-------------------------
1. Check for existing provider:

```bash
aws iam list-open-id-connect-providers
```

2. Create provider (if missing):

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

Note: verify the current thumbprint from AWS docs when you run this.

IAM trust policy examples
-------------------------
- Minimal trust policy scoped to this repository branch (`main`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:OWNER/REPO:ref:refs/heads/main"
        },
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
```

- Allow all branches for the repo (use cautiously): `repo:OWNER/REPO:ref:refs/heads/*`.

Permission policy sketches
-------------------------
- Deploy-role (S3 sync + CloudFront invalidation):

```json
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Effect":"Allow",
      "Action":[
        "s3:ListBucket",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource":[
        "arn:aws:s3:::YOUR_SITE_BUCKET",
        "arn:aws:s3:::YOUR_SITE_BUCKET/*"
      ]
    },
    {
      "Effect":"Allow",
      "Action":[
        "cloudfront:CreateInvalidation",
        "cloudfront:GetDistribution",
        "cloudfront:GetDistributionConfig"
      ],
      "Resource":"*"
    }
  ]
}
```

- Terraform-role: harder to pin down. For initial rollout you can attach managed policies for the resources Terraform controls (S3, CloudFront, Route53, ACM), then refine to a custom least-privilege policy once you observe which actions are used.

Terraform-managed role (Terraform example)
-----------------------------------------
Example Terraform snippet that creates an OIDC provider, a role, and attaches a policy (conceptual — replace placeholders):

```hcl
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "github_assume_role" {
  statement {
    effect = "Allow"
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    actions = ["sts:AssumeRoleWithWebIdentity"]

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:OWNER/REPO:ref:refs/heads/main"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "gh_actions_role" {
  name               = "gh-actions-role-mbm-ui"
  assume_role_policy = data.aws_iam_policy_document.github_assume_role.json
}

resource "aws_iam_policy" "deploy_policy" {
  name   = "gh-actions-deploy-policy"
  policy = file("policies/gh-actions-deploy.json")
}

resource "aws_iam_role_policy_attachment" "deploy_attach" {
  role       = aws_iam_role.gh_actions_role.name
  policy_arn = aws_iam_policy.deploy_policy.arn
}
```

Workflow snippet (replace secret method)
--------------------------------------
Replace the secret-based configure step with a `role-to-assume` call:

```yaml
- name: Configure AWS credentials via OIDC
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::ACCOUNT_ID:role/gh-actions-role-mbm-ui
    aws-region: ${{ env.AWS_REGION }}
```

Notes on role separation
------------------------
- Use a `terraform-role` that Terraform jobs assume (it may need broad privileges depending on resources). Limit to the repo and branch used for apply.
- Use a `deploy-role` for build/deploy jobs (S3 + CloudFront). This role can be very narrow.
- Keep plan-only jobs read-only. In PRs run `terraform plan` and comment (no `apply`).

Testing & cutover steps
----------------------
1. Create roles and trust policies in AWS (Terraform or CLI).
2. Update the GitHub workflow(s) to set `role-to-assume` for the jobs.
3. Trigger a `workflow_dispatch` or a test branch run to verify the role is assumed and operations succeed.
4. Inspect CloudTrail to confirm the assumed role is used, not a long-lived credential.
5. When satisfied, remove AWS access key secrets from repository.

Risks & recommendations
-----------------------
- Principle of least privilege: start narrow, iterate. Terraform may need broader permissions initially.
- Keep separate roles for plan, apply, and deploy to reduce risk.
- Use repo+ref scoping in trust policy to avoid cross-repo token reuse.
- Document roles and required policies so future maintainers can reason about changes.

References
----------
- AWS docs: Configure web identity federation to AWS using GitHub Actions (OIDC)
- GitHub docs: About OIDC provider and token.actions.githubusercontent.com

Appendix: example IAM actions frequently required by Terraform
-----------------------------------------------------------
- s3:CreateBucket, s3:PutBucketPolicy, s3:PutObject, s3:GetObject, s3:ListBucket
- cloudfront:CreateDistribution, cloudfront:UpdateDistribution, cloudfront:CreateInvalidation
- route53:ChangeResourceRecordSets, route53:GetChange
- acm:RequestCertificate, acm:DescribeCertificate, acm:DeleteCertificate

---
This document is a snapshot of a recommended approach; adapt to your team's policies and AWS account structure.
