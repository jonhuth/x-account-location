# Testing X Account Tools on Safari (macOS + iOS)

**Product goal (from todos):** Safari is the ship surface. Validate **location flags first** on **iOS Safari**, with X open in the browser (not the X app). Chrome remains the fast R&D loop.

**Prereqs**

| Need | Why |
|------|-----|
| Mac with **Xcode 15+** | Build/sign Safari Web Extension app |
| **Apple Developer** account (free team OK for personal device; paid for TestFlight/App Store) | Signing |
| iPhone/iPad on **iOS 16+** (or Simulator) | Mobile Safari extensions |
| Logged-in session on **x.com in Safari** | Flags use page-context GraphQL |

Convert once (or after manifest/resource changes that the converter should re-ingest):

```bash
# From repo root, on a Mac:
./safari/convert.sh
# Optional:
# BUNDLE_ID=com.yourllc.xaccounttools APP_NAME="X Account Tools" ./safari/convert.sh
```

That generates an Xcode project under `safari/Xcode/`.

---

## macOS Safari (fastest desktop check)

1. Open the generated Xcode project:
   ```bash
   open safari/Xcode/*.xcodeproj
   ```
2. Select the **macOS** scheme for the containing app.
3. **Signing & Capabilities** → choose your Team for **both** the app target and the **Safari Web Extension** target.
4. Product → **Run** (⌘R). The empty shell app launches; the extension is installed for development.
5. **Safari → Settings → Extensions**
   - Enable **X Account Tools**
   - Allow for **x.com** / **twitter.com** (or “all websites” while testing)
