variable "bucket_name" {
  description = "Name for the static site S3 bucket"
  type        = string
  default     = "mqm-ui-infra-217354297026"
}

variable "aws_region" {
  description = "AWS region to deploy resources in"
  type        = string
  default     = "us-east-1"
}

variable "cognito_callback_urls" {
  description = "Allowed OAuth callback URLs"
  type        = list(string)
  default     = ["http://localhost:5173/", "https://mealsbymaggie.com/", "https://www.mealsbymaggie.com/"]
}

variable "cognito_logout_urls" {
  description = "Allowed OAuth logout URLs"
  type        = list(string)
  default     = ["http://localhost:5173/", "https://mealsbymaggie.com/", "https://www.mealsbymaggie.com/"]
}


# Set from the BUDGET_ALERT_EMAIL repo secret in CI (TF_VAR_budget_alert_email). Sensitive
# so plans posted as PR comments on this public repo don't print it.
variable "budget_alert_email" {
  description = "Email address for the Bedrock budget alerts"
  type        = string
  sensitive   = true
}
