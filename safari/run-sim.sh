#!/usr/bin/env bash
# Boot iOS Simulator and install the latest Debug build of the Safari extension app.
# Does NOT enable the extension inside Safari Settings (Apple has no stable CLI for that).
#
# Usage:
#   ./safari/run-sim.sh
#   IOS_SIM_NAME="iPhone 16 Pro" ./safari/run-sim.sh
#
# Env: APP_NAME, BUNDLE_ID, IOS_SIM_NAME, DEVELOPMENT_TEAM
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: must run on macOS" >&2
  exit 1
fi

APP_NAME="${APP_NAME:-X Account Tools}"
BUNDLE_ID="${BUNDLE_ID:-com.example.xaccounttools}"
IOS_SIM_NAME="${IOS_SIM_NAME:-iPhone 16}"

# Ensure built
SKIP_CONVERT="${SKIP_CONVERT:-1}"
if [[ ! -d "${ROOT}/safari/Xcode" ]] || ! find "${ROOT}/safari/Xcode" -name '*.xcodeproj' | grep -q .; then
  SKIP_CONVERT=0
fi
SKIP_CONVERT="$SKIP_CONVERT" "${ROOT}/safari/build.sh" ios-sim

# Resolve simulator UDID
UDID=$(xcrun simctl list devices available | awk -v name="$IOS_SIM_NAME" '
  $0 ~ name && $0 ~ /\([A-F0-9-]{36}\)/ {
    if (match($0, /\([A-F0-9-]{36}\)/)) {
      id=substr($0, RSTART+1, RLENGTH-2)
      print id
      exit
    }
  }')

if [[ -z "${UDID:-}" ]]; then
  echo "error: no available simulator named '${IOS_SIM_NAME}'" >&2
  echo "List: xcrun simctl list devices available | grep iPhone" >&2
  exit 1
fi

echo "==> boot simulator ${IOS_SIM_NAME} (${UDID})"
xcrun simctl boot "$UDID" 2>/dev/null || true
open -a Simulator

# Find built .app (DerivedData)
APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData -type d -name "${APP_NAME}.app" \
  -path '*/Build/Products/Debug-iphonesimulator/*' 2>/dev/null \
  | head -1 || true)

if [[ -z "${APP_PATH:-}" ]]; then
  # fallback any Debug-iphonesimulator app matching bundle
  APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData -type d -name '*.app' \
    -path '*/Debug-iphonesimulator/*' 2>/dev/null | head -1 || true)
fi

if [[ -z "${APP_PATH:-}" || ! -d "$APP_PATH" ]]; then
  echo "error: could not find built .app in DerivedData" >&2
  exit 1
fi

echo "==> install ${APP_PATH}"
xcrun simctl install "$UDID" "$APP_PATH"

# Bundle id of containing app is usually BUNDLE_ID (converter default)
echo "==> launch ${BUNDLE_ID}"
xcrun simctl launch "$UDID" "$BUNDLE_ID" 2>/dev/null \
  || xcrun simctl launch "$UDID" "${BUNDLE_ID}.app" 2>/dev/null \
  || echo "note: launch by bundle id failed — open the app manually on the simulator home screen"

echo
echo "Hands-off build/install done. Still requires one-time (or per-reinstall) GUI:"
echo "  Simulator → Settings → Safari → Extensions → enable '${APP_NAME}'"
echo "  Safari → x.com → allow extension for site"
echo "  Log into X in Safari (not the X app)"
