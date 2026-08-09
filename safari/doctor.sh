#!/usr/bin/env bash
# Preflight for hands-off Safari Web Extension builds (macOS only).
# Usage: ./safari/doctor.sh
set -euo pipefail

ok=0
warn=0
fail=0

pass() { echo "  ✓ $*"; ok=$((ok + 1)); }
note() { echo "  · $*"; warn=$((warn + 1)); }
bad()  { echo "  ✗ $*"; fail=$((fail + 1)); }

echo "Safari extension doctor"
echo "======================="

if [[ "$(uname -s)" != "Darwin" ]]; then
  bad "Not macOS ($(uname -s)). Convert/build must run on a Mac (SSH/agent on Mac OK)."
  exit 1
fi
pass "Darwin host"

if ! command -v xcrun >/dev/null 2>&1; then
  bad "xcrun missing — install Xcode (xcodes install <ver> or App Store)"
else
  pass "xcrun present"
fi

if xcode-select -p >/dev/null 2>&1; then
  pass "xcode-select → $(xcode-select -p)"
else
  bad "xcode-select path unset — sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
fi

if xcrun safari-web-extension-converter --help >/dev/null 2>&1; then
  pass "safari-web-extension-converter available"
else
  bad "safari-web-extension-converter missing (needs full Xcode, not CLT-only)"
fi

if command -v xcodebuild >/dev/null 2>&1; then
  ver=$(xcodebuild -version 2>/dev/null | head -1 || echo unknown)
  pass "xcodebuild ($ver)"
else
  bad "xcodebuild missing"
fi

if xcrun simctl list devices available >/dev/null 2>&1; then
  sims=$(xcrun simctl list devices available 2>/dev/null | grep -c "iPhone" || true)
  pass "simctl OK (~${sims} available iPhone sims listed)"
else
  note "simctl unavailable — Simulator builds will fail"
fi

if command -v xcodes >/dev/null 2>&1; then
  pass "xcodes CLI (Xcode version manager)"
else
  note "xcodes not installed — brew install xcodesorg/made/xcodes (optional)"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "${ROOT}/extension/manifest.json" ]]; then
  pass "extension/manifest.json present"
else
  bad "missing ${ROOT}/extension/manifest.json"
fi

if [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
  pass "DEVELOPMENT_TEAM=${DEVELOPMENT_TEAM}"
else
  note "DEVELOPMENT_TEAM unset — set 10-char Team ID for non-interactive signing"
  note "  export DEVELOPMENT_TEAM=XXXXXXXXXX  # Xcode → Settings → Accounts → Team"
fi

if [[ -n "${BUNDLE_ID:-}" ]]; then
  pass "BUNDLE_ID=${BUNDLE_ID}"
else
  note "BUNDLE_ID unset — convert.sh defaults to com.example.xaccounttools"
fi

# Identities (does not prove Apple ID login)
if security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Development\|Apple Distribution"; then
  pass "codesigning identity found in keychain"
else
  note "no Apple Development identity visible — open Xcode once, add Apple ID, create cert"
fi

echo
echo "Summary: ${ok} ok, ${warn} notes, ${fail} failures"
echo
echo "Automatable: convert → xcodebuild → simctl install/launch"
echo "Human once:  Team/signing, device Trust, Safari enable extension, x.com login + site allow"
echo "See: safari/CLI.md"

[[ "$fail" -eq 0 ]]
