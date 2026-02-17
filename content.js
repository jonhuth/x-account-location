// Configuration constants
// Cache settings
const CACHE_KEY = 'twitter_location_cache';
const CACHE_EXPIRY_DAYS = 30;
const NULL_CACHE_EXPIRY_DAYS = 1;
const CACHE_SAVE_INTERVAL = 5000; // Debounce cache saves (ms)
const CACHE_PERIODIC_SAVE = 30000; // Periodic save interval (ms)

// Rate limiting
const MIN_REQUEST_INTERVAL = 3500; // ms between requests
const MAX_CONCURRENT_REQUESTS = 1;
const MAX_QUEUE_SIZE = 50;
const BASE_BACKOFF_MINUTES = 5;
const REQUEST_TIMEOUT = 10000; // ms

// Storage
const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024; // 10MB
const STORAGE_LOG_THRESHOLD = 90; // Don't allow writes at 90%

// Extension state
const TOGGLE_KEY = 'extension_enabled';
const DEFAULT_ENABLED = true;
const STATS_KEY = 'location_stats';

// Bot Detection state
const BOT_TOGGLE_KEY = 'bot_detection_enabled';
const BOT_SENSITIVITY_KEY = 'bot_sensitivity';
let botDetectionEnabled = true;
let botSensitivity = 3; // 1-5, default medium

// Processing
const PROCESS_THROTTLE = 3000; // ms
const INIT_DELAY = 2000; // ms
const BATCH_SIZE = 10;
const BATCH_DELAY = 4000; // ms between requests (slightly more than MIN_REQUEST_INTERVAL)

// Cache for user locations - persistent storage
let locationCache = new Map(); // Map<username, {location: string|null, expiry: number}>

// Rate limiting state
const requestQueue = [];
let isProcessingQueue = false;
let lastRequestTime = 0;
let activeRequests = 0;
let rateLimitResetTime = 0; // Unix timestamp when rate limit resets
let consecutiveRateLimits = 0; // Track consecutive rate limits for exponential backoff

// Observer state
let observer = null;
let intersectionObserver = null;

// Extension enabled state
let extensionEnabled = true;

// Track pending location requests to avoid duplicate API calls
// Map<username, Promise<location>> - serves dual purpose:
// 1. Check if username exists → it's being processed
// 2. Get the promise → we can await it
const pendingLocationRequests = new Map();

// Statistics tracking - unique profiles per country/region
const locationStats = new Map(); // Map<location, Set<username>> - in memory for deduplication

