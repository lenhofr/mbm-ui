# Custom Welcome + Verification Email Implementation Plan

## Overview

This document outlines the implementation plan for **Option B**: Replacing Cognito's built-in verification email with a single, beautifully branded email that combines both email verification AND welcome messaging with full personalization.

## Current State vs Target State

### Current State (Option A - Two Emails)
1. **Verification Email**: Basic Cognito template from `no-reply@mail.mealsbymaggie.com`
2. **Welcome Email**: (Not implemented) Would be sent via Post Confirmation trigger

### Target State (Option B - Single Email)
1. **Combined Email**: Beautiful branded verification + welcome email from `welcome@mail.mealsbymaggie.com` with user's actual nickname

## Implementation Plan

### Phase 1: Create Custom Message Lambda

#### 1.1 Lambda Function (`terraform/lambda/auth/custom_message.py`)

```python
import json
import boto3
import os

def handler(event, context):
    """
    Custom Message trigger - replace Cognito's verification email with branded version
    """
    
    trigger_source = event['triggerSource']
    
    # Only customize verification emails
    if trigger_source != 'CustomMessage_SignUp':
        return event
    
    # Extract user info
    user_attributes = event['request']['userAttributes']
    email = user_attributes.get('email')
    nickname = user_attributes.get('nickname', user_attributes.get('given_name', 'there'))
    code_parameter = event['request']['codeParameter']  # This is {####}
    
    # Custom branded verification + welcome email
    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #ff6b6b, #ffa500); padding: 30px; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 32px;">🍳 Welcome to Meals by Maggie!</h1>
        </div>
        
        <div style="padding: 30px; background-color: #f9f9f9;">
            <h2 style="color: #333;">Hi {nickname}! 👋</h2>
            
            <p style="font-size: 16px; line-height: 1.6; color: #555;">
                Welcome to our cooking community! We're absolutely thrilled to have you join us on this delicious journey.
            </p>
            
            <div style="background: #fff; border: 3px solid #ff6b6b; border-radius: 10px; padding: 30px; text-align: center; margin: 30px 0;">
                <h3 style="color: #ff6b6b; margin-top: 0;">Verify Your Email</h3>
                <p style="font-size: 18px; color: #333; margin: 20px 0;">
                    Please enter this verification code to complete your account setup:
                </p>
                <div style="font-size: 36px; font-weight: bold; color: #ff6b6b; letter-spacing: 8px; font-family: monospace; background: #f0f0f0; padding: 20px; border-radius: 5px; margin: 20px 0;">
                    {code_parameter}
                </div>
                <p style="font-size: 14px; color: #666; margin-bottom: 0;">
                    This code will expire in 24 hours.
                </p>
            </div>
            
            <p style="font-size: 16px; line-height: 1.6; color: #555;">
                Once verified, you'll be able to:
            </p>
            
            <ul style="font-size: 16px; line-height: 1.8; color: #555;">
                <li>🔍 Browse our collection of amazing recipes</li>
                <li>📝 Add your own favorite recipes</li>
                <li>⭐ Rate and review recipes</li>
                <li>📸 Share photos of your culinary creations</li>
            </ul>
            
            <p style="font-size: 14px; color: #666; text-align: center; margin-top: 30px;">
                Need help? Reply to this email or visit our <a href="https://mealsbymaggie.com/help" style="color: #ff6b6b;">help center</a>.
            </p>
        </div>
        
        <div style="background-color: #333; color: white; padding: 20px; text-align: center; font-size: 14px;">
            <p style="margin: 0;">Happy cooking! ❤️</p>
            <p style="margin: 5px 0 0 0;"><strong>The Meals by Maggie Team</strong></p>
            <p style="margin: 10px 0 0 0; color: #999;">
                <a href="https://mealsbymaggie.com" style="color: #ff6b6b;">mealsbymaggie.com</a>
            </p>
        </div>
    </body>
    </html>
    """
    
    text_body = f"""
    Hi {nickname}! 👋

    Welcome to Meals by Maggie! We're absolutely thrilled to have you join our cooking community.

    VERIFY YOUR EMAIL
    Please enter this verification code to complete your account setup:

    {code_parameter}

    This code will expire in 24 hours.

    Once verified, you'll be able to:
    • Browse our collection of amazing recipes
    • Add your own favorite recipes  
    • Rate and review recipes
    • Share photos of your culinary creations

    Need help? Reply to this email or visit our help center.

    Happy cooking! ❤️
    The Meals by Maggie Team
    https://mealsbymaggie.com
    """
    
    # Update the event with our custom message
    event['response']['emailSubject'] = f"Welcome to Meals by Maggie, {nickname}! Please verify your email 🍳"
    event['response']['emailMessage'] = text_body
    
    # Note: HTML email requires SES integration, which we'll handle separately
    
    return event
```

