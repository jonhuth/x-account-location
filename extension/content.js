// Configuration constants
// Cache settings
const CACHE_KEY = 'twitter_location_cache';
const CACHE_EXPIRY_DAYS = 30;
const NULL_CACHE_EXPIRY_DAYS = 1;
const CACHE_SAVE_INTERVAL = 5000;
const CACHE_PERIODIC_SAVE = 30000;

// Rate limiting
const MIN_REQUEST_INTERVAL = 3500;
const MAX_CONCURRENT_REQUESTS = 1;
const MAX_QUEUE_SIZE = 50;
const BASE_BACKOFF_MINUTES = 5;
const REQUEST_TIMEOUT = 10000;

// Storage
const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024;
const STORAGE_LOG_THRESHOLD = 90;

// Extension state
const TOGGLE_KEY = 'extension_enabled';
const DEFAULT_ENABLED = true;
const STATS_KEY = 'location_stats';

// Bot Detection state
const BOT_TOGGLE_KEY = 'bot_detection_enabled';
const BOT_SENSITIVITY_KEY = 'bot_sensitivity';
let botDetectionEnabled = true;
let botSensitivity = 3;
let pageScriptInjected = false;

// Processing
const PROCESS_THROTTLE = 2000;
const INIT_DELAY = 1500;
const BATCH_SIZE = 10;
const BATCH_DELAY = 4000;
const BOT_PROCESS_INTERVAL = 800; // Process bots frequently for real-time feel

// Cache for user locations
let locationCache = new Map();

// Rate limiting state
const requestQueue = [];
let isProcessingQueue = false;
let lastRequestTime = 0;
let activeRequests = 0;
let rateLimitResetTime = 0;
let consecutiveRateLimits = 0;

// Observer state
let observer = null;
let intersectionObserver = null;

// Extension enabled state
let extensionEnabled = true;

// Pending requests
const pendingLocationRequests = new Map();
const locationStats = new Map();
let lastLoggedStoragePercent = -1;

// Load enabled state
async function loadEnabledState() {
  try {
    const result = await chrome.storage.local.get([TOGGLE_KEY, BOT_TOGGLE_KEY, BOT_SENSITIVITY_KEY]);
    extensionEnabled = result[TOGGLE_KEY] !== undefined ? result[TOGGLE_KEY] : DEFAULT_ENABLED;
    botDetectionEnabled = result[BOT_TOGGLE_KEY] !== false;
    botSensitivity = result[BOT_SENSITIVITY_KEY] || 3;
  } catch (error) {
    extensionEnabled = DEFAULT_ENABLED;
    botDetectionEnabled = true;
    botSensitivity = 3;
  }
}

// Listen for toggle changes from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'extensionToggle') {
    extensionEnabled = request.enabled;
    if (extensionEnabled) setTimeout(processUsernamesThrottled, 500);
    else removeAllFlags();
  } else if (request.type === 'resetStats') {
    locationStats.clear();
  } else if (request.type === 'botDetectionToggle') {
    botDetectionEnabled = request.enabled;
    if (botDetectionEnabled) setTimeout(scheduleBotProcessing, 500);
    else window.BotUI?.removeAllBotUI?.();
  } else if (request.type === 'botSensitivityChange') {
    botSensitivity = request.sensitivity;
  } else if (request.type === 'botWhitelistUpdate') {
    window.BotCache?.loadWhitelist?.().then(() => {
      if (botDetectionEnabled) setTimeout(scheduleBotProcessing, 500);
    });
  } else if (request.type === 'botLookup') {
    const username = request.username;
    if (window.BotCache?.lookupUsername) {
      window.BotCache.lookupUsername(username).then(verdict => {
        sendResponse({ verdict });
      }).catch(() => sendResponse({ verdict: null }));
      return true;
    } else {
      sendResponse({ verdict: null });
    }
  } else if (request.type === 'dataCleared') {
    locationCache.clear();
    locationStats.clear();
    botDetectionEnabled = true;
    botSensitivity = 3;
    extensionEnabled = true;
    removeAllFlags();
    window.BotUI?.removeAllBotUI?.();
    setTimeout(init, 500);
  }
});

// ============================================================================
// LOCATION DETECTION (unchanged from original)
// ============================================================================

async function loadCache() {
  try {
    if (!isExtensionContextValid()) return;
    const result = await chrome.storage.local.get(CACHE_KEY);
    if (result[CACHE_KEY]) {
      const cached = result[CACHE_KEY];
      const now = Date.now();
      for (const [username, data] of Object.entries(cached)) {
        if (data.expiry && data.expiry > now) {
          locationCache.set(username, { location: data.location, expiry: data.expiry });
          if (data.location !== null) {
            if (!locationStats.has(data.location)) locationStats.set(data.location, new Set());
            locationStats.get(data.location).add(username);
          }
        }
      }
    }
  } catch (error) {
    if (!error.message?.includes('Extension context invalidated')) {
      console.error('Error loading cache:', error);
    }
  }
}

function isExtensionContextValid() {
  return !!chrome.runtime?.id;
}

function calculateExpiry(location, now = Date.now()) {
  const days = location === null ? NULL_CACHE_EXPIRY_DAYS : CACHE_EXPIRY_DAYS;
  return now + (days * 24 * 60 * 60 * 1000);
}

async function canWriteToStorage() {
  if (!isExtensionContextValid()) return false;
  // Safari (and some engines) omit getBytesInUse — allow writes when quota API is missing.
  // Returning false here previously blocked all location-cache persistence on Safari.
  if (typeof chrome.storage?.local?.getBytesInUse !== 'function') return true;
  try {
    const bytesUsed = await chrome.storage.local.getBytesInUse(null);
    return Math.floor((bytesUsed / STORAGE_QUOTA_BYTES) * 100) < STORAGE_LOG_THRESHOLD;
  } catch {
    // Prefer attempting a write over silently dropping cache on quota probe failures.
    return true;
  }
}

