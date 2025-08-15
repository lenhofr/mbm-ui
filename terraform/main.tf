locals {
  bucket_name = "mqm-ui-infra-217354297026"
}

module "site" {
  source      = "./modules/s3-static-site"
  bucket_name = local.bucket_name
}
