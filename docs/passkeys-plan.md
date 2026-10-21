# Passkeys ("Sign in with Face ID") — implementation plan

Status: **idea, not started.** Listed in [`ios-backlog.md`](ios-backlog.md#sign-in).

## Goal

Let people sign in to Meals by Maggie with a **passkey** instead of typing a password: Face ID / Touch ID on iPhone and Mac, or a phone scan from other browsers. Passkeys sync through iCloud Keychain (and Google Password Manager on Android/Chrome), so one passkey works in the iOS app **and** on mealsbymaggie.com.

Passwords stay. A passkey is something a signed-in user *adds* ("Use Face ID next time"), so:

- sign-up keeps the **invite code + email + password** flow and the `pre_sign_up` Lambda unchanged;
- the password remains the fallback if a device or passkey is lost.

## How it fits the current stack

| Piece | Today | With passkeys |
| --- | --- | --- |
| Cognito user pool | Default (Lite) features, password sign-in | **Essentials** feature plan, sign-in policy allowing `PASSWORD` and `WEB_AUTHN` |
| App client `mbm-spa-client` | `ALLOW_USER_SRP_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH` | + `ALLOW_USER_AUTH` (Cognito's choice-based sign-in flow) |
| Website | Amplify JS v6 Authenticator (SRP) | + "Sign in with a passkey" and "Add a passkey" (Amplify JS passkey APIs) |
| iOS app | Amplify Swift 2.62, SRP | + same, via Amplify Swift's WebAuthn APIs |
| mealsbymaggie.com | Static SPA on S3/CloudFront | + `/.well-known/apple-app-site-association` file (shared with Universal Links) |

Cognito stores the passkeys and runs the WebAuthn ceremony; Amplify on each client talks to the platform's passkey UI (`ASAuthorizationController` on iOS, `navigator.credentials` on the web). We don't store any keys ourselves.

## Key decision: the relying party ID

A passkey is bound to a **relying party (RP) ID**, a domain. Both clients must use the same one for a single passkey to work everywhere:

- **Use `mealsbymaggie.com`.** The website's origin (`https://mealsbymaggie.com`, and `www.` as a subdomain) matches it, and the iOS app proves it may use it through the `webcredentials` entry in the site's apple-app-site-association file.
- Don't use the Cognito prefix domain (`mbm-app-….auth.us-east-1.amazoncognito.com`): neither the website nor the app lives there, and passkeys tied to it couldn't be used from either.
- **Verify** in the Cognito docs that an embedded-SDK setup (not managed login / hosted UI) may set the RP ID to our own domain; Cognito restricts the RP ID when managed login with a custom domain is used.
- Consequence: passkeys **won't work on `localhost`** during web development. Test against the deployed site, or use a separate dev user pool with its own RP ID.

## Implementation steps

### 1. Terraform (user pool + app client)

In `terraform/app_account/backend_api.tf`:

```hcl
resource "aws_cognito_user_pool" "mbm" {
  # ...existing settings...
  user_pool_tier = "ESSENTIALS"

  sign_in_policy {
    allowed_first_auth_factors = ["PASSWORD", "WEB_AUTHN"]
  }

  web_authn_configuration {
    relying_party_id  = "mealsbymaggie.com"
    user_verification = "required" # always ask for Face ID / Touch ID / device PIN
  }
}

resource "aws_cognito_user_pool_client" "spa" {
  # ...existing settings...
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_AUTH",
  ]
}
```

- **Provider version:** these arguments need a recent `hashicorp/aws` 5.x. `backend.tf` pins `~> 5.0` with no committed lock file, so CI uses the newest 5.x; confirm the arguments exist in that version's docs.
- **Check the plan carefully:** both resources must show **"updated in-place"**. A replacement of `aws_cognito_user_pool.mbm` would delete every account.
- **Cost:** passkeys are an Essentials-tier feature. Check current Cognito pricing for Essentials (it has a monthly free allowance of active users); a family-sized pool should cost little or nothing, but confirm before switching tiers.

### 2. apple-app-site-association (website): done

Already live with Universal Links: `public/.well-known/apple-app-site-association` has the `webcredentials` entry for `V92G57KLG3.com.mealsbymaggie.app`, and `deploy.yml` uploads it as `application/json`. Nothing to add for passkeys.

### 3. iOS app

1. **Associated Domains capability:** done; `MealsByMaggie.entitlements` already lists `webcredentials:mealsbymaggie.com` and `applinks:mealsbymaggie.com`.
2. **Minimum iOS version:** Amplify Swift's passkey APIs need iOS 17.4 or later; the app targets 17.0. Either raise the deployment target to 17.4 or hide the passkey buttons behind `if #available(iOS 17.4, *)`.
3. **Add a passkey** (signed in), e.g. in `AccountView`:
   ```swift
   try await Amplify.Auth.associateWebAuthnCredential(presentationAnchor: window)
   ```
   Also list and remove them (`listWebAuthnCredentials`, `deleteWebAuthnCredential(credentialId:)`) so a lost device's passkey can be revoked.
4. **Sign in with a passkey** in `LoginView`: ask for the email, then
   ```swift
   let options = AuthSignInRequest.Options(
       pluginOptions: AWSAuthSignInOptions(authFlowType: .userAuth(preferredFirstFactor: .webAuthn))
   )
   try await Amplify.Auth.signIn(username: email, options: options)
   ```
   If the user has no passkey, fall back to the password field. Handle the next steps Cognito may return with `USER_AUTH` (e.g. a first-factor choice).
5. Add the new `AWSCognitoAuthError` WebAuthn cases (`webAuthnNotEnabled`, `webAuthnNotSupported`, `userCancelled`, …) to `friendlyAuthMessage` with kitchen-talk wording.
6. Exact Amplify Swift signatures: confirm against the installed version (2.62.0) before writing code.

### 4. Website

1. Check whether the installed `@aws-amplify/ui-react` Authenticator supports passkeys / passwordless sign-in. If it does, enable it there; if not, add a small custom "Sign in with a passkey" button beside it.
2. Use Amplify JS v6:
   - sign in: `signIn({ username, options: { authFlowType: 'USER_AUTH', preferredChallenge: 'WEB_AUTHN' } })`
   - add / list / remove: `associateWebAuthnCredential()`, `listWebAuthnCredentials()`, `deleteWebAuthnCredential({ credentialId })`
3. Put "Add a passkey" in the account sheet (`HomeScreen.tsx`), next to Log out.
4. Confirm the exact function names against the installed `aws-amplify` version.

### 5. UX copy (both platforms)

- Account sheet: **"Use Face ID to sign in"** → after success: "All set! Next time, just use Face ID."
- Login: **"Sign in with Face ID"** (iOS) / **"Sign in with a passkey"** (web), with "Use password instead".
- Errors: cancelled → stay quiet; not supported → "This device can't use passkeys. Your password still works."

## Testing

- Passkeys need a **real device** signed into iCloud with Keychain on; the simulator's support is limited.
- Test the cross-device promise: add a passkey on the iPhone app, then sign in on mealsbymaggie.com in Safari on a Mac with the same Apple ID (and vice versa).
- Test fallbacks: password still works; deleting a passkey stops it working; a user without a passkey sees the password flow.
- Unit-test the pieces that don't need the OS UI (error-message mapping, choosing passkey vs password in `AuthModel`).

## Rollout order

1. Terraform: Essentials tier, sign-in policy, WebAuthn config, `ALLOW_USER_AUTH` (check the plan: in-place only).
2. ~~Website: apple-app-site-association with `webcredentials`.~~ Done.
3. iOS: Associated Domains + "Add a passkey" + "Sign in with Face ID"; ship to TestFlight.
4. Web: same buttons.
5. Optional later: offer "Add Face ID?" right after a password sign-in.

## Related ideas

- **Saved passwords shared between site and app** shipped with the `webcredentials` entry: iOS offers passwords saved for mealsbymaggie.com in Safari inside the app's login form, and saves new ones for both.
- **Universal Links** (shipped) use the same apple-app-site-association file (`applinks`).
- **Sign in with Apple** was considered and set aside: the invite-code check (`pre_sign_up`) runs for every new account, and Apple sign-in has no step to enter a code, so it needs an invite-flow redesign first.