// Storage monitoring
let lastLoggedStoragePercent = -1; // Track last logged percentage to avoid duplicate logs

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
    if (botDetectionEnabled) setTimeout(processUsernamesThrottled, 500);
    else window.BotUI?.removeAllBotUI?.();
  } else if (request.type === 'botSensitivityChange') {
    botSensitivity = request.sensitivity;
  } else if (request.type === 'botWhitelistUpdate') {
    if (botDetectionEnabled) setTimeout(processUsernamesThrottled, 500);
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

// Load cache from persistent storage
async function loadCache() {
  try {
    if (!isExtensionContextValid()) return;
    
    const result = await chrome.storage.local.get(CACHE_KEY);
    if (result[CACHE_KEY]) {
      const cached = result[CACHE_KEY];
      const now = Date.now();
      
      // Filter out expired entries (including null entries that expired)
      for (const [username, data] of Object.entries(cached)) {
        if (data.expiry && data.expiry > now) {
          locationCache.set(username, {
            location: data.location,
            expiry: data.expiry
          });
          
          // Rebuild stats from cache
          if (data.location !== null) {
            if (!locationStats.has(data.location)) {
              locationStats.set(data.location, new Set());
            }
            locationStats.get(data.location).add(username);
          }
        }
      }
    }
  } catch (error) {
    // Silently ignore context invalidation errors
    if (!error.message?.includes('Extension context invalidated') && 
        !error.message?.includes('message port closed')) {
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
  if (!isExtensionContextValid() || !chrome.storage?.local?.getBytesInUse) {
    return false;
  }
  try {
    const bytesUsed = await chrome.storage.local.getBytesInUse(null);
    const percentUsed = Math.floor((bytesUsed / STORAGE_QUOTA_BYTES) * 100);
    return percentUsed < STORAGE_LOG_THRESHOLD;
  } catch (error) {
    console.error('Error checking storage:', error);
    return false;
  }
}

// Check storage usage and log at 10% increments
async function checkStorageUsage() {
  try {
    if (!isExtensionContextValid() || !chrome.storage?.local?.getBytesInUse) {
      return null;
    }
    
    const bytesUsed = await chrome.storage.local.getBytesInUse(null);
    const percentUsed = Math.floor((bytesUsed / STORAGE_QUOTA_BYTES) * 100);
    
    // Log at 10% increments (10%, 20%, 30%, etc.)
    const logThreshold = Math.floor(percentUsed / 10) * 10;
    
    // Always log if we're at or above threshold, or if we've crossed a new 10% threshold
    const shouldLog = (logThreshold > lastLoggedStoragePercent && logThreshold >= 10) || 
                      (percentUsed >= STORAGE_LOG_THRESHOLD && lastLoggedStoragePercent < STORAGE_LOG_THRESHOLD);
    
    if (shouldLog) {
      const mbUsed = (bytesUsed / (1024 * 1024)).toFixed(2);
      const mbQuota = (STORAGE_QUOTA_BYTES / (1024 * 1024)).toFixed(0);
      console.warn(`📦 Storage usage: ${percentUsed}% (${mbUsed}MB / ${mbQuota}MB)`);
      lastLoggedStoragePercent = logThreshold;
    }
    
    return percentUsed;
  } catch (error) {
    console.error('Error checking storage usage:', error);
    return null;
  }
}

// Save cache to persistent storage (batch save)
async function saveCache() {
  try {
    if (!isExtensionContextValid()) return;
    if (!(await canWriteToStorage())) return;
    
    const cacheObj = {};
    const now = Date.now();
    
    for (const [username, entry] of locationCache.entries()) {
      const expiry = entry.expiry || calculateExpiry(entry.location, now);
      cacheObj[username] = {
        location: entry.location,
        expiry: expiry,
        cachedAt: entry.cachedAt || now
      };
    }
    
    const statsObj = {};
    for (const [location, usernames] of locationStats.entries()) {
      statsObj[location] = usernames.size;
    }
    
    await chrome.storage.local.set({ [CACHE_KEY]: cacheObj, [STATS_KEY]: statsObj });
    await checkStorageUsage();
  } catch (error) {
    // Silently ignore context invalidation errors
    if (!error.message?.includes('Extension context invalidated') && 
        !error.message?.includes('message port closed')) {
      console.error('Error saving cache:', error);
    }
  }
}

// Load statistics from persistent storage
async function loadStats() {
  try {
    if (!isExtensionContextValid()) return;
    await chrome.storage.local.get(STATS_KEY);
  } catch (error) {
    // Silently ignore
  }
}


// Update statistics when a location is cached
function updateStats(username, location) {
  if (!location) {
    return; // Don't track null locations
  }
  
  if (!locationStats.has(location)) {
    locationStats.set(location, new Set());
  }
  
  const usernames = locationStats.get(location);
  if (!usernames.has(username)) {
    usernames.add(username);
    // Stats will be saved with cache (debounced)
  }
}

// Add a single entry to cache and trigger debounced save
function saveCacheEntry(username, location) {
  if (!isExtensionContextValid()) {
    return;
  }
  
  const now = Date.now();
  locationCache.set(username, {
    location: location,
    expiry: calculateExpiry(location, now),
    cachedAt: now
  });
  
  // Update statistics for non-null locations
  if (location !== null) {
    updateStats(username, location);
  }
  
  // Debounce saves
  if (!saveCache.timeout) {
    saveCache.timeout = setTimeout(async () => {
      await saveCache();
      saveCache.timeout = null;
    }, CACHE_SAVE_INTERVAL);
  }
}

// Inject script into page context to access fetch with proper cookies
function injectPageScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('pageScript.js');
  script.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
  
  // Listen for rate limit info from page script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === '__rateLimitInfo') {
      consecutiveRateLimits++;
      const baseWaitMinutes = BASE_BACKOFF_MINUTES * Math.pow(2, consecutiveRateLimits - 1);
      const exponentialWaitSeconds = baseWaitMinutes * 60;
      
      // Use the longer of: API-reported reset time or exponential backoff
      const apiResetTime = event.data.resetTime;
      const exponentialResetTime = Math.floor(Date.now() / 1000) + exponentialWaitSeconds;
      rateLimitResetTime = Math.max(apiResetTime, exponentialResetTime);
    }
  });
}

function isRateLimited() {
  if (rateLimitResetTime === 0) return false;
  const now = Math.floor(Date.now() / 1000);
  return now < rateLimitResetTime;
}

function resetRateLimit() {
  rateLimitResetTime = 0;
  consecutiveRateLimits = 0;
}

// Process request queue with rate limiting
async function processRequestQueue() {
  if (isProcessingQueue || requestQueue.length === 0) {
    return;
  }
  
  // Check if we're rate limited
  if (isRateLimited()) {
    const now = Math.floor(Date.now() / 1000);
    const waitTime = (rateLimitResetTime - now) * 1000;
    while (requestQueue.length > 0) {
      requestQueue.shift().reject(new Error('Rate limited'));
    }
    setTimeout(processRequestQueue, Math.min(waitTime, 60000));
    return;
  }
  
  // Rate limit expired, reset if needed
  if (rateLimitResetTime > 0) resetRateLimit();
  
  isProcessingQueue = true;
  
  while (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT_REQUESTS) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    // Wait if needed to respect rate limit
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }
    
    const { screenName, resolve, reject } = requestQueue.shift();
    activeRequests++;
    lastRequestTime = Date.now();
    
    // Make the request
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