async function checkStorageUsage() {
  try {
    if (!isExtensionContextValid() || typeof chrome.storage?.local?.getBytesInUse !== 'function') {
      return null;
    }
    const bytesUsed = await chrome.storage.local.getBytesInUse(null);
    const percentUsed = Math.floor((bytesUsed / STORAGE_QUOTA_BYTES) * 100);
    const logThreshold = Math.floor(percentUsed / 10) * 10;
    if ((logThreshold > lastLoggedStoragePercent && logThreshold >= 10) ||
        (percentUsed >= STORAGE_LOG_THRESHOLD && lastLoggedStoragePercent < STORAGE_LOG_THRESHOLD)) {
      lastLoggedStoragePercent = logThreshold;
    }
    return percentUsed;
  } catch { return null; }
}

async function saveCache() {
  try {
    if (!isExtensionContextValid()) return;
    if (!(await canWriteToStorage())) return;
    
    const cacheObj = {};
    const now = Date.now();
    for (const [username, entry] of locationCache.entries()) {
      const expiry = entry.expiry || calculateExpiry(entry.location, now);
      cacheObj[username] = { location: entry.location, expiry: expiry, cachedAt: entry.cachedAt || now };
    }
    
    const statsObj = {};
    for (const [location, usernames] of locationStats.entries()) {
      statsObj[location] = usernames.size;
    }
    
    await chrome.storage.local.set({ [CACHE_KEY]: cacheObj, [STATS_KEY]: statsObj });
    await checkStorageUsage();
  } catch (error) {
    if (!error.message?.includes('Extension context invalidated')) {
      console.error('Error saving cache:', error);
    }
  }
}

async function loadStats() {
  try {
    if (!isExtensionContextValid()) return;
    await chrome.storage.local.get(STATS_KEY);
  } catch { /* ignore */ }
}

function updateStats(username, location) {
  if (!location) return;
  if (!locationStats.has(location)) locationStats.set(location, new Set());
  const usernames = locationStats.get(location);
  if (!usernames.has(username)) usernames.add(username);
}

function saveCacheEntry(username, location) {
  if (!isExtensionContextValid()) return;
  const now = Date.now();
  locationCache.set(username, { location, expiry: calculateExpiry(location, now), cachedAt: now });
  if (location !== null) updateStats(username, location);
  
  if (!saveCache.timeout) {
    saveCache.timeout = setTimeout(async () => {
      await saveCache();
      saveCache.timeout = null;
    }, CACHE_SAVE_INTERVAL);
  }
}

function injectPageScript() {
  if (pageScriptInjected) return;
  pageScriptInjected = true;

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('pageScript.js');
  script.onload = function() { this.remove(); };
  (document.head || document.documentElement).appendChild(script);
  
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === '__rateLimitInfo') {
      consecutiveRateLimits++;
      const baseWaitMinutes = BASE_BACKOFF_MINUTES * Math.pow(2, consecutiveRateLimits - 1);
      const exponentialWaitSeconds = baseWaitMinutes * 60;
      const apiResetTime = event.data.resetTime;
      const exponentialResetTime = Math.floor(Date.now() / 1000) + exponentialWaitSeconds;
      rateLimitResetTime = Math.max(apiResetTime, exponentialResetTime);
    }
  });
}

function isRateLimited() {
  if (rateLimitResetTime === 0) return false;
  return Math.floor(Date.now() / 1000) < rateLimitResetTime;
}

function resetRateLimit() {
  rateLimitResetTime = 0;
  consecutiveRateLimits = 0;
}

async function processRequestQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  
  if (isRateLimited()) {
    const now = Math.floor(Date.now() / 1000);
    const waitTime = (rateLimitResetTime - now) * 1000;
    while (requestQueue.length > 0) {
      requestQueue.shift().reject(new Error('Rate limited'));
    }
    setTimeout(processRequestQueue, Math.min(waitTime, 60000));
    return;
  }
  
  if (rateLimitResetTime > 0) resetRateLimit();
  isProcessingQueue = true;
  
  while (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT_REQUESTS) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }
    
    const { screenName, resolve, reject } = requestQueue.shift();
    activeRequests++;
    lastRequestTime = Date.now();
    
    try {
      const location = await makeLocationRequest(screenName);
      if (consecutiveRateLimits > 0) consecutiveRateLimits = 0;
      resolve(location);
    } catch (error) {
      reject(error);
    } finally {
      activeRequests--;
      setTimeout(processRequestQueue, 200);
    }
  }
  
  isProcessingQueue = false;
}

function makeLocationRequest(screenName) {
  return new Promise((resolve, reject) => {
    const requestId = Date.now() + Math.random();
    
    const handler = (event) => {
      if (event.source !== window) return;
      if (event.data && event.data.type === '__locationResponse' && event.data.screenName === screenName && event.data.requestId === requestId) {
        window.removeEventListener('message', handler);
        const location = event.data.location;
        const isRateLimited = event.data.isRateLimited || false;
        if (!isRateLimited) saveCacheEntry(screenName, location || null);
        resolve(location || null);
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ type: '__fetchLocation', screenName, requestId }, '*');
    setTimeout(() => {
      window.removeEventListener('message', handler);
      pendingLocationRequests.delete(screenName);
      resolve(null);
    }, REQUEST_TIMEOUT);
  });
}

function createLocationInfo(location) {
  if (!location) return { location: null, flag: null, displayText: null };
  const flag = getCountryFlag(location);
  return { location, flag, displayText: flag || `(${location})` };
}

