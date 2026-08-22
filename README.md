# Flagline

Location flags and country filter for X.

See where accounts are based. Tap a flag to hide that country. Optional calm-home preset.

- **Safari (iOS + macOS)** — product surface (paid App Store / TestFlight)
- **Chrome** — fast R&D (load unpacked)

Shared code is a Manifest V3 WebExtension under [`extension/`](./extension/). **Client-only.** No backend in the shipped package.

## Features (v1)

- Country flag next to usernames (X About Account, your session)
- Hide posts from selected countries (tap a flag, or the popup)
- Calm home: Following + less chrome (optional)
- On-device cache; no Flagline server

Bot detection and mute-manager code remain in the repo for Chrome R&D. They are not loaded in the v1 content scripts.

## Install — Chrome

1. Clone this repo
2. `chrome://extensions/` → Developer mode → **Load unpacked**
3. Select the **`extension/`** directory (not the repo root)
4. Open x.com

## Install — Safari (macOS + iOS)

Requires a **Mac with Xcode**. Packaging cannot be completed on Linux alone.

```bash
APP_NAME=Flagline BUNDLE_ID=com.aevum.flagline ./safari/convert.sh
open safari/Xcode/*.xcodeproj
```

Then follow **[safari/TESTING.md](./safari/TESTING.md)**. App Store path: **[docs/agent/app-store-ship.md](./docs/agent/app-store-ship.md)**.

**Use Safari → x.com, not the X app.**

## Repo layout

```text
extension/     Shared MV3 sources (Chrome + Safari)
safari/        convert.sh, TESTING.md, generated Xcode (gitignored)
backend/       Parked bot-classify API (not in the paid package)
```

## Privacy

See [docs/privacy.md](./docs/privacy.md). Location queries use your logged-in X session in page context. Hide lists stay in extension local storage.

## License

MIT