#### 1.2 Enhanced Version with SES Integration

For full HTML email support, we need to integrate with SES directly:

```python
import json
import boto3
import os

def handler(event, context):
    """
    Custom Message trigger with SES integration for HTML emails
    """
    
    trigger_source = event['triggerSource']
    
    # Only customize verification emails
    if trigger_source != 'CustomMessage_SignUp':
        return event
    
    # Extract user info
    user_attributes = event['request']['userAttributes']
    email = user_attributes.get('email')
    nickname = user_attributes.get('nickname', user_attributes.get('given_name', 'there'))
    code_parameter = event['request']['codeParameter']
    
    # Send via SES for HTML support
    ses_client = boto3.client('ses', region_name='us-east-1')
    
    try:
        # [HTML and text body code from above]
        
        # Send the email via SES
        response = ses_client.send_email(
            Source="Meals by Maggie <welcome@mail.mealsbymaggie.com>",
            Destination={'ToAddresses': [email]},
            Message={
                'Subject': {
                    'Data': f"Welcome to Meals by Maggie, {nickname}! Please verify your email 🍳",
                    'Charset': 'UTF-8'
                },
                'Body': {
                    'Html': {'Data': html_body, 'Charset': 'UTF-8'},
                    'Text': {'Data': text_body, 'Charset': 'UTF-8'}
                }
            }
        )
        
        print(f"Custom verification email sent to {email}, MessageId: {response['MessageId']}")
        
        # Return empty response to prevent Cognito from sending its own email
        event['response']['emailSubject'] = ""
        event['response']['emailMessage'] = ""
        
    except Exception as e:
        print(f"Failed to send custom email to {email}: {str(e)}")
        # Fallback to Cognito's default email
        event['response']['emailSubject'] = f"Welcome to Meals by Maggie, {nickname}! Please verify your email"
        event['response']['emailMessage'] = f"Hi {nickname}!\n\nYour verification code is: {code_parameter}\n\nWelcome to Meals by Maggie!"
    
    return event
```

### Phase 2: Update Terraform Configuration

#### 2.1 Add Custom Message Lambda Resources

```hcl
# IAM role for custom message lambda
resource "aws_iam_role" "custom_message_role" {
  name               = "mbm-cognito-custom-message-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

# SES permissions for custom message lambda
resource "aws_iam_policy" "custom_message_ses_policy" {
  name = "mbm-custom-message-ses"
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ],
        Resource = [
          aws_sesv2_email_identity.mbm_domain.arn,
          "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:identity/mail.mealsbymaggie.com"
        ]
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

resource "aws_iam_role_policy_attachment" "custom_message_ses_attach" {
  role       = aws_iam_role.custom_message_role.name
  policy_arn = aws_iam_policy.custom_message_ses_policy.arn
}

# Custom Message Lambda function
resource "aws_lambda_function" "cognito_custom_message" {
  filename         = archive_file.auth_zip.output_path
  function_name    = "mbm-cognito-custom-message"
  role             = aws_iam_role.custom_message_role.arn
  handler          = "custom_message.handler"
  runtime          = "python3.10"
  source_code_hash = archive_file.auth_zip.output_base64sha256
  timeout          = 30
}

# Permission for Cognito to invoke custom message lambda
resource "aws_lambda_permission" "allow_cognito_custom_message" {
  statement_id  = "AllowCognitoCustomMessage"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cognito_custom_message.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.mbm.arn
}

# CloudWatch Log Group for custom message lambda
resource "aws_cloudwatch_log_group" "custom_message_lambda_logs" {
  name              = "/aws/lambda/${aws_lambda_function.cognito_custom_message.function_name}"
  retention_in_days = 14

  tags = {
    ManagedBy = "terraform"
    site      = "mbm"
  }
}
```