async function getLocation(screenName) {
  if (locationCache.has(screenName)) {
    const cached = locationCache.get(screenName);
    if (cached.expiry && cached.expiry > Date.now()) return createLocationInfo(cached.location);
    locationCache.delete(screenName);
  }
  
  if (pendingLocationRequests.has(screenName)) {
    const location = await pendingLocationRequests.get(screenName);
    if (locationCache.has(screenName)) {
      const cached = locationCache.get(screenName);
      if (cached.expiry && cached.expiry > Date.now()) return createLocationInfo(cached.location);
    }
    return createLocationInfo(location);
  }
  
  if (requestQueue.length >= MAX_QUEUE_SIZE) {
    return { location: null, flag: null, displayText: null };
  }
  
  const locationPromise = new Promise((resolve, reject) => {
    requestQueue.push({ 
      screenName, 
      resolve: (location) => { pendingLocationRequests.delete(screenName); resolve(location); }, 
      reject: (error) => { pendingLocationRequests.delete(screenName); reject(error); }
    });
    processRequestQueue();
  });
  
  pendingLocationRequests.set(screenName, locationPromise);
  const location = await locationPromise;
  return createLocationInfo(location);
}

function parseUsernameFromLink(href) {
  if (!href) return null;
  const match = href.match(/^\/([^\/\?]+)/);
  return match && match[1] ? match[1] : null;
}

function isValidUsername(username) {
  if (!username || username.length === 0 || username.length >= 20) return false;
  const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 
                         'settings', 'bookmarks', 'lists', 'communities', 'hashtag'];
  if (excludedRoutes.includes(username) || username.startsWith('hashtag') || username.startsWith('search')) return false;
  if (username.includes('status') || /^\d+$/.test(username)) return false;
  return true;
}

function isUsernameLink(link, potentialUsername) {
  const text = link.textContent?.trim() || '';
  const linkText = text.toLowerCase();
  const usernameLower = potentialUsername.toLowerCase();
  return text.startsWith('@') || linkText === usernameLower || linkText === `@${usernameLower}` ||
         (text.trim().startsWith('@') && text.trim().substring(1) === potentialUsername);
}

function extractUsername(element) {
  // First try UserName container (works for both OP and replies)
  const usernameElement = element.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  if (usernameElement) {
    // Look for @username link pattern
    for (const link of usernameElement.querySelectorAll('a[href^="/"]')) {
      const href = link.getAttribute('href');
      const username = parseUsernameFromLink(href);
      if (username && isValidUsername(username)) {
        // Prefer links that look like @username (not display names)
        const text = link.textContent?.trim() || '';
        if (text.startsWith('@') || text.toLowerCase() === username.toLowerCase()) {
          return username;
        }
      }
    }
    // Second pass: any valid username link in UserName container
    for (const link of usernameElement.querySelectorAll('a[href^="/"]')) {
      const username = parseUsernameFromLink(link.getAttribute('href'));
      if (username && isValidUsername(username)) return username;
    }
  }
  
  // Fallback: search all links
  const allLinks = element.querySelectorAll('a[href^="/"]');
  const seenUsernames = new Set();
  
  for (const link of allLinks) {
    const username = parseUsernameFromLink(link.getAttribute('href'));
    if (!username || seenUsernames.has(username) || !isValidUsername(username)) continue;
    seenUsernames.add(username);
    if (isUsernameLink(link, username)) return username;
    const parent = link.closest('[data-testid="UserName"], [data-testid="User-Name"]');
    if (parent && !username.includes('/')) return username;
  }
  
  // Last resort: match @username pattern in text
  const textContent = element.textContent || '';
  for (const match of textContent.matchAll(/@([a-zA-Z0-9_]+)/g)) {
    const username = match[1];
    const link = element.querySelector(`a[href="/${username}"], a[href^="/${username}?"]`);
    if (link && link.closest('[data-testid="UserName"], [data-testid="User-Name"]')) return username;
  }
  
  return null;
}

function findHandleSection(container, screenName) {
  return Array.from(container.querySelectorAll('div')).find(div => {
    const link = div.querySelector(`a[href="/${screenName}"]`);
    return link && link.textContent?.trim() === `@${screenName}`;
  });
}

function getUserNameRootForFlags(from) {
  if (window.BotUI?.getUserNameRoot) return window.BotUI.getUserNameRoot(from);
  if (!from) return null;
  if (from.matches?.('[data-testid="UserName"], [data-testid="User-Name"]')) return from;
  return (
    from.querySelector?.('[data-testid="UserName"], [data-testid="User-Name"]') ||
    from.closest?.('[data-testid="UserName"], [data-testid="User-Name"]') ||
    null
  );
}

function insertFlagElement(container, flagSpan, screenName) {
  // Same first-line host as bot chips: [Name] [Verified] [flag][badge] [@handle]
  injectLocationStyles();
  if (window.BotUI?.insertIntoChipHost) {
    const kind = flagSpan.hasAttribute('data-twitter-flag-shimmer') ? 'shimmer' : 'flag';
    if (window.BotUI.insertIntoChipHost(container, flagSpan, screenName, kind)) {
      return true;
    }
  }
  // Fallback without BotUI: after display name on first flex row only
  const root = getUserNameRootForFlags(container) || container;
  const links = root.querySelectorAll('a[href^="/"]');
  for (const link of links) {
    const text = link.textContent?.trim() || '';
    if (text.startsWith('@') || link.querySelector('time')) continue;
    try {
      link.after(flagSpan);
      return true;
    } catch { /* continue */ }
  }
  try {
    root.appendChild(flagSpan);
    return true;
  } catch {
    return false;
  }
}

