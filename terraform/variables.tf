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