#### 2.2 Update Cognito User Pool Lambda Configuration

```hcl
# Update the existing lambda_config block
lambda_config {
  pre_sign_up     = aws_lambda_function.cognito_pre_signup.arn
  custom_message  = aws_lambda_function.cognito_custom_message.arn
}

# REMOVE the verification_message_template block entirely
# verification_message_template {
#   default_email_option = "CONFIRM_WITH_CODE"
#   email_subject        = "Welcome to Meals by Maggie! Please verify your email"
#   email_message        = "Hi there! 👋\n\nWelcome to Meals by Maggie!..."
# }
```

### Phase 3: Testing Strategy

#### 3.1 Development Testing
1. **Create test Lambda** with console logging to verify event structure
2. **Test with dummy email addresses** to validate HTML rendering
3. **Verify code parameter** is correctly passed and displayed
4. **Test fallback behavior** when SES fails

#### 3.2 Production Testing  
1. **Deploy to staging environment** first
2. **Test with real email addresses** (team members)
3. **Verify email deliverability** and spam folder placement
4. **Test mobile email client rendering** (iOS Mail, Gmail, Outlook)
5. **Load test** with multiple signups to ensure Lambda performance

#### 3.3 Rollback Plan
- Keep backup of current `verification_message_template` configuration
- Monitor CloudWatch logs for Lambda errors
- Have ability to quickly disable `custom_message` trigger if issues arise

### Phase 4: Monitoring and Analytics

#### 4.1 CloudWatch Metrics
- Lambda execution duration and errors
- SES bounce and complaint rates  
- Email delivery success rates

#### 4.2 User Experience Metrics
- Email verification completion rates
- Time between signup and verification
- Support requests related to email verification

## Benefits of This Implementation

### ✅ User Experience
- **Single email** reduces confusion
- **Beautiful branding** creates great first impression  
- **Full personalization** with actual nickname
- **Clear call-to-action** with prominent verification code

### ✅ Technical Benefits
- **Complete control** over email content and styling
- **Custom sender address** (`welcome@mail.mealsbymaggie.com`)
- **HTML email support** with fallback to text
- **Error handling** with fallback to basic Cognito email

### ✅ Business Benefits
- **Stronger brand identity** from first interaction
- **Higher conversion rates** with engaging welcome content
- **Reduced support burden** with clearer instructions
- **Analytics capability** for email engagement tracking

## Implementation Timeline

- **Phase 1**: 2-3 days (Lambda development and testing)
- **Phase 2**: 1 day (Terraform configuration updates)  
- **Phase 3**: 3-5 days (Testing and validation)
- **Phase 4**: 1 day (Monitoring setup)

**Total Estimated Time**: 1-2 weeks

## Prerequisites

- [x] SES production access (already configured)
- [x] Domain verification (already completed)
- [x] MAIL-FROM domain setup (already configured)
- [ ] HTML email template design and testing
- [ ] Mobile email client compatibility testing

## Future Enhancements

1. **A/B Testing**: Compare single email vs two-email approach
2. **Dynamic Content**: Personalize based on signup source or user preferences
3. **Multi-language Support**: Support for different languages based on user locale
4. **Email Analytics**: Track open rates, click rates, and engagement metrics
5. **Conditional Content**: Show different content based on invite code type or user segment

---

*This implementation plan provides a comprehensive approach to creating a single, branded verification + welcome email that will significantly improve the user onboarding experience while maintaining the security and reliability of email verification.*