6. Open [https://x.com](https://x.com) in Safari, log in, scroll the timeline / open profiles.
7. **Expect (flags MVP):** country flag emoji next to accounts that expose location via About Account.
8. **Debug:**
   - Safari → Settings → Advanced → **Show features for web developers**
   - Develop → [your Mac] → Web Extension Background Content / page inspect as available
   - On the x.com tab: Develop → Show Web Inspector → Console
9. After JS-only edits inside `extension/`, rebuild without convert:
   ```bash
   SKIP_CONVERT=1 ./safari/build.sh ios-sim   # or macos
   SKIP_CONVERT=1 ./safari/run-sim.sh         # iOS Simulator reinstall
   ```
   Then hard-refresh x.com in Safari. **Re-enable the extension only if this is a fresh install** — same bundle id rebuilds usually keep Settings → Extensions enabled.

**Unsigned / developer path (macOS only):**  
Safari → Settings → Advanced → developer menu, then Develop → **Allow Unsigned Extensions** (resets when Safari quits). Prefer the Xcode-signed path for anything you will TestFlight.

---

## iOS / iPadOS Safari (flags-first MVP)

Safari Web Extensions on iOS **do not** load from a folder like Chrome. They ship inside the containing app built by Xcode.

### A. Physical device (recommended)

1. Connect iPhone/iPad, trust the computer.
2. In Xcode, select the **iOS** scheme and your **device**.
3. Signing: same Team on app + extension targets; unique bundle IDs if needed.
4. Product → **Run**. Installs the containing app on the device.
5. On the device:
   - Open **Settings → Apps → Safari → Extensions** (wording varies slightly by iOS version: **Settings → Safari → Extensions**)
   - Enable **X Account Tools**
   - Set permission to **Allow** for x.com (or ask / allow on first use)
6. Open **Safari** (not the X app) → go to `https://x.com` → log in.
7. Address bar: the **puzzle / extension** control — confirm the extension is allowed for this site.
8. Scroll a timeline. Flags should appear within a few seconds on accounts with location data.

### B. Simulator

Same Xcode Run flow with an iOS Simulator destination. Extensions work in Simulator Safari, but:

- Log in to X in the simulator browser
- Re-check **Settings → Safari → Extensions** after install
- Performance and SPA quirks can differ slightly from a real phone — still useful for “does it inject?”

### C. TestFlight (personal / beta)

1. Archive the iOS (or multiplatform) app in Xcode.
2. Upload to **App Store Connect** → internal TestFlight.
3. Install TestFlight build on your phone.
4. Enable the extension under Safari settings again (new install = re-enable).
5. Keep using **Safari + x.com**, not the X app — native X has no extension surface.

---

## Permission UX (Safari-specific)

Safari requires **explicit per-site access**. If flags never appear:

1. Extension disabled in Safari settings  
2. Site not allowed (toolbar extension menu → Always Allow on x.com)  
3. Content scripts not matching (must be `https://x.com/*` / `https://twitter.com/*`)  
4. Not logged in (location GraphQL needs session cookies in page context)  
5. Extension context invalidated after rebuild — hard-refresh the tab  

Design for this: first-run copy in the containing app should say **Open Safari → x.com → allow extension**.

---

## Feature matrix (what to validate when)

| Feature | macOS Safari | iOS Safari | Notes |
|---------|--------------|------------|--------|
| Location flags | Primary | **MVP** | content script + `pageScript.js` injection |
| Bot chips / backend classify | Yes if network OK | Yes if network OK | Needs nas backend (`http://nas.tail5becd.ts.net:3004`); not flags MVP |
| Popup toggles / storage | Yes | Yes (toolbar extension popup) | `chrome.storage` works in Safari WE |
| Clean Interests (`scripting.executeScript`) | Yes | Limited / may fail | Power-user desktop tool; not iOS MVP |
| Service worker background | N/A today | N/A today | This extension is content-script driven |

**Flags-first success criteria**

- [ ] Extension enabled on device Safari  
- [ ] x.com allowed  
- [ ] At least one flag visible on a known geo-tagged account  
- [ ] Toggle off/on from extension popup clears/restores flags  
- [ ] Cache survives tab reload (storage write path works on Safari)

---

## Chrome (still the R&D loop)

```text
chrome://extensions → Developer mode → Load unpacked → select extension/
```

Do not load the repo root anymore — shared sources live in `extension/`.

---

## Paid / App Store notes (next, not required to test)

From product notes: Safari is the **paid** surface; Chrome free culture is optional R&D.

| Model | Fit here |
|-------|----------|
| Paid app ($3–15) | Simple for flags-only MVP |
| Free + IAP Pro | Unlock bot AI / higher limits |
| Free ext + backend sub | AI classification via nas backend |

IAP needs **StoreKit in the containing app** + App Group / `nativeMessaging` / shared defaults to tell the web extension “pro unlocked.” Leave that for a follow-up once flags ship on TestFlight.

Review: privacy nutrition labels (network to nas backend + X), no tracking, account data only for classification.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| No flags, no errors | Site permission + extension enabled |
| `pageScript` 404 | `web_accessible_resources` + rebuild Resources |
| Storage never persists | Fixed in 2.2: missing `getBytesInUse` no longer blocks writes |
| Bot API fails on device | ATS / HTTPS; host_permissions include nas backend |
| Works on Mac, not iPhone | Re-enable extension after install; use Safari not X app |
| Converter missing | Full Xcode, not only CLT; `xcode-select -s /Applications/Xcode.app/...` |

---

## Hands-off / agent CLI (prefer this on a Mac)

See **[CLI.md](./CLI.md)** for the full automated vs human split.

```bash
export DEVELOPMENT_TEAM=XXXXXXXXXX   # once
./safari/doctor.sh
./safari/build.sh ios-sim            # convert + xcodebuild
./safari/run-sim.sh                  # simctl install/launch
# then once: Settings → Safari → Extensions → enable + allow x.com
```

## Linux agents / this machine

`homebox` is Linux — you **cannot** run `xcrun safari-web-extension-converter` or Xcode here. Ship the `extension/` sources + `safari/*.sh` from any machine; SSH/Tailscale to a Mac and run `./safari/build.sh` / `./safari/run-sim.sh` there.
