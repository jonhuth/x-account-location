// Bot Detection - Minimal Client
// Only extracts DOM data, all scoring done server-side

// ============================================================================
// DATA EXTRACTION ONLY - No pattern matching, no scoring
// ============================================================================

/**
 * Extract reply data from DOM element
 * Returns structured data for server-side AI classification
 */
function extractReplyDataFromElement(el, username) {
  try {
    // Display name
    const userNameContainer = el.querySelector('[data-testid="User-Name"], [data-testid="UserName"]');
    let displayName = username;
    if (userNameContainer) {
      const nameLink = userNameContainer.querySelector('a[href^="/"]');
      if (nameLink) {
        const fullText = nameLink.textContent?.trim() || '';
        if (fullText && !fullText.startsWith('@')) {
          displayName = fullText;
        }
      }
    }
    
    // Reply text
    const replyText = el.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || '';
    
    // Avatar check
    const avatarEl = el.querySelector('img[src*="profile_images"]');
    const hasCustomAvatar = avatarEl ? !avatarEl.src.includes('default_profile') : true;
    
    // Verified badge - check multiple selectors
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
      hasCustomAvatar,
      isVerified,
      // These are not available from DOM - server handles missing data
      bio: '',
      followers: 0,
      following: 0,
      createdAt: '',
    };
  } catch (e) {
    return null;
  }
}

/**
 * Determine if reply should be sent to server for classification
 * Simple checks only - no pattern matching
 */
function shouldClassify(replyData, isWhitelisted, userFollows) {
  // Never classify whitelisted accounts
  if (isWhitelisted) return { action: 'skip', reason: 'whitelisted' };
  
  // User follows = strong legitimacy signal, only classify if very short/empty
  if (userFollows) {
    // Only flag if literally empty or single character
    if (replyData.replyText.length > 1) {
      return { action: 'skip', reason: 'user_follows' };
    }
  }
  
  // Verified accounts with substantive replies = skip
  if (replyData.isVerified && replyData.replyText.length > 50) {
    return { action: 'skip', reason: 'verified_substantive' };
  }
  
  // Everything else goes to server for AI classification
  return { action: 'classify', reason: 'needs_analysis' };
}

// Export minimal interface
if (typeof window !== 'undefined') {
  window.BotDetection = {
    extractReplyDataFromElement,
    shouldClassify,
  };
}