// Location chips — shared density with bot chips, content-sized for X flex rows
const LOCATION_UI_STYLES = `
@keyframes xat-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Host styles also live in botUI; keep a copy so flags work if bots disabled */
.xat-chip-host {
  box-sizing: border-box;
  display: inline-flex !important;
  flex-direction: row !important;
  flex: 0 0 auto !important;
  flex-grow: 0 !important;
  flex-shrink: 0 !important;
  align-items: center !important;
  align-self: center !important;
  gap: 2px;
  margin: 0 0 0 2px;
  width: max-content !important;
  max-width: max-content !important;
  white-space: nowrap !important;
  vertical-align: middle;
  line-height: 1;
  position: static !important;
}

.xat-flag,
.xat-flag-shimmer {
  box-sizing: border-box;
  flex: 0 0 auto !important;
  flex-grow: 0 !important;
  flex-shrink: 0 !important;
  align-self: center !important;
  width: max-content !important;
  max-width: max-content !important;
  font-family: TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.xat-flag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  min-height: 18px;
  margin: 0 0 0 3px;
  padding: 0 2px;
  vertical-align: middle;
  line-height: 1;
  font-size: 14px;
  color: inherit;
  user-select: none;
  white-space: nowrap;
}

.xat-flag--text {
  height: 18px;
  max-width: 7.5em !important;
  width: max-content !important;
  padding: 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 999px;
  border: 1px solid rgba(113, 118, 123, 0.3);
  background: rgba(113, 118, 123, 0.1);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.01em;
  color: #71767b;
}

.xat-flag-shimmer {
  display: inline-block;
  width: 16px !important;
  max-width: 16px !important;
  min-width: 16px !important;
  height: 12px;
  margin: 0 0 0 3px;
  vertical-align: middle;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    rgba(113, 118, 123, 0.12) 0%,
    rgba(113, 118, 123, 0.28) 50%,
    rgba(113, 118, 123, 0.12) 100%
  );
  background-size: 200% 100%;
  animation: xat-shimmer 1.2s ease-in-out infinite;
}
`;

function injectLocationStyles() {
  if (document.getElementById('xat-location-styles')) return;
  const style = document.createElement('style');
  style.id = 'xat-location-styles';
  style.textContent = LOCATION_UI_STYLES;
  document.head.appendChild(style);
}

function createLoadingShimmer() {
  injectLocationStyles();
  const shimmer = document.createElement('span');
  shimmer.className = 'xat-flag-shimmer';
  shimmer.setAttribute('data-twitter-flag-shimmer', 'true');
  shimmer.setAttribute('aria-hidden', 'true');
  return shimmer;
}

async function addFlagToUsername(usernameElement, screenName) {
  if (usernameElement.dataset.flagAdded === 'true') return;
  if (addFlagFromCache(usernameElement, screenName)) return;
  
  if (pendingLocationRequests.has(screenName)) {
    const locationInfo = await getLocation(screenName);
    if (usernameElement.dataset.flagAdded === 'true') return;
    if (locationInfo && locationInfo.location) {
      if (addFlagToElement(usernameElement, screenName, locationInfo)) {
        usernameElement.dataset.flagAdded = 'true';
        return;
      }
    }
    usernameElement.dataset.flagAdded = 'waiting';
    return;
  }

  usernameElement.dataset.flagAdded = 'processing';
  const userNameContainer = getUserNameRootForFlags(usernameElement);
  const shimmerSpan = createLoadingShimmer();
  let shimmerInserted = false;

  if (userNameContainer) {
    shimmerInserted = insertFlagElement(userNameContainer, shimmerSpan, screenName);
  }
  
  try {
    const locationInfo = await getLocation(screenName);
    if (shimmerInserted && shimmerSpan.parentNode) shimmerSpan.remove();
    
    if (!locationInfo || !locationInfo.location) {
      usernameElement.dataset.flagAdded = 'failed';
      return;
    }

    const success = addFlagToElement(usernameElement, screenName, locationInfo);
    
    if (success) {
      document.querySelectorAll('[data-flag-added="waiting"]').forEach(container => {
        if (extractUsername(container) === screenName) addFlagToUsername(container, screenName).catch(() => {});
      });
    } else {
      usernameElement.dataset.flagAdded = 'failed';
    }
  } catch {
    if (shimmerInserted && shimmerSpan.parentNode) shimmerSpan.remove();
    usernameElement.dataset.flagAdded = 'failed';
  }
}

function removeAllFlags() {
  document.querySelectorAll('[data-twitter-flag]').forEach(flag => flag.remove());
  document.querySelectorAll('[data-twitter-flag-shimmer]').forEach(shimmer => shimmer.remove());
  document.querySelectorAll('[data-flag-added]').forEach(container => delete container.dataset.flagAdded);
}

let processUsernamesThrottleTimeout = null;
function processUsernamesThrottled() {
  if (processUsernamesThrottleTimeout) return;
  processUsernamesThrottleTimeout = setTimeout(() => {
    processUsernames();
    processUsernamesThrottleTimeout = null;
  }, PROCESS_THROTTLE);
}

function addFlagToElement(usernameElement, screenName, locationInfo) {
  if (!locationInfo?.location) return false;
  const root = getUserNameRootForFlags(usernameElement);
  if (!root) return false;
  if (root.querySelector('[data-twitter-flag]')) {
    usernameElement.dataset.flagAdded = 'true';
    return true;
  }

  injectLocationStyles();

  const hasEmojiFlag = Boolean(locationInfo.flag);
  const flagSpan = document.createElement('span');
  flagSpan.className = hasEmojiFlag ? 'xat-flag' : 'xat-flag xat-flag--text';
  // Emoji flags: bare glyph. Unknown locations: compact muted chip, no leading space.
  flagSpan.textContent = hasEmojiFlag
    ? locationInfo.flag
    : String(locationInfo.location || '').trim();
  flagSpan.setAttribute('data-twitter-flag', 'true');
  flagSpan.setAttribute('title', locationInfo.location);
  flagSpan.setAttribute('aria-label', `Account based in ${locationInfo.location}`);

  if (insertFlagElement(root, flagSpan, screenName)) {
    usernameElement.dataset.flagAdded = 'true';
    updateStats(screenName, locationInfo.location);
    return true;
  }

  return false;
}