// Make actual API request
function makeLocationRequest(screenName) {
  return new Promise((resolve, reject) => {
    const requestId = Date.now() + Math.random();
    
    // Listen for response via postMessage
    const handler = (event) => {
      // Only accept messages from the page (not from extension)
      if (event.source !== window) return;
      
      if (event.data && 
          event.data.type === '__locationResponse' &&
          event.data.screenName === screenName && 
          event.data.requestId === requestId) {
        window.removeEventListener('message', handler);
        const location = event.data.location;
        const isRateLimited = event.data.isRateLimited || false;
        
        // Only cache if not rate limited (don't cache failures due to rate limiting)
        if (!isRateLimited) {
          saveCacheEntry(screenName, location || null);
        }
        
        resolve(location || null);
      }
    };
    window.addEventListener('message', handler);
    
    // Send fetch request to page script via postMessage
    window.postMessage({
      type: '__fetchLocation',
      screenName,
      requestId
    }, '*');
    
    // Timeout
    setTimeout(() => {
      window.removeEventListener('message', handler);
      pendingLocationRequests.delete(screenName);
      resolve(null);
    }, REQUEST_TIMEOUT);
  });
}

// Helper: Convert location string to location info object
function createLocationInfo(location) {
  if (!location) {
    return { location: null, flag: null, displayText: null };
  }
  const flag = getCountryFlag(location);
  return {
    location,
    flag,
    displayText: flag || `(${location})`
  };
}

// Get location for a username (checks cache first, then API)
async function getLocation(screenName) {
  // Check cache first
  if (locationCache.has(screenName)) {
    const cached = locationCache.get(screenName);
    if (cached.expiry && cached.expiry > Date.now()) {
      return createLocationInfo(cached.location);
    }
    locationCache.delete(screenName);
  }
  
  // Check if there's already a pending request
  if (pendingLocationRequests.has(screenName)) {
    const location = await pendingLocationRequests.get(screenName);
    if (locationCache.has(screenName)) {
      const cached = locationCache.get(screenName);
      if (cached.expiry && cached.expiry > Date.now()) {
        return createLocationInfo(cached.location);
      }
    }
    return createLocationInfo(location);
  }
  
  // Queue full - skip
  if (requestQueue.length >= MAX_QUEUE_SIZE) {
    return { location: null, flag: null, displayText: null };
  }
  
  // Create the promise for this request and store it
  const locationPromise = new Promise((resolve, reject) => {
    requestQueue.push({ 
      screenName, 
      resolve: (location) => {
        pendingLocationRequests.delete(screenName);
        resolve(location);
      }, 
      reject: (error) => {
        pendingLocationRequests.delete(screenName);
        reject(error);
      }
    });
    processRequestQueue();
  });
  
  pendingLocationRequests.set(screenName, locationPromise);
  const location = await locationPromise;
  return createLocationInfo(location);
}

// Helper: Parse username from href
function parseUsernameFromLink(href) {
  if (!href) return null;
  const match = href.match(/^\/([^\/\?]+)/);
  return match && match[1] ? match[1] : null;
}

// Helper: Check if a string is a valid username
function isValidUsername(username) {
  if (!username || username.length === 0 || username.length >= 20) return false;
  
  const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 
                         'settings', 'bookmarks', 'lists', 'communities', 'hashtag'];
  if (excludedRoutes.includes(username) || username.startsWith('hashtag') || username.startsWith('search')) {
    return false;
  }
  
  if (username.includes('status') || /^\d+$/.test(username)) {
    return false;
  }
  
  return true;
}

// Helper: Check if link text indicates username
function isUsernameLink(link, potentialUsername) {
  const text = link.textContent?.trim() || '';
  const linkText = text.toLowerCase();
  const usernameLower = potentialUsername.toLowerCase();
  
  return text.startsWith('@') || 
         linkText === usernameLower || 
         linkText === `@${usernameLower}` ||
         (text.trim().startsWith('@') && text.trim().substring(1) === potentialUsername);
}

