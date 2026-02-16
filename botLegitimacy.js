// Bot Legitimacy Signals
// Fetches and caches user following list for legitimacy scoring

// Configuration
const FOLLOWING_CACHE_KEY = 'user_following_cache';
const FOLLOWING_CACHE_EXPIRY_HOURS = 24;
const FOLLOWING_FETCH_BATCH_SIZE = 200; // Twitter API cursor pagination

// State
let userFollowingSet = null;
let followingCacheExpiry = 0;
let isLoadingFollowing = false;
let followingLoadPromise = null;

// Load cached following list from storage
async function loadCachedFollowing() {
  try {
    const result = await chrome.storage.local.get(FOLLOWING_CACHE_KEY);
    if (result[FOLLOWING_CACHE_KEY]) {
      const cached = result[FOLLOWING_CACHE_KEY];
      if (cached.expiry && cached.expiry > Date.now()) {
        userFollowingSet = new Set(cached.usernames);
        followingCacheExpiry = cached.expiry;
        console.log(`Loaded ${userFollowingSet.size} cached following entries`);
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('Error loading following cache:', error);
    return false;
  }
}

// Save following list to storage
async function saveFollowingCache(usernames) {
  try {
    const expiry = Date.now() + (FOLLOWING_CACHE_EXPIRY_HOURS * 60 * 60 * 1000);
    await chrome.storage.local.set({
      [FOLLOWING_CACHE_KEY]: {
        usernames: Array.from(usernames),
        expiry,
        updatedAt: Date.now()
      }
    });
    followingCacheExpiry = expiry;
    console.log(`Saved ${usernames.size} following entries to cache`);
  } catch (error) {
    console.error('Error saving following cache:', error);
  }
}

// Fetch user's following list from Twitter's internal API
// This uses the page context to make authenticated requests
async function fetchUserFollowing() {
  return new Promise((resolve, reject) => {
    const requestId = Date.now() + Math.random();
    let responded = false;
    
    const handler = (event) => {
      if (event.source !== window) return;
      
      if (event.data && 
          event.data.type === '__followingResponse' &&
          event.data.requestId === requestId) {
        responded = true;
        window.removeEventListener('message', handler);
        
        if (event.data.error) {
          console.warn('Following fetch error:', event.data.error);
          // Return empty array on error instead of rejecting - don't block bot detection
          resolve([]);
        } else {
          resolve(event.data.following || []);
        }
      }
    };
    
    window.addEventListener('message', handler);
    
    // Request following list from page script
    window.postMessage({
      type: '__fetchFollowing',
      requestId
    }, '*');
    
    // Timeout after 30 seconds - resolve with empty array, don't block
    setTimeout(() => {
      if (!responded) {
        window.removeEventListener('message', handler);
        console.warn('Following fetch timeout - page script may not be ready');
        // Return empty array instead of rejecting - don't block bot detection
        resolve([]);
      }
    }, 30000);
  });
}

// Load user following list (from cache or fetch fresh)
async function loadUserFollowing(forceRefresh = false) {
  // Return existing promise if already loading
  if (isLoadingFollowing && followingLoadPromise) {
    return followingLoadPromise;
  }
  
  // Return cached data if valid and not forcing refresh
  if (!forceRefresh && userFollowingSet && followingCacheExpiry > Date.now()) {
    return userFollowingSet;
  }
  
  // Try to load from storage first
  if (!forceRefresh) {
    const cachedLoaded = await loadCachedFollowing();
    if (cachedLoaded && userFollowingSet) {
      return userFollowingSet;
    }
  }
  
  // Need to fetch fresh data
  isLoadingFollowing = true;
  followingLoadPromise = (async () => {
    try {
      console.log('Fetching user following list...');
      const following = await fetchUserFollowing();
      userFollowingSet = new Set(following.map(u => u.toLowerCase()));
      await saveFollowingCache(userFollowingSet);
      console.log(`Loaded ${userFollowingSet.size} accounts user is following`);
      return userFollowingSet;
    } catch (error) {
      console.error('Error fetching following list:', error);
      // Return empty set on error (no legitimacy signals, but don't block)
      userFollowingSet = userFollowingSet || new Set();
      return userFollowingSet;
    } finally {
      isLoadingFollowing = false;
      followingLoadPromise = null;
    }
  })();
  
  return followingLoadPromise;
}

// Check if user follows a specific account
function isFollowedByUser(username) {
  if (!userFollowingSet) return false;
  return userFollowingSet.has(username.toLowerCase());
}

// Get count of mutual follows (accounts user follows that also follow the target)
// This is simplified - we just check if user follows them
// Full mutual detection would require checking target's followers list
function getMutualFollowCount(username) {
  // For now, return 0 - proper implementation would need Twitter API access
  // to check follower lists, which is expensive
  // Instead, we rely on the "user follows" signal being strong enough
  return 0;
}

// Get user context for a username
async function getUserContext(username) {
  // Ensure following list is loaded
  await loadUserFollowing();
  
  return {
    userFollows: isFollowedByUser(username),
    mutualCount: getMutualFollowCount(username)
  };
}

// Initialize legitimacy system
async function initLegitimacy() {
  // Try to load cached following in background (don't block)
  loadUserFollowing().catch(err => {
    console.warn('Failed to load following list:', err);
  });
}

// Export for use in content.js
if (typeof window !== 'undefined') {
  window.BotLegitimacy = {
    loadUserFollowing,
    isFollowedByUser,
    getMutualFollowCount,
    getUserContext,
    initLegitimacy,
    // For debugging
    getFollowingSet: () => userFollowingSet,
    getFollowingCount: () => userFollowingSet?.size || 0,
  };
}
