# X Account Tools - AGENTS.md

Browser extension for bot detection, location flags, and tools on X/Twitter.

**Surface strategy:** Chrome = R&D loop. **Safari (iOS/macOS) = product** (paid niche / App Store). Flags-first MVP on iOS Safari; keep X in the browser, not the app.

## Architecture (v2.2)

```
x-account-location/
├── extension/             # Shared MV3 WebExtension (Chrome + Safari source of truth)
│   ├── manifest.json
│   ├── popup.html/js      # Tabs: Bot Detection, Location, Tools
│   ├── content.js         # Coordinates all features
│   ├── pageScript.js      # Injected page script — location API only
│   ├── countryFlags.js
│   ├── botDetection.js    # DOM extraction, should-classify
│   ├── botCache.js        # Cache, batching, circuit breaker
│   ├── botUI.js           # Badges, dimming, quick actions
│   └── icons/
├── safari/                # Mac packaging (converter + testing docs)
│   ├── convert.sh         # xcrun safari-web-extension-converter (macOS only)
│   ├── TESTING.md         # iOS + macOS install/test steps
│   └── Xcode/             # generated, gitignored
├── backend/               # Bun/Hono — bot classification via AI
│   └── src/
└── icons/                 # convenience symlinks → extension/icons
```

## Key Design Decisions

### Hybrid Classification (client-first, server fallback)
**Resolve offline first**, then Haiku only when needed:
1. Personal override / whitelist
2. **Follow hard-trust** (accounts you follow never hit the multi-tenant API)
3. Verdict cache + account reputation prior
4. Local template prefilter (vapid phrases / LLM filler)
5. Passive profile fields from intercepted X traffic (no extra UserByScreenName)
6. Server: local filter → LRU → Claude Haiku

Following list is paginated slowly in the background (capped pages, delays) and cached 24h.
`userFollows` is client-only so shared server cache stays non-personalized.

### Safari compatibility
- Prefer durable `chrome.*` APIs (Safari Web Extensions support the Chrome namespace).
- Do **not** gate storage writes on `getBytesInUse` — Safari often lacks it; missing API must mean “allow write.”
- iOS: no unpacked load; must build via Xcode containing app. Per-site permission UX is required.
- Content-script driven (no required background service worker) — fits non-persistent iOS model.
- Clean Interests uses `scripting.executeScript` — desktop-oriented; not the iOS MVP.

### Performance Optimizations
- **Debounced observers**: 300ms mutation, 500ms scroll
- **Throttled processing**: 2s minimum between bot batches
- **Batching**: Up to 5 replies per API call
- **Circuit breaker**: Backs off exponentially on errors
- **Request timeout**: 8s with automatic retry
- **System prompt caching**: Static categories in Anthropic system prompt

### Rate Limits (Backend)
- Global: 100 requests/min per IP
- Classify: 30 batch requests/min per IP
- Lookup: 20 requests/min per IP

## Bot Detection Flow

```
1. MutationObserver detects new tweets
2. scheduleBotProcessing() throttles (2s interval)
3. processBotDetectionBatch() filters visible tweets
4. For each tweet:
   a. Check whitelist → skip
   b. Check cache → apply verdict if cached
   c. Extract DOM data → extractReplyData()
   d. Quick local check → shouldClassify() (only skips verified/followed)
   e. Queue for server → queueForClassification()
5. Server batches replies, classifies via AI
6. Apply UI → applyBotUI() (badge, dimming, actions)
```

## Script Communication

- `content.js` ↔ `pageScript.js`: `window.postMessage()` for location API only
- `content.js` ↔ `popup.js`: `chrome.runtime.onMessage`
- `content.js` ↔ `backend`: fetch with timeout/retry

## Caching

| Cache | TTL | Purpose |
|-------|-----|---------|
| Bot verdicts (memory) | Session | Fast re-lookup |
| Bot verdicts (storage) | 7 days | Persist across sessions |
| Whitelist (storage) | Permanent | User overrides |
| Location cache | 30 days | Avoid API spam |
| Backend LRU | 1 hour | Dedup AI calls |

## Code Style

### Defensive Coding

```javascript
// BAD - assumes types
text.toLowerCase()
data.map(fn)

// GOOD - defensive
String(text || '').toLowerCase()
(Array.isArray(data) ? data : []).map(fn)
obj?.property ?? defaultValue
```

### Extension Context
```javascript
// Check before storage ops
if (!chrome.runtime?.id) return;

// Wrap storage in try/catch
try {
  await chrome.storage.local.get(key);
} catch (e) {
  if (!e.message?.includes('Extension context invalidated')) throw e;
}
```

## Development

### Chrome (any machine)
1. `chrome://extensions/` → Developer mode → **Load unpacked** → select **`extension/`**
2. Navigate to x.com
3. After changes: refresh icon on extension card
4. Console: `window.debugShowTweets()` or `window.forceReprocessBots()`

### Safari (macOS host with Xcode / agent CLI)
```bash
export DEVELOPMENT_TEAM=XXXXXXXXXX   # once in shell profile
./safari/doctor.sh
./safari/build.sh ios-sim            # convert + xcodebuild
./safari/run-sim.sh                  # simctl install/launch
# human once: Settings → Safari → Extensions → enable + allow x.com
```
Hands-off map: **`safari/CLI.md`**. GUI walkthrough: **`safari/TESTING.md`**.

Linux agents cannot run the converter or Xcode — edit `extension/` here; SSH to Mac for build/sim.

### Backend
```bash
cd backend
bun install
bun run dev      # Dev server on :3000
bun run lint:fix # Biome
```

Environment: `ANTHROPIC_API_KEY=sk-ant-...`

### Deployment

Docker on **nas** (`x-account-backend`), port 3004. Railway retired 2026-08-13.

URL: `http://nas.tail5becd.ts.net:3004`

## Debugging

### Console Commands
```javascript
chrome.storage.local.get('bot_verdict_cache', console.log)
chrome.storage.local.get('bot_whitelist', console.log)
window.debugShowTweets()    // Show all tweets + status
window.forceReprocessBots() // Reprocess all tweets
```

### Common Issues

**Tweets not being classified**
- Check `botDetectionEnabled` in storage
- Check network tab for backend requests
- Look for circuit breaker logs

**Flags missing on Safari**
- Extension enabled + **x.com allowed** (Safari per-site permissions)
- Using Safari, not the X app
- Rebuild/reinstall after Xcode changes

**"X is not a function"**
- Add defensive type coercion
- Log actual value: `console.log(typeof val, val)`

**Backend 429**
- Rate limit exceeded
- Wait 60s or check per-endpoint limits
