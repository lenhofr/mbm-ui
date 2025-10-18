# Friends & Family Invite Codes — Implementation Guide

This document is the step-by-step plan to gate new sign-ups behind single-use invite codes while keeping self-service registration. We’ll use an Amazon Cognito Pre Sign-up Lambda trigger that validates codes stored in DynamoDB. This guide covers architecture, infra changes (Terraform), app changes, seeding/ops, testing, deployment, and rollback.

## Goals and constraints
- Only users with a valid invite code can sign up.
- Codes are single-use by default; optionally multi-use or expiring.
- Keep current login and auth flows post sign-up (no code needed to sign in).
- Manage codes without using the AWS Console (CLI or scripts).
- Minimal disruption to existing web and API infra.

## High-level architecture
- Frontend adds an Invite code field to the sign-up form and sends it as a Cognito custom attribute `custom:invite`.
- Cognito User Pool invokes a Pre Sign-up Lambda on each sign-up attempt.
- Lambda checks DynamoDB table `mbm-invites` for the provided code.
  - If the code exists, not revoked, not expired, and unused, mark it used and allow sign-up.
  - Otherwise, throw an error to block sign-up.
- Optional: Reserve in PreSignUp and finalize consumption in PostConfirmation to avoid “burning” codes if users never confirm email.

## Components to add
1. DynamoDB table `mbm-invites` (PAY_PER_REQUEST)
   - Partition key: `code` (String)
   - Attributes we may write/read:
     - `used` (Boolean)
     - `usedAt` (Number, epoch seconds)
     - `usedBy` (String, email)
     - `revoked` (Boolean)
     - `issuedAt` (Number)
     - `expiresAt` (Number) — enable TTL on table if using expirations
2. Lambda function `mbm-cognito-pre-signup` (Python 3.10)
   - Env vars: `INVITES_TABLE`, optional `MASTER_CODE`
   - IAM: read/update the invites table, basic logging
3. Cognito User Pool changes
   - Add custom attribute `invite` (string) to accept form input (`custom:invite`)
   - Wire Pre Sign-up trigger to the Lambda
4. (Frontend) Add Invite code field to sign-up form
   - Use Amplify Authenticator or current sign-up form
   - Pass `custom:invite` as a required attribute
5. (Ops) Code seeding tools
   - CLI one-liners for single code management
   - Node script to generate N random codes in bulk with optional TTL

## Terraform changes (sketch)
Note: We will integrate into existing Terraform in `terraform/`. Names and regions will match your current setup.

- DynamoDB table:
```
resource "aws_dynamodb_table" "invites" {
  name         = "mbm-invites"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "code"

  attribute { name = "code" type = "S" }

  # Optional TTL if using expirations
  # ttl {
  #   attribute_name = "expiresAt"
  #   enabled        = true
  # }

  tags = { Name = "mbm-invites" }
}
```

- Lambda packaging and role:
```
resource "archive_file" "pre_signup_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/auth"
  output_path = "${path.module}/build/pre_sign_up.zip"
}

resource "aws_iam_role" "pre_signup_role" {
  name = "mbm-cognito-pre-signup-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },
      Action   = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "pre_signup_basic" {
  role       = aws_iam_role.pre_signup_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_policy" "pre_signup_ddb_policy" {
  name   = "mbm-pre-signup-ddb"
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect   = "Allow",
      Action   = ["dynamodb:UpdateItem", "dynamodb:GetItem"],
      Resource = aws_dynamodb_table.invites.arn
    }]
  })
}

resource "aws_iam_role_policy_attachment" "pre_signup_ddb_attach" {
  role       = aws_iam_role.pre_signup_role.name
  policy_arn = aws_iam_policy.pre_signup_ddb_policy.arn
}

resource "aws_lambda_function" "cognito_pre_signup" {
  function_name    = "mbm-cognito-pre-signup"
  role             = aws_iam_role.pre_signup_role.arn
  handler          = "pre_sign_up.handler"
  runtime          = "python3.10"
  filename         = archive_file.pre_signup_zip.output_path
  source_code_hash = archive_file.pre_signup_zip.output_base64sha256

  environment {
    variables = {
      INVITES_TABLE = aws_dynamodb_table.invites.name
      # MASTER_CODE = "FRIENDS2025" # optional
    }
  }
}

resource "aws_lambda_permission" "allow_cognito_pre_signup" {
  statement_id  = "AllowCognitoPreSignUp"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cognito_pre_signup.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.mbm.arn
}

# Update existing pool resource:
resource "aws_cognito_user_pool" "mbm" {
  # ...existing config...

  schema {
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    name                     = "invite"
    required                 = false
    string_attribute_constraints { min_length = 1, max_length = 64 }
  }

  lambda_config { pre_sign_up = aws_lambda_function.cognito_pre_signup.arn }
}
```

