# Spam Filter for X

Hide bots, spam countries, and clutter on X. All on this device.

- **Safari (iOS + macOS)** — product (App Store / TestFlight)
- **Chrome** — load unpacked from `extension/` for R&D

x.com only. Not Desloppify (all-web slop).

## What it does

- Hide farm / bot accounts (local signals; people you follow stay)
- Hide posts from countries that flood the feed
- Hide X chrome (For you, Explore, trends, Who to follow, ads, …) — saved locally

## Chrome

`chrome://extensions` → Load unpacked → `extension/`

## Safari

```bash
APP_NAME="Spam Filter for X" BUNDLE_ID=com.aevum.spamfilter ./safari/convert.sh
```

Use Safari → x.com, not the X app. [safari/TESTING.md](./safari/TESTING.md) · [docs/agent/app-store-ship.md](./docs/agent/app-store-ship.md)

## Privacy

[docs/privacy.md](./docs/privacy.md)

## License

MIT
