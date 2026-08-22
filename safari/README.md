# Safari packaging

Shared WebExtension sources live in [`../extension/`](../extension/). This folder holds Mac-only packaging for the **Safari Web Extension** app shell (App Store / TestFlight / device install).

## Quick path

```bash
# On macOS with Xcode:
./convert.sh
open Xcode/*.xcodeproj   # path printed by convert.sh
```

Then follow **[TESTING.md](./TESTING.md)** for macOS Safari and iOS Safari (flags + country hide).

## Layout after convert

```text
safari/
├── convert.sh          # runs safari-web-extension-converter
├── TESTING.md          # iOS + macOS how-to
├── README.md           # this file
└── Xcode/              # generated (gitignored) — app + extension targets
```

`Xcode/` is generated and gitignored so Linux/CI clones stay clean. Re-run `convert.sh` on a Mac after meaningful manifest or resource set changes.

## Product intent

- **Safari = product** (paid niche, mobile Safari where Chrome extensions don’t exist)
- **Chrome = R&D** (`chrome://extensions` → Load unpacked → `extension/`)
- v1: **location flags + hide-by-country on iOS Safari**, X in the browser not the app, no backend
