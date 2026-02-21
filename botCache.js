// Bot Detection - Caching & Server Communication
// Handles batching, caching, and server requests with proper error handling

// ============================================================================
// Configuration
// ============================================================================

const BOT_CACHE_KEY = 'bot_verdict_cache';
const BOT_CACHE_EXPIRY_DAYS = 7;
const BOT_CACHE_SAVE_INTERVAL = 5000;
const BOT_BATCH_SIZE = 5;
const BOT_BATCH_DELAY = 500; // Fast batching for real-time feel
const REQUEST_TIMEOUT_MS = 8000; // 8 second timeout
const MAX_RETRIES = 2;
const BACKEND_URL = 'https://x-bot-detector-production.up.railway.app';

// ============================================================================
// Cache State
// ============================================================================

const botVerdictCache = new Map();
let pendingCacheSave = null;

// ============================================================================
// Batching State
// ============================================================================

const pendingBotRequests = new Map();
const botClassificationQueue = [];
let batchTimeout = null;

// ============================================================================
// Circuit Breaker State
// ============================================================================

let backendCircuitOpen = false;
let circuitOpenUntil = 0;
let consecutiveErrors = 0;
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_BASE_MS = 60000;

// ============================================================================
// Cache Operations
// ============================================================================

async function loadBotCache() {
  try {
    const result = await chrome.storage.local.get(BOT_CACHE_KEY);
    if (result[BOT_CACHE_KEY]) {
      const cached = result[BOT_CACHE_KEY];
      const now = Date.now();
      for (const [username, data] of Object.entries(cached)) {
        if (data.expiry && data.expiry > now) {
          botVerdictCache.set(username.toLowerCase(), data);
        }
      }
    }
  } catch (e) { /* storage error */ }
}

function saveBotCache(username, verdict) {
  const now = Date.now();
  const expiry = now + (BOT_CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  
  botVerdictCache.set(username.toLowerCase(), {
    ...verdict,
    expiry,
    cachedAt: now
  });
  
  if (!pendingCacheSave) {
    pendingCacheSave = setTimeout(async () => {
      await persistBotCache();
      pendingCacheSave = null;
    }, BOT_CACHE_SAVE_INTERVAL);
  }
}

async function persistBotCache() {
  try {
    const cacheObj = {};
    for (const [username, data] of botVerdictCache.entries()) {
      cacheObj[username] = data;
    }
    await chrome.storage.local.set({ [BOT_CACHE_KEY]: cacheObj });
  } catch (e) { /* storage error */ }
}

function getCachedVerdict(username) {
  const key = username.toLowerCase();
  const cached = botVerdictCache.get(key);
  
  if (cached && cached.expiry && cached.expiry > Date.now()) {
    return cached;
  }
  
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
    backendCircuitOpen = false;
    return false;
  }
  return true;
}

function recordSuccess() {
  consecutiveErrors = 0;
  backendCircuitOpen = false;
}

function recordError() {
  consecutiveErrors++;
  if (consecutiveErrors >= CIRCUIT_THRESHOLD && !backendCircuitOpen) {
    backendCircuitOpen = true;
    const backoffMs = CIRCUIT_BASE_MS * Math.pow(2, consecutiveErrors - CIRCUIT_THRESHOLD);
    circuitOpenUntil = Date.now() + Math.min(backoffMs, 300000); // Max 5 min
  }
}

// ============================================================================
// Fetch with Timeout
// ============================================================================

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeout);
    return response;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw e;
  }
}

// ============================================================================
// Single Request with Retry
// ============================================================================

