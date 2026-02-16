// Bot Detection Caching & Batching System
// Multi-tier cache with request coalescing and circuit breaker

// Configuration
const BOT_CACHE_KEY = 'bot_verdict_cache';
const BOT_CACHE_EXPIRY_DAYS = 7;
const BOT_CACHE_SAVE_INTERVAL = 5000;
const BOT_BATCH_SIZE = 5;
const BOT_BATCH_DELAY = 2000;
const BACKEND_URL = 'https://x-bot-detector-production.up.railway.app'; // Update after deploy

// ============================================================================
// Multi-tier Cache State
// ============================================================================

// Layer 1: In-memory cache (instant)
const botVerdictCache = new Map(); // Map<username, verdict>

// Layer 2: Pending chrome.storage save
let pendingCacheSave = null;

// ============================================================================
// Batching & Coalescing State
// ============================================================================

const pendingBotRequests = new Map(); // Map<username, Promise<verdict>>
const botClassificationQueue = [];
let batchTimeout = null;

// ============================================================================
// Circuit Breaker State
// ============================================================================

let backendCircuitOpen = false;
let circuitOpenUntil = 0;
let consecutiveErrors = 0;
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_BASE_MS = 60000; // 1 minute

// ============================================================================
// Cache Operations
// ============================================================================

// Load bot cache from chrome.storage
async function loadBotCache() {
  try {
    const result = await chrome.storage.local.get(BOT_CACHE_KEY);
    if (result[BOT_CACHE_KEY]) {
      const cached = result[BOT_CACHE_KEY];
      const now = Date.now();
      let loaded = 0;
      let expired = 0;
      
      for (const [username, data] of Object.entries(cached)) {
        if (data.expiry && data.expiry > now) {
          botVerdictCache.set(username.toLowerCase(), data);
          loaded++;
        } else {
          expired++;
        }
      }
      
      console.log(`Bot cache: loaded ${loaded}, expired ${expired}`);
    }
  } catch (error) {
    console.error('Error loading bot cache:', error);
  }
}

