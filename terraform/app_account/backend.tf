terraform {
  required_version = ">= 1.5, < 2.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  backend "s3" {
    # Existing shared state bucket (us-east-1)
    bucket = "tf-state-common-217354297026-us-east-1"
    # Path/key for this project's state
    key    = "mbm-ui/terraform.tfstate"
    region = "us-east-1"

    # If you have a DynamoDB table for state locking, set it here.
    # dynamodb_table = "terraform-locks"
  }
}
