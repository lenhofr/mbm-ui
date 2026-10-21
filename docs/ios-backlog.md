# iOS app backlog

Ideas for the SwiftUI app in `ios/` (and the backend/web changes they need) that have been discussed but deliberately not built yet. Move an item into a branch when it's picked up, and delete it here once it ships.

Keep each entry short. When an idea needs a real plan, write it up as its own `docs/<feature>-plan.md` and link it from the entry (e.g. [`passkeys-plan.md`](passkeys-plan.md)).

## Uses the paid Apple Developer Program

The paid account is in place (TestFlight is live), so these are unblocked.

### Share → Meals by Maggie (share extension)
Add the app to the iOS share sheet so a recipe page in Safari (or text, or a screenshot) can be sent straight to the AI importer.

- New *Share Extension* target that accepts URLs, text and images, and hands them to the main app's existing `ImportFlowView`.
- The hand-off needs an **App Group** (shared container) between the app and the extension, which needs the paid account (not available on a free Personal Team).
- Optional: share the Cognito session through a Keychain access group so the extension can import without opening the app.
- The web app's `/import?url=` route (share target, bookmarklets) is the same idea for the PWA.

### App Store
- App Store review requires in-app **account deletion** (a new Lambda + button), a privacy policy URL, and screenshots.

## Sign-in

### Passkeys ("Sign in with Face ID")
Passwordless sign-in with Face ID / Touch ID that works in the iOS app and on the website (passkeys sync through iCloud Keychain). Added from the account sheet after signing in, so the invite-code sign-up and password fallback stay as they are. Needs Cognito's Essentials tier and a sign-in policy change, a `webcredentials` entry that already exists in the website's apple-app-site-association file, and new buttons on both clients. Full plan: [`passkeys-plan.md`](passkeys-plan.md).

### Sign in with Apple (set aside)
Conflicts with the invite-code gate: `pre_sign_up` runs for every new account, and Apple sign-in has no step to enter a code. Revisit only with an invite-flow redesign (e.g. enter the code first, then sign in with Apple).

## Feature parity with the web

- **Quick tips** (`QuickTips.tsx`): the tips sheet and inline tips in search.
- **Quick view** (long-press a card on the web): a peek at the ingredients without opening the recipe.
- **Search**: the web uses Fuse.js fuzzy matching; iOS uses plain substring matching on title, tags and ingredients.

## Cross-platform improvements

- **Favorites sync**: favorites live on each device (web `localStorage`, iOS `UserDefaults`), keyed by Cognito sub. Syncing needs API storage, e.g. `GET/PUT /favorites` backed by DynamoDB.
- **Print a recipe** (tester request): neither client has a print option. iOS: a Print action on the recipe page using `UIPrintInteractionController` with a clean layout (title, servings, ingredients, steps; scaled amounts if servings changed). Web: a Print button calling `window.print()`, with `@media print` rules for the detail screen; the existing ones in `src/styles.css` target old cook-modal classes that no longer exist.
- **Slow scans**: API Gateway and the Lambda both stop at 30s, which caps how long Bedrock can spend on a hard handwritten card.