## Lambda code (sketch)
File: `terraform/lambda/auth/pre_sign_up.py`
```
import os, time, json, boto3
from botocore.exceptions import ClientError

TABLE = os.environ.get('INVITES_TABLE')
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE) if TABLE else None

class Deny(Exception):
    pass

def handler(event, _ctx):
    attrs = (event.get('request') or {}).get('userAttributes') or {}
    email = attrs.get('email') or ''
    code  = attrs.get('custom:invite')
    if not code:
        raise Deny('Missing invite code')

    # Check and consume code atomically
    try:
        now = int(time.time())
        resp = table.update_item(
            Key={'code': code},
            UpdateExpression="SET #u = :true, usedAt = :ts, usedBy = :email",
            ConditionExpression=(
                "attribute_exists(code) AND "
                "(attribute_not_exists(revoked) OR revoked = :false) AND "
                "(attribute_not_exists(used) OR #u = :false) AND "
                "(attribute_not_exists(expiresAt) OR expiresAt > :ts)"
            ),
            ExpressionAttributeNames={'#u': 'used'},
            ExpressionAttributeValues={':true': True, ':false': False, ':ts': now, ':email': email},
            ReturnValues='ALL_NEW',
        )
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise Deny('Invalid, revoked, expired, or already used invite code')
        raise

    event.setdefault('response', {})
    # Optionally: auto-confirm
    # event['response']['autoConfirmUser'] = True
    return event
```

## Frontend changes
- File(s): likely `src/components/LoginModal.tsx` (or wherever your sign-up form is rendered via Amplify Authenticator).
- Add a required form field for `custom:invite` and include it in `signUpAttributes`/`formFields` config.
- Basic example:
```
<Authenticator
  signUpAttributes={["email"]}
  formFields={{
    signUp: {
      'custom:invite': {
        label: 'Invite code',
        placeholder: 'Enter invite code',
        isRequired: true,
        order: 1,
      },
      email: { order: 2 },
      password: { order: 3 },
      confirm_password: { order: 4 },
    },
  }}
/>
```

## Seeding and managing codes
You do not need the AWS Console. Use CLI or a Node script.

Single-table seed examples (current model)

- Single-use:
```
aws dynamodb put-item --region us-east-1 --table-name mbm-invites --item '{"code":{"S":"FNF-ALICE-001"},"sk":{"S":"META"},"maxUses":{"N":"1"},"uses":{"N":"0"},"issuedAt":{"N":"'"$(date +%s)"'"}}'
```

- Multi-use (25 uses):
```
aws dynamodb put-item --region us-east-1 --table-name mbm-invites --item '{"code":{"S":"FNF-BETA-25"},"sk":{"S":"META"},"maxUses":{"N":"25"},"uses":{"N":"0"},"issuedAt":{"N":"'"$(date +%s)"'"}}'
```

- Unlimited:
```
aws dynamodb put-item --region us-east-1 --table-name mbm-invites --item '{"code":{"S":"FNF-MASTER"},"sk":{"S":"META"},"unlimited":{"BOOL":true},"uses":{"N":"0"},"issuedAt":{"N":"'"$(date +%s)"'"}}'
```

