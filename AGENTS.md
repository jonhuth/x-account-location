.# X Account Tools - AGENTS.md

Chrome extension for bot detection, location flags, and tools on X/Twitter.

## Architecture

```
x-account-location/
├── manifest.json          # MV3 extension manifest
├── popup.html/js          # Extension popup UI (tabs: Bot Detection, Location, Tools)
├── content.js             # Main content script - coordinates all features
├── pageScript.js          # Injected page script - accesses Twitter internal APIs
├── countryFlags.js        # Country name to flag emoji mapping
├── botDetection.js        # Local heuristics engine (score 0-100)
├── botLegitimacy.js       # User following list for legitimacy signals
├── botCache.js            # Multi-tier caching, batching, circuit breaker
├── botUI.js               # Bot detection UI (badges, dimming, overlays)
└── backend/               # Bun/Hono server for AI classification
    └── src/
        ├── index.ts       # Server entry point with CORS, rate limiting
        ├── routes/        # API endpoints
        └── lib/           # Anthropic client, prompts, cache
```

## Key Components

### Bot Detection Flow
1. `MutationObserver` detects new tweets in DOM
2. `processBotDetection()` in content.js orchestrates:
   - Check whitelist → skip if whitelisted
   - Check cache → apply verdict if cached
   - Extract data → `extractReplyData()` gets username, text, avatar, verified
   - Run heuristics → `calculateBotScore()` in botDetection.js
   - Action based on score: `dim` (local bot), `ai` (uncertain), `none` (likely human)
3. For `ai` action: queue to backend via `botCache.js`
4. Apply UI via `botUI.js`

### Script Communication
- `content.js` ↔ `pageScript.js`: `window.postMessage()` with type prefixes
  - `__fetchLocation` / `__locationResponse`: Location API
  - `__fetchFollowing` / `__followingResponse`: Following list API
- `content.js` ↔ `popup.js`: `chrome.runtime.onMessage`

### Caching Strategy
- **In-memory**: Fastest, lost on page reload
- **chrome.storage.local**: Persists across sessions
  - Location cache: 30 days (1 day for null)
  - Bot verdicts: 7 days
  - Following list: 24 hours
- **Backend LRU**: 1 hour TTL, prevents duplicate AI calls

## Code Style

### Defensive Coding (CRITICAL)

**`X is not a function` errors occur when calling methods on values:** `value.method()`

```javascript
// Bad                          // Good
text.toLowerCase()              String(text || '').toLowerCase()
data.map(fn)                    (Array.isArray(data) ? data : []).map(fn)
obj.property                    obj?.property
```

**External data is never trustworthy** — DOM extraction, Twitter API responses, message passing, popup input.

### JavaScript Conventions
- Use `const` by default, `let` only when reassignment needed
- Use optional chaining (`?.`) and nullish coalescing (`??`)
- Avoid `var`

### Chrome Extension Specifics
- Check `chrome.runtime?.id` before storage operations (context invalidation)
- Use `try/catch` around all `chrome.storage` calls
- Clean up event listeners to avoid memory leaks

## Development

### Testing the Extension
1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select this directory
4. Navigate to x.com and check console for logs
5. After code changes: click refresh icon on extension card

### Backend Commands
```bash
cd backend
bun install
bun run dev      # Dev server on :3001
bun run lint:fix # Biome lint + fix
```

### Environment Variables (Backend)
```env
ANTHROPIC_API_KEY=sk-ant-...
PORT=3001  # Optional, defaults to 3001
```

## Debugging

### Common Issues

**"Following fetch timeout"**: Page script not ready
- Check `pageScript.js` is being injected
- Check console for header capture logs
- May need to wait for Twitter to make API calls first

**"X is not a function"**: Type mismatch
- Check the function's input - is it what you expect?
- Add defensive coercion at function entry
- Log the actual value: `console.log(typeof val, val)`

**Bot detection not running**: 
- Check `botDetectionEnabled` in storage
- Check console for initialization logs
- Verify all scripts listed in manifest.json

### Useful Console Commands
```javascript
// Check bot cache
chrome.storage.local.get('bot_verdict_cache', console.log)

// Check following cache
chrome.storage.local.get('user_following_cache', console.log)

// Check whitelist
chrome.storage.local.get('bot_whitelist', console.log)

// Force refresh following list
window.BotLegitimacy?.loadUserFollowing(true)
```

## Backend Deployment

Hosted on Railway: `https://x-bot-detector-production.up.railway.app`

```bash
cd backend
railway login
railway link --project x-bot-detector
railway up
```

Set `ANTHROPIC_API_KEY` in Railway dashboard.