// Function to extract username from various Twitter UI elements
function extractUsername(element) {
  // Try data-testid="UserName" or "User-Name" first (most reliable)
  const usernameElement = element.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  if (usernameElement) {
    for (const link of usernameElement.querySelectorAll('a[href^="/"]')) {
      const username = parseUsernameFromLink(link.getAttribute('href'));
      if (username && isValidUsername(username)) {
        return username;
      }
    }
  }
  
  // Try finding username links in the entire element (broader search)
  const allLinks = element.querySelectorAll('a[href^="/"]');
  const seenUsernames = new Set();
  
  for (const link of allLinks) {
    const username = parseUsernameFromLink(link.getAttribute('href'));
    if (!username || seenUsernames.has(username) || !isValidUsername(username)) {
      continue;
    }
    seenUsernames.add(username);
    
    // Check if link text indicates it's a username
    if (isUsernameLink(link, username)) {
      return username;
    }
    
    // Check if link is in a UserName container
    const parent = link.closest('[data-testid="UserName"], [data-testid="User-Name"]');
    if (parent && !username.includes('/')) {
      return username;
    }
  }
  
  // Last resort: look for @username pattern in text content and verify with link
  const textContent = element.textContent || '';
  for (const match of textContent.matchAll(/@([a-zA-Z0-9_]+)/g)) {
    const username = match[1];
    const link = element.querySelector(`a[href="/${username}"], a[href^="/${username}?"]`);
    if (link && link.closest('[data-testid="UserName"], [data-testid="User-Name"]')) {
      return username;
    }
  }
  
  return null;
}

// Helper: Find handle section
function findHandleSection(container, screenName) {
  return Array.from(container.querySelectorAll('div')).find(div => {
    const link = div.querySelector(`a[href="/${screenName}"]`);
    return link && link.textContent?.trim() === `@${screenName}`;
  });
}

// Helper: Try to insert flag element into container
function insertFlagElement(container, flagSpan, screenName) {
  const handleSection = findHandleSection(container, screenName);
  
  // Strategy 1: Insert before handle section if it exists and is direct child
  if (handleSection && handleSection.parentNode === container) {
    try {
      container.insertBefore(flagSpan, handleSection);
      return true;
    } catch (e) {
      // Continue to next strategy
    }
  }
  
  // Strategy 2: Insert before handle section's parent if different from container
  if (handleSection?.parentNode && handleSection.parentNode !== container) {
    try {
      handleSection.parentNode.insertBefore(flagSpan, handleSection);
      return true;
    } catch (e) {
      // Continue to next strategy
    }
  }
  
  // Strategy 3: Insert after display name link if available
  const displayNameLink = container.querySelector('a[href^="/"]');
  if (displayNameLink) {
    const displayContainer = displayNameLink.closest('div');
    if (displayContainer?.parentNode) {
      try {
        displayContainer.parentNode.insertBefore(flagSpan, displayContainer.nextSibling);
        return true;
      } catch (e) {
        // Continue to fallback
      }
    }
  }
  
  // Strategy 4: Fallback - append to container
  try {
    container.appendChild(flagSpan);
    return true;
  } catch (e) {
    return false;
  }
}

// Create loading shimmer placeholder
function createLoadingShimmer() {
  const shimmer = document.createElement('span');
  shimmer.setAttribute('data-twitter-flag-shimmer', 'true');
  shimmer.style.display = 'inline-block';
  shimmer.style.width = '20px';
  shimmer.style.height = '16px';
  shimmer.style.marginLeft = '4px';
  shimmer.style.marginRight = '4px';
  shimmer.style.verticalAlign = 'middle';
  shimmer.style.borderRadius = '2px';
  shimmer.style.background = 'linear-gradient(90deg, rgba(113, 118, 123, 0.2) 25%, rgba(113, 118, 123, 0.4) 50%, rgba(113, 118, 123, 0.2) 75%)';
  shimmer.style.backgroundSize = '200% 100%';
  shimmer.style.animation = 'shimmer 1.5s infinite';
  
  // Add animation keyframes if not already added
  if (!document.getElementById('twitter-flag-shimmer-style')) {
    const style = document.createElement('style');
    style.id = 'twitter-flag-shimmer-style';
    style.textContent = `
      @keyframes shimmer {
        0% {
          background-position: -200% 0;
        }
        100% {
          background-position: 200% 0;
        }
      }
    `;
    document.head.appendChild(style);
  }
  
  return shimmer;
}

