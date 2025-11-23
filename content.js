// Cache for user locations - persistent storage
let locationCache = new Map(); // Map<username, {location: string|null, expiry: number}>
const CACHE_KEY = 'twitter_location_cache';
const CACHE_EXPIRY_DAYS = 30; // Cache for 30 days for valid locations
const NULL_CACHE_EXPIRY_DAYS = 1; // Cache for 1 day for null entries (no location found)

// Rate limiting
const requestQueue = [];
let isProcessingQueue = false;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3500; // 3.5 seconds between requests (increased to avoid rate limits)
const MAX_CONCURRENT_REQUESTS = 1; // Single concurrent request to reduce API load
const MAX_QUEUE_SIZE = 50; // Maximum queue size to prevent unbounded growth
let activeRequests = 0;
let rateLimitResetTime = 0; // Unix timestamp when rate limit resets
let consecutiveRateLimits = 0; // Track consecutive rate limits for exponential backoff
const BASE_BACKOFF_MINUTES = 5; // Base wait time in minutes

// Observer for dynamically loaded content
let observer = null;
// IntersectionObserver for visible elements
let intersectionObserver = null;

// Extension enabled state
let extensionEnabled = true;
const TOGGLE_KEY = 'extension_enabled';
const DEFAULT_ENABLED = true;

// Track usernames currently being processed to avoid duplicate requests
const processingUsernames = new Set();

