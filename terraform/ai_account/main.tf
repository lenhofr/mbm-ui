# Cross-account IAM role that the mbm-recipes Lambda (in account 217354297026) assumes
# to call Bedrock. Only the Lambda's execution role is trusted — no other principal can assume this.
resource "aws_iam_role" "bedrock_access" {
  name = "mbm-bedrock-access"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = var.app_lambda_role_arn }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "bedrock_invoke" {
  name = "mbm-bedrock-invoke"
  role = aws_iam_role.bedrock_access.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "bedrock:InvokeModel"
      Resource = "*"
    }]
  })
}

# Monthly cost budget for Bedrock usage in this account.
# Alerts at 80% of actual spend and 100% of forecasted spend.
# Adjust limit_amount to suit expected usage (~$0.01-0.03 per recipe import).
resource "aws_budgets_budget" "bedrock_monthly" {
  name         = "mbm-bedrock-monthly"
  budget_type  = "COST"
  limit_amount = "10"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "Service"
    values = ["Amazon Bedrock"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}
