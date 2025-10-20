# Architecture

This document summarizes the app and infrastructure topology for the Meals by Maggie (mbm-ui) project.

## Diagram

```mermaid
flowchart TD
  U[Browser / PWA] -->|HTTPS| CF[CloudFront CDN]

  subgraph Static_Site
    S3Site[(S3 Bucket - Static SPA)]
    CFLogs[(S3 Bucket - CF Logs)]
    OAC[Origin Access Control]
    CF -->|OAC signed S3 GetObject| S3Site
    CF -->|Access logs| CFLogs
    CF -->|Default root index.html<br/>SPA 403/404 -> index.html| S3Site
  end

  subgraph DNS_TLS
    R53[Route53 Hosted Zone<br/>mealsbymaggie.com]
    ACM[ACM Certificate (us-east-1)]
    R53 == A/AAAA alias ==> CF
    ACM -. used by .-> CF
    SES[SES Domain Identity<br/>DKIM + MAIL FROM]
    SES -. DKIM/MAIL FROM records .- R53
  end

  %% API
  U -->|HTTPS (VITE_API_BASE)| APIGW[API Gateway - HTTP API<br/>CORS enabled]
  APIGW -->|JWT Authorizer| COG[Cognito User Pool<br/>SPA App Client]
  COG -->|Pre Sign-Up Trigger| LPre[Lambda: pre-sign-up]
  COG -. email via .- SES

  APIGW -->|Lambda Proxy| LRec[Lambda: recipes]
  APIGW -->|Lambda Proxy| LImg[Lambda: images]

  subgraph Data
    DDBRec[(DynamoDB: recipes)]
    DDBRate[(DynamoDB: ratings)]
    S3Img[(S3 Bucket: images<br/>CORS for PUT/POST)]
    LRec --> DDBRec
    LRec --> DDBRate
    LImg --> S3Img
  end

  %% Observability
  CW[(CloudWatch Logs)]
  APIGW --> CW
  LRec --> CW
  LImg --> CW
```

## Legend and notes
- Static site: SPA assets are served from S3 through CloudFront using an Origin Access Control (OAC). CloudFront maps SPA 403/404 to `index.html` for client-side routing.
- DNS/TLS: Route53 provides apex and `www` aliases to CloudFront. ACM cert (in us-east-1) is attached to CloudFront. SES verifies the sending domain with DKIM and an optional custom MAIL FROM.
- Auth: The SPA uses Cognito (Amplify SRP). A pre-sign-up Lambda validates invite codes in DynamoDB.
- API: API Gateway (HTTP API) fronts Lambdas. Public routes: `GET /recipes`, `GET /recipes/{id}`, `GET /ratings`, `GET /images/{key+}`. Auth-required routes (JWT): `POST /recipes`, `PUT /recipes/{id}`, `DELETE /recipes/{id}`, `POST /ratings`, `POST /images`.
- Images: The images Lambda returns presigned PUT/POST data for uploads and redirects `GET /images/{key}` to a presigned GET URL.
- Observability: Lambdas and API write to CloudWatch Logs. CloudFront logs to a dedicated S3 bucket with lifecycle management.

## File map (where things live)

Terraform (infrastructure)
- CloudFront + site bucket + logs: `terraform/main.tf`
- TLS + aliases + redirect function: `terraform/acm.tf`
- Hosted zone + SES (DKIM/Mail From): `terraform/route53.tf`
- Backend API (DynamoDB, S3 images, IAM, Lambdas, API Gateway, Cognito): `terraform/backend_api.tf`
- S3 static site module: `terraform/modules/s3-static-site/main.tf`
- Lambda handlers: `terraform/lambda/recipes/app.py`, `terraform/lambda/images/app.py`
- Lambda tests (pytest + moto): `terraform/lambda/tests/`

Frontend (application)
- App entry and features: `src/App.tsx`
- Storage adapters (local/remote): `src/lib/storage.ts`
- Amplify/Cognito config: `src/auth/amplify.ts`
- Cognito auth hook: `src/hooks/useCognitoAuth.ts`

## Related docs
- Quickstart & deploy: `README.md`
- Terraform usage and backend state: `terraform/README.md`
- UI features overview: `FEATURES-README.md`
