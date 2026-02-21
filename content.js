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
  if (!isExtensionContextValid() || !chrome.storage?.local?.getBytesInUse) return false;
  try {
    const bytesUsed = await chrome.storage.local.getBytesInUse(null);
    return Math.floor((bytesUsed / STORAGE_QUOTA_BYTES) * 100) < STORAGE_LOG_THRESHOLD;
  } catch { return false; }
}

async function checkStorageUsage() {
  try {
    if (!isExtensionContextValid() || !chrome.storage?.local?.getBytesInUse) return null;
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

function insertFlagElement(container, flagSpan, screenName) {
  // Layout goal: [DisplayName] [Flag] [BotBadge] [@handle] [time]
  
  // PRIORITY 1: Before existing bot badge (so flag comes first)
  const existingBotBadge = container.querySelector('[data-bot-badge]');
  if (existingBotBadge) {
    try { 
      existingBotBadge.before(flagSpan); 
      return true; 
    } catch { /* continue */ }
  }
  
  // PRIORITY 2: Before bot skeleton (loading state)
  const botSkeleton = container.querySelector('[data-bot-skeleton]');
  if (botSkeleton) {
    try { 
      botSkeleton.before(flagSpan); 
      return true; 
    } catch { /* continue */ }
  }
  
  // PRIORITY 3: Before @handle section
  const handleSection = findHandleSection(container, screenName);
  if (handleSection) {
    const parent = handleSection.parentNode;
    if (parent) {
      try { 
        parent.insertBefore(flagSpan, handleSection); 
        return true; 
      } catch { /* continue */ }
    }
  }
  
  // PRIORITY 4: After display name link
  const displayNameLink = container.querySelector('a[href^="/"]');
  if (displayNameLink) {
    try {
      displayNameLink.after(flagSpan);
      return true;
    } catch { /* continue */ }
  }
  
  // FALLBACK: Append
  try { container.appendChild(flagSpan); return true; } catch { return false; }
}

function createLoadingShimmer() {
  const shimmer = document.createElement('span');
  shimmer.setAttribute('data-twitter-flag-shimmer', 'true');
  shimmer.style.cssText = 'display:inline-block;width:20px;height:16px;margin:0 4px;vertical-align:middle;border-radius:2px;background:linear-gradient(90deg,rgba(113,118,123,0.2) 25%,rgba(113,118,123,0.4) 50%,rgba(113,118,123,0.2) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite';
  
  if (!document.getElementById('twitter-flag-shimmer-style')) {
    const style = document.createElement('style');
    style.id = 'twitter-flag-shimmer-style';
    style.textContent = `@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }`;
    document.head.appendChild(style);
  }
  
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
  const userNameContainer = usernameElement.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  const shimmerSpan = createLoadingShimmer();
  let shimmerInserted = false;
  
  if (userNameContainer) {
    const handleSection = findHandleSection(userNameContainer, screenName);
    if (handleSection?.parentNode) {
      try { handleSection.parentNode.insertBefore(shimmerSpan, handleSection); shimmerInserted = true; } catch { /* ignore */ }
    }
    if (!shimmerInserted) {
      try { userNameContainer.appendChild(shimmerSpan); shimmerInserted = true; } catch { /* ignore */ }
    }
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
  if (usernameElement.querySelector('[data-twitter-flag]')) return true;
  if (!locationInfo?.location) return false;
  
  const containerForFlag = usernameElement.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  if (!containerForFlag) return false;
  
  const flagSpan = document.createElement('span');
  flagSpan.textContent = ` ${locationInfo.displayText}`;
  flagSpan.setAttribute('data-twitter-flag', 'true');
  flagSpan.setAttribute('title', locationInfo.location);
  Object.assign(flagSpan.style, {
    marginLeft: '4px', marginRight: '4px', display: 'inline', color: 'inherit',
    verticalAlign: 'middle', fontSize: locationInfo.flag ? 'inherit' : '0.9em',
    opacity: locationInfo.flag ? '1' : '0.7'
  });
  
  if (insertFlagElement(containerForFlag, flagSpan, screenName)) {
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
      setTimeout(() => {
        if (extensionEnabled) processUsernamesThrottled();
        if (botDetectionEnabled) scheduleBotProcessing();
      }, INIT_DELAY);
    }
  }, 500);
}

// ============================================================================
// BOT DETECTION - Simplified (Server does all scoring)
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
  
  // Select ALL tweet articles - this includes OP and all replies
  const unprocessed = document.querySelectorAll('article[data-testid="tweet"]:not([data-bot-processed])');
  if (unprocessed.length === 0) return;
  
  // Only process visible + near-visible tweets
  const visible = Array.from(unprocessed).filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight + 300 && rect.bottom > -100;
  });
  
  if (visible.length === 0) return;
  
  // Process tweets in parallel
  const batch = visible.slice(0, 8);
  const promises = batch.map(el => processBotDetection(el));
  await Promise.allSettled(promises);
  
  // Schedule more if needed
  if (visible.length > 8) {
    setTimeout(scheduleBotProcessing, 50);
  }
}

