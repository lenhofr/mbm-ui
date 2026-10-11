# iOS app backlog

Ideas for the SwiftUI app in `ios/` that have been discussed but deliberately not built yet. Move an item into a branch when it's picked up, and delete it here once it ships.

## Needs the paid Apple Developer Program ($99/yr)

### Share → Meals by Maggie (share extension)
Add the app to the iOS share sheet so a recipe page in Safari (or text, or a screenshot) can be sent straight to the AI importer.

- New *Share Extension* target that accepts URLs, text and images, and hands them to the main app's existing `ImportFlowView`.
- The hand-off needs an **App Group** (shared container) between the app and the extension, and App Groups aren't available on a free Personal Team; that's why this is parked.
- Optional: share the Cognito session through a Keychain access group so the extension can import without opening the app.
- The web app's `/import?url=` route (share target, bookmarklets) is the same idea for the PWA.

### TestFlight / App Store
- TestFlight lets Maggie and family install the app; builds also stop expiring after 7 days.
- App Store review requires in-app **account deletion** (a new Lambda + button), a privacy policy URL, and screenshots.

## Feature parity with the web

- **Nickname prompt** (`CompleteProfile.tsx`): ask for a kitchen nickname when the account has none, so recipes aren't stamped "User".
- **Quick tips** (`QuickTips.tsx`): the tips sheet and inline tips in search.
- **Quick view** (long-press a card on the web): a peek at the ingredients without opening the recipe.
- **Search**: the web uses Fuse.js fuzzy matching; iOS uses plain substring matching on title, tags and ingredients.

## Cross-platform improvements

- **Favorites sync**: favorites live on each device (web `localStorage`, iOS `UserDefaults`), keyed by Cognito sub. Syncing needs API storage, e.g. `GET/PUT /favorites` backed by DynamoDB.
- **Slow scans**: API Gateway and the Lambda both stop at 30s, which caps how long Bedrock can spend on a hard handwritten card.
- **Clearing a field on edit**: `PUT /recipes/{id}` merges the body over the existing item, so a field left out (e.g. a deleted description) keeps its old value. Fixing it means the clients sending explicit nulls or the Lambda replacing instead of merging.
