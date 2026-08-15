# X Account Tools

Location flags, bot detection, and power tools for X/Twitter.

- **Chrome** — fast R&D (load unpacked)
- **Safari (iOS + macOS)** — product surface (App Store / TestFlight shell)

Shared code is a Manifest V3 WebExtension under [`extension/`](./extension/).

## Features

### Location Flags (Safari MVP)
- Detects usernames on x.com / twitter.com
- Uses X’s GraphQL About Account API (page context, your session)
- Country flag emoji next to usernames
- Works with infinite scroll; caches locations locally

### Bot Detection
- Client-first resolution (whitelist, follow trust, cache, local filters)
- Optional Claude Haiku classification via the nas backend
- Badges, dimming, quick actions

### Clean Interests
- Desktop-oriented tool for Twitter interests settings
- Prefer Chrome or macOS Safari; not the iOS MVP path

## Install — Chrome

1. Clone this repo
2. `chrome://extensions/` → Developer mode → **Load unpacked**
3. Select the **`extension/`** directory (not the repo root)
4. Open x.com

## Install — Safari (macOS + iOS)

Requires a **Mac with Xcode**. Packaging cannot be completed on Linux alone.

```bash
./safari/convert.sh          # generates safari/Xcode/
open safari/Xcode/*.xcodeproj
```

Then follow **[safari/TESTING.md](./safari/TESTING.md)** for:

- macOS Safari developer enable + site permissions
- iOS device / Simulator run from Xcode
- TestFlight personal install
- Flags-first success checklist

**Important:** Use **Safari → x.com**, not the X app. Mobile Chrome/Brave cannot run this extension.

## Backend (bot AI)

```bash
cd backend
bun install
bun run dev      # :3000
```

Env: `ANTHROPIC_API_KEY=sk-ant-...`  
Production: `http://nas.tail5becd.ts.net:3004` (Docker on nas; Railway retired 2026-08-13)

## Repo layout

```text
extension/     Shared MV3 sources (Chrome + Safari)
safari/        convert.sh, TESTING.md, generated Xcode (gitignored)
backend/       Bun/Hono classify API
```

## Monetization direction

Safari is intended as a **paid niche** product (paid app, IAP, or backend sub for AI). Chrome can stay free for personal use / R&D. StoreKit + license unlock in the containing app is a follow-up after flags ship on TestFlight.

## Privacy

- Location queries use your logged-in X session in page context
- Bot classification may call the hosted backend with reply/profile signals
- Verdicts and location cache stored in extension local storage
- No analytics SDK in the extension package today

## License

MIT