function addFlagFromCache(container, screenName) {
  if (!locationCache.has(screenName)) return false;
  const cached = locationCache.get(screenName);
  const now = Date.now();
  if (cached.expiry && cached.expiry > now && cached.location !== null) {
    const locationInfo = createLocationInfo(cached.location);
    if (addFlagToElement(container, screenName, locationInfo)) return true;
  }
  return false;
}

async function processVisibleUsernames(containers) {
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const visibleContainers = [];
  const offScreenContainers = [];
  
  for (const container of containers) {
    const rect = container.getBoundingClientRect();
    const isVisible = rect.top < viewportHeight && rect.bottom > 0 && rect.left < viewportWidth && rect.right > 0;
    if (isVisible) visibleContainers.push(container);
    else offScreenContainers.push(container);
  }
  
  let cachedCount = 0;
  const uncachedContainers = [];
  
  for (const container of visibleContainers) {
    const screenName = extractUsername(container);
    if (screenName) {
      const status = container.dataset.flagAdded;
      if (!status || status === 'failed') {
        if (addFlagFromCache(container, screenName)) cachedCount++;
        else uncachedContainers.push(container);
      }
    }
  }
  
  const uniqueUsernames = new Map();
  for (const container of uncachedContainers) {
    const screenName = extractUsername(container);
    if (screenName) {
      if (!uniqueUsernames.has(screenName)) uniqueUsernames.set(screenName, []);
      uniqueUsernames.get(screenName).push(container);
    }
  }
  
  const uniqueUsernameList = Array.from(uniqueUsernames.keys());
  
  for (let i = 0; i < uniqueUsernameList.length; i++) {
    const screenName = uniqueUsernameList[i];
    const containers = uniqueUsernames.get(screenName);
    
    if (containers.length > 0) {
      await addFlagToUsername(containers[0], screenName).catch(err => {
        containers.forEach(c => c.dataset.flagAdded = 'failed');
      });
      
      if (containers[0].dataset.flagAdded === 'true' && containers.length > 1) {
        if (locationCache.has(screenName)) {
          const cached = locationCache.get(screenName);
          if (cached.expiry && cached.expiry > Date.now() && cached.location) {
            const locationInfo = createLocationInfo(cached.location);
            for (let j = 1; j < containers.length; j++) addFlagToElement(containers[j], screenName, locationInfo);
          }
        }
      }
    }
    
    if (i < uniqueUsernameList.length - 1) await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
  }
  
  for (const container of offScreenContainers) {
    const screenName = extractUsername(container);
    if (screenName) {
      const status = container.dataset.flagAdded;
      if (!status || status === 'failed') {
        if (!addFlagFromCache(container, screenName)) container.dataset.flagNeedsApi = 'true';
      }
    }
  }
  
  const uncachedOffScreen = offScreenContainers.filter(c => c.dataset.flagNeedsApi === 'true');
  if (uncachedOffScreen.length > 0 && !intersectionObserver) {
    intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const container = entry.target;
          const screenName = extractUsername(container);
          if (screenName) {
            const status = container.dataset.flagAdded;
            if (!status || status === 'failed') {
              if (!addFlagFromCache(container, screenName)) {
                addFlagToUsername(container, screenName).catch(() => { container.dataset.flagAdded = 'failed'; });
              }
            }
          }
          intersectionObserver.unobserve(container);
        }
      });
    }, { threshold: 0.1 });
    
    uncachedOffScreen.forEach(container => intersectionObserver.observe(container));
  }
}

async function processUsernames() {
  if (!extensionEnabled) return;
  
  const containers = document.querySelectorAll('article[data-testid="tweet"], [data-testid="UserCell"], [data-testid="User-Names"], [data-testid="User-Name"]');
  if (containers.length === 0) return;
  
  await processVisibleUsernames(containers);
}

function setupObservers() {
  if (observer) observer.disconnect();
  
  let mutationTimeout = null;
  observer = new MutationObserver((mutations) => {
    if (mutations.some(m => m.addedNodes.length > 0)) {
      if (!mutationTimeout) {
        mutationTimeout = setTimeout(() => {
          mutationTimeout = null;
          if (extensionEnabled) processUsernamesThrottled();
          if (botDetectionEnabled) scheduleBotProcessing();
        }, 150); // Faster mutation response
      }
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
  
  // Use requestIdleCallback for scroll to avoid blocking
  let scrollPending = false;
  window.addEventListener('scroll', () => {
    if (!scrollPending) {
      scrollPending = true;
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => {
          scrollPending = false;
          if (extensionEnabled) processUsernamesThrottled();
          if (botDetectionEnabled) scheduleBotProcessing();
        }, { timeout: 200 });
      } else {
        setTimeout(() => {
          scrollPending = false;
          if (extensionEnabled) processUsernamesThrottled();
          if (botDetectionEnabled) scheduleBotProcessing();
        }, 150);
      }
    }
  }, { passive: true });
  
  // Navigation observer
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Drop thread-reply index when leaving a status page / switching tweets
      window.BotDetection?.clearThreadReplyRegistry?.();
      setTimeout(() => {
        if (extensionEnabled) processUsernamesThrottled();
        if (botDetectionEnabled) scheduleBotProcessing();
      }, INIT_DELAY);
    }
  }, 500);
}

// ============================================================================
// BOT DETECTION
// Local trust/templates first → backend AI only when needed
// Zero extra X profile API calls (passive intercept cache only)
// ============================================================================

