#!/usr/bin/env bash
# Convert WebExtension → Xcode project and build (macOS only).
#
# Usage:
#   ./safari/build.sh                  # convert + build iOS Simulator + macOS
#   ./safari/build.sh ios-sim          # iOS Simulator only
#   ./safari/build.sh macos            # macOS only
#   ./safari/build.sh convert          # convert only
#   SKIP_CONVERT=1 ./safari/build.sh   # rebuild without re-convert
#
# Env:
#   DEVELOPMENT_TEAM   Apple Team ID (required for device; recommended always)
#   BUNDLE_ID          reverse-DNS id for convert
#   APP_NAME           display name (default: X Account Tools)
#   IOS_SIM_NAME       default: iPhone 16
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: must run on macOS" >&2
  exit 1
fi

TARGET="${1:-all}"
APP_NAME="${APP_NAME:-X Account Tools}"
BUNDLE_ID="${BUNDLE_ID:-com.example.xaccounttools}"
IOS_SIM_NAME="${IOS_SIM_NAME:-iPhone 16}"
XCODE_DIR="${ROOT}/safari/Xcode"
SKIP_CONVERT="${SKIP_CONVERT:-0}"

find_xcodeproj() {
  local p
  p=$(find "${XCODE_DIR}" -name '*.xcodeproj' -maxdepth 4 2>/dev/null | head -1 || true)
  if [[ -z "$p" ]]; then
    echo "error: no .xcodeproj under ${XCODE_DIR} — run convert first" >&2
    exit 1
  fi
  echo "$p"
}

find_scheme() {
  local proj="$1"
  # Prefer scheme matching app name; else first listed
  local schemes
  schemes=$(xcodebuild -list -project "$proj" 2>/dev/null | sed -n '/Schemes:/,$p' | tail -n +2 | sed 's/^[[:space:]]*//' | grep -v '^$' || true)
  if echo "$schemes" | grep -qx "${APP_NAME}"; then
    echo "${APP_NAME}"
    return
  fi
  echo "$schemes" | head -1
}

run_convert() {
  echo "==> convert"
  APP_NAME="${APP_NAME}" BUNDLE_ID="${BUNDLE_ID}" "${ROOT}/safari/convert.sh"
}

# After first successful GUI/Xcode team pick, DEVELOPMENT_TEAM can be injected:
signing_args() {
  local args=()
  if [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
    args+=(DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM}")
    args+=(-allowProvisioningUpdates)
  fi
  printf '%s\n' "${args[@]}"
}

build_ios_sim() {
  local proj scheme dest
  proj=$(find_xcodeproj)
  scheme=$(find_scheme "$proj")
  dest="platform=iOS Simulator,name=${IOS_SIM_NAME}"
  echo "==> xcodebuild iOS Simulator scheme=${scheme} dest=${dest}"
  # shellcheck disable=SC2046
  xcodebuild \
    -project "$proj" \
    -scheme "$scheme" \
    -destination "$dest" \
    -configuration Debug \
    $(signing_args) \
    build
}

build_macos() {
  local proj scheme
  proj=$(find_xcodeproj)
  scheme=$(find_scheme "$proj")
  echo "==> xcodebuild macOS scheme=${scheme}"
  # shellcheck disable=SC2046
  xcodebuild \
    -project "$proj" \
    -scheme "$scheme" \
    -destination 'platform=macOS' \
    -configuration Debug \
    $(signing_args) \
    build
}

case "$TARGET" in
  convert)
    run_convert
    ;;
  ios-sim|ios|sim)
    [[ "$SKIP_CONVERT" == "1" ]] || run_convert
    build_ios_sim
    ;;
  macos|mac)
    [[ "$SKIP_CONVERT" == "1" ]] || run_convert
    build_macos
    ;;
  all)
    [[ "$SKIP_CONVERT" == "1" ]] || run_convert
    build_ios_sim
    build_macos
    ;;
  *)
    echo "usage: $0 [all|ios-sim|macos|convert]" >&2
    exit 2
    ;;
esac

echo
echo "Build finished. Next:"
echo "  ./safari/run-sim.sh          # install+launch on iOS Simulator (still enable extension in Settings once)"
echo "  open safari/Xcode/*.xcodeproj  # only if signing/GUI needed"
echo "  Human: Safari → Extensions → enable + allow x.com (once per install)"
