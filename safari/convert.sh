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
echo "Done. Hands-off next (Mac):"
echo "  export DEVELOPMENT_TEAM=XXXXXXXXXX   # once in shell profile"
echo "  ./safari/doctor.sh"
echo "  ./safari/build.sh ios-sim            # or: macos | all"
echo "  ./safari/run-sim.sh                  # sim install/launch"
echo "Still human once: Safari Settings → Extensions → enable + allow x.com"
echo "Docs: safari/CLI.md · safari/TESTING.md"
