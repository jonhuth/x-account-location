# App Store Connect — paste-ready listing

Use this in App Store Connect after the Mac archive/TestFlight build. Do not scrape ASC.

## Identity

| Field | Value |
|---|---|
| Name | Spam Filter for X |
| Subtitle | Hide bots, countries, clutter |
| Bundle ID | `com.aevum.spamfilter` |
| SKU | `spam-filter-for-x` |
| Primary language | English (US) |
| Category | Utilities (Safari Extensions) |
| Price | $4.99 USD, paid-upfront, no IAP |
| Age | 12+ if X UGC is declared; otherwise 4+. Prefer 12+ if the questionnaire mentions user-generated social content. |

## URLs

| Field | Value |
|---|---|
| Privacy Policy | https://github.com/jonhuth/spam-filter-for-x/blob/master/docs/privacy.md |
| Support | https://github.com/jonhuth/spam-filter-for-x/issues |
| Marketing (optional) | leave blank |

## Keywords

```
twitter,mute,farm,timeline,safari,following,ads,promoted,explore,location,flag,bot
```

Do not repeat: spam, filter, X, hide, bots, countries, clutter.

## Promotional text (170 chars, optional, editable without review)

Hide farm accounts, posts from countries that flood the feed, and noisy X chrome. Runs on your iPhone in Safari. Nothing leaves the device.

## Description

```
Spam Filter for X cleans your X (Twitter) timeline in Safari.

Hide farm and bot accounts. Hide posts from countries that spam the feed. Hide For you, Explore, trends, ads, and other chrome you do not want. Settings stay on this device.

Works in Safari on x.com. It does not work in the X app.

How to turn it on
1. Open Settings → Safari → Extensions and enable Spam Filter for X.
2. Open Safari and go to x.com (not the X app).
3. Allow the extension for x.com.
4. Farm posts hide. Tap a country flag to hide that country. Open the extension to pick chrome to hide.

Privacy
No account. No tracking. No Spam Filter server. Location comes from your logged-in X session on the page. Hide lists stay in Safari’s extension storage on your iPhone or Mac.
```

## What’s New (1.0 / 3.0.0)

```
First App Store release.

• Hide farm / bot accounts (on-device)
• Hide posts from selected countries (tap a flag)
• Hide X chrome, saved on this device
```

## App Privacy (nutrition labels)

- Data collected: **No**
- Tracking: **No**
- Linked to identity: n/a
- Used for tracking: n/a

Review notes (paste in App Review Information):

```
This is a Safari Web Extension for x.com only.

It hides farm-like accounts using on-device profile signals, hides tweets from countries the user selects, and hides optional X UI chrome. Processing stays on device. The extension does not call our servers.

Test: enable the extension, open https://x.com in Safari (not the X app), allow the site, scroll the timeline. Farm posts should hide. Tap a flag to hide that country. Chrome toggles are in the extension popup.

Demo account: use any logged-in x.com session on the review device.
```

## Containing app (Xcode shell)

After `./safari/convert.sh`, replace the empty SwiftUI placeholder with:

```
Spam Filter for X

1. Settings → Safari → Extensions → enable Spam Filter for X
2. Open Safari → x.com (not the X app)
3. Allow this extension for x.com

Farm posts hide. Tap a flag to hide that country.
Chrome toggles live in the Safari extension popup.
```

Do not add login, analytics, or IAP to the shell.

## Mac commands (this laptop — no inbound SSH)

```bash
cd ~/dev/spam-filter-for-x
git pull
export DEVELOPMENT_TEAM=XXXXXXXXXX   # Aevum 10-char Team ID
export BUNDLE_ID=com.aevum.spamfilter
export APP_NAME="Spam Filter for X"
./safari/doctor.sh
./safari/convert.sh
./safari/build.sh ios-sim
./safari/run-sim.sh
```

Then: Simulator Settings → Safari → Extensions → enable. Safari → x.com → allow. Archive in Xcode → App Store Connect → TestFlight → listing above → submit.