// Function to add flag to username element
async function addFlagToUsername(usernameElement, screenName) {
  // Check if flag already added
  if (usernameElement.dataset.flagAdded === 'true') {
    return;
  }

  // Check cache FIRST before making any API calls
  if (addFlagFromCache(usernameElement, screenName)) {
    return; // Already added from cache
  }

  // Check if this username is already being processed (prevent duplicate API calls)
  if (pendingLocationRequests.has(screenName)) {
    // Wait for the pending request to complete
    const locationInfo = await getLocation(screenName);
    
    // Check if flag was added by the other process
    if (usernameElement.dataset.flagAdded === 'true') {
      return;
    }
    
    // Try to add flag with the location we got
    if (locationInfo && locationInfo.location) {
      const success = addFlagToElement(usernameElement, screenName, locationInfo);
      if (success) {
        usernameElement.dataset.flagAdded = 'true';
        return;
      }
    }
    
    // If still not added, mark this container as waiting
    usernameElement.dataset.flagAdded = 'waiting';
    return;
  }

  // Mark as processing to avoid duplicate requests
  usernameElement.dataset.flagAdded = 'processing';
  
  // Find User-Name container for shimmer placement
  const userNameContainer = usernameElement.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  
  // Create and insert loading shimmer
  const shimmerSpan = createLoadingShimmer();
  let shimmerInserted = false;
  
  if (userNameContainer) {
    // Try to insert shimmer before handle section (same place flag will go)
    const handleSection = findHandleSection(userNameContainer, screenName);
    if (handleSection?.parentNode) {
      try {
        handleSection.parentNode.insertBefore(shimmerSpan, handleSection);
        shimmerInserted = true;
      } catch (e) {
        // Fallback
      }
    }
    // Fallback: append to container
    if (!shimmerInserted) {
      try {
        userNameContainer.appendChild(shimmerSpan);
        shimmerInserted = true;
      } catch (e) { /* ignore */ }
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
      // Also mark other containers waiting for this username
      document.querySelectorAll('[data-flag-added="waiting"]').forEach(container => {
        if (extractUsername(container) === screenName) {
          addFlagToUsername(container, screenName).catch(() => {});
        }
      });
    } else {
      usernameElement.dataset.flagAdded = 'failed';
    }
  } catch (error) {
    if (shimmerInserted && shimmerSpan.parentNode) shimmerSpan.remove();
    usernameElement.dataset.flagAdded = 'failed';
  }
}

// Function to remove all flags (when extension is disabled)
function removeAllFlags() {
  const flags = document.querySelectorAll('[data-twitter-flag]');
  flags.forEach(flag => flag.remove());
  
  // Also remove any loading shimmers
  const shimmers = document.querySelectorAll('[data-twitter-flag-shimmer]');
  shimmers.forEach(shimmer => shimmer.remove());
  
  // Reset flag added markers
  document.querySelectorAll('[data-flag-added]').forEach(container => {
    delete container.dataset.flagAdded;
  });
}

// Throttled wrapper for processUsernames
let processUsernamesThrottleTimeout = null;
function processUsernamesThrottled() {
  if (processUsernamesThrottleTimeout) {
    return; // Already scheduled
  }
  processUsernamesThrottleTimeout = setTimeout(() => {
    processUsernames();
    processUsernamesThrottleTimeout = null;
  }, PROCESS_THROTTLE);
}

// Helper function to add flag to element
function addFlagToElement(usernameElement, screenName, locationInfo) {
  // Check if flag already exists
  if (usernameElement.querySelector('[data-twitter-flag]')) {
    return true;
  }
  
  if (!locationInfo?.location) {
    return false;
  }
  
  // Find the User-Name container
  const containerForFlag = usernameElement.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  if (!containerForFlag) {
    return false;
  }
  
  // Create flag span
  const flagSpan = document.createElement('span');
  flagSpan.textContent = ` ${locationInfo.displayText}`;
  flagSpan.setAttribute('data-twitter-flag', 'true');
  flagSpan.setAttribute('title', locationInfo.location);
  Object.assign(flagSpan.style, {
    marginLeft: '4px',
    marginRight: '4px',
    display: 'inline',
    color: 'inherit',
    verticalAlign: 'middle',
    fontSize: locationInfo.flag ? 'inherit' : '0.9em',
    opacity: locationInfo.flag ? '1' : '0.7'
  });
  
  // Try to insert flag
  if (insertFlagElement(containerForFlag, flagSpan, screenName)) {
    usernameElement.dataset.flagAdded = 'true';
    updateStats(screenName, locationInfo.location);
    return true;
  }
  
  return false;
}

// Check cache and add flag immediately if cached
function addFlagFromCache(container, screenName) {
  if (!locationCache.has(screenName)) return false;
  
  const cached = locationCache.get(screenName);
  const now = Date.now();
  
  if (cached.expiry && cached.expiry > now && cached.location !== null) {
    const locationInfo = createLocationInfo(cached.location);
    if (addFlagToElement(container, screenName, locationInfo)) {
      return true;
    }
  }
  return false;
}

