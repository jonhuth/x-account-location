// This script runs in the page context to access cookies and make API calls
(function() {
  // Store headers from Twitter's own API calls
  let twitterHeaders = null;
  let headersReady = false;
  
  // Function to capture headers from a request
  function captureHeaders(headers) {
    if (!headers) return;
    
    const headerObj = {};
    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        headerObj[key] = value;
      });
    } else if (headers instanceof Object) {
      // Copy all headers
      for (const [key, value] of Object.entries(headers)) {
        headerObj[key] = value;
      }
    }
    
    // Replace headers completely (don't merge) to ensure we get auth tokens
    twitterHeaders = headerObj;
    headersReady = true;
    console.log('Captured Twitter API headers:', Object.keys(headerObj));
  }
  
  // Intercept fetch to capture Twitter's headers
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const url = args[0];
    const options = args[1] || {};
    
    // If it's a Twitter GraphQL API call, capture ALL headers
    if (typeof url === 'string' && url.includes('x.com/i/api/graphql')) {
      if (options.headers) {
        captureHeaders(options.headers);
        console.log('Captured Twitter headers:', Object.keys(twitterHeaders || {}));
      }
    }
    
    return originalFetch.apply(this, args);
  };
  
  // Also intercept XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._url = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };
  
  XMLHttpRequest.prototype.send = function(...args) {
    if (this._url && this._url.includes('x.com/i/api/graphql')) {
      const headers = {};
      // Try to get headers from setRequestHeader
      if (this._headers) {
        Object.assign(headers, this._headers);
      }
      captureHeaders(headers);
    }
    return originalXHRSend.apply(this, args);
  };
  
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
    if (!this._headers) this._headers = {};
    this._headers[header] = value;
    return originalSetRequestHeader.apply(this, [header, value]);
  };
  
  // Wait a bit for Twitter to make some API calls first
  setTimeout(() => {
    if (!headersReady) {
      console.log('No Twitter headers captured yet, using defaults');
      twitterHeaders = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      headersReady = true;
    }
  }, 3000);
  
  // Helper: Get current user's screen name from page
  function getCurrentUsername() {
    // Try to get from page URL patterns or DOM
    const navLinks = document.querySelectorAll('nav a[href^="/"]');
    for (const link of navLinks) {
      const href = link.getAttribute('href');
      // Profile link is typically just /username
      if (href && href.match(/^\/[a-zA-Z0-9_]+$/) && !['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings'].includes(href.slice(1))) {
        // Check if this is the profile link (usually has avatar or specific data-testid)
        if (link.querySelector('img') || link.closest('[data-testid="AppTabBar_Profile_Link"]')) {
          return href.slice(1);
        }
      }
    }
    // Fallback: try to find in account switcher or similar
    const accountSwitcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (accountSwitcher) {
      const usernameSpan = accountSwitcher.querySelector('span');
      if (usernameSpan) {
        const match = usernameSpan.textContent?.match(/@([a-zA-Z0-9_]+)/);
        if (match) return match[1];
      }
    }
    return null;
  }
  
  // Fetch user's following list with pagination
  async function fetchFollowingList() {
    const currentUser = getCurrentUsername();
    if (!currentUser) {
      throw new Error('Could not determine current user');
    }
    
    console.log(`Fetching following list for @${currentUser}...`);
    
    const following = [];
    let cursor = null;
    let pageCount = 0;
    const maxPages = 50; // Safety limit: 50 pages * 200 = 10,000 max following
    
    // Use captured headers
    const headers = twitterHeaders || {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    
    while (pageCount < maxPages) {
      const variables = {
        userId: null, // Will be set from first call
        count: 200,
        includePromotedContent: false
      };
      
      if (cursor) {
        variables.cursor = cursor;
      }
      
      // First, we need to get the user ID
      if (!variables.userId) {
        // Get user ID from UserByScreenName query
        const userIdUrl = `https://x.com/i/api/graphql/xmU6X_CKVnQ5lSrCbAmJsg/UserByScreenName?variables=${encodeURIComponent(JSON.stringify({ screen_name: currentUser }))}`;
        try {
          const userIdResponse = await fetch(userIdUrl, {
            method: 'GET',
            credentials: 'include',
            headers: headers,
            referrer: window.location.href
          });
          
          if (userIdResponse.ok) {
            const userData = await userIdResponse.json();
            variables.userId = userData?.data?.user?.result?.rest_id;
            if (!variables.userId) {
              throw new Error('Could not get user ID');
            }
          } else if (userIdResponse.status === 429) {
            console.warn('Rate limited when fetching user ID');
            break;
          } else {
            throw new Error(`Failed to get user ID: ${userIdResponse.status}`);
          }
        } catch (error) {
          console.error('Error getting user ID:', error);
          throw error;
        }
      }
      
      // Now fetch following
      const features = {
        rweb_tipjar_consumption_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        articles_preview_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        rweb_video_timestamps_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_enhance_cards_enabled: false
      };
      
      const followingUrl = `https://x.com/i/api/graphql/iSicc7LrzWGBgDPL0tM_TQ/Following?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;
      
      try {
        const response = await fetch(followingUrl, {
          method: 'GET',
          credentials: 'include',
          headers: headers,
          referrer: window.location.href
        });
        
        if (response.status === 429) {
          console.warn('Rate limited when fetching following list');
          break;
        }
        
        if (!response.ok) {
          console.error(`Following API error: ${response.status}`);
          break;
        }
        
        const data = await response.json();
        const timeline = data?.data?.user?.result?.timeline?.timeline;
        
        if (!timeline?.instructions) {
          console.log('No more following entries');
          break;
        }
        
        // Extract usernames from instructions
        let foundEntries = false;
        for (const instruction of timeline.instructions) {
          const entries = instruction.entries || [];
          for (const entry of entries) {
            if (entry.content?.itemContent?.user_results?.result) {
              const user = entry.content.itemContent.user_results.result;
              const screenName = user.legacy?.screen_name;
              if (screenName) {
                following.push(screenName.toLowerCase());
                foundEntries = true;
              }
            }
            // Check for cursor
            if (entry.content?.cursorType === 'Bottom') {
              cursor = entry.content.value;
            }
          }
        }
        
        if (!foundEntries) {
          console.log('No more following entries found');
          break;
        }
        
        pageCount++;
        console.log(`Fetched page ${pageCount}, total following: ${following.length}`);
        
        // Small delay between pages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error('Error fetching following page:', error);
        break;
      }
    }
    
    console.log(`Finished fetching following list: ${following.length} accounts`);
    return following;
  }
  
  // Listen for fetch requests from content script via postMessage
  window.addEventListener('message', async function(event) {
    // Handle following list request
    if (event.data && event.data.type === '__fetchFollowing') {
      const { requestId } = event.data;
      
      // Wait for headers to be ready
      if (!headersReady) {
        let waitCount = 0;
        while (!headersReady && waitCount < 30) {
          await new Promise(resolve => setTimeout(resolve, 100));
          waitCount++;
        }
      }
      
      try {
        const following = await fetchFollowingList();
        window.postMessage({
          type: '__followingResponse',
          following,
          requestId
        }, '*');
      } catch (error) {
        console.error('Error fetching following list:', error);
        window.postMessage({
          type: '__followingResponse',
          following: [],
          error: error.message,
          requestId
        }, '*');
      }
      return;
    }
    
    // Only accept messages from our extension
    if (event.data && event.data.type === '__fetchLocation') {
      const { screenName, requestId } = event.data;
      
      // Wait for headers to be ready
      if (!headersReady) {
        let waitCount = 0;
        while (!headersReady && waitCount < 30) {
          await new Promise(resolve => setTimeout(resolve, 100));
          waitCount++;
        }
      }
      
      try {
        const variables = JSON.stringify({ screenName });
        const url = `https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery?variables=${encodeURIComponent(variables)}`;
        
        // Use captured headers or minimal defaults
        const headers = twitterHeaders || {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        };
        
        // Ensure credentials are included
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: headers,
          referrer: window.location.href,
          referrerPolicy: 'origin-when-cross-origin'
        });
        
        let location = null;
        if (response.ok) {
          const data = await response.json();
          console.log(`API response for ${screenName}:`, data);
          location = data?.data?.user_result_by_screen_name?.result?.about_profile?.account_based_in || null;
          console.log(`Extracted location for ${screenName}:`, location);
          
          // Debug: log the full path to see what's available
          if (!location && data?.data?.user_result_by_screen_name?.result) {
            console.log('User result available but no location:', {
              hasAboutProfile: !!data.data.user_result_by_screen_name.result.about_profile,
              aboutProfile: data.data.user_result_by_screen_name.result.about_profile
            });
          }
        } else {
          const errorText = await response.text().catch(() => '');
          
          // Handle rate limiting
          if (response.status === 429) {
            const resetTime = response.headers.get('x-rate-limit-reset');
            const remaining = response.headers.get('x-rate-limit-remaining');
            const limit = response.headers.get('x-rate-limit-limit');
            
            if (resetTime) {
              const resetDate = new Date(parseInt(resetTime) * 1000);
              const now = Date.now();
              const waitTime = resetDate.getTime() - now;
              
              console.log(`Rate limited! Limit: ${limit}, Remaining: ${remaining}`);
              console.log(`Rate limit resets at: ${resetDate.toLocaleString()}`);
              console.log(`Waiting ${Math.ceil(waitTime / 1000 / 60)} minutes before retrying...`);
              
              // Store rate limit info for content script
              window.postMessage({
                type: '__rateLimitInfo',
                resetTime: parseInt(resetTime),
                waitTime: Math.max(0, waitTime)
              }, '*');
            }
          } else {
            console.log(`Twitter API error for ${screenName}:`, response.status, response.statusText, errorText.substring(0, 200));
          }
        }
        
        // Send response back to content script via postMessage
        // Include error status so content script knows not to cache on rate limit
        window.postMessage({
          type: '__locationResponse',
          screenName,
          location,
          requestId,
          isRateLimited: response.status === 429
        }, '*');
      } catch (error) {
        console.error('Error fetching location:', error);
        window.postMessage({
          type: '__locationResponse',
          screenName,
          location: null,
          requestId
        }, '*');
      }
    }
  });
})();

