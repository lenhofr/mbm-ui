##########################
# Backend API resources
##########################

# DynamoDB tables for recipes and ratings
resource "aws_dynamodb_table" "recipes" {
  name         = "mbm-recipes"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "recipeId"

  attribute {
    name = "recipeId"
    type = "S"
  }

  tags = {
    Name = "mbm-recipes"
  }
}

resource "aws_dynamodb_table" "ratings" {
  name         = "mbm-ratings"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "ratingId"

  attribute {
    name = "ratingId"
    type = "S"
  }

  tags = {
    Name = "mbm-ratings"
  }
}

# S3 bucket for uploaded images
resource "aws_s3_bucket" "images" {
  bucket        = "mbm-site-images-${random_id.bucket_suffix.hex}"
  force_destroy = false

  tags = {
    Name = "mbm-site-images"
  }

  server_side_encryption_configuration {
    rule {
      apply_server_side_encryption_by_default {
        sse_algorithm = "AES256"
      }
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "images" {
  bucket = aws_s3_bucket.images.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "POST"]
    allowed_origins = ["*"]
    expose_headers  = []
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_public_access_block" "images" {
  bucket = aws_s3_bucket.images.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "images" {
  bucket = aws_s3_bucket.images.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# IAM Role for Lambda functions
resource "aws_iam_role" "lambda_exec" {
  name = "mbm-lambda-exec"

  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# Inline policy granting access to DynamoDB and S3 and CloudWatch logs
resource "aws_iam_policy" "lambda_policy" {
  name   = "mbm-lambda-policy"
  policy = data.aws_iam_policy_document.lambda_policy.json
}

data "aws_iam_policy_document" "lambda_policy" {
  statement {
    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem"
    ]
    resources = [aws_dynamodb_table.recipes.arn, aws_dynamodb_table.ratings.arn]
  }

  statement {
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.images.arn}/*"]
  }

  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["arn:aws:logs:*:*:*"]
  }
}

# Invite codes table (single-use codes)
resource "aws_dynamodb_table" "invites" {
  name         = "mbm-invites"
  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "code"
  range_key = "sk"

  attribute {
    name = "code"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  # Attributes for GSI on email usage queries
  attribute {
    name = "email"
    type = "S"
  }
  attribute {
    name = "usedAt"
    type = "N"
  }

  global_secondary_index {
    name            = "gsi_email"
    hash_key        = "email"
    range_key       = "usedAt"
    projection_type = "ALL"
  }

  tags = {
    Name = "mbm-invites"
  }
}

# Package pre-sign-up auth lambda
resource "archive_file" "auth_zip" {
  type        = "zip"
  output_path = "${path.module}/dist/auth.zip"
  source_dir  = "${path.module}/lambda/auth"
}

# IAM for pre-sign-up lambda (separate from general lambda_exec for least privilege)
resource "aws_iam_role" "pre_signup_role" {
  name               = "mbm-cognito-pre-signup-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_policy" "pre_signup_ddb_policy" {
  name = "mbm-pre-signup-ddb"
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect   = "Allow",
        Action   = ["dynamodb:UpdateItem", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"],
        Resource = aws_dynamodb_table.invites.arn
      },
      {
        Effect   = "Allow",
        Action   = ["dynamodb:TransactWriteItems"],
        Resource = "*"
      },
      {
        Effect = "Allow",
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ],
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "pre_signup_ddb_attach" {
  role       = aws_iam_role.pre_signup_role.name
  policy_arn = aws_iam_policy.pre_signup_ddb_policy.arn
}

resource "aws_lambda_function" "cognito_pre_signup" {
  filename         = archive_file.auth_zip.output_path
  function_name    = "mbm-cognito-pre-signup"
  role             = aws_iam_role.pre_signup_role.arn
  handler          = "pre_sign_up.handler"
  runtime          = "python3.10"
  source_code_hash = archive_file.auth_zip.output_base64sha256

  environment {
    variables = {
      INVITES_TABLE = aws_dynamodb_table.invites.name
    }
  }
}

resource "aws_iam_role_policy_attachment" "lambda_policy_attach" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = aws_iam_policy.lambda_policy.arn
}

# Package and create simple Lambda functions
resource "archive_file" "recipes_zip" {
  type        = "zip"
  output_path = "${path.module}/dist/recipes.zip"
  source_dir  = "${path.module}/lambda/recipes"
}

resource "archive_file" "images_zip" {
  type        = "zip"
  output_path = "${path.module}/dist/images.zip"
  source_dir  = "${path.module}/lambda/images"
}

resource "aws_lambda_function" "recipes_fn" {
  filename         = archive_file.recipes_zip.output_path
  function_name    = "mbm-recipes-fn"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "app.handler"
  runtime          = "python3.10"
  source_code_hash = archive_file.recipes_zip.output_base64sha256

  environment {
    variables = {
      RECIPES_TABLE = aws_dynamodb_table.recipes.name
      RATINGS_TABLE = aws_dynamodb_table.ratings.name
      IMAGES_BUCKET = aws_s3_bucket.images.id
    }
  }
}

resource "aws_lambda_function" "images_fn" {
  filename         = archive_file.images_zip.output_path
  function_name    = "mbm-images-fn"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "app.handler"
  runtime          = "python3.10"
  source_code_hash = archive_file.images_zip.output_base64sha256

  environment {
    variables = {
      IMAGES_BUCKET = aws_s3_bucket.images.id
    }
  }
}

# Authorization is enforced via Cognito JWT authorizer on protected routes.
#########################################
# Cognito: User Pool, App Client, Domain
#########################################

resource "aws_cognito_user_pool" "mbm" {
  name = "mbm-user-pool"

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  # Enable email verification now that SES production access is approved
  auto_verified_attributes = ["email"]

  # Custom attribute to capture invite code
  schema {
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    name                     = "invite"
    required                 = false
    string_attribute_constraints {
      min_length = 1
      max_length = 64
    }
  }

  lambda_config {
    pre_sign_up = aws_lambda_function.cognito_pre_signup.arn
  }

  # Send verification and other emails via SES using our domain
  email_configuration {
    email_sending_account  = "DEVELOPER"
    from_email_address     = "Meals by Maggie <no-reply@mealsbymaggie.com>"
    reply_to_email_address = "hello@mealsbymaggie.com"
    # Use SESv2 domain identity ARN
    source_arn = aws_sesv2_email_identity.mbm_domain.arn
  }

  # Brand the verification email (code option)
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Meals by Maggie verification code"
    email_message        = "Your confirmation code is {####}"
  }
}


resource "aws_cognito_user_pool_client" "spa" {
  name         = "mbm-spa-client"
  user_pool_id = aws_cognito_user_pool.mbm.id

  generate_secret = false

  # Enable SRP (Secure Remote Password) and refresh token flows for embedded login
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  callback_urls = var.cognito_callback_urls
  logout_urls   = var.cognito_logout_urls

  supported_identity_providers  = ["COGNITO"]
  prevent_user_existence_errors = "ENABLED"
}

resource "aws_cognito_user_pool_domain" "mbm" {
  domain       = "mbm-app-${random_id.bucket_suffix.hex}"
  user_pool_id = aws_cognito_user_pool.mbm.id
}

# Allow Cognito to invoke the pre-signup lambda
resource "aws_lambda_permission" "allow_cognito_pre_signup" {
  statement_id  = "AllowCognitoPreSignUp"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cognito_pre_signup.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.mbm.arn
}

# Hosted UI customization (brand look & feel)
resource "aws_cognito_user_pool_ui_customization" "mbm_spa" {
  user_pool_id = aws_cognito_user_pool.mbm.id
  # Tie customization to the SPA client specifically.
  client_id = aws_cognito_user_pool_client.spa.id

  # Keep CSS in a separate file for easier iteration.
  css = file("${path.module}/cognito-ui.css")

  # Optional: add a logo image (PNG/JPG/SVG as base64). Provide a small square/rectangular logo.
  # image_file = filebase64("${path.module}/assets/mbm-logo.png")
}

#########################################
# API Gateway (HTTP API) wiring + CORS
#########################################

resource "aws_apigatewayv2_api" "http_api" {
  name          = "mbm-http-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["content-type", "authorization"]
    max_age       = 3600
  }
}

# Integrations
resource "aws_apigatewayv2_integration" "recipes_integration" {
  api_id           = aws_apigatewayv2_api.http_api.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.recipes_fn.invoke_arn
}

resource "aws_apigatewayv2_integration" "images_integration" {
  api_id           = aws_apigatewayv2_api.http_api.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.images_fn.invoke_arn
}

# Routes
#############################
# Authorizer (Cognito JWT)
#############################

resource "aws_apigatewayv2_authorizer" "cognito_jwt" {
  api_id          = aws_apigatewayv2_api.http_api.id
  authorizer_type = "JWT"
  identity_sources = [
    "$request.header.Authorization"
  ]
  name = "cognito-jwt"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.spa.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.mbm.id}"
  }
}

#########################################
# Routes (split by method: public vs auth)
#########################################

# Recipes
resource "aws_apigatewayv2_route" "recipes_get" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /recipes"
  target    = "integrations/${aws_apigatewayv2_integration.recipes_integration.id}"
}

resource "aws_apigatewayv2_route" "recipes_post" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /recipes"
  target             = "integrations/${aws_apigatewayv2_integration.recipes_integration.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id
}

resource "aws_apigatewayv2_route" "recipes_item_get" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /recipes/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.recipes_integration.id}"
}

resource "aws_apigatewayv2_route" "recipes_item_put" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "PUT /recipes/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.recipes_integration.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id
}

resource "aws_apigatewayv2_route" "recipes_item_delete" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "DELETE /recipes/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.recipes_integration.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id
}

# Ratings
resource "aws_apigatewayv2_route" "ratings_get" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /ratings"
  target    = "integrations/${aws_apigatewayv2_integration.recipes_integration.id}"
}

resource "aws_apigatewayv2_route" "ratings_post" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /ratings"
  target             = "integrations/${aws_apigatewayv2_integration.recipes_integration.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id
}

# Images
resource "aws_apigatewayv2_route" "images_post" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /images"
  target             = "integrations/${aws_apigatewayv2_integration.images_integration.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id
}

resource "aws_apigatewayv2_route" "images_get" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /images/{key+}"
  target    = "integrations/${aws_apigatewayv2_integration.images_integration.id}"
}

# Permissions for API Gateway to invoke Lambda
resource "aws_lambda_permission" "allow_apigw_recipes" {
  statement_id  = "AllowExecutionFromAPIGatewayRecipes"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.recipes_fn.function_name
  principal     = "apigateway.amazonaws.com"
  # Allow all routes on this API to call this Lambda (covers /recipes, /recipes/{id}, /ratings)
  source_arn = "arn:aws:execute-api:${var.aws_region}:${data.aws_caller_identity.current.account_id}:${aws_apigatewayv2_api.http_api.id}/*/*/*"
}

resource "aws_lambda_permission" "allow_apigw_images" {
  statement_id  = "AllowExecutionFromAPIGatewayImages"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.images_fn.function_name
  principal     = "apigateway.amazonaws.com"
  # Allow all routes on this API to call this Lambda (covers /images and /images/{key+})
  source_arn = "arn:aws:execute-api:${var.aws_region}:${data.aws_caller_identity.current.account_id}:${aws_apigatewayv2_api.http_api.id}/*/*/*"
}

# Stage
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = "$default"
  auto_deploy = true
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    # Structured JSON for easier filtering in CloudWatch Logs Insights
    format = jsonencode({
      requestId                    = "$context.requestId"
      requestTime                  = "$context.requestTime"
      sourceIp                     = "$context.identity.sourceIp"
      httpMethod                   = "$context.httpMethod"
      path                         = "$context.path"
      protocol                     = "$context.protocol"
      routeKey                     = "$context.routeKey"
      status                       = "$context.status"
      responseLength               = "$context.responseLength"
      integrationStatus            = "$context.integrationStatus"
      integrationLatency           = "$context.integrationLatency"
      integrationErrorMessage      = "$context.integrationErrorMessage"
      errorMessage                 = "$context.error.message"
      errorResponseType            = "$context.error.responseType"
      authorizerError              = "$context.authorizer.error"
      authorizerIntegrationLatency = "$context.authorizer.integrationLatency"
    })
  }
}

output "http_api_invoke_url" {
  value = aws_apigatewayv2_api.http_api.api_endpoint
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.mbm.id
}

output "cognito_user_pool_client_id" {
  value = aws_cognito_user_pool_client.spa.id
}

output "cognito_domain_prefix" {
  value = aws_cognito_user_pool_domain.mbm.domain
}

output "cognito_oauth_base" {
  value = "https://${aws_cognito_user_pool_domain.mbm.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "cognito_issuer" {
  value = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.mbm.id}"
}

# Convenience: expose the images bucket name
output "images_bucket_name" {
  value = aws_s3_bucket.images.bucket
}

# CloudWatch Log Groups for Lambdas
resource "aws_cloudwatch_log_group" "recipes_lambda_logs" {
  name              = "/aws/lambda/${aws_lambda_function.recipes_fn.function_name}"
  retention_in_days = 14

  tags = {
    ManagedBy = "terraform"
    site      = "mbm"
  }
}

resource "aws_cloudwatch_log_group" "images_lambda_logs" {
  name              = "/aws/lambda/${aws_lambda_function.images_fn.function_name}"
  retention_in_days = 14

  tags = {
    ManagedBy = "terraform"
    site      = "mbm"
  }
}

# CloudWatch Log Group for API Gateway access logs
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/http-api/${aws_apigatewayv2_api.http_api.name}"
  retention_in_days = 30

  tags = {
    ManagedBy = "terraform"
    site      = "mbm"
  }
}

# Allow API Gateway service to put logs into the API Log Group
data "aws_iam_policy_document" "apigw_put_logs" {
  statement {
    sid    = "AllowApiGatewayToPutLogs"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["apigateway.amazonaws.com"]
    }

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]

    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }
}

resource "aws_cloudwatch_log_resource_policy" "apigw_policy" {
  policy_name     = "mbm-apigw-log-policy"
  policy_document = data.aws_iam_policy_document.apigw_put_logs.json
}
