#!/usr/bin/env bash
# Archive the iOS app and upload it to App Store Connect (TestFlight).
# Same as Xcode's Product → Archive, then Distribute App → App Store Connect → Upload.
#
# Usage: npm run ios:testflight
#
# Signs with the Apple account you're signed into in Xcode (Settings → Accounts).
# Runs only from an up-to-date, clean main so every TestFlight build matches merged
# code; set TESTFLIGHT_SKIP_CHECKS=1 to skip that (e.g. to try a branch build).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [[ "${TESTFLIGHT_SKIP_CHECKS:-}" != "1" ]]; then
  branch=$(git branch --show-current)
  if [[ "$branch" != "main" ]]; then
    echo "On '$branch', not main. Run: git checkout main && git pull" >&2
    exit 1
  fi
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "Uncommitted changes; commit or stash them first." >&2
    exit 1
  fi
  git fetch -q origin main
  if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
    echo "Local main doesn't match origin/main. Run: git pull" >&2
    exit 1
  fi
fi

# Build numbers must go up with every upload; a timestamp always does, with no
# version bump to commit. The version (1.0) stays as set in the project.
build_number=$(date +%Y%m%d%H%M)
archive=ios/build/MealsByMaggie.xcarchive
export_dir=ios/build/export

rm -rf "$archive" "$export_dir"

echo "Archiving build $build_number ($(git rev-parse --short HEAD))..."
xcodebuild archive \
  -project ios/MealsByMaggie.xcodeproj \
  -scheme MealsByMaggie \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$archive" \
  -skipPackagePluginValidation \
  -skipMacroValidation \
  -allowProvisioningUpdates \
  -quiet \
  CURRENT_PROJECT_VERSION="$build_number"

echo "Uploading to App Store Connect..."
xcodebuild -exportArchive \
  -archivePath "$archive" \
  -exportOptionsPlist ios/ExportOptions.plist \
  -exportPath "$export_dir" \
  -allowProvisioningUpdates

echo
echo "Uploaded build $build_number. App Store Connect emails you when it's processed"
echo "(usually 5–30 minutes). Internal testers get it automatically; for external"
echo "groups, add the build to the group in App Store Connect → TestFlight."
