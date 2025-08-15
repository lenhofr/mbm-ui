terraform {
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
