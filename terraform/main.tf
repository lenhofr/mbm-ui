provider "aws" {
  region = var.region
}

module "site" {
  source      = "./modules/s3-static-site"
  bucket_name = var.bucket_name
}
