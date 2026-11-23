# Monthly alert on Bedrock spend in this account (mbm-ui recipe import, plus jf-com's
# drafts). A budget only emails; it doesn't stop spending, and billing data lags by hours.
# Normal use is a dollar or two: a front+back card scan costs about $0.03.
resource "aws_budgets_budget" "bedrock_monthly" {
  name         = "bedrock-monthly"
  budget_type  = "COST"
  limit_amount = "20"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Kimi and other models AWS sells itself bill as "Amazon Bedrock". Anthropic models are
  # sold through AWS Marketplace and bill under their own service name.
  cost_filter {
    name = "Service"
    values = [
      "Amazon Bedrock",
      "Claude Sonnet 4.6 (Amazon Bedrock Edition)",
    ]
  }

  # Early warning: $5 is well above a normal month.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 5
    threshold_type             = "ABSOLUTE_VALUE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
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