let botProcessingScheduled = false;
let lastBotProcessTime = 0;

function scheduleBotProcessing() {
  if (botProcessingScheduled || !botDetectionEnabled) return;
  
  const now = Date.now();
  const timeSinceLast = now - lastBotProcessTime;
  const delay = Math.max(0, BOT_PROCESS_INTERVAL - timeSinceLast);
  
  botProcessingScheduled = true;
  setTimeout(() => {
    botProcessingScheduled = false;
    lastBotProcessTime = Date.now();
    processBotDetectionBatch();
  }, delay);
}

async function processBotDetectionBatch() {
  if (!botDetectionEnabled) return;
  
  const unprocessed = document.querySelectorAll('article[data-testid="tweet"]:not([data-bot-processed])');
  if (unprocessed.length === 0) return;
  
  // Only visible + near-visible — don't burn work off-screen
  const visible = Array.from(unprocessed).filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight + 300 && rect.bottom > -100;
  });
  
  if (visible.length === 0) return;
  
  // Smaller concurrent batch = less main-thread + backend spikes
  const batch = visible.slice(0, 6);
  const promises = batch.map(el => processBotDetection(el));
  await Promise.allSettled(promises);
  
  if (visible.length > 6) {
    setTimeout(scheduleBotProcessing, 120);
  }
}

/**
 * Passive profile enrichment from pageScript's intercept cache.
 * Never triggers a UserByScreenName call — if not already cached, skip fields.
 */
function getPassiveUserData(username) {
  return new Promise((resolve) => {
    const requestId = Date.now() + Math.random();
    let done = false;

    const handler = (event) => {
      if (event.source !== window) return;
      if (event.data?.type === '__userDataResponse' && event.data.requestId === requestId) {
        done = true;
        window.removeEventListener('message', handler);
        resolve(event.data.userData || null);
      }
    };

    window.addEventListener('message', handler);
    window.postMessage({ type: '__getUserData', username, requestId }, '*');

    // Very short wait — never stall the pipeline for missing cache
    setTimeout(() => {
      if (!done) {
        window.removeEventListener('message', handler);
        resolve(null);
      }
    }, 80);
  });
}

function dimThresholdForSensitivity() {
  // sensitivity 1..5 → lower = more aggressive dimming
  // 1: 0.9, 3: 0.7, 5: 0.55
  const s = Number(botSensitivity) || 3;
  return Math.max(0.5, Math.min(0.95, 1.05 - s * 0.1));
}

