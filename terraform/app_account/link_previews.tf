##########################
# Per-recipe link previews (Lambda@Edge)
##########################
# Link-preview crawlers (Messages, Slack, ...) don't run JS, so /recipe/<id> needs its
# og:title/og:image in the HTML itself. An origin-request function on the /recipe/*
# cache behavior (main.tf) fills them in from the public GET /recipes/{id}; on any
# error it falls back to the plain index.html. Code: lambda/preview/app.py.
#
# Lambda@Edge must live in us-east-1 and can't have environment variables, so the
# API URL is packaged as config.json. Note: deleting an edge function only succeeds
# a few hours after it's detached from CloudFront (AWS removes its edge replicas first).

resource "archive_file" "preview_zip" {
  type        = "zip"
  output_path = "${path.module}/dist/preview.zip"

  source {
    content  = file("${path.module}/lambda/preview/app.py")
    filename = "app.py"
  }

  source {
    content = jsonencode({
      api_base    = aws_apigatewayv2_api.http_api.api_endpoint
      site_origin = "https://mealsbymaggie.com"
    })
    filename = "config.json"
  }
}

data "aws_iam_policy_document" "edge_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com", "edgelambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "preview_edge" {
  name               = "mbm-recipe-preview-edge-role"
  assume_role_policy = data.aws_iam_policy_document.edge_assume_role.json
}

# Logs only; it reads the public API and site over HTTPS. Edge logs land in the
# region that served the request, as /aws/lambda/us-east-1.mbm-recipe-preview.
resource "aws_iam_role_policy_attachment" "preview_edge_logs" {
  role       = aws_iam_role.preview_edge.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "recipe_preview" {
  provider         = aws.us_east_1
  filename         = archive_file.preview_zip.output_path
  function_name    = "mbm-recipe-preview"
  role             = aws_iam_role.preview_edge.arn
  handler          = "app.handler"
  runtime          = "python3.12"
  source_code_hash = archive_file.preview_zip.output_base64sha256
  memory_size      = 128
  timeout          = 15 # > two 5s fetches, so the fallback always runs
  # CloudFront needs a numbered version, not $LATEST.
  publish = true
}