// Statistics tracking - unique profiles per country/region
const locationStats = new Map(); // Map<location, Set<username>> - in memory for deduplication
const STATS_KEY = 'location_stats'; // Storage key for statistics (counts only)

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
    // Check if extension context is still valid
    if (!chrome.runtime?.id) {
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

// Save cache to persistent storage
async function saveCache() {
  try {
    // Check if extension context is still valid
    if (!chrome.runtime?.id) {
      console.log('Extension context invalidated, skipping cache save');
      return;
    }
    
    const cacheObj = {};
    const now = Date.now();
    
    for (const [username, entry] of locationCache.entries()) {
      // Use existing expiry if available, otherwise calculate new one
      const expiry = entry.expiry || (entry.location === null 
        ? now + (NULL_CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
        : now + (CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000));
      
      cacheObj[username] = {
        location: entry.location,
        expiry: expiry,
        cachedAt: entry.cachedAt || now
      };
    }
    
    await chrome.storage.local.set({ [CACHE_KEY]: cacheObj });
  } catch (error) {
    // Extension context invalidated errors are expected when extension is reloaded
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
    if (!chrome.runtime?.id) {
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

// Save statistics to persistent storage (counts only)
async function saveStats() {
  try {
    if (!chrome.runtime?.id) {
      console.log('Extension context invalidated, skipping stats save');
      return;
    }
    
    const statsObj = {};
    for (const [location, usernames] of locationStats.entries()) {
      statsObj[location] = usernames.size; // Store only count
    }
    
    await chrome.storage.local.set({ [STATS_KEY]: statsObj });
  } catch (error) {
    console.error('Error saving stats:', error);
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
    // Debounce stats save - save every 2 seconds for real-time popup updates
    if (!saveStats.timeout) {
      saveStats.timeout = setTimeout(async () => {
        await saveStats();
        saveStats.timeout = null;
      }, 2000);
    }
  }
}

// Save a single entry to cache
async function saveCacheEntry(username, location) {
  // Check if extension context is still valid
  if (!chrome.runtime?.id) {
    console.log('Extension context invalidated, skipping cache entry save');
    return;
  }
  
  const now = Date.now();
  const expiry = location === null
    ? now + (NULL_CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
    : now + (CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  
  locationCache.set(username, {
    location: location,
    expiry: expiry,
    cachedAt: now
  });
  
  // Update statistics for non-null locations
  if (location !== null) {
    updateStats(username, location);
  }
  
  // Debounce saves - only save every 5 seconds
  if (!saveCache.timeout) {
    saveCache.timeout = setTimeout(async () => {
      await saveCache();
      saveCache.timeout = null;
    }, 5000);
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

// Process request queue with rate limiting
async function processRequestQueue() {
  if (isProcessingQueue || requestQueue.length === 0) {
    return;
  }
  
  // Check if we're rate limited
  if (rateLimitResetTime > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (now < rateLimitResetTime) {
      const waitTime = (rateLimitResetTime - now) * 1000;
      const waitMinutes = Math.ceil(waitTime / 1000 / 60);
      console.log(`⏸️  Rate limited. Waiting ${waitMinutes} minutes... (${consecutiveRateLimits} consecutive rate limit${consecutiveRateLimits > 1 ? 's' : ''})`);
      // Clean up queue on rate limit - reject pending requests
      while (requestQueue.length > 0) {
        const { reject } = requestQueue.shift();
        reject(new Error('Rate limited'));
      }
      setTimeout(processRequestQueue, Math.min(waitTime, 60000)); // Check every minute max
      return;
    } else {
      // Rate limit expired, reset counters
      if (consecutiveRateLimits > 0) {
        console.log(`✅ Rate limit cleared after ${consecutiveRateLimits} consecutive limit${consecutiveRateLimits > 1 ? 's' : ''}. Resuming normal operation.`);
      }
      rateLimitResetTime = 0;
      consecutiveRateLimits = 0;
    }
  }
  
  // Log queue status
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
    makeLocationRequest(screenName)
      .then(location => {
        // Successful request - reset consecutive rate limit counter
        if (consecutiveRateLimits > 0) {
          console.log(`✅ Successful request after ${consecutiveRateLimits} rate limit${consecutiveRateLimits > 1 ? 's' : ''}. Resetting backoff.`);
          consecutiveRateLimits = 0;
        }
        resolve(location);
      })
      .catch(error => {
        reject(error);
      })
      .finally(() => {
        activeRequests--;
        // Continue processing queue
        setTimeout(processRequestQueue, 200);
      });
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
    
    // Timeout after 10 seconds
    setTimeout(() => {
      window.removeEventListener('message', handler);
      // Don't cache timeout failures - allow retry
      console.log(`Request timeout for ${screenName}, not caching`);
      resolve(null);
    }, 10000);
  });
}

// Helper function to get location info (flag || country || region)
// Returns: { location: string|null, flag: string|null, displayText: string }
function getLocationInfo(location) {
  if (!location) {
    return { location: null, flag: null, displayText: null };
  }
  
  const flag = getCountryFlag(location);
  
  if (flag) {
    return { location, flag, displayText: flag };
  } else {
    // No flag found, use location text as fallback
    return { location, flag: null, displayText: `(${location})` };
  }
}

// Get location for a username (checks cache first, then API)
// Returns: { location: string|null, flag: string|null, displayText: string }
async function getLocation(screenName) {
  // Check cache first
  if (locationCache.has(screenName)) {
    const cached = locationCache.get(screenName);
    const now = Date.now();
    
    // Check if cache entry is expired
    if (cached.expiry && cached.expiry > now) {
      // Cache is valid, return location info
      const locationInfo = getLocationInfo(cached.location);
      const display = locationInfo.flag || locationInfo.displayText || 'null';
      console.log(`✅ CACHE HIT: @${screenName} → ${display} (${cached.location || 'no location'})`);
      return locationInfo;
    } else {
      // Cache expired, remove it
      console.log(`⏰ Cache expired for ${screenName}, removing`);
      locationCache.delete(screenName);
    }
  }
  
  // Not in cache or expired, need to fetch from API
  // Check if queue is full
  if (requestQueue.length >= MAX_QUEUE_SIZE) {
    console.warn(`Queue full (${requestQueue.length}/${MAX_QUEUE_SIZE}), rejecting request for ${screenName}`);
    return { location: null, flag: null, displayText: null };
  }
  
  console.log(`📡 API REQUEST: @${screenName} (queue: ${requestQueue.length}/${MAX_QUEUE_SIZE})`);
  
  // Queue the API request
  const location = await new Promise((resolve, reject) => {
    requestQueue.push({ screenName, resolve, reject });
    processRequestQueue();
  });
  
  // Return location info with flag/country/region logic
  return getLocationInfo(location);
}

// Function to extract username from various Twitter UI elements
function extractUsername(element) {
  // Try data-testid="UserName" or "User-Name" first (most reliable)
  const usernameElement = element.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  if (usernameElement) {
    const links = usernameElement.querySelectorAll('a[href^="/"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      const match = href.match(/^\/([^\/\?]+)/);
      if (match && match[1]) {
        const username = match[1];
        // Filter out common routes
        const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
        if (!excludedRoutes.includes(username) && 
            !username.startsWith('hashtag') &&
            !username.startsWith('search') &&
            username.length > 0 &&
            username.length < 20) { // Usernames are typically short
          return username;
        }
      }
    }
  }
  
  // Try finding username links in the entire element (broader search)
  const allLinks = element.querySelectorAll('a[href^="/"]');
  const seenUsernames = new Set();
  
  for (const link of allLinks) {
    const href = link.getAttribute('href');
    if (!href) continue;
    
    const match = href.match(/^\/([^\/\?]+)/);
    if (!match || !match[1]) continue;
    
    const potentialUsername = match[1];
    
    // Skip if we've already checked this username
    if (seenUsernames.has(potentialUsername)) continue;
    seenUsernames.add(potentialUsername);
    
    // Filter out routes and invalid usernames
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities', 'hashtag'];
    if (excludedRoutes.some(route => potentialUsername === route || potentialUsername.startsWith(route))) {
      continue;
    }
    
    // Skip status/tweet links
    if (potentialUsername.includes('status') || potentialUsername.match(/^\d+$/)) {
      continue;
    }
    
    // Check link text/content for username indicators
    const text = link.textContent?.trim() || '';
    const linkText = text.toLowerCase();
    const usernameLower = potentialUsername.toLowerCase();
    
    // If link text starts with @, it's definitely a username
    if (text.startsWith('@')) {
      return potentialUsername;
    }
    
    // If link text matches the username (without @), it's likely a username
    if (linkText === usernameLower || linkText === `@${usernameLower}`) {
      return potentialUsername;
    }
    
    // Check if link is in a UserName container or has username-like structure
    const parent = link.closest('[data-testid="UserName"], [data-testid="User-Name"]');
    if (parent) {
      // If it's in a UserName container and looks like a username, return it
      if (potentialUsername.length > 0 && potentialUsername.length < 20 && !potentialUsername.includes('/')) {
        return potentialUsername;
      }
    }
    
    // Also check if link text is @username format
    if (text && text.trim().startsWith('@')) {
      const atUsername = text.trim().substring(1);
      if (atUsername === potentialUsername) {
        return potentialUsername;
      }
    }
  }
  
  // Last resort: look for @username pattern in text content and verify with link
  const textContent = element.textContent || '';
  const atMentionMatches = textContent.matchAll(/@([a-zA-Z0-9_]+)/g);
  for (const match of atMentionMatches) {
    const username = match[1];
    // Verify it's actually a link in a User-Name container
    const link = element.querySelector(`a[href="/${username}"], a[href^="/${username}?"]`);
    if (link) {
      // Make sure it's in a username context, not just mentioned in tweet text
      const isInUserNameContainer = link.closest('[data-testid="UserName"], [data-testid="User-Name"]');
      if (isInUserNameContainer) {
        return username;
      }
    }
  }
  
  return null;
}

// Helper function to find handle section
function findHandleSection(container, screenName) {
  return Array.from(container.querySelectorAll('div')).find(div => {
    const link = div.querySelector(`a[href="/${screenName}"]`);
    if (link) {
      const text = link.textContent?.trim();
      return text === `@${screenName}`;
    }
    return false;
  });
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

  // Check if this username is already being processed (prevent duplicate API calls)
  if (processingUsernames.has(screenName)) {
    // Wait a bit and check if flag was added by the other process
    await new Promise(resolve => setTimeout(resolve, 500));
    if (usernameElement.dataset.flagAdded === 'true') {
      return;
    }
    // If still not added, mark this container as waiting
    usernameElement.dataset.flagAdded = 'waiting';
    return;
  }

  // Mark as processing to avoid duplicate requests
  usernameElement.dataset.flagAdded = 'processing';
  processingUsernames.add(screenName);
  
  // Find User-Name container for shimmer placement
  const userNameContainer = usernameElement.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  
  // Create and insert loading shimmer
  const shimmerSpan = createLoadingShimmer();
  let shimmerInserted = false;
  
  if (userNameContainer) {
    // Try to insert shimmer before handle section (same place flag will go)
    const handleSection = findHandleSection(userNameContainer, screenName);
    if (handleSection && handleSection.parentNode) {
      try {
        handleSection.parentNode.insertBefore(shimmerSpan, handleSection);
        shimmerInserted = true;
      } catch (e) {
        // Fallback: insert at end of container
        try {
          userNameContainer.appendChild(shimmerSpan);
          shimmerInserted = true;
        } catch (e2) {
          console.log('Failed to insert shimmer');
        }
      }
    } else {
      // Fallback: insert at end of container
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
    // Remove from processing set
    processingUsernames.delete(screenName);
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
  }, 3000); // 3 second throttle
}

// Helper function to add flag to element
function addFlagToElement(usernameElement, screenName, locationInfo) {
  // Check if flag already exists
  const existingFlag = usernameElement.querySelector('[data-twitter-flag]');
  if (existingFlag) {
    return true; // Already added
  }
  
  if (!locationInfo || !locationInfo.location) {
    return false; // No location to display
  }
  
  // Find the User-Name container
  const containerForFlag = usernameElement.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  if (!containerForFlag) {
    return false;
  }
  
  // Create flag span with flag || country || region
  const flagSpan = document.createElement('span');
  flagSpan.textContent = ` ${locationInfo.displayText}`;
  flagSpan.setAttribute('data-twitter-flag', 'true');
  flagSpan.setAttribute('title', locationInfo.location);
  flagSpan.style.marginLeft = '4px';
  flagSpan.style.marginRight = '4px';
  flagSpan.style.display = 'inline';
  flagSpan.style.color = 'inherit';
  flagSpan.style.verticalAlign = 'middle';
  
  // Style text fallback differently
  if (!locationInfo.flag) {
    flagSpan.style.fontSize = '0.9em';
    flagSpan.style.opacity = '0.7';
  }
  
  // Find the handle section
  const handleSection = findHandleSection(containerForFlag, screenName);
  
  let inserted = false;
  
  // Strategy 1: Insert right before the handle section
  if (handleSection && handleSection.parentNode === containerForFlag) {
    try {
      containerForFlag.insertBefore(flagSpan, handleSection);
      inserted = true;
    } catch (e) {
      // Continue to next strategy
    }
  }
  
  // Strategy 2: Insert before handle section's parent
  if (!inserted && handleSection && handleSection.parentNode) {
    try {
      const handleParent = handleSection.parentNode;
      if (handleParent !== containerForFlag && handleParent.parentNode) {
        handleParent.parentNode.insertBefore(flagSpan, handleParent);
        inserted = true;
      } else if (handleParent === containerForFlag) {
        containerForFlag.insertBefore(flagSpan, handleSection);
        inserted = true;
      }
    } catch (e) {
      // Continue to next strategy
    }
  }
  
  // Strategy 3: Insert after display name container
  if (!inserted && handleSection) {
    try {
      const displayNameLink = containerForFlag.querySelector('a[href^="/"]');
      if (displayNameLink) {
        const displayNameContainer = displayNameLink.closest('div');
        if (displayNameContainer && displayNameContainer.parentNode) {
          if (displayNameContainer.parentNode === handleSection.parentNode) {
            displayNameContainer.parentNode.insertBefore(flagSpan, handleSection);
            inserted = true;
          } else {
            displayNameContainer.parentNode.insertBefore(flagSpan, displayNameContainer.nextSibling);
            inserted = true;
          }
        }
      }
    } catch (e) {
      // Continue to fallback
    }
  }
  
  // Strategy 4: Fallback - append to container
  if (!inserted) {
    try {
      containerForFlag.appendChild(flagSpan);
      inserted = true;
    } catch (e) {
      return false;
    }
  }
  
  if (inserted) {
    usernameElement.dataset.flagAdded = 'true';
    // Update statistics
    if (locationInfo.location) {
      updateStats(screenName, locationInfo.location);
    }
    return true;
  }
  
  return false;
}

// Check cache and add flag immediately if cached
function addFlagFromCache(container, screenName) {
  if (locationCache.has(screenName)) {
    const cached = locationCache.get(screenName);
    const now = Date.now();
    
    // Check if cache entry is expired
    if (cached.expiry && cached.expiry > now && cached.location !== null) {
      // Cache is valid, get location info and add flag immediately
      const locationInfo = getLocationInfo(cached.location);
      if (addFlagToElement(container, screenName, locationInfo)) {
        const display = locationInfo.flag || locationInfo.displayText || 'null';
        console.log(`✅ CACHE HIT (display): @${screenName} → ${display}`);
        return true;
      }
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
  const BATCH_SIZE = 10;
  for (let i = 0; i < uncachedContainers.length; i += BATCH_SIZE) {
    const batch = uncachedContainers.slice(i, i + BATCH_SIZE);
    for (const container of batch) {
      const screenName = extractUsername(container);
      if (screenName) {
        addFlagToUsername(container, screenName).catch(err => {
          console.error(`Error processing ${screenName}:`, err);
          container.dataset.flagAdded = 'failed';
        });
      }
    }
    // Wait between batches to avoid overwhelming the API
    if (i + BATCH_SIZE < uncachedContainers.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
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

// Initialize observer for dynamically loaded content
function initObserver() {
  if (observer) {
    observer.disconnect();
  }

  observer = new MutationObserver((mutations) => {
    // Don't process if extension is disabled
    if (!extensionEnabled) {
      return;
    }
    
    let shouldProcess = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldProcess = true;
        break;
      }
    }
    
    if (shouldProcess) {
      // Throttle processing to reduce API calls
      processUsernamesThrottled();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Main initialization
async function init() {
  console.log('Twitter Location Flag extension initialized');
  
  // Load enabled state first
  await loadEnabledState();
  
  // Load persistent cache
  await loadCache();
  
  // Load statistics
  await loadStats();
  
  // Only proceed if extension is enabled
  if (!extensionEnabled) {
    console.log('Extension is disabled');
    return;
  }
  
  // Inject page script
  injectPageScript();
  
  // Wait a bit for page to fully load
  setTimeout(() => {
    processUsernamesThrottled();
  }, 2000);
  
  // Set up observer for new content
  initObserver();
  
  // Re-process on navigation (Twitter uses SPA)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      console.log('Page navigation detected, reprocessing usernames');
      setTimeout(processUsernamesThrottled, 2000);
    }
  }).observe(document, { subtree: true, childList: true });
  
  // Save cache periodically
  setInterval(saveCache, 30000); // Save every 30 seconds
}

// Wait for page to load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

