# Releasing the iOS app to TestFlight

New iOS builds go to testers through TestFlight. Build and upload from your Mac with one command:

```bash
git checkout main && git pull
npm run ios:testflight
```

That's it. The script ([`scripts/ios-testflight.sh`](../scripts/ios-testflight.sh)):

1. Checks you're on `main`, with no uncommitted changes, and matching `origin/main`, so every build matches merged code.
2. Archives the app (Xcode's Product → Archive) with a timestamp build number like `202610131705`. Build numbers must go up with every upload; a timestamp always does, and there's nothing to bump or commit.
3. Uploads it to App Store Connect (Organizer → Distribute App → App Store Connect → Upload), using [`ios/ExportOptions.plist`](../ios/ExportOptions.plist).

Then:

- **Processing:** App Store Connect emails you when the build is processed, usually 5–30 minutes.
- **Internal testers** (people on your App Store Connect team) get each processed build automatically.
- **External testers** (invited by email or public link) don't: add each build to the group yourself. In App Store Connect → TestFlight, open the external group, add the build under Builds, fill in "What to Test", and submit. Apple's beta review is usually quick for later builds of an already-approved app. Testers then see an Update button in the TestFlight app.

## Requirements

- Xcode signed in to the Apple Developer account (Xcode → Settings → Accounts). The script signs with it through `-allowProvisioningUpdates`, the same as Xcode's automatic signing.
- The app version (`MARKETING_VERSION`, currently 1.0) is set in the Xcode project. Change it there only when starting a new release line; TestFlight updates just need the build number to go up.

## Trying a branch build

To send a build from a branch (or with local changes) to TestFlight, skip the `main` checks:

```bash
TESTFLIGHT_SKIP_CHECKS=1 npm run ios:testflight
```

## Troubleshooting

- **Signing or provisioning errors:** open the project in Xcode, check Signing & Capabilities for the MealsByMaggie target, and make sure your account is listed under Settings → Accounts.
- **"Trust & Enable" / plugin validation errors:** the script passes `-skipPackagePluginValidation` for the AWS SDK's `smithy-swift` plugin, like CI.
- The archive and export are left in `ios/build/` (gitignored) for inspection; each run replaces them.

Automatic builds on every merge (Xcode Cloud) are an idea in [`ios-backlog.md`](ios-backlog.md).
