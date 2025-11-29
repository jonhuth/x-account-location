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
    const result = await chrome.storage.local.get([TOGGLE_KEY]);
    extensionEnabled = result[TOGGLE_KEY] !== undefined ? result[TOGGLE_KEY] : DEFAULT_ENABLED;
    console.log('Extension enabled:', extensionEnabled);
  } catch (error) {
    console.error('Error loading enabled state:', error);
    extensionEnabled = DEFAULT_ENABLED;
  }
}

// Listen for toggle changes from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'extensionToggle') {
    extensionEnabled = request.enabled;
    console.log('Extension toggled:', extensionEnabled);
    
    if (extensionEnabled) {
      // Re-initialize if enabled
      setTimeout(() => {
        processUsernamesThrottled();
      }, 500);
    } else {
      // Remove all flags if disabled
      removeAllFlags();
    }
  } else if (request.type === 'resetStats') {
    // Clear in-memory statistics
    locationStats.clear();
    console.log('Statistics reset');
  }
});

// Load cache from persistent storage
async function loadCache() {
  try {
    if (!isExtensionContextValid()) {
      console.log('Extension context invalidated, skipping cache load');
      return;
    }
    
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
      const validCount = Array.from(locationCache.values()).filter(e => e.location !== null).length;
      const nullCount = Array.from(locationCache.values()).filter(e => e.location === null).length;
      console.log(`Loaded ${locationCache.size} cached entries (${validCount} valid, ${nullCount} null)`);
      console.log(`Rebuilt stats for ${locationStats.size} locations`);
    }
  } catch (error) {
    // Extension context invalidated errors are expected when extension is reloaded
    if (error.message?.includes('Extension context invalidated') || 
        error.message?.includes('message port closed')) {
      console.log('Extension context invalidated, cache load skipped');
    } else {
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
    if (!isExtensionContextValid()) {
      console.log('Extension context invalidated, skipping cache save');
      return;
    }
    
    if (!(await canWriteToStorage())) {
      const percent = await checkStorageUsage();
      console.error(`❌ Storage at ${percent}% - cannot save cache. Please upgrade storage method.`);
      return;
    }
    
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
    
    // Save cache and stats together
    const statsObj = {};
    for (const [location, usernames] of locationStats.entries()) {
      statsObj[location] = usernames.size;
    }
    
    await chrome.storage.local.set({
      [CACHE_KEY]: cacheObj,
      [STATS_KEY]: statsObj
    });
    
    await checkStorageUsage();
  } catch (error) {
    if (error.message?.includes('Extension context invalidated') || 
        error.message?.includes('message port closed')) {
      console.log('Extension context invalidated, cache save skipped');
    } else {
      console.error('Error saving cache:', error);
    }
  }
}

// Load statistics from persistent storage
async function loadStats() {
  try {
    if (!isExtensionContextValid()) {
      console.log('Extension context invalidated, skipping stats load');
      return;
    }
    
    const result = await chrome.storage.local.get(STATS_KEY);
    if (result[STATS_KEY]) {
      const stats = result[STATS_KEY];
      // Convert counts back to Sets for deduplication (we'll rebuild from cache)
      // For now, just store the counts - we'll rebuild Sets as we process new entries
      console.log(`Loaded stats for ${Object.keys(stats).length} locations`);
    }
  } catch (error) {
    console.error('Error loading stats:', error);
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
      
      const waitMinutes = Math.ceil((rateLimitResetTime - Math.floor(Date.now() / 1000)) / 60);
      console.warn(`🚫 RATE LIMIT #${consecutiveRateLimits}: Exponential backoff active. Will resume in ${waitMinutes} minutes (backoff: ${baseWaitMinutes}min base × 2^${consecutiveRateLimits - 1})`);
    }
  });
}

function isRateLimited() {
  if (rateLimitResetTime === 0) return false;
  const now = Math.floor(Date.now() / 1000);
  return now < rateLimitResetTime;
}