// Process visible usernames only
async function processVisibleUsernames(containers) {
  const visibleContainers = [];
  const offScreenContainers = [];
  
  // Check visibility using getBoundingClientRect (synchronous, faster)
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  
  for (const container of containers) {
    const rect = container.getBoundingClientRect();
    // Consider visible if any part is in viewport
    const isVisible = rect.top < viewportHeight && 
                     rect.bottom > 0 && 
                     rect.left < viewportWidth && 
                     rect.right > 0;
    
    if (isVisible) {
      visibleContainers.push(container);
    } else {
      offScreenContainers.push(container);
    }
  }
  
  
  // First pass: Check cache for all visible containers and display immediately
  let cachedCount = 0;
  const uncachedContainers = [];
  
  for (const container of visibleContainers) {
    const screenName = extractUsername(container);
    if (screenName) {
      const status = container.dataset.flagAdded;
      if (!status || status === 'failed') {
        // Check cache first
        if (addFlagFromCache(container, screenName)) {
          cachedCount++;
        } else {
          // Not in cache, will need API call
          uncachedContainers.push(container);
        }
      }
    }
  }
  
  
  // Second pass: Process uncached containers in batches (API calls)
  // Deduplicate usernames to avoid duplicate API calls
  const uniqueUsernames = new Map(); // Map<screenName, containers[]>
  for (const container of uncachedContainers) {
    const screenName = extractUsername(container);
    if (screenName) {
      if (!uniqueUsernames.has(screenName)) {
        uniqueUsernames.set(screenName, []);
      }
      uniqueUsernames.get(screenName).push(container);
    }
  }
  
  const uniqueUsernameList = Array.from(uniqueUsernames.keys());
  
  // Process unique usernames one at a time to respect rate limits
  for (let i = 0; i < uniqueUsernameList.length; i++) {
    const screenName = uniqueUsernameList[i];
    const containers = uniqueUsernames.get(screenName);
    
    // Process first container (will trigger API call if needed)
    if (containers.length > 0) {
      await addFlagToUsername(containers[0], screenName).catch(err => {
        console.error(`Error processing ${screenName}:`, err);
        containers.forEach(c => c.dataset.flagAdded = 'failed');
      });
      
      // If successful, add flag to other containers with same username from cache
      if (containers[0].dataset.flagAdded === 'true' && containers.length > 1) {
        // Get location info from cache (should be available now)
        if (locationCache.has(screenName)) {
          const cached = locationCache.get(screenName);
          if (cached.expiry && cached.expiry > Date.now() && cached.location) {
            const locationInfo = createLocationInfo(cached.location);
            for (let j = 1; j < containers.length; j++) {
              addFlagToElement(containers[j], screenName, locationInfo);
            }
          }
        }
      }
    }
    
    // Wait between requests to respect rate limits (except for last one)
    if (i < uniqueUsernameList.length - 1) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }
  }
  
  // Pre-check cache for off-screen containers and add flags immediately
  for (const container of offScreenContainers) {
    const screenName = extractUsername(container);
    if (screenName) {
      const status = container.dataset.flagAdded;
      if (!status || status === 'failed') {
        // Check cache first - if cached, add flag immediately
        if (!addFlagFromCache(container, screenName)) {
          // Not cached, will need API call when scrolled into view
          container.dataset.flagNeedsApi = 'true';
        }
      }
    }
  }
  
  // Set up IntersectionObserver for off-screen elements that need API calls
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
              // Double-check cache in case it was added while scrolling
              if (!addFlagFromCache(container, screenName)) {
                // Still not cached, make API call
                addFlagToUsername(container, screenName).catch(err => {
                  console.error(`Error processing ${screenName}:`, err);
                  container.dataset.flagAdded = 'failed';
                });
              }
            }
          }
          intersectionObserver.unobserve(container);
        }
      });
    }, { threshold: 0.1 });
    
    // Observe only uncached off-screen containers
    uncachedOffScreen.forEach(container => {
      intersectionObserver.observe(container);
    });
  }
}

// Function to process all username elements on the page
async function processUsernames() {
  // Check if extension is enabled
  if (!extensionEnabled) {
    return;
  }
  
  const containers = document.querySelectorAll('article[data-testid="tweet"], [data-testid="UserCell"], [data-testid="User-Names"], [data-testid="User-Name"]');
  if (containers.length === 0) return;
  
  // Process visible elements first, then set up observer for off-screen
  await processVisibleUsernames(containers);
}

// Setup observers for dynamically loaded content
function setupObservers() {
  // MutationObserver for new content (throttled)
  if (observer) observer.disconnect();
  
  let mutationTimeout = null;
  observer = new MutationObserver((mutations) => {
    if (mutations.some(m => m.addedNodes.length > 0)) {
      // Coalesce rapid mutations into single processing
      if (!mutationTimeout) {
        mutationTimeout = setTimeout(() => {
          mutationTimeout = null;
          if (extensionEnabled) processUsernamesThrottled();
          if (botDetectionEnabled) scheduleBotProcessing();
        }, 200); // 200ms debounce
      }
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
  
  // Scroll listener for processing tweets that become visible
  let scrollTimeout = null;
  window.addEventListener('scroll', () => {
    if (!scrollTimeout) {
      scrollTimeout = setTimeout(() => {
        scrollTimeout = null;
        if (botDetectionEnabled) scheduleBotProcessing();
      }, 300); // 300ms debounce on scroll
    }
  }, { passive: true });
  
  // Navigation observer for SPA (separate, less frequent)
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        if (extensionEnabled) processUsernamesThrottled();
        if (botDetectionEnabled) scheduleBotProcessing();
      }, INIT_DELAY);
    }
  }, 500); // Check every 500ms instead of every mutation
}

