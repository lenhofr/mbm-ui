provider "aws" {
  region = var.aws_region

  # Recommended modern defaults
  default_tags {
    tags = {
      ManagedBy = "terraform"
    }
  }
}

# Provider alias for resources that must live in us-east-1 (CloudFront ACM certificates)
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      ManagedBy = "terraform"
    }
  }
}