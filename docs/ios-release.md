# Releasing the iOS app to TestFlight

New iOS builds go to testers through TestFlight.

## Xcode Cloud (the normal path)

Every merge to `main` that changes something under `ios/` starts an Xcode Cloud build. It archives, signs and uploads the app to TestFlight, and internal testers get it automatically. Nothing to run.

- **Watch builds:** Xcode → Report Navigator (⌘9) → Cloud, or App Store Connect → your app → Xcode Cloud.
- **Start one by hand:** Report Navigator (⌘9) → Cloud, right-click the workflow → Start Build (or "Start Build" on the workflow in App Store Connect).
- **External testers** still need each build added to their group (see below).
- **Plugin trust:** [`ios/ci_scripts/ci_post_clone.sh`](../ios/ci_scripts/ci_post_clone.sh) runs on Xcode Cloud after the clone and trusts the AWS SDK's `smithy-swift` plugin, the cloud equivalent of clicking "Trust & Enable". It must stay executable, in `ios/ci_scripts/` next to the `.xcodeproj`.
- **Build numbers:** Xcode Cloud numbers builds itself, counting up from the "next build number" in App Store Connect → Xcode Cloud → Settings. It's set above the timestamp numbers the script used before (e.g. `202610161152`), so new builds sort as newer than the old ones in TestFlight.

### Workflow setup (one time, done in Xcode)

Integrate → Create Workflow… (or Report Navigator (⌘9) → Cloud → Get Started), MealsByMaggie app. When asked to connect GitHub, authorize Xcode Cloud and install its GitHub app on `lenhofr/mbm-ui` only; the listed package repos (apple/…, awslabs/…, aws-amplify/…) are public and need no access. Then edit the workflow:

- **Start condition:** Branch Changes on `main`, only when files in `ios/` change.
- **Environment:** latest Xcode and macOS.
- **Action:** Archive – iOS, deployment preparation "TestFlight (Internal Testing Only)". Xcode's default workflow has only a Build action, which compiles and uploads nothing; remove it.
- **Post-action:** TestFlight Internal Testing, to the internal group (only offered once the Archive action exists).

PR builds and tests stay on GitHub Actions (`.github/workflows/ios.yml`).

## From your Mac (fallback)

If Xcode Cloud is down or you need a build it can't make, build and upload with one command:

```bash
git checkout main && git pull
npm run ios:testflight
```

**Mixing the two causes rejected uploads.** The script uses a timestamp build number, which jumps far above Xcode Cloud's counter; afterwards, raise Xcode Cloud's next build number above it again (App Store Connect → Xcode Cloud → Settings).

The script ([`scripts/ios-testflight.sh`](../scripts/ios-testflight.sh)):

1. Checks you're on `main`, with no uncommitted changes, and matching `origin/main`, so every build matches merged code.
2. Archives the app (Xcode's Product → Archive) with a timestamp build number like `202610131705`. Build numbers must go up with every upload; a timestamp always does, and there's nothing to bump or commit.
3. Uploads it to App Store Connect (Organizer → Distribute App → App Store Connect → Upload), using [`ios/ExportOptions.plist`](../ios/ExportOptions.plist).

## After an upload

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
- **"Trust & Enable" / plugin validation errors:** the script passes `-skipPackagePluginValidation` for the AWS SDK's `smithy-swift` plugin, like CI. On Xcode Cloud, check that `ios/ci_scripts/ci_post_clone.sh` ran (it shows in the build log) and is executable.
- **Xcode Cloud upload rejected for the build number:** raise the next build number in App Store Connect → Xcode Cloud → Settings above the last uploaded build.
- The archive and export are left in `ios/build/` (gitignored) for inspection; each run replaces them.