// Main initialization
async function init() {
  await loadEnabledState();
  await loadCache();
  await loadStats();
  await checkStorageUsage();
  
  if (!extensionEnabled && !botDetectionEnabled) return;
  
  // Inject page script FIRST - other systems depend on it
  injectPageScript();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Initialize bot detection modules (silent - only log errors)
  if (botDetectionEnabled) {
    window.BotUI?.injectBotStyles?.();
    await window.BotCache?.loadBotCache?.();
    await window.BotCache?.loadWhitelist?.();
    window.BotLegitimacy?.initLegitimacy?.();
  }
  
  setupObservers();
  
  setTimeout(() => {
    processUsernamesThrottled();
    if (botDetectionEnabled) scheduleBotProcessing();
  }, INIT_DELAY);
  
  setInterval(saveCache, CACHE_PERIODIC_SAVE);
  
  // One-time summary log
  console.log(`X-Tools: location=${extensionEnabled}, bots=${botDetectionEnabled}`);
}

// ============================================================================
// Bot Detection Integration (Performance-Optimized)
// ============================================================================

const BotModules = {
  get Detection() { return window.BotDetection; },
  get UI() { return window.BotUI; },
  get Cache() { return window.BotCache; },
  get Legitimacy() { return window.BotLegitimacy; },
};

// Debounce/throttle for bot detection
let botProcessingScheduled = false;
let botStats = { processed: 0, bots: 0, humans: 0 };

// Request user data from intercepted Twitter API cache
function requestUserData(username) {
  return new Promise((resolve) => {
    const requestId = `userData_${Date.now()}_${Math.random()}`;
    const handler = (event) => {
      if (event.data?.type === '__userDataResponse' && event.data.requestId === requestId) {
        window.removeEventListener('message', handler);
        resolve(event.data.userData);
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ type: '__getUserData', username, requestId }, '*');
    // Timeout after 100ms - don't block on missing data
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 100);
  });
}

// Process a single tweet for bot detection
async function processBotDetection(el) {
  if (!botDetectionEnabled || el.dataset.botProcessed) return;
  el.dataset.botProcessed = 'processing';
  
  const username = extractUsername(el);
  if (!username) {
    console.log('🤖 Skipping tweet - no username found');
    el.dataset.botProcessed = 'skip';
    return;
  }
  
  // Whitelist check
  if (BotModules.Cache?.isWhitelisted?.(username)) {
    el.dataset.botProcessed = 'whitelisted';
    return;
  }
  
  // Cache check
  const cached = BotModules.Cache?.getCachedVerdict?.(username);
  if (cached) {
    if (cached.isBot) BotModules.UI?.applyBotUI?.(el, cached);
    el.dataset.botProcessed = 'cached';
    return;
  }
  
  // Extract data from DOM (synchronous)
  const replyData = extractReplyData(el, username);
  if (!replyData) { el.dataset.botProcessed = 'skip'; return; }
  
  // Add legitimacy context (async but fast - uses local cache)
  if (BotModules.Legitimacy?.getUserContext) {
    const ctx = await BotModules.Legitimacy.getUserContext(username);
    replyData.userFollows = ctx.userFollows;
    replyData.mutualCount = ctx.mutualCount;
  }
  
  // Calculate score
  if (!BotModules.Detection?.calculateBotScore) {
    el.dataset.botProcessed = 'skip';
    return;
  }
  
  const result = BotModules.Detection.calculateBotScore(replyData);
  const score = result.score;
  const action = BotModules.Detection.getActionForScore?.(score, replyData.hasTwitterData) || 'none';
  
  // Debug: Log detection results (only if interesting)
  if (score > 10 || action !== 'none') {
    console.log(`🤖 @${username}: score=${score}, action=${action}, tweet="${replyData.replyText?.slice(0, 50)}..."`, result.breakdown);
  }
  
  if (action === 'dim') {
    // High confidence bot
    const verdict = {
      username, isBot: true,
      confidence: Math.min(0.95, score / 100),
      category: 'crypto_spam',
      reason: 'Heuristic detection',
      source: 'heuristics',
      expiry: Date.now() + 7 * 24 * 60 * 60 * 1000
    };
    console.log(`🚫 BOT: @${username} flagged with score=${score}`);
    BotModules.Cache?.persistBotCache?.(username, verdict);
    BotModules.UI?.applyBotUI?.(el, verdict);
    botStats.bots++;
    el.dataset.botProcessed = 'bot';
  } else if (action === 'ai') {
    // Queue for AI - enrich with heuristic score for server context
    const enrichedData = {
      ...replyData,
      heuristicScore: score,
      originalTweetText: '', // Not easily available, server handles missing data
      secondsAfterOriginal: 0, // Not easily available
      accountCreatedAt: '', // Not available from DOM
    };
    
    BotModules.Cache?.queueForClassification?.(enrichedData, (verdict) => {
      if (verdict?.isBot) {
        BotModules.UI?.applyBotUI?.(el, verdict);
        botStats.bots++;
      } else {
        botStats.humans++;
      }
      el.dataset.botProcessed = verdict?.isBot ? 'bot' : 'human';
    });
    el.dataset.botProcessed = 'pending';
  } else {
    botStats.humans++;
    el.dataset.botProcessed = 'human';
  }
  
  botStats.processed++;
}

