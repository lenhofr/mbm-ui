# iOS app backlog

Ideas for the SwiftUI app in `ios/` (and the backend/web changes they need) that have been discussed but deliberately not built yet. Move an item into a branch when it's picked up, and delete it here once it ships.

Keep each entry short. When an idea needs a real plan, write it up as its own `docs/<feature>-plan.md` and link it from the entry (e.g. [`passkeys-plan.md`](passkeys-plan.md)).

## Needs the paid Apple Developer Program ($99/yr)

### Share → Meals by Maggie (share extension)
Add the app to the iOS share sheet so a recipe page in Safari (or text, or a screenshot) can be sent straight to the AI importer.

- New *Share Extension* target that accepts URLs, text and images, and hands them to the main app's existing `ImportFlowView`.
- The hand-off needs an **App Group** (shared container) between the app and the extension, and App Groups aren't available on a free Personal Team; that's why this is parked.
- Optional: share the Cognito session through a Keychain access group so the extension can import without opening the app.
- The web app's `/import?url=` route (share target, bookmarklets) is the same idea for the PWA.

### App Store
- App Store review requires in-app **account deletion** (a new Lambda + button), a privacy policy URL, and screenshots.

### Xcode Cloud (automatic TestFlight builds)
Apple's build service can archive, sign and upload to TestFlight on every merge to `main` (25 free compute hours/month), replacing the manual Product → Archive → Distribute steps. Needs GitHub repo access granted to Xcode Cloud and a workflow that passes `-skipPackagePluginValidation` (or trusts the smithy-swift plugin). The GitHub Actions workflow (`ios.yml`) would keep handling PR build/test.

## Sharing recipes

### Share button on the recipe page
Replace the recipe page's heart (favoriting stays on the recipe cards) with a **Share** button that opens the iOS share sheet (Messages, Mail, AirDrop, Copy…) with the recipe title and its public web link, e.g. `https://mealsbymaggie.com/recipe/<id>`. Recipe pages are already public, so anyone can open the link in a browser without the app or an account. SwiftUI's `ShareLink` covers it; iOS-only, no backend changes.

### Open shared links in the app (Universal Links)
When someone who has the app taps a `mealsbymaggie.com/recipe/<id>` link, open that recipe in the app instead of Safari.
- Host `/.well-known/apple-app-site-association` on the website (served as JSON from the S3/CloudFront site) listing the app (`<team id>.com.mealsbymaggie.app`) and the `/recipe/*` paths.
- Add the **Associated Domains** capability (`applinks:mealsbymaggie.com`, plus `www`) to the app; needs the paid developer account, which is now in place.
- Handle the incoming URL in the app (`onOpenURL`) by pushing the recipe's detail screen.

## Sign-in

### Passkeys ("Sign in with Face ID")
Passwordless sign-in with Face ID / Touch ID that works in the iOS app and on the website (passkeys sync through iCloud Keychain). Added from the account sheet after signing in, so the invite-code sign-up and password fallback stay as they are. Needs Cognito's Essentials tier and a sign-in policy change, an apple-app-site-association file on the website, and new buttons on both clients. Full plan: [`passkeys-plan.md`](passkeys-plan.md).

### Saved passwords shared between the site and the app
Add a `webcredentials:mealsbymaggie.com` Associated Domain plus the matching apple-app-site-association entry, so iOS offers passwords saved for mealsbymaggie.com inside the app's login form (and saves new ones for both). Same website file as passkeys and Universal Links; small on its own.

### Sign in with Apple (set aside)
Conflicts with the invite-code gate: `pre_sign_up` runs for every new account, and Apple sign-in has no step to enter a code. Revisit only with an invite-flow redesign (e.g. enter the code first, then sign in with Apple).

## Feature parity with the web

- **Nickname prompt** (`CompleteProfile.tsx`): ask for a kitchen nickname when the account has none, so recipes aren't stamped "User".
- **Quick tips** (`QuickTips.tsx`): the tips sheet and inline tips in search.
- **Quick view** (long-press a card on the web): a peek at the ingredients without opening the recipe.
- **Search**: the web uses Fuse.js fuzzy matching; iOS uses plain substring matching on title, tags and ingredients.

## Cross-platform improvements

- **Favorites sync**: favorites live on each device (web `localStorage`, iOS `UserDefaults`), keyed by Cognito sub. Syncing needs API storage, e.g. `GET/PUT /favorites` backed by DynamoDB.
- **Slow scans**: API Gateway and the Lambda both stop at 30s, which caps how long Bedrock can spend on a hard handwritten card.
- **Clearing a field on edit**: `PUT /recipes/{id}` merges the body over the existing item, so a field left out (e.g. a deleted description) keeps its old value. Fixing it means the clients sending explicit nulls or the Lambda replacing instead of merging.
