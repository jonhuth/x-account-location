#!/usr/bin/env bash
# Convert WebExtension → Xcode project and build (macOS only).
#
# Usage:
#   ./safari/build.sh                  # convert + build iOS Simulator + macOS
#   ./safari/build.sh ios-sim          # iOS Simulator only
#   ./safari/build.sh macos            # macOS only
#   ./safari/build.sh convert          # convert only
#   SKIP_CONVERT=1 ./safari/build.sh   # rebuild without re-convert
#   SKIP_DOCTOR=1  ./safari/build.sh   # skip doctor (when already known good)
#
# Env:
#   DEVELOPMENT_TEAM   Apple Team ID (required for device; recommended always)
#   BUNDLE_ID          reverse-DNS id for convert
#   APP_NAME           display name (default: Sift)
#   IOS_SIM_NAME       preferred sim name (optional; auto-picks if missing)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: must run on macOS" >&2
  exit 1
fi

if [[ "${SKIP_DOCTOR:-0}" != "1" && -x "${ROOT}/safari/doctor.sh" ]]; then
  if ! "${ROOT}/safari/doctor.sh" >/tmp/safari-doctor.out 2>&1; then
    cat /tmp/safari-doctor.out >&2
    exit 1
  fi
fi

TARGET="${1:-all}"
APP_NAME="${APP_NAME:-Sift}"
BUNDLE_ID="${BUNDLE_ID:-com.aevum.sift}"
IOS_SIM_NAME="${IOS_SIM_NAME:-}"
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

list_schemes() {
  local proj="$1"
  xcodebuild -list -project "$proj" 2>/dev/null \
    | sed -n '/Schemes:/,$p' | tail -n +2 \
    | sed 's/^[[:space:]]*//' | grep -v '^$' || true
}

# platform: ios | macos
find_scheme() {
  local proj="$1" platform="${2:-}"
  local schemes scheme
  schemes=$(list_schemes "$proj")
  if [[ -z "$schemes" ]]; then
    echo "error: no schemes in $proj" >&2
    exit 1
  fi

  if [[ "$platform" == "ios" ]]; then
    # Prefer "Sift (iOS)" style schemes from the converter
    while IFS= read -r scheme; do
      [[ "$scheme" == *"(iOS)"* || "$scheme" == *iOS* ]] && { echo "$scheme"; return; }
    done <<<"$schemes"
  fi
  if [[ "$platform" == "macos" ]]; then
    while IFS= read -r scheme; do
      [[ "$scheme" == *"(macOS)"* || "$scheme" == *macOS* || "$scheme" == *Mac* ]] && { echo "$scheme"; return; }
    done <<<"$schemes"
    # Single multiplatform scheme
    echo "$schemes" | head -1
    return
  fi

  if echo "$schemes" | grep -qx "${APP_NAME}"; then
    echo "${APP_NAME}"
    return
  fi
  echo "$schemes" | head -1
}

# Pick a real available iPhone simulator (name or generic platform fallback).
resolve_ios_sim_destination() {
  local preferred="${IOS_SIM_NAME:-}"
  local line name

  if [[ -n "$preferred" ]]; then
    if xcrun simctl list devices available 2>/dev/null | grep -F "$preferred" | grep -q "iPhone"; then
      echo "platform=iOS Simulator,name=${preferred}"
      return
    fi
    echo "note: preferred sim '${preferred}' not available — auto-picking" >&2
  fi

  # First available iPhone from simctl
  line=$(xcrun simctl list devices available 2>/dev/null | grep -E '^\s+iPhone' | head -1 || true)
  if [[ -n "$line" ]]; then
    # "    iPhone 16 Pro (UUID) (Shutdown)" or similar
    name=$(echo "$line" | sed -E 's/^[[:space:]]+//' | sed -E 's/ \([A-F0-9-]{36}\).*//')
    if [[ -n "$name" ]]; then
      echo "platform=iOS Simulator,name=${name}"
      return
    fi
  fi

  # Generic destination — xcodebuild picks any installed iOS Simulator runtime
  echo "generic/platform=iOS Simulator"
}

signing_args() {
  local args=()
  if [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
    args+=(DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM}")
    args+=(-allowProvisioningUpdates)
  fi
  # CODE_SIGN_IDENTITY for sim can stay automatic; team helps avoid empty platform issues
  printf '%s\n' "${args[@]}"
}

run_convert() {
  echo "==> convert"
  APP_NAME="${APP_NAME}" BUNDLE_ID="${BUNDLE_ID}" "${ROOT}/safari/convert.sh"
}

build_ios_sim() {
  local proj scheme dest
  proj=$(find_xcodeproj)
  scheme=$(find_scheme "$proj" ios)
  dest=$(resolve_ios_sim_destination)
  echo "==> xcodebuild iOS Simulator"
  echo "    project: $proj"
  echo "    scheme:  $scheme"
  echo "    dest:    $dest"
  # shellcheck disable=SC2046
  if ! xcodebuild \
    -project "$proj" \
    -scheme "$scheme" \
    -destination "$dest" \
    -configuration Debug \
    $(signing_args) \
    build; then
    echo >&2
    echo "error: iOS Simulator build failed." >&2
    echo "Your log usually means: iOS Simulator *platform/runtime* is not installed." >&2
    echo "Fix:" >&2
    echo "  xcodebuild -downloadPlatform iOS" >&2
    echo "  # or: Xcode → Settings → Platforms → iOS → Get" >&2
    echo "  # wait for download, then:" >&2
    echo "  ./safari/doctor.sh && ./safari/build.sh ios-sim" >&2
    echo "Meanwhile you can test on macOS Safari:" >&2
    echo "  ./safari/build.sh macos" >&2
    echo "  open \"$proj\"   # Run the macOS scheme, then enable extension in Safari Settings" >&2
    exit 1
  fi
}

build_macos() {
  local proj scheme
  proj=$(find_xcodeproj)
  scheme=$(find_scheme "$proj" macos)
  echo "==> xcodebuild macOS scheme=${scheme}"
  # shellcheck disable=SC2046
  if ! xcodebuild \
    -project "$proj" \
    -scheme "$scheme" \
    -destination 'platform=macOS' \
    -configuration Debug \
    $(signing_args) \
    build; then
    echo "error: macOS build failed. Try: open \"$(find_xcodeproj)\" and set Team on both targets." >&2
    exit 1
  fi
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
echo "  ./safari/run-sim.sh"
echo "  Human once: Simulator Settings → Safari → Extensions → enable + allow x.com"