// Save bot cache to chrome.storage (debounced)
function saveBotCache(username, verdict) {
  const now = Date.now();
  const expiry = now + (BOT_CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  
  botVerdictCache.set(username.toLowerCase(), {
    ...verdict,
    expiry,
    cachedAt: now
  });
  
  // Debounce save
  if (!pendingCacheSave) {
    pendingCacheSave = setTimeout(async () => {
      await persistBotCache();
      pendingCacheSave = null;
    }, BOT_CACHE_SAVE_INTERVAL);
  }
}

// Persist cache to storage
async function persistBotCache() {
  try {
    const cacheObj = {};
    for (const [username, data] of botVerdictCache.entries()) {
      cacheObj[username] = data;
    }
    await chrome.storage.local.set({ [BOT_CACHE_KEY]: cacheObj });
    console.log(`Bot cache: persisted ${botVerdictCache.size} entries`);
  } catch (error) {
    console.error('Error persisting bot cache:', error);
  }
}

// Get cached verdict (instant)
function getCachedVerdict(username) {
  const key = username.toLowerCase();
  const cached = botVerdictCache.get(key);
  
  if (cached && cached.expiry && cached.expiry > Date.now()) {
    return cached;
  }
  
  // Expired, remove it
  if (cached) {
    botVerdictCache.delete(key);
  }
  
  return null;
}

// ============================================================================
// Circuit Breaker
// ============================================================================

function isCircuitOpen() {
  if (!backendCircuitOpen) return false;
  if (Date.now() >= circuitOpenUntil) {
    // Circuit expired, allow one request through
    backendCircuitOpen = false;
    return false;
  }
  return true;
}

function recordSuccess() {
  consecutiveErrors = 0;
  if (backendCircuitOpen) {
    console.log('Circuit breaker: closed (success)');
    backendCircuitOpen = false;
  }
}

function recordError() {
  consecutiveErrors++;
  if (consecutiveErrors >= CIRCUIT_THRESHOLD && !backendCircuitOpen) {
    backendCircuitOpen = true;
    // Exponential backoff: 1min, 2min, 4min, etc.
    const backoffMs = CIRCUIT_BASE_MS * Math.pow(2, consecutiveErrors - CIRCUIT_THRESHOLD);
    circuitOpenUntil = Date.now() + backoffMs;
    console.warn(`Circuit breaker: OPEN for ${backoffMs / 1000}s (${consecutiveErrors} consecutive errors)`);
  }
}

// ============================================================================
// Request Coalescing & Batching
// ============================================================================

/**
 * Queue a username for AI classification
 * Returns existing promise if already pending (coalescing)
 */
function queueForClassification(username, replyData) {
  const key = username.toLowerCase();
  
  // Coalesce: return existing promise if pending
  if (pendingBotRequests.has(key)) {
    console.log(`Bot: coalescing request for @${username}`);
    return pendingBotRequests.get(key);
  }
  
  const promise = new Promise((resolve) => {
    botClassificationQueue.push({
      username: key,
      replyData,
      resolve
    });
    
    // Dispatch when batch is full or after delay
    if (botClassificationQueue.length >= BOT_BATCH_SIZE) {
      dispatchBatch();
    } else if (!batchTimeout) {
      batchTimeout = setTimeout(dispatchBatch, BOT_BATCH_DELAY);
    }
  });
  
  pendingBotRequests.set(key, promise);
  return promise;
}

// Dispatch batch to backend
async function dispatchBatch() {
  if (batchTimeout) {
    clearTimeout(batchTimeout);
    batchTimeout = null;
  }
  
  const batch = botClassificationQueue.splice(0, BOT_BATCH_SIZE);
  if (batch.length === 0) return;
  
  console.log(`Bot: dispatching batch of ${batch.length} for AI classification`);
  
  // Check circuit breaker
  if (isCircuitOpen()) {
    console.warn('Bot: circuit open, returning fallback verdicts');
    batch.forEach(item => {
      const fallback = createFallbackVerdict('circuit_open');
      pendingBotRequests.delete(item.username);
      item.resolve(fallback);
    });
    return;
  }
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replies: batch.map(b => b.replyData)
      })
    });
    
    if (!response.ok) {
      throw new Error(`Backend error: ${response.status}`);
    }
    
    const data = await response.json();
    recordSuccess();
    
    // Resolve each promise with its result
    batch.forEach((item, i) => {
      const verdict = data.verdicts?.[i] || createFallbackVerdict('no_result');
      saveBotCache(item.username, verdict);
      pendingBotRequests.delete(item.username);
      item.resolve(verdict);
    });
    
  } catch (error) {
    console.error('Bot: batch classification error:', error);
    recordError();
    
    // Resolve all as fallback
    batch.forEach(item => {
      const fallback = createFallbackVerdict('error');
      pendingBotRequests.delete(item.username);
      item.resolve(fallback);
    });
  }
  
  // Process any remaining items in queue
  if (botClassificationQueue.length > 0) {
    if (botClassificationQueue.length >= BOT_BATCH_SIZE) {
      setTimeout(dispatchBatch, 100);
    } else {
      batchTimeout = setTimeout(dispatchBatch, BOT_BATCH_DELAY);
    }
  }
}

// Create fallback verdict when backend unavailable
function createFallbackVerdict(source) {
  return {
    isBot: false,
    confidence: 0,
    category: 'genuine',
    reason: `Classification unavailable (${source})`,
    signals: [],
    source: 'fallback'
  };
}

// ============================================================================
// Bot-or-Not Lookup (single username)
// ============================================================================

