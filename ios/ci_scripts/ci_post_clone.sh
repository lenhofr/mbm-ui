#!/bin/sh
# Xcode Cloud runs this after cloning the repo, before resolving packages
# (see docs/ios-release.md).
# Trusts the AWS SDK's smithy-swift build plugin and macros: the "Trust & Enable"
# prompt in Xcode, or -skipPackagePluginValidation on the command line.
# ("Validatation" is Apple's real spelling of the setting.)
set -e
defaults write com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatation -bool YES
defaults write com.apple.dt.Xcode IDESkipMacroFingerprintValidation -bool YES
