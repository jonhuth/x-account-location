#!/usr/bin/env bash
# Convert the shared WebExtension into a Safari Web Extension Xcode app.
# Must run on macOS with Xcode (Command Line Tools + full Xcode.app) installed.
#
# Usage:
#   ./safari/convert.sh
#   BUNDLE_ID=com.yourllc.xaccounttools APP_NAME="X Account Tools" ./safari/convert.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="${ROOT}/extension"
OUT_DIR="${ROOT}/safari/Xcode"
APP_NAME="${APP_NAME:-X Account Tools}"
BUNDLE_ID="${BUNDLE_ID:-com.example.xaccounttools}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: safari-web-extension-converter only runs on macOS (this host is $(uname -s))." >&2
  echo "Copy the repo to a Mac (or SSH to one with Xcode), then re-run." >&2
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "error: xcrun not found — install Xcode from the App Store, then:" >&2
  echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
  exit 1
fi

if [[ ! -f "${EXT_DIR}/manifest.json" ]]; then
  echo "error: missing ${EXT_DIR}/manifest.json" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

echo "Converting ${EXT_DIR} → ${OUT_DIR}"
echo "  app-name: ${APP_NAME}"
echo "  bundle-id: ${BUNDLE_ID}"
echo

# --force overwrites a previous conversion; multiplatform (iOS + macOS) by default.
# Drop --macos-only / --ios-only if you want a single platform.
xcrun safari-web-extension-converter "${EXT_DIR}" \
  --project-location "${OUT_DIR}" \
  --app-name "${APP_NAME}" \
  --bundle-identifier "${BUNDLE_ID}" \
  --swift \
  --force \
  --no-prompt

echo
echo "Done. Next:"
echo "  1. open ${OUT_DIR}/*.xcodeproj  (or the generated .xcworkspace)"
echo "  2. Select your Team (Signing & Capabilities) for the app + extension targets"
echo "  3. See safari/TESTING.md for macOS + iOS run steps"
echo "  4. Prefer running on a device with X in Safari (not the X app)"
