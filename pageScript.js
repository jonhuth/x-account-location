// Page script - intercepts Twitter API responses and handles authenticated requests
(function() {
  'use strict';
  
  // ============================================================================
  // State
  // ============================================================================
  
  let twitterHeaders = null;
  let headersReady = false;
  
  // Cache of user data intercepted from Twitter's own API calls
  const userDataCache = new Map();
  
  // ============================================================================
  // Intercept Twitter API responses to extract user data
  // ============================================================================
  
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = String(args[0] || '');
    const options = args[1] || {};
    
    // Capture headers from Twitter's GraphQL calls (for our own requests later)
    if (url.includes('x.com/i/api/graphql') && options.headers && !headersReady) {
      captureHeaders(options.headers);
    }
    
    // Call original fetch
    const response = await originalFetch.apply(this, args);
    
    // Intercept responses that contain user data
    if (url.includes('x.com/i/api/graphql')) {
      try {
        // Clone response so we can read it without consuming
        const cloned = response.clone();
        const data = await cloned.json().catch(() => null);
        if (data) {
          extractUsersFromResponse(data);
        }
      } catch (e) {
        // Silently fail - don't break Twitter
      }
    }
    
    return response;
  };
  
  function captureHeaders(headers) {
    const headerObj = {};
    if (headers instanceof Headers) {
      headers.forEach((v, k) => { headerObj[k] = v; });
    } else if (typeof headers === 'object') {
      Object.assign(headerObj, headers);
    }
    if (Object.keys(headerObj).length > 0) {
      twitterHeaders = headerObj;
      headersReady = true;
    }
  }
  
  // Recursively extract user objects from Twitter API responses
  function extractUsersFromResponse(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 15) return;
    
    // Check if this is a user object (has legacy.screen_name)
    if (obj.legacy?.screen_name && obj.rest_id) {
      const legacy = obj.legacy;
      const username = String(legacy.screen_name || '').toLowerCase();
      if (username) {
        userDataCache.set(username, {
          id: obj.rest_id,
          username: legacy.screen_name,
          displayName: legacy.name || '',
          followers: legacy.followers_count || 0,
          following: legacy.friends_count || 0,
          tweets: legacy.statuses_count || 0,
          createdAt: legacy.created_at || null,
          verified: legacy.verified || obj.is_blue_verified || false,
          protected: legacy.protected || false,
          bio: legacy.description || '',
          location: legacy.location || '',
          hasCustomAvatar: !String(legacy.profile_image_url_https || '').includes('default_profile'),
          fetchedAt: Date.now()
        });
      }
    }
    
    // Recurse into arrays and objects
    if (Array.isArray(obj)) {
      for (const item of obj) {
        extractUsersFromResponse(item, depth + 1);
      }
    } else {
      for (const key of Object.keys(obj)) {
        extractUsersFromResponse(obj[key], depth + 1);
      }
    }
  }
  
  // ============================================================================
  // Message handlers for content script
  // ============================================================================
  
  window.addEventListener('message', async function(event) {
    if (!event.data?.type) return;
    
    // Get cached user data
    if (event.data.type === '__getUserData') {
      const { username, requestId } = event.data;
      const cached = userDataCache.get(String(username || '').toLowerCase());
      window.postMessage({
        type: '__userDataResponse',
        username,
        userData: cached || null,
        requestId
      }, '*');
      return;
    }
    
    // Get multiple users' data
    if (event.data.type === '__getBulkUserData') {
      const { usernames, requestId } = event.data;
      const results = {};
      for (const u of (usernames || [])) {
        const cached = userDataCache.get(String(u || '').toLowerCase());
        if (cached) results[u.toLowerCase()] = cached;
      }
      window.postMessage({
        type: '__bulkUserDataResponse',
        userData: results,
        requestId
      }, '*');
      return;
    }
    
    // Fetch location (AboutAccountQuery)
    if (event.data.type === '__fetchLocation') {
      const { screenName, requestId } = event.data;
      await handleLocationRequest(screenName, requestId);
      return;
    }
    
    // Fetch following list
    if (event.data.type === '__fetchFollowing') {
      const { requestId } = event.data;
      await handleFollowingRequest(requestId);
      return;
    }
  });
  
  // ============================================================================
  // Location request handler
  // ============================================================================
  
  async function handleLocationRequest(screenName, requestId) {
    // Wait for headers (max 2s)
    if (!headersReady) {
      for (let i = 0; i < 20 && !headersReady; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    try {
      const variables = JSON.stringify({ screenName });
      const url = `https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery?variables=${encodeURIComponent(variables)}`;
      
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: twitterHeaders || { 'Accept': 'application/json' },
        referrer: window.location.href
      });
      
      let location = null;
      let isRateLimited = response.status === 429;
      
      if (response.ok) {
        const data = await response.json();
        location = data?.data?.user_result_by_screen_name?.result?.about_profile?.account_based_in || null;
      }
      
      window.postMessage({
        type: '__locationResponse',
        screenName,
        location,
        requestId,
        isRateLimited
      }, '*');
    } catch (error) {
      window.postMessage({
        type: '__locationResponse',
        screenName,
        location: null,
        requestId
      }, '*');
    }
  }
  
  // ============================================================================
  // Following list handler
  // ============================================================================
  
  async function handleFollowingRequest(requestId) {
    // Wait for headers
    if (!headersReady) {
      for (let i = 0; i < 20 && !headersReady; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    try {
      // Get current username from DOM
      const currentUser = getCurrentUsername();
      if (!currentUser) {
        throw new Error('Could not determine current user');
      }
      
      // First get user ID
      const userId = await getUserId(currentUser);
      if (!userId) {
        throw new Error('Could not get user ID');
      }
      
      // Fetch following (just first page for now - avoid rate limits)
      const following = await fetchFollowingPage(userId);
      
      window.postMessage({
        type: '__followingResponse',
        following,
        requestId
      }, '*');
    } catch (error) {
      window.postMessage({
        type: '__followingResponse',
        following: [],
        error: error.message,
        requestId
      }, '*');
    }
  }
  
  function getCurrentUsername() {
    // Try account switcher first (most reliable)
    const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (switcher) {
      const text = switcher.textContent || '';
      const match = text.match(/@([a-zA-Z0-9_]+)/);
      if (match) return match[1];
    }
    
    // Try profile link
    const profileLink = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    if (profileLink) {
      const href = profileLink.getAttribute('href');
      if (href) return href.replace('/', '');
    }
    
    return null;
  }
  
  async function getUserId(screenName) {
    const features = {
      hidden_profile_subscriptions_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true
    };
    
    const url = `https://x.com/i/api/graphql/xmU6X_CKVnQ5lSrCbAmJsg/UserByScreenName?variables=${encodeURIComponent(JSON.stringify({ screen_name: screenName }))}&features=${encodeURIComponent(JSON.stringify(features))}`;
    
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: twitterHeaders || { 'Accept': 'application/json' },
      referrer: window.location.href
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    return data?.data?.user?.result?.rest_id || null;
  }
  
  async function fetchFollowingPage(userId, cursor = null) {
    const variables = { userId, count: 200, includePromotedContent: false };
    if (cursor) variables.cursor = cursor;
    
    const features = {
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false
    };
    
    const url = `https://x.com/i/api/graphql/iSicc7LrzWGBgDPL0tM_TQ/Following?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;
    
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: twitterHeaders || { 'Accept': 'application/json' },
      referrer: window.location.href
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const following = [];
    
    const instructions = data?.data?.user?.result?.timeline?.timeline?.instructions || [];
    for (const instruction of instructions) {
      for (const entry of (instruction.entries || [])) {
        const user = entry.content?.itemContent?.user_results?.result;
        if (user?.legacy?.screen_name) {
          following.push(user.legacy.screen_name.toLowerCase());
        }
      }
    }
    
    return following;
  }
  
  // Auto-ready headers after 3s if none captured
  setTimeout(() => {
    if (!headersReady) {
      twitterHeaders = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
      headersReady = true;
    }
  }, 3000);
  
  // Expose cache size for debugging (no verbose logging)
  window.__botDetectionCacheSize = () => userDataCache.size;
})();
