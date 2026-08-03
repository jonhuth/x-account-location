# X Account Tools - AGENTS.md

Chrome extension for bot detection, location flags, and tools on X/Twitter.

## Architecture (v2)

```
x-account-location/
├── manifest.json          # MV3 extension manifest
├── popup.html/js          # Extension popup UI (tabs: Bot Detection, Location, Tools)
├── content.js             # Main content script - coordinates all features
├── pageScript.js          # Injected page script - location API only
├── countryFlags.js        # Country name to flag emoji mapping
├── botDetection.js        # Minimal local checks (DOM extraction, should-classify logic)
├── botCache.js            # Caching, batching, circuit breaker, timeout/retry
├── botUI.js               # Bot detection UI (badges, dimming, quick actions)
└── backend/               # Bun/Hono server - ALL bot classification via AI
    └── src/
        ├── index.ts       # Server with CORS, per-endpoint rate limiting
        ├── routes/        # /classify (batch), /lookup (single)
        └── lib/           # Anthropic client, system prompt, response parsing
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

### Testing
1. `chrome://extensions/` → Developer mode → Load unpacked
2. Navigate to x.com
3. After changes: click refresh icon on extension card
4. Console: `window.debugShowTweets()` or `window.forceReprocessBots()`

### Backend
```bash
cd backend
bun install
bun run dev      # Dev server on :3000
bun run lint:fix # Biome
```

Environment: `ANTHROPIC_API_KEY=sk-ant-...`

### Deployment
```bash
cd backend
railway up
```

URL: `https://x-bot-detector-production.up.railway.app`

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

**"X is not a function"**
- Add defensive type coercion
- Log actual value: `console.log(typeof val, val)`

**Backend 429**
- Rate limit exceeded
- Wait 60s or check per-endpoint limits
