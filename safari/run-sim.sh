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

APP_NAME="${APP_NAME:-Flagline}"
BUNDLE_ID="${BUNDLE_ID:-com.aevum.flagline}"
IOS_SIM_NAME="${IOS_SIM_NAME:-}"

# Ensure built
SKIP_CONVERT="${SKIP_CONVERT:-1}"
if [[ ! -d "${ROOT}/safari/Xcode" ]] || ! find "${ROOT}/safari/Xcode" -name '*.xcodeproj' | grep -q .; then
  SKIP_CONVERT=0
fi
SKIP_CONVERT="$SKIP_CONVERT" "${ROOT}/safari/build.sh" ios-sim

# Resolve simulator: preferred name, else first available iPhone
pick_udid() {
  local preferred="${1:-}" line name udid
  if [[ -n "$preferred" ]]; then
    udid=$(xcrun simctl list devices available 2>/dev/null | awk -v name="$preferred" '
      index($0, name) && $0 ~ /\([A-F0-9-]{36}\)/ {
        if (match($0, /\([A-F0-9-]{36}\)/)) {
          print substr($0, RSTART+1, RLENGTH-2)
          exit
        }
      }')
    if [[ -n "${udid:-}" ]]; then
      echo "$udid|$preferred"
      return
    fi
    echo "note: preferred sim '${preferred}' not found — auto-picking" >&2
  fi

  line=$(xcrun simctl list devices available 2>/dev/null | grep -E 'iPhone' | head -1 || true)
  if [[ -z "$line" ]]; then
    echo "error: no available iPhone simulators." >&2
    echo "Install an iOS runtime:" >&2
    echo "  xcodebuild -downloadPlatform iOS" >&2
    echo "  # or Xcode → Settings → Platforms → iOS → Get" >&2
    exit 1
  fi
  name=$(echo "$line" | sed -E 's/^[[:space:]]+//' | sed -E 's/ \([A-F0-9-]{36}\).*//')
  udid=$(echo "$line" | grep -oE '[A-F0-9-]{36}' | head -1)
  echo "${udid}|${name}"
}

picked=$(pick_udid "$IOS_SIM_NAME")
UDID="${picked%%|*}"
SIM_LABEL="${picked#*|}"

echo "==> boot simulator ${SIM_LABEL} (${UDID})"
xcrun simctl boot "$UDID" 2>/dev/null || true
open -a Simulator

# Find built .app (DerivedData)
APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData -type d -name "${APP_NAME}.app" \
  -path '*/Build/Products/Debug-iphonesimulator/*' 2>/dev/null \
  | head -1 || true)

if [[ -z "${APP_PATH:-}" ]]; then
  APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData -type d -name '*.app' \
    -path '*/Debug-iphonesimulator/*' 2>/dev/null | head -1 || true)
fi

if [[ -z "${APP_PATH:-}" || ! -d "$APP_PATH" ]]; then
  echo "error: could not find built .app in DerivedData" >&2
  echo "Build may have failed. Run: ./safari/build.sh ios-sim" >&2
  exit 1
fi

echo "==> install ${APP_PATH}"
xcrun simctl install "$UDID" "$APP_PATH"

echo "==> launch ${BUNDLE_ID}"
xcrun simctl launch "$UDID" "$BUNDLE_ID" 2>/dev/null \
  || xcrun simctl launch "$UDID" "${BUNDLE_ID}.app" 2>/dev/null \
  || echo "note: launch by bundle id failed — open the app on the simulator home screen"

echo
echo "Hands-off build/install done. Still requires one-time (or per-reinstall) GUI:"
echo "  1. Simulator → Settings → Safari → Extensions → enable '${APP_NAME}'"
echo "  2. Open Safari → https://x.com → allow extension for this site"
echo "  3. Log into X in Safari (not the X app)"
echo "  4. Scroll timeline — look for location flags / bot chips"