async function processBotDetection(el) {
  if (!botDetectionEnabled) return;
  const status = el.dataset.botProcessed;
  if (status && status !== 'error') return;
  el.dataset.botProcessed = 'processing';
  el.dataset.botDimThreshold = String(dimThresholdForSensitivity());
  
  const username = extractUsername(el);
  if (!username) {
    el.dataset.botProcessed = 'skip';
    return;
  }

  // Extract DOM data first (cheap)
  const replyData = extractReplyData(el, username);
  if (!replyData) {
    el.dataset.botProcessed = 'skip';
    return;
  }

  // Trust signals — multiple sources so people you follow never show "?"
  // 1) Following list / live set  2) DOM unfollow button  3) passive GraphQL
  const followsFromList = Boolean(window.BotLegitimacy?.isFollowedByUser?.(username));
  const followsFromDom = Boolean(
    replyData.userFollows ||
      window.BotDetection?.detectYouFollowFromDom?.(el),
  );
  if (followsFromDom && !followsFromList) {
    window.BotLegitimacy?.noteYouFollow?.(username);
  }
  const userFollows = followsFromList || followsFromDom || Boolean(replyData.userFollows);
  const isMutual = Boolean(window.BotLegitimacy?.isMutualWithUser?.(username));
  const trustTier =
    window.BotLegitimacy?.getTrustTier?.(username) ||
    (isMutual ? 'mutual' : userFollows ? 'following' : 'none');
  replyData.userFollows = userFollows;
  replyData.trustTier = trustTier;
  replyData.mutualCount = isMutual ? 1 : 0;

  // Rule stack (offline first): override → whitelist → mutual/follow → cache → local → server
  // Hard-trust never demoted by short comments or AI failure.
  const local = window.BotCache?.resolveLocally?.(username, replyData, {
    userFollows,
    isMutual,
    trustTier,
  });
  if (local) {
    let display = local;
    if (local.source !== 'cache' && !local.expiry) {
      display = window.BotCache?.saveBotCache?.(username, local) || local;
    } else {
      display = window.BotCache?.getCachedVerdict?.(username) || local;
    }
    window.BotUI?.applyBotUI?.(el, display, username);
    el.dataset.botProcessed = display.isBot ? 'bot' : (display.isSlop ? 'slop' : 'human');
    el.dataset.botUsername = username.toLowerCase();
    return;
  }

  // Optional: enrich from passive intercept cache only (no X API)
  const passive = await getPassiveUserData(username);
  if (passive) {
    if (passive.bio) replyData.bio = String(passive.bio).slice(0, 400);
    // Use != null so 0 followers still counts for ratio (common on farm alts)
    if (passive.followers != null) replyData.followers = Number(passive.followers) || 0;
    if (passive.following != null) replyData.following = Number(passive.following) || 0;
    if (passive.createdAt) replyData.accountCreatedAt = passive.createdAt;
    if (passive.displayName) replyData.displayName = passive.displayName;
    if (typeof passive.hasCustomAvatar === 'boolean') {
      replyData.hasCustomAvatar = passive.hasCustomAvatar;
    }
    if (passive.verified) replyData.isVerified = true;
    if (passive.location) replyData.location = passive.location;
    // Relationship from intercepted GraphQL — instant hard-trust, no Following crawl
    if (passive.youFollow || passive.followingMe) {
      window.BotLegitimacy?.noteYouFollow?.(username);
      replyData.userFollows = true;
    }
    if (passive.followedBy) {
      window.BotLegitimacy?.noteFollowedBy?.(username);
    }
  }

  // Re-check hard-trust after passive relationship fields (mutual may appear late)
  if (window.BotLegitimacy?.isHardTrustTier?.(window.BotLegitimacy.getTrustTier?.(username))) {
    const tier = window.BotLegitimacy.getTrustTier(username);
    const trustV = window.BotLegitimacy.createTrustVerdict(username, tier);
    window.BotCache?.saveBotCache?.(username, trustV);
    window.BotUI?.applyBotUI?.(el, trustV, username);
    el.dataset.botProcessed = 'human';
    el.dataset.botUsername = username.toLowerCase();
    return;
  }

  // Refresh stamps after passive enrichment
  replyData.userFollows = Boolean(window.BotLegitimacy?.isFollowedByUser?.(username));
  replyData.trustTier = window.BotLegitimacy?.getTrustTier?.(username) || 'none';
  replyData.mutualCount = window.BotLegitimacy?.isMutualWithUser?.(username) ? 1 : 0;

  // Re-resolve with followers/following — ratio is a high local bot signal
  if (replyData.followers > 0 || replyData.following > 0) {
    const afterPassive = window.BotCache?.resolveLocally?.(username, replyData, {
      userFollows: replyData.userFollows,
      isMutual: replyData.mutualCount > 0,
      trustTier: replyData.trustTier,
    });
    if (afterPassive) {
      let display = afterPassive;
      if (afterPassive.source !== 'cache' && !afterPassive.expiry) {
        display = window.BotCache?.saveBotCache?.(username, afterPassive) || afterPassive;
      } else {
        display = window.BotCache?.getCachedVerdict?.(username) || afterPassive;
      }
      window.BotUI?.applyBotUI?.(el, display, username);
      el.dataset.botProcessed = display.isBot
        ? 'bot'
        : display.isSlop
          ? 'slop'
          : 'human';
      el.dataset.botUsername = username.toLowerCase();
      // Still index for thread dup so a later peer can match (detail views)
      window.BotDetection?.classifyThreadDuplicate?.(username, replyData);
      return;
    }
  }

  // Status/detail only: near-duplicate reply *clusters* (2+ look-alike alts)
  const threadDup = window.BotDetection?.classifyThreadDuplicate?.(username, replyData);
  if (threadDup?.verdict) {
    const display =
      window.BotCache?.saveBotCache?.(username, threadDup.verdict) || threadDup.verdict;
    window.BotUI?.applyBotUI?.(el, display, username);
    el.dataset.botProcessed = 'bot';
    el.dataset.botUsername = username.toLowerCase();
    const peers = Array.isArray(threadDup.peerUsernames)
      ? threadDup.peerUsernames
      : threadDup.peerUsername
        ? [threadDup.peerUsername]
        : [];
    if (peers.length > 0) {
      window.BotDetection?.applyThreadDuplicateToCluster?.(peers, threadDup.verdict);
    }
    return;
  }

  const quickCheck = window.BotDetection?.shouldClassify?.(
    replyData,
    window.BotCache?.isWhitelisted?.(username)
  );
  if (quickCheck?.action === 'skip') {
    el.dataset.botProcessed = 'skip';
    return;
  }
  
  el.dataset.botProcessed = 'pending';
  el.dataset.botUsername = username.toLowerCase();
  window.BotUI?.showPending?.(el, username);
  
  try {
    const verdict = await window.BotCache?.queueForClassification?.(username, replyData);
    window.BotUI?.resolvePending?.(el, verdict, username);
    el.dataset.botProcessed = verdict?.isBot ? 'bot' : (verdict?.isSlop ? 'slop' : 'human');
  } catch {
    el.querySelector?.('[data-bot-skeleton]')?.remove?.();
    el.dataset.botProcessed = 'error';
  }
}

function extractReplyData(el, username) {
  // Prefer shared extractor so local filter + server share one shape
  if (window.BotDetection?.extractReplyDataFromElement) {
    return window.BotDetection.extractReplyDataFromElement(el, username);
  }
  try {
    const userNameContainer = el.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
    let displayName = username;
    if (userNameContainer) {
      const nameLink = userNameContainer.querySelector('a[href^="/"]');
      if (nameLink) {
        const fullText = nameLink.textContent?.trim() || '';
        if (fullText && !fullText.startsWith('@')) displayName = fullText;
      }
    }
    
    const replyText = el.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || '';
    const avatarEl = el.querySelector('img[src*="profile_images"]');
    const hasCustomAvatar = avatarEl ? !avatarEl.src.includes('default_profile') : true;
    
    const isVerified = !!(
      el.querySelector('[data-testid="icon-verified"]') ||
      el.querySelector('svg[aria-label*="Verified"]') ||
      el.querySelector('[aria-label*="Verified"]') ||
      userNameContainer?.querySelector('svg[data-testid="icon-verified"]') ||
      userNameContainer?.querySelector('[data-testid="icon-verified"]') ||
      userNameContainer?.querySelector('svg[viewBox="0 0 22 22"]')
    );
    
    return {
      username,
      displayName,
      replyText,
      originalTweetText: '',
      bio: '',
      followers: 0,
      following: 0,
      hasCustomAvatar,
      isVerified,
      userFollows: false,
      mutualCount: 0,
      trustTier: 'none',
    };
  } catch {
    return null;
  }
}