function resetRateLimit() {
  if (consecutiveRateLimits > 0) {
    console.log(`✅ Rate limit cleared after ${consecutiveRateLimits} consecutive limit${consecutiveRateLimits > 1 ? 's' : ''}. Resuming normal operation.`);
  }
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
    const waitMinutes = Math.ceil(waitTime / 1000 / 60);
    console.log(`⏸️  Rate limited. Waiting ${waitMinutes} minutes... (${consecutiveRateLimits} consecutive rate limit${consecutiveRateLimits > 1 ? 's' : ''})`);
    
    // Reject pending requests
    while (requestQueue.length > 0) {
      requestQueue.shift().reject(new Error('Rate limited'));
    }
    
    setTimeout(processRequestQueue, Math.min(waitTime, 60000));
    return;
  }
  
  // Rate limit expired, reset if needed
  if (rateLimitResetTime > 0) {
    resetRateLimit();
  }
  
  if (requestQueue.length > 0) {
    console.log(`Processing queue: ${requestQueue.length} requests pending, ${activeRequests} active`);
  }
  
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
      // Successful request - reset consecutive rate limit counter
      if (consecutiveRateLimits > 0) {
        console.log(`✅ Successful request after ${consecutiveRateLimits} rate limit${consecutiveRateLimits > 1 ? 's' : ''}. Resetting backoff.`);
        consecutiveRateLimits = 0;
      }
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
        } else {
          console.warn(`⚠️  Not caching null for ${screenName} due to rate limit`);
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
      // Remove from pending requests on timeout
      pendingLocationRequests.delete(screenName);
      // Don't cache timeout failures - allow retry
      console.log(`Request timeout for ${screenName}, not caching`);
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
// Returns: { location: string|null, flag: string|null, displayText: string }
async function getLocation(screenName) {
  // Check cache first
  if (locationCache.has(screenName)) {
    const cached = locationCache.get(screenName);
    const now = Date.now();
    
    if (cached.expiry && cached.expiry > now) {
      const locationInfo = createLocationInfo(cached.location);
      const display = locationInfo.flag || locationInfo.displayText || 'null';
      console.log(`✅ CACHE HIT: @${screenName} → ${display} (${cached.location || 'no location'})`);
      return locationInfo;
    }
    
    // Cache expired, remove it
    console.log(`⏰ Cache expired for ${screenName}, removing`);
    locationCache.delete(screenName);
  }
  
  // Check if there's already a pending request for this username
  if (pendingLocationRequests.has(screenName)) {
    console.log(`⏳ Waiting for pending request for @${screenName}`);
    const location = await pendingLocationRequests.get(screenName);
    
    // After waiting, check cache again - it might have been updated
    if (locationCache.has(screenName)) {
      const cached = locationCache.get(screenName);
      if (cached.expiry && cached.expiry > Date.now()) {
        const locationInfo = createLocationInfo(cached.location);
        const display = locationInfo.flag || locationInfo.displayText || 'null';
        console.log(`✅ CACHE HIT (after wait): @${screenName} → ${display}`);
        return locationInfo;
      }
    }
    
    return createLocationInfo(location);
  }
  
  // Not in cache or expired, need to fetch from API
  if (requestQueue.length >= MAX_QUEUE_SIZE) {
    console.warn(`Queue full (${requestQueue.length}/${MAX_QUEUE_SIZE}), rejecting request for ${screenName}`);
    return { location: null, flag: null, displayText: null };
  }
  
  console.log(`📡 API REQUEST: @${screenName} (queue: ${requestQueue.length}/${MAX_QUEUE_SIZE})`);
  
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
      } catch (e) {
        console.log('Failed to insert shimmer');
      }
    }
  }
  
  try {
    console.log(`Processing flag for ${screenName}...`);

    // Get location info (flag || country || region)
    const locationInfo = await getLocation(screenName);
    
    // Remove shimmer
    if (shimmerInserted && shimmerSpan.parentNode) {
      shimmerSpan.remove();
    }
    
    if (!locationInfo || !locationInfo.location) {
      console.log(`No location found for ${screenName}, marking as failed`);
      usernameElement.dataset.flagAdded = 'failed';
      return;
    }

    console.log(`Location info for ${screenName}:`, locationInfo);

    // Use the helper function to add the flag
    const success = addFlagToElement(usernameElement, screenName, locationInfo);
    
    if (success) {
      console.log(`✓ Successfully added ${locationInfo.displayText} for ${screenName} (${locationInfo.location})`);
      
      // Also mark any other containers waiting for this username
      const waitingContainers = document.querySelectorAll(`[data-flag-added="waiting"]`);
      waitingContainers.forEach(container => {
        const waitingUsername = extractUsername(container);
        if (waitingUsername === screenName) {
          // Try to add flag to this container too
          addFlagToUsername(container, screenName).catch(() => {});
        }
      });
    } else {
      console.error(`✗ Failed to insert flag for ${screenName}`);
      usernameElement.dataset.flagAdded = 'failed';
    }
  } catch (error) {
    console.error(`Error processing flag for ${screenName}:`, error);
    // Remove shimmer on error
    if (shimmerInserted && shimmerSpan.parentNode) {
      shimmerSpan.remove();
    }
    usernameElement.dataset.flagAdded = 'failed';
  } finally {
    // Note: pendingLocationRequests is cleaned up in getLocation() when promise resolves/rejects
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
  const containers = document.querySelectorAll('[data-flag-added]');
  containers.forEach(container => {
    delete container.dataset.flagAdded;
  });
  
  console.log('Removed all flags');
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
      const display = locationInfo.flag || locationInfo.displayText || 'null';
      console.log(`✅ CACHE HIT (display): @${screenName} → ${display}`);
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
  
  console.log(`Found ${visibleContainers.length} visible and ${offScreenContainers.length} off-screen containers`);
  
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
  
  console.log(`Found ${cachedCount} cached accounts, ${uncachedContainers.length} need API calls`);
  
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
  console.log(`Processing ${uniqueUsernameList.length} unique usernames (from ${uncachedContainers.length} containers)`);
  
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
  
  // Find all tweet/article containers and user cells
  const containers = document.querySelectorAll('article[data-testid="tweet"], [data-testid="UserCell"], [data-testid="User-Names"], [data-testid="User-Name"]');
  
  console.log(`Processing ${containers.length} containers for usernames`);
  
  if (containers.length === 0) {
    return;
  }
  
  // Process visible elements first, then set up observer for off-screen
  await processVisibleUsernames(containers);
}

// Setup observers for dynamically loaded content
function setupObservers() {
  // MutationObserver for new content
  if (observer) {
    observer.disconnect();
  }
  
  observer = new MutationObserver((mutations) => {
    // Check if any mutations added nodes (extension enabled check is in processUsernames)
    if (mutations.some(m => m.addedNodes.length > 0)) {
      processUsernamesThrottled();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Navigation observer for SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      console.log('Page navigation detected, reprocessing usernames');
      setTimeout(processUsernamesThrottled, INIT_DELAY);
    }
  }).observe(document, { subtree: true, childList: true });
}

// Main initialization
async function init() {
  console.log('Twitter Location Flag extension initialized');
  
  await loadEnabledState();
  await loadCache();
  await loadStats();
  await checkStorageUsage();
  
  if (!extensionEnabled) {
    console.log('Extension is disabled');
    return;
  }
  
  injectPageScript();
  setupObservers();
  
  setTimeout(() => {
    processUsernamesThrottled();
  }, INIT_DELAY);
  
  setInterval(saveCache, CACHE_PERIODIC_SAVE);
}

// Wait for page to load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

