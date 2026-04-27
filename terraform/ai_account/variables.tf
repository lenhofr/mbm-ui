variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "app_lambda_role_arn" {
  description = "ARN of the mbm-recipes Lambda execution role in the app account (217354297026)"
  type        = string
  default     = "arn:aws:iam::217354297026:role/mbm-lambda-exec"
}

variable "budget_alert_email" {
  description = "Email address to receive Bedrock cost budget alerts"
  type        = string
  default     = "r.lenhof@gmail.com"
}