// Debug functions
window.forceReprocessBots = async function() {
  const allTweets = document.querySelectorAll('article[data-testid="tweet"]');
  console.log(`Reprocessing ${allTweets.length} tweets...`);
  allTweets.forEach(el => delete el.dataset.botProcessed);
  for (const el of allTweets) await processBotDetection(el);
  console.log('Done!');
};

window.forceReprocessFlags = async function() {
  const containers = document.querySelectorAll('article[data-testid="tweet"]');
  console.log(`Reprocessing ${containers.length} containers for flags...`);
  containers.forEach(el => delete el.dataset.flagAdded);
  await processVisibleUsernames(Array.from(containers));
  console.log('Done!');
};

window.debugShowTweets = function() {
  const allTweets = document.querySelectorAll('article[data-testid="tweet"]');
  const data = Array.from(allTweets).map(el => ({
    username: extractUsername(el),
    botStatus: el.dataset.botProcessed || 'none',
    flagStatus: el.dataset.flagAdded || 'none',
    hasFlag: !!el.querySelector('[data-twitter-flag]'),
    hasBotBadge: !!el.querySelector('[data-bot-badge]'),
    text: el.querySelector('[data-testid="tweetText"]')?.textContent?.slice(0, 30)
  }));
  console.table(data);
  return data;
};

window.debugBotCache = function() {
  console.log('Circuit breaker open:', window.BotCache?.isCircuitOpen?.() || false);
  console.log('Pending requests:', window.BotCache?.pendingCount?.() || 0);
};

window.debugUser = async function(username) {
  console.log(`=== Debug: ${username} ===`);
  
  // Check location cache
  const locCached = locationCache.get(username);
  console.log('Location cache:', locCached || 'not cached');
  
  // Find tweets from this user
  const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  const userTweets = tweets.filter(t => extractUsername(t) === username);
  console.log(`Found ${userTweets.length} tweets from ${username}`);
  
  userTweets.forEach((t, i) => {
    const userNameContainer = t.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
    console.log(`Tweet ${i + 1}:`, {
      flagAdded: t.dataset.flagAdded,
      botProcessed: t.dataset.botProcessed,
      hasFlag: !!t.querySelector('[data-twitter-flag]'),
      hasBotBadge: !!t.querySelector('[data-bot-badge]'),
      userNameContainer: !!userNameContainer,
      displayLinks: userNameContainer ? Array.from(userNameContainer.querySelectorAll('a')).map(a => ({
        text: a.textContent?.slice(0, 20),
        href: a.getAttribute('href')
      })) : null
    });
  });
  
  // Try to get fresh location
  console.log('Fetching fresh location...');
  try {
    const loc = await getLocation(username);
    console.log('Location result:', loc);
  } catch (e) {
    console.log('Location error:', e);
  }
};

// ============================================================================
// INIT
// ============================================================================

async function init() {
  await loadEnabledState();
  await loadCache();
  await loadStats();
  await checkStorageUsage();
  
  // Early return only if BOTH features are disabled
  if (!extensionEnabled && !botDetectionEnabled) return;
  
  // pageScript: passive user intercept + following list + location
  // Needed for bot legitimacy even when location flags are off
  if (extensionEnabled || botDetectionEnabled) {
    if (extensionEnabled) injectLocationStyles();
    injectPageScript();
    await new Promise(resolve => setTimeout(resolve, 400));
  }

  // Bot detection setup
  if (botDetectionEnabled) {
    window.BotUI?.injectBotStyles?.();
    await window.BotCache?.loadBotCache?.();
    await window.BotCache?.loadWhitelist?.();
    // Await cache load so people you follow are trusted on first paint.
    // Network Following crawl still backgrounds if cache incomplete.
    try {
      await window.BotLegitimacy?.initLegitimacy?.();
    } catch {
      /* ignore */
    }

    // Soft-correct chips when follow/mutual arrives late (crawl, GraphQL, DOM).
    // Never leave bot/slop/"?" on accounts you follow.
    const softCorrectTrust = (usernameHint) => {
      document.querySelectorAll('article[data-testid="tweet"][data-bot-username]').forEach((el) => {
        const u = el.dataset.botUsername;
        if (!u) return;
        if (usernameHint && u !== String(usernameHint).toLowerCase()) return;
        const tier = window.BotLegitimacy?.getTrustTier?.(u);
        if (!window.BotLegitimacy?.isHardTrustTier?.(tier)) return;
        const verdict = window.BotLegitimacy.createTrustVerdict(u, tier);
        window.BotCache?.saveBotCache?.(u, verdict);
        // Force re-paint even if a previous "?" / bot chip was applied
        delete el.dataset.botVerdict;
        window.BotUI?.applyBotUI?.(el, verdict, u);
        el.dataset.botProcessed = 'human';
      });
    };

    window.addEventListener('botFollowingUpdated', () => softCorrectTrust());
    window.addEventListener('botTrustUpdated', (e) => {
      softCorrectTrust(e?.detail?.username);
    });

    // Passive relationship stream from pageScript intercepts (timeline GraphQL)
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data?.type !== '__relationshipSeen' || !event.data.username) return;
      const u = event.data.username;
      // youFollow = YOU follow them (legacy.following); followedBy = they follow you
      if (event.data.youFollow || event.data.following) {
        window.BotLegitimacy?.noteYouFollow?.(u);
      }
      if (event.data.followedBy) {
        window.BotLegitimacy?.noteFollowedBy?.(u);
      }
    });
  }
  
  // Setup observers - they internally check each feature's enabled state
  setupObservers();
  
  // Start processing - each function checks its own enabled state
  setTimeout(() => {
    if (extensionEnabled) processUsernamesThrottled();
    if (botDetectionEnabled) scheduleBotProcessing();
  }, INIT_DELAY);
  
  // Location cache periodic save
  if (extensionEnabled) {
    setInterval(saveCache, CACHE_PERIODIC_SAVE);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