async function lookupUsername(username, context = {}) {
  const key = username.toLowerCase();
  
  // Check cache first
  const cached = getCachedVerdict(key);
  if (cached) {
    return { ...cached, cached: true };
  }
  
  // Check circuit breaker
  if (isCircuitOpen()) {
    return { ...createFallbackVerdict('circuit_open'), cached: false };
  }
  
  try {
    const params = new URLSearchParams();
    if (context.bio) params.set('bio', context.bio);
    if (context.displayName) params.set('displayName', context.displayName);
    if (context.followers) params.set('followers', context.followers);
    if (context.following) params.set('following', context.following);
    if (context.verified) params.set('verified', context.verified);
    if (context.heuristicScore) params.set('heuristicScore', context.heuristicScore);
    if (context.userFollows) params.set('userFollows', context.userFollows);
    
    const url = `${BACKEND_URL}/api/lookup/${key}?${params.toString()}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Lookup error: ${response.status}`);
    }
    
    const data = await response.json();
    recordSuccess();
    
    if (data.verdict) {
      saveBotCache(key, data.verdict);
      return { ...data.verdict, cached: false };
    }
    
    return { ...createFallbackVerdict('no_verdict'), cached: false };
    
  } catch (error) {
    console.error('Bot: lookup error:', error);
    recordError();
    return { ...createFallbackVerdict('error'), cached: false };
  }
}

// ============================================================================
// Whitelist Management
// ============================================================================

const WHITELIST_KEY = 'bot_whitelist';
let whitelistSet = new Set();

async function loadWhitelist() {
  try {
    const result = await chrome.storage.local.get(WHITELIST_KEY);
    if (result[WHITELIST_KEY]) {
      whitelistSet = new Set(result[WHITELIST_KEY].map(u => u.toLowerCase()));
      console.log(`Bot: loaded ${whitelistSet.size} whitelisted accounts`);
    }
  } catch (error) {
    console.error('Error loading whitelist:', error);
  }
}

async function addToWhitelist(username) {
  whitelistSet.add(username.toLowerCase());
  try {
    await chrome.storage.local.set({
      [WHITELIST_KEY]: Array.from(whitelistSet)
    });
    // Remove from bot cache if present
    botVerdictCache.delete(username.toLowerCase());
    console.log(`Bot: whitelisted @${username}`);
  } catch (error) {
    console.error('Error saving whitelist:', error);
  }
}

async function removeFromWhitelist(username) {
  whitelistSet.delete(username.toLowerCase());
  try {
    await chrome.storage.local.set({
      [WHITELIST_KEY]: Array.from(whitelistSet)
    });
    console.log(`Bot: removed @${username} from whitelist`);
  } catch (error) {
    console.error('Error saving whitelist:', error);
  }
}

function isWhitelisted(username) {
  return whitelistSet.has(username.toLowerCase());
}

function getWhitelist() {
  return Array.from(whitelistSet);
}

// ============================================================================
// Statistics
// ============================================================================

function getBotStats() {
  let bots = 0;
  let humans = 0;
  const categories = {};
  
  for (const [, verdict] of botVerdictCache.entries()) {
    if (verdict.isBot) {
      bots++;
      categories[verdict.category] = (categories[verdict.category] || 0) + 1;
    } else {
      humans++;
    }
  }
  
  return {
    total: botVerdictCache.size,
    bots,
    humans,
    categories,
    whitelisted: whitelistSet.size,
    circuitOpen: backendCircuitOpen,
    consecutiveErrors
  };
}

// ============================================================================
// Initialize
// ============================================================================

async function initBotCache() {
  await loadBotCache();
  await loadWhitelist();
}

// Export
if (typeof window !== 'undefined') {
  window.BotCache = {
    initBotCache,
    loadBotCache,
    getCachedVerdict,
    saveBotCache,
    queueForClassification,
    lookupUsername,
    // Whitelist
    addToWhitelist,
    removeFromWhitelist,
    isWhitelisted,
    getWhitelist,
    // Stats
    getBotStats,
    // Config
    BACKEND_URL,
  };
}