async function processBotDetection(el) {
  if (!botDetectionEnabled) return;
  // Allow reprocessing of errored tweets
  const status = el.dataset.botProcessed;
  if (status && status !== 'error') return;
  el.dataset.botProcessed = 'processing';
  
  const username = extractUsername(el);
  if (!username) {
    el.dataset.botProcessed = 'skip';
    return;
  }
  
  // Whitelist check
  if (window.BotCache?.isWhitelisted?.(username)) {
    el.dataset.botProcessed = 'whitelisted';
    return;
  }
  
  // Cache check - apply immediately if cached
  const cached = window.BotCache?.getCachedVerdict?.(username);
  if (cached) {
    // Apply UI for BOTH humans and bots (show scores)
    window.BotUI?.applyBotUI?.(el, cached, username);
    el.dataset.botProcessed = cached.isBot ? 'bot' : 'human';
    return;
  }
  
  // Extract data from DOM
  const replyData = extractReplyData(el, username);
  if (!replyData) {
    el.dataset.botProcessed = 'skip';
    return;
  }
  
  // Quick local checks (verified, substantive replies)
  const quickCheck = window.BotDetection?.shouldClassify?.(replyData, false, false);
  if (quickCheck?.action === 'skip') {
    el.dataset.botProcessed = 'skip';
    return;
  }
  
  // OPTIMISTIC UI: Show skeleton immediately while waiting for server
  el.dataset.botProcessed = 'pending';
  el.dataset.botUsername = username.toLowerCase();
  window.BotUI?.showPending?.(el, username);
  
  try {
    const verdict = await window.BotCache?.queueForClassification?.(username, replyData);
    // Resolve: replace skeleton with final verdict (show for BOTH humans and bots)
    window.BotUI?.resolvePending?.(el, verdict, username);
    el.dataset.botProcessed = verdict?.isBot ? 'bot' : 'human';
  } catch {
    // Remove skeleton on error
    el.querySelector?.('[data-bot-skeleton]')?.remove?.();
    el.dataset.botProcessed = 'error';
  }
}

function extractReplyData(el, username) {
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
      bio: '',
      followers: 0,
      following: 0,
      hasCustomAvatar,
      isVerified,
      userFollows: false,
      mutualCount: 0
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

// ============================================================================
// INIT
// ============================================================================

async function init() {
  await loadEnabledState();
  await loadCache();
  await loadStats();
  await checkStorageUsage();
  
  if (!extensionEnabled && !botDetectionEnabled) return;
  
  injectPageScript();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  if (botDetectionEnabled) {
    window.BotUI?.injectBotStyles?.();
    await window.BotCache?.loadBotCache?.();
    await window.BotCache?.loadWhitelist?.();
  }
  
  setupObservers();
  
  setTimeout(() => {
    processUsernamesThrottled();
    if (botDetectionEnabled) scheduleBotProcessing();
  }, INIT_DELAY);
  
  setInterval(saveCache, CACHE_PERIODIC_SAVE);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
