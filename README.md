# Sift

Cut noise on X. Hide farm accounts, spam countries, and distracting chrome. Everything stays on this device.

- **Safari (iOS + macOS)** — product surface (paid App Store / TestFlight)
- **Chrome** — fast R&D (load unpacked)

This is an x.com-only SNR tool. It is **not** [Desloppify](https://github.com/jonhuth/desloppify) (all-web slop). Shared MV3 sources live in [`extension/`](./extension/).

## What it does

- **Hide farm / bot accounts** — local profile gates (extreme follow-farm, new shells, look-alike reply clusters). People you follow are never scored. No AI backend in v1.
- **Hide countries** — tap a flag, or pick from the popup. For countries that flood the feed.
- **X chrome** — per-view toggles (For you, Explore, trends, Who to follow, promoted, Grok, Communities, Premium, Topics). Saved in `chrome.storage.local`. Calm-home preset if you want one tap.

## Install — Chrome

1. `chrome://extensions/` → Developer mode → **Load unpacked**
2. Select **`extension/`**
3. Open x.com

## Install — Safari

Mac with Xcode:

```bash
APP_NAME=Sift BUNDLE_ID=com.aevum.sift ./safari/convert.sh
open safari/Xcode/*.xcodeproj
```

Use **Safari → x.com**, not the X app. See [safari/TESTING.md](./safari/TESTING.md) and [docs/agent/app-store-ship.md](./docs/agent/app-store-ship.md).

## Privacy

[docs/privacy.md](./docs/privacy.md). No Sift server. Location comes from your X session on the page.

## License

MIT
