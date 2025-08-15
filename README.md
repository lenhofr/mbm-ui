# mbm-ui
Meals by Maggie UI SPA app

Here’s a high-level plan to deploy a Single Page Application (SPA) for storing recipes, pictures, and ratings on AWS using S3, CloudFront, and Lambda:

1. Frontend (SPA)
Framework: Use React, Vue, Angular, or plain HTML/JS.
Deployment: Host static files (HTML, JS, CSS, images) on an S3 bucket.
Setup: Make the S3 bucket public for read access or use CloudFront to serve the content securely.
2. CloudFront
Use CloudFront as a CDN to distribute your SPA globally.
Connect CloudFront to your S3 bucket.
(Optional) Configure error handling to serve index.html for all routes (important for SPAs with client-side routing).
3. Backend (API)
Lambda Functions: Use AWS Lambda (with API Gateway) to provide backend endpoints for:

Storing/retrieving recipes
Storing/retrieving ratings
Handling image uploads (store images in another S3 bucket)
API Gateway: Set up REST or HTTP endpoints to trigger Lambda functions.

4. Data Storage
Recipes/Ratings: Use DynamoDB or another AWS database for storing structured data.
Images: Store images in an S3 bucket.
5. Authentication (Optional)
Use Amazon Cognito for user authentication (sign up, sign in, etc.).
6. Deployment Flow
Build your SPA locally.
Upload the build artifacts to the S3 bucket.
Invalidate the CloudFront cache to ensure new content is served.
Set up Lambda/API Gateway for backend.
Connect your frontend app to the backend endpoints.
Sample Architecture Diagram

```
[Browser] 
   | 
   v
[CloudFront CDN] 
   |
   v
[S3 Bucket (SPA files)]   [API Gateway]---->[Lambda Functions]---->[DynamoDB (Data)]
                                 | 
                                 v
                      [S3 Bucket (Images)]
```