- Revoke:
```
aws dynamodb update-item --region us-east-1 --table-name mbm-invites --key '{"code":{"S":"FNF-MASTER"},"sk":{"S":"META"}}' --update-expression "SET revoked = :t" --expression-attribute-values '{":t":{"BOOL":true}}'
```

Bulk seeding script: `scripts/seed-invites.mjs` (Node, AWS SDK v3)
- Generates N secure random codes as META items (defaults to single-use), optional TTL, batch-writes (25 at a time), prints codes.
- Example run:
```
TABLE=mbm-invites COUNT=50 PREFIX=FNF CODE_LEN=8 TTL_DAYS=30 AWS_REGION=us-east-1 node scripts/seed-invites.mjs
```

Using the npm script
- You can run the same script via npm:
```
npm run invites:seed
```

- With overrides (zsh/macOS):
```
AWS_REGION=us-east-1 TABLE=mbm-invites COUNT=25 PREFIX=FNF CODE_LEN=8 TTL_DAYS=14 npm run invites:seed
```

Notes
- The script prints the generated codes to stdout; copy and distribute them securely.
- By default it creates single-use codes (maxUses=1). For multi-use or unlimited codes, use the CLI examples above to set maxUses or unlimited explicitly (we can extend the script to accept MAX_USES/UNLIMITED if desired).

## Testing checklist
- Unit test Lambda locally with sample events (valid, invalid, used, revoked, expired, missing code).
- Deploy to a dev stack; attempt sign-up without a code → should fail.
- Attempt with valid code → should succeed; verify item marked `used` with `usedBy` and `usedAt`.
- Retry with same code → should fail.
- Try revoked/expired code → should fail with clear message.
- Confirm normal sign-in flow doesn’t require a code.

## Deployment steps (high level)
1. Merge Terraform changes and Lambda code into `terraform/`.
2. `terraform init && terraform apply` to create table, Lambda, and wire trigger.
3. Add frontend form field and deploy the SPA.
4. Seed initial invite codes (CLI or script) and distribute to testers securely.
5. Validate on Test/Preview environment; then roll to Production.

## Email verification sender notes
- Cognito verification emails are configured to send via SES from `no-reply@mealsbymaggie.com`. Terraform manages the SES domain identity, DKIM, and optional MAIL FROM DNS in `terraform/route53.tf` and wires Cognito in `terraform/backend_api.tf`.
- DNS changes can take time to propagate; SES must show the domain as verified before Cognito will send using it. Until then, emails may appear from the default amazonses.com address.
- New SES accounts are in the sandbox and can only send to verified recipients. If you need to email arbitrary users, request production access in SES or temporarily verify recipient emails for testing.

## Rollback and kill switches
- To pause sign-ups immediately: remove/detach PreSignUp trigger or set a `BLOCK_SIGNUP` env var and check it in Lambda to deny all.
- To revert infra: `terraform apply` with previous state, or comment out trigger and re-apply.
- To re-enable public sign-up later: keep trigger but allow a new “public” code type, or remove trigger entirely.

## Observability and ops
- CloudWatch Logs for Lambda: monitor errors and code consumption.
- Consider metrics: count of successful sign-ups, code failures, and unknown codes.
- Periodic report: scan for remaining unused codes or near-expiry.

## Security considerations
- Use high-entropy codes (8–12+ chars mixed alphanumerics).
- Optionally store hashed codes (e.g., SHA-256 of code) and compare the hash in Lambda.
- Least-privilege IAM for Lambda (only update/get on the single table ARN).
- Avoid leaking error details to attackers; use generic failure messages in UI.

## Acceptance criteria
- Sign-up without an invite code is blocked.
- Sign-up with a valid unused code succeeds and marks code used.
- Subsequent attempts with the same code are blocked.
- Codes manageable via CLI or seed script without AWS Console.
- Clear runbook to pause or expand access during the F&F phase.
