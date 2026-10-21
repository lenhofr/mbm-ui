#!/bin/sh
# Xcode Cloud runs this after xcodebuild. For archive builds it writes the
# TestFlight "What to Test" notes from the last few merged PRs that changed the
# app (ios/MealsByMaggie/), newest first. Xcode Cloud reads them from
# ci_scripts/TestFlight/WhatToTest.en-US.txt. See docs/ios-release.md.
# Never fails the build: worst case, the build goes out without notes.

[ -n "$CI_ARCHIVE_PATH" ] || exit 0

REPO="${CI_PRIMARY_REPOSITORY_PATH:-$(git rev-parse --show-toplevel)}"
NOTES_DIR="$REPO/ios/ci_scripts/TestFlight"
mkdir -p "$NOTES_DIR" || exit 0

# Xcode Cloud clones shallow; fetch enough history to find recent merges.
if [ "$(git -C "$REPO" rev-parse --is-shallow-repository)" = "true" ]; then
  git -C "$REPO" fetch --quiet --deepen 100 || true
fi

# A merge commit's subject is "Merge pull request #N from …" and its body is the
# PR title; for a direct commit, use its subject.
CHANGES=$(git -C "$REPO" log --first-parent -3 --format='%s%x1f%b%x1e' -- ios/MealsByMaggie |
  awk 'BEGIN { RS = "\036"; FS = "\037" }
       NF { sub(/^\n+/, "", $1); split($2, body, "\n")
            title = ($1 ~ /^Merge pull request/ && body[1] != "") ? body[1] : $1
            if (title != "") print "• " title }')

{
  echo "What's new:"
  if [ -n "$CHANGES" ]; then echo "$CHANGES"; else echo "• Fixes and improvements"; fi
  echo
  echo "Spot something off? Take a screenshot to send feedback through TestFlight."
} > "$NOTES_DIR/WhatToTest.en-US.txt"

cat "$NOTES_DIR/WhatToTest.en-US.txt"
exit 0