// Extract data from tweet element (DOM only - no external API)
function extractReplyData(el, username) {
  try {
    // Display name - first link in User-Name container
    const userNameContainer = el.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
    let displayName = username;
    if (userNameContainer) {
      const nameLink = userNameContainer.querySelector('a[href^="/"]');
      if (nameLink) {
        // Display name is the text content excluding the @handle
        const fullText = nameLink.textContent?.trim() || '';
        if (fullText && !fullText.startsWith('@')) {
          displayName = fullText;
        }
      }
    }
    
    // Tweet text
    const replyText = el.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || '';
    
    // Avatar - check if custom (not default)
    const avatarEl = el.querySelector('img[src*="profile_images"]');
    const hasCustomAvatar = avatarEl ? !avatarEl.src.includes('default_profile') : true; // Assume custom if we can't tell
    
    // Verified badge
    const isVerified = !!(
      el.querySelector('[data-testid="icon-verified"]') ||
      el.querySelector('svg[aria-label*="Verified"]') ||
      el.querySelector('[aria-label*="Verified"]')
    );
    
    // Location from our cache (if we've looked up this user before)
    const cachedLocation = locationCache.get(username.toLowerCase());
    
    return {
      username,
      displayName,
      replyText,
      bio: '', // Not available from DOM - server can still analyze other signals
      followers: 0, // Not available from DOM
      following: 0, // Not available from DOM
      createdAt: '', // Not available from DOM
      hasCustomAvatar,
      isVerified,
      location: cachedLocation?.location || null,
      // DOM-only mode - scoring should rely on content/name signals
      hasTwitterData: false,
      userFollows: false,
      mutualCount: 0
    };
  } catch (e) {
    console.error('Error extracting reply data:', e);
    return null;
  }
}

// Batch process visible tweets (throttled)
function scheduleBotProcessing() {
  if (botProcessingScheduled || !botDetectionEnabled) return;
  botProcessingScheduled = true;
  
  requestAnimationFrame(() => {
    botProcessingScheduled = false;
    processBotDetectionBatch();
  });
}

async function processBotDetectionBatch() {
  const allTweets = document.querySelectorAll('article[data-testid="tweet"]');
  const unprocessed = document.querySelectorAll('article[data-testid="tweet"]:not([data-bot-processed])');
  
  if (unprocessed.length === 0) return;
  
  // Log diagnostic info 
  const usernames = Array.from(unprocessed).map(el => extractUsername(el)).filter(Boolean);
  console.log(`🤖 Batch: ${unprocessed.length} unprocessed (${usernames.slice(0, 5).map(u => '@' + u).join(', ')}${usernames.length > 5 ? '...' : ''})`);
  
  // Only process visible tweets
  const visible = Array.from(unprocessed).filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight + 200 && rect.bottom > -200;
  });
  
  // Process in small batches to avoid blocking
  const batch = visible.slice(0, 5);
  for (const el of batch) {
    await processBotDetection(el);
  }
  
  // If more to process, schedule next batch
  if (visible.length > 5) {
    setTimeout(scheduleBotProcessing, 50);
  }
}

// Legacy function name for compatibility
function processBotDetectionForReplies() {
  scheduleBotProcessing();
}

// Debug function: Force reprocess all tweets (call from console: forceReprocessBots())
window.forceReprocessBots = async function() {
  const allTweets = document.querySelectorAll('article[data-testid="tweet"]');
  console.log(`🔧 Force reprocessing ${allTweets.length} tweets...`);
  
  // Reset processed flags
  allTweets.forEach(el => {
    delete el.dataset.botProcessed;
  });
  
  // Process all
  for (const el of allTweets) {
    await processBotDetection(el);
  }
  
  console.log('🔧 Done!');
};

// Debug function: Show all tweet usernames on page
window.debugShowTweets = function() {
  const allTweets = document.querySelectorAll('article[data-testid="tweet"]');
  const data = Array.from(allTweets).map(el => ({
    username: extractUsername(el),
    processed: el.dataset.botProcessed,
    hasUserName: !!el.querySelector('[data-testid="UserName"], [data-testid="User-Name"]'),
    tweetText: el.querySelector('[data-testid="tweetText"]')?.textContent?.slice(0, 50)
  }));
  console.table(data);
  return data;
};

// Wait for page to load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

