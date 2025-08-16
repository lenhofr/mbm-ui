#!/usr/bin/env bash
# Pre-commit hook: ensure terraform files are formatted
set -euo pipefail

echo "Running terraform fmt -recursive -check..."
if ! command -v terraform >/dev/null 2>&1; then
  echo "terraform CLI not found in PATH. Skipping terraform fmt check."
  exit 0
fi

# Run format check
if ! terraform fmt -recursive -check >/dev/null 2>&1; then
  echo "terraform files are not formatted. Run: terraform fmt -recursive"
  exit 1
fi

echo "terraform fmt check passed."
exit 0