async function classifyWithRetry(replyData, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(`${BACKEND_URL}/api/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replies: [replyData] })
      });
      
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      
      const data = await response.json();
      return data.verdicts?.[0] || null;
    } catch (e) {
      if (attempt === retries) {
        throw e;
      }
      // Wait before retry (exponential backoff)
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
  return null;
}

// ============================================================================
// Batch Queue & Processing
// ============================================================================

function queueForClassification(username, replyData) {
  const key = username.toLowerCase();
  
  // Coalesce: return existing promise if pending
  if (pendingBotRequests.has(key)) {
    return pendingBotRequests.get(key);
  }
  
  const promise = new Promise((resolve) => {
    botClassificationQueue.push({
      username: key,
      replyData,
      resolve
    });
    
    // Dispatch immediately when batch is full, otherwise schedule
    if (botClassificationQueue.length >= BOT_BATCH_SIZE) {
      if (batchTimeout) {
        clearTimeout(batchTimeout);
        batchTimeout = null;
      }
      // Use setImmediate equivalent for faster dispatch
      setTimeout(dispatchBatch, 0);
    } else if (!batchTimeout) {
      batchTimeout = setTimeout(dispatchBatch, BOT_BATCH_DELAY);
    }
  });
  
  pendingBotRequests.set(key, promise);
  return promise;
}

async function dispatchBatch() {
  if (batchTimeout) {
    clearTimeout(batchTimeout);
    batchTimeout = null;
  }
  
  const batch = botClassificationQueue.splice(0, BOT_BATCH_SIZE);
  if (batch.length === 0) return;
  
  if (isCircuitOpen()) {
    batch.forEach(item => {
      const fallback = createFallbackVerdict('circuit_open');
      pendingBotRequests.delete(item.username);
      item.resolve(fallback);
    });
    return;
  }
  
  try {
    const response = await fetchWithTimeout(`${BACKEND_URL}/api/classify`, {
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
    
    // Process results
    const verdicts = data.verdicts || [];
    
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      const verdict = verdicts[i];
      
      if (verdict) {
        saveBotCache(item.username, verdict);
        pendingBotRequests.delete(item.username);
        item.resolve(verdict);
      } else {
        // Individual item failed - try single retry
        retryIndividual(item);
      }
    }
    
  } catch (error) {
    recordError();
    // Batch failed - retry each individually
    for (const item of batch) {
      retryIndividual(item);
    }
  }
}

async function retryIndividual(item) {
  try {
    const verdict = await classifyWithRetry(item.replyData, 1);
    if (verdict) {
      saveBotCache(item.username, verdict);
      pendingBotRequests.delete(item.username);
      item.resolve(verdict);
    } else {
      const fallback = createFallbackVerdict('retry_failed');
      pendingBotRequests.delete(item.username);
      item.resolve(fallback);
    }
  } catch (e) {
    const fallback = createFallbackVerdict('error');
    pendingBotRequests.delete(item.username);
    item.resolve(fallback);
  }
}

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
// Single Username Lookup (for popup "Bot or Not")
// ============================================================================

async function lookupUsername(username, context = {}) {
  const key = username.toLowerCase();
  
  const cached = getCachedVerdict(key);
  if (cached) {
    return { ...cached, cached: true };
  }
  
  if (isCircuitOpen()) {
    return { ...createFallbackVerdict('circuit_open'), cached: false };
  }
  
  try {
    const verdict = await classifyWithRetry({
      username: key,
      displayName: context.displayName || username,
      replyText: context.replyText || '',
      bio: context.bio || '',
      followers: context.followers || 0,
      following: context.following || 0,
      hasCustomAvatar: context.hasCustomAvatar ?? true,
      isVerified: context.isVerified ?? false,
      userFollows: context.userFollows ?? false,
      mutualCount: context.mutualCount ?? 0,
    });
    
    if (verdict) {
      saveBotCache(key, verdict);
      recordSuccess();
      return { ...verdict, cached: false };
    }
    
    return { ...createFallbackVerdict('no_verdict'), cached: false };
    
  } catch (error) {
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
    }
  } catch (e) { /* storage error */ }
}

async function addToWhitelist(username) {
  const key = username.toLowerCase();
  whitelistSet.add(key);
  botVerdictCache.delete(key);
  
  try {
    await Promise.all([
      chrome.storage.local.set({ [WHITELIST_KEY]: Array.from(whitelistSet) }),
      persistBotCache()
    ]);
  } catch (e) { /* storage error */ }
}

async function removeFromWhitelist(username) {
  whitelistSet.delete(username.toLowerCase());
  try {
    await chrome.storage.local.set({
      [WHITELIST_KEY]: Array.from(whitelistSet)
    });
  } catch (e) { /* storage error */ }
}

function isWhitelisted(username) {
  return whitelistSet.has(username.toLowerCase());
}

function getWhitelist() {
  return Array.from(whitelistSet);
}

// ============================================================================
// Stats
// ============================================================================

function getBotStats() {
  let bots = 0;
  let humans = 0;
  const categories = {};
  
  for (const [, verdict] of botVerdictCache.entries()) {
    if (verdict.isBot) {
      bots++;
      const cat = verdict.category || 'unknown';
      categories[cat] = (categories[cat] || 0) + 1;
    } else {
      humans++;
    }
  }
  
  return { bots, humans, categories, total: bots + humans };
}

// ============================================================================
// Export
// ============================================================================

if (typeof window !== 'undefined') {
  window.BotCache = {
    loadBotCache,
    loadWhitelist,
    getCachedVerdict,
    saveBotCache,
    persistBotCache,
    queueForClassification,
    lookupUsername,
    addToWhitelist,
    removeFromWhitelist,
    isWhitelisted,
    getWhitelist,
    getBotStats,
    BACKEND_URL,
  };
}
