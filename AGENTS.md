# Flagline - AGENTS.md

Flagline is an iOS Safari extension for location flags and client-only country filtering on X.

**Surface strategy:** Safari on iOS is the paid product. Chrome is the load-unpacked R&D loop. Keep X in Safari, not the native X app.

## Monday MVP

1. Show location flags beside x.com usernames.
2. Hide tweet articles from selected countries.
3. Let a flag tap toggle that country.
4. Expose location, hidden countries, onboarding, and Calm home in the popup.
5. Keep all shipped behavior client-only.

## Architecture

```text
x-account-location/
├── extension/             # Shared MV3 WebExtension source
│   ├── manifest.json      # Flagline 3.0.0
│   ├── popup.html/js      # Location first, country hide, Calm home
│   ├── content.js         # Location and timeline UI coordinator
│   ├── pageScript.js      # X AboutAccountQuery in page context
│   ├── countryFlags.js    # Canonical label to emoji map
│   ├── countryFilter.js   # Client-only hidden-country storage and matching
│   ├── focusMode.js       # Optional Calm home behavior
│   ├── bot*.js            # Parked Chrome R&D; default off
│   └── icons/
├── safari/                # Mac-only converter, build, and test docs
├── backend/               # Parked bot R&D; not part of the paid package path
└── docs/agent/            # Agent and App Store runbooks
```

## Country filtering

Storage key: `hidden_countries`

```javascript
{
  countries: ['India', 'United States'],
  updatedAt: 0,
}
```

`countryFilter.js` canonicalizes exact country names, the last comma-separated part, and the longest matching `COUNTRY_FLAGS` key. Unknown labels remain hideable as trimmed regions.

Only `article[data-testid="tweet"]` can receive:

- `data-xat-country="India"`
- `data-xat-geo-hidden="1"`
- `display: none`

Do not hide profile headers or `UserCell` elements. A flag is a tap target with a title and accessible label. Storage changes and the `countryFilterUpdated` popup message trigger a rescan.

## Location flow

1. A content observer finds username containers.
2. `pageScript.js` makes X's `AboutAccountQuery` with the user's page session.
3. `content.js` caches the returned location for 30 days.
4. `countryFlags.js` supplies the emoji.
5. `content.js` inserts the flag and annotates the containing tweet.
6. `countryFilter.js` decides whether the tweet is hidden.

No external backend host permission belongs in `extension/manifest.json`.

## Parked bot R&D

Bot and mute-manager files stay in `extension/` for research but are **not** in v1 `content_scripts`. `bot_detection_enabled` defaults to `false`. Backend URLs in parked files are empty. The Flagline popup does not expose bot AI, lookup, Railway, Anthropic, Clean Interests, or Apply-to-X.

## Safari compatibility

- Prefer `chrome.*`; Safari Web Extensions support that namespace.
- Do not gate storage writes on `getBytesInUse`. A missing quota API means allow the write.
- iOS requires an Xcode containing app and per-site permission.
- Keep the extension content-script driven. Do not require a persistent background worker.
- Do not invent or commit generated Xcode project files.

## Defensive JavaScript

```javascript
String(value || '').toLowerCase()
(Array.isArray(value) ? value : []).map(fn)
object?.property ?? fallback
```

Check `chrome.runtime?.id` before storage operations in invalidatable extension contexts. Wrap storage access in `try/catch`. No secrets or noisy console logging.

## Development

### Chrome

1. Open `chrome://extensions/` and enable Developer mode.
2. Load unpacked from `extension/`.
3. Open x.com.
4. Refresh the extension and x.com after source changes.

### Safari

Safari conversion and Xcode builds are Mac-only.

```bash
export DEVELOPMENT_TEAM=XXXXXXXXXX
./safari/doctor.sh
./safari/build.sh ios-sim
./safari/run-sim.sh
```

Human setup remains: enable Flagline in Safari settings and allow x.com. See `safari/TESTING.md` and `docs/agent/app-store-ship.md`.

## MVP checks

```bash
node --check extension/countryFilter.js
node --check extension/content.js
node --check extension/popup.js
rg -n 'railway|anthropic|x-bot-detector' \
  extension/manifest.json extension/popup.html extension/popup.js extension/countryFilter.js
```

The search must return no matches. Chrome must load from `extension/`. Safari conversion, signing, TestFlight, and App Store submission stay on a Mac.
