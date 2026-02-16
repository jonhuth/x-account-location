// Bot Detection Heuristics Engine
// Fast local scoring (0-100) with spam signals (+) and legitimacy signals (-)

// ============================================================================
// BUZZWORD LISTS
// ============================================================================

const CRYPTO_BIO_BUZZWORDS = [
  // Identity labels
  'web3', 'crypto native', 'defi degen', 'nft collector', 'dao contributor',
  'onchain', 'blockchain', 'decentralized', 'permissionless',
  // Activity claims
  'building in public', 'shipping daily', 'exploring', 'researching',
  'yapper', 'alpha seeker', 'airdrop hunter', 'degen',
  // Cringe signals
  'gm/gn', 'wagmi', 'ngmi', 'probably nothing', 'few understand',
  'future millionaire', 'generational wealth', 'exit liquidity',
  // Role claims without substance
  'advisor', 'consultant', 'helping projects', 'dm for collabs',
  // Maxi indicators
  'eth maxi', 'sol maxi', 'btc maxi', 'chain agnostic',
];

const CRYPTO_NAME_RED_FLAGS = [
  /\.eth$/i, /\.sol$/i, /\.lens$/i, /\.base$/i,
  /crypto\s?\w+/i, /\w+\s?crypto/i,
  /web3\s?\w+/i, /\w+\s?web3/i,
  /defi\s?\w+/i, /nft\s?\w+/i,
  /[🚀💎🔥⚡️💰🌙]+/, // emoji patterns
  /\d{4,}$/, // ends in 4+ numbers
  /_\d+$/, // underscore + numbers
];

const VAPID_REPLY_PATTERNS = [
  /^(great|amazing|incredible|insane|fire|based)\s+(thread|take|post|point)/i,
  /^this\s+(is\s+)?(so\s+)?(true|it|the way|bullish)/i,
  /^(bullish|bearish)\s+(on\s+)?this/i,
  /^more people need to (see|hear|understand) this/i,
  /^saving this/i,
  /^(underrated|overrated)\s+(thread|take)/i,
  /^(gm|gn|wagmi|ngmi|lfg|letsgo)/i,
  /^facts\.?$/i,
  /^(real|true|valid)\.?$/i,
  /^this is (exactly )?why/i,
  /^couldn't agree more/i,
  /^(nailed it|spot on|on point)/i,
  /^100%$/i,
  /^fax\.?$/i,
  /^w take\.?$/i,
  /^massive\.?$/i,
  /^huge\.?$/i,
  /^🔥+$/,
  /^💯+$/,
];

const GENERIC_PRAISE_PHRASES = [
  'great thread', 'amazing thread', 'incredible thread',
  'love this', 'so true', 'exactly this', 'this is the way',
  'bullish', 'based', 'gigabrain', 'alpha', 'gem',
  'ser', 'fren', 'anon', 'king', 'legend',
  'lfg', 'lets go', 'wagmi', 'gm', 'gn',
];

const ENGAGEMENT_BAIT_PHRASES = [
  'thoughts?', 'what do you think', 'curious to hear',
  'would love to connect', 'dm me', 'let\'s chat',
  'drop a', 'comment below', 'who else',
];

const SELF_PROMO_PATTERNS = [
  /this is (exactly )?why (we|i)'?m? building/i,
  /we solved this at/i,
  /check out (our|my)/i,
  /reminds me of what we'?re? doing/i,
  /at \[?\w+\]? we/i,
];

// High-spam regions (based on observed bot farm patterns)
const SPAM_REGION_TIERS = {
  tier1: ['Nigeria', 'Pakistan', 'Bangladesh', 'Philippines', 'India', 'Indonesia', 'Vietnam'],
  tier2: ['Kenya', 'Ghana', 'Sri Lanka', 'Nepal', 'Egypt', 'Morocco'],
};

// ============================================================================
// CORE SIGNALS (40 points max)
// ============================================================================

function getCoreSignals(accountData, replyElement) {
  let score = 0;
  
  // Account age: Created < 90 days + high activity (10 points)
  if (accountData.createdAt) {
    try {
      const ageMs = Date.now() - new Date(accountData.createdAt).getTime();
      const ageDays = ageMs / (24 * 60 * 60 * 1000);
      if (ageDays < 30) score += 10;
      else if (ageDays < 90) score += 5;
    } catch (e) {
      // Invalid date, skip
    }
  }
  
  // Default avatar (5 points)
  if (!accountData.hasCustomAvatar) {
    score += 5;
  }
  
  // Handle pattern: random suffix, underscores + numbers (10 points)
  // Defensive: ensure string
  const username = String(accountData.username || '');
  if (/[a-z]+\d{6,}$/i.test(username)) score += 10;
  else if (/_\d{3,}$/.test(username)) score += 7;
  else if (/\d{4,}$/.test(username)) score += 5;
  
  // Reply timing: within 60s of original (15 points)
  if (accountData.secondsAfterOriginal !== undefined) {
    if (accountData.secondsAfterOriginal < 30) score += 15;
    else if (accountData.secondsAfterOriginal < 60) score += 10;
    else if (accountData.secondsAfterOriginal < 120) score += 5;
  }
  
  return Math.min(score, 40);
}

// ============================================================================
// CONTENT SIGNALS (30 points max)
// ============================================================================

function getContentSignals(replyText) {
  let score = 0;
  // Defensive: ensure replyText is a string
  const text = String(replyText || '').toLowerCase().trim();
  
  if (!text) return 0;
  
  // Generic praise (10 points)
  const praiseCount = GENERIC_PRAISE_PHRASES.filter(phrase => 
    text.includes(phrase.toLowerCase())
  ).length;
  if (praiseCount >= 2) score += 10;
  else if (praiseCount >= 1) score += 5;
  
  // Vapid agreement patterns (8 points)
  const vapidMatch = VAPID_REPLY_PATTERNS.some(pattern => pattern.test(text));
  if (vapidMatch) score += 8;
  
  // Engagement bait (7 points)
  const engagementMatch = ENGAGEMENT_BAIT_PHRASES.some(phrase => 
    text.includes(phrase.toLowerCase())
  );
  if (engagementMatch) score += 7;
  
  // Self-promotion (5 points)
  const selfPromoMatch = SELF_PROMO_PATTERNS.some(pattern => pattern.test(text));
  if (selfPromoMatch) score += 5;
  
  // Very short replies are suspicious
  if (text.length < 20 && text.length > 0) score += 3;
  
  // Just emojis
  if (/^[\p{Emoji}\s]+$/u.test(text)) score += 5;
  
  return Math.min(score, 30);
}

// ============================================================================
// CRYPTO-SPECIFIC SIGNALS (30 points max)
// ============================================================================

function getCryptoSignals(accountData) {
  let score = 0;
  // Defensive: ensure strings
  const bio = String(accountData.bio || '').toLowerCase();
  const displayName = String(accountData.displayName || '');
  
  // Bio buzzword density (12 points)
  const buzzwordCount = CRYPTO_BIO_BUZZWORDS.filter(word => 
    bio.includes(word.toLowerCase())
  ).length;
  if (buzzwordCount >= 4) score += 12;
  else if (buzzwordCount >= 3) score += 9;
  else if (buzzwordCount >= 2) score += 6;
  else if (buzzwordCount >= 1) score += 3;
  
  // Name red flags (8 points)
  const nameMatch = CRYPTO_NAME_RED_FLAGS.some(pattern => 
    pattern.test(displayName) || pattern.test(accountData.username || '')
  );
  if (nameMatch) score += 8;
  
  // Kaito indicators (5 points)
  if (bio.includes('yapper') || bio.includes('kaito') || bio.includes('engagement')) {
    score += 5;
  }
  
  // Engagement stats in bio
  if (/\d+[kmb]?\+?\s*(impressions|views|followers)/i.test(bio)) {
    score += 5;
  }
  
  // Chain emoji spam (5 points)
  const chainEmojis = ['◎', '⟠', '🔵', '⬛', '🔶', '💜'];
  const chainEmojiCount = chainEmojis.filter(emoji => 
    bio.includes(emoji) || displayName.includes(emoji)
  ).length;
  if (chainEmojiCount >= 2) score += 5;
  else if (chainEmojiCount >= 1) score += 2;
  
  return Math.min(score, 30);
}

// ============================================================================
// BEHAVIORAL SIGNALS (20 points max)
// ============================================================================

function getBehavioralSignals(accountData, threadContext = {}) {
  let score = 0;
  
  // Thread bombing: same account 2+ times in thread (8 points)
  if (threadContext.sameAccountReplies && threadContext.sameAccountReplies >= 2) {
    score += 8;
  }
  
  // Engagement ratio: Following >> Followers (7 points)
  const followers = accountData.followers || 0;
  const following = accountData.following || 0;
  
  if (following > 0 && followers > 0) {
    const ratio = followers / following;
    // Suspicious: following >> followers (farming pattern)
    if (ratio < 0.2 && following > 1000) score += 7;
    else if (ratio < 0.5 && following > 500) score += 4;
  } else if (following > 1000 && followers < 100) {
    score += 7; // Classic farming pattern
  }
  
  // High activity on new account
  if (accountData.createdAt) {
    const ageMs = Date.now() - new Date(accountData.createdAt).getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    if (ageDays < 90 && following > 500) {
      score += 5;
    }
  }
  
  return Math.min(score, 20);
}

// ============================================================================
// LOCATION SIGNAL (15 points max)
// ============================================================================

function getLocationScore(location, otherSignalsScore) {
  // Location only matters if already suspicious (other signals >= 25)
  if (otherSignalsScore < 25) return 0;
  
  if (!location) return 5;
  
  const locationLower = location.toLowerCase();
  
  // Tier 1: +10 points
  if (SPAM_REGION_TIERS.tier1.some(c => locationLower.includes(c.toLowerCase()))) {
    return 10;
  }
  
  // Tier 2: +5 points
  if (SPAM_REGION_TIERS.tier2.some(c => locationLower.includes(c.toLowerCase()))) {
    return 5;
  }
  
  return 0;
}

// ============================================================================
// LEGITIMACY SIGNALS (Negative Score - Reduce Suspicion)
// ============================================================================

function getFollowerRatioReduction(followers, following) {
  if (following === 0) return 0; // Can't calculate ratio
  
  const ratio = followers / following;
  
  // Strong ratio: followers >= 10x following
  if (ratio >= 10 && followers >= 1000) return -15;
  
  // Moderate ratio: followers >= 3x following  
  if (ratio >= 3 && followers >= 500) return -10;
  
  // Slight positive: more followers than following
  if (ratio >= 1.5 && followers >= 100) return -5;
  
  return 0;
}

function calculateLegitimacyReduction(accountData, userContext = {}) {
  let reduction = 0;
  
  // You follow them (strongest signal) - -30
  if (userContext.userFollows) {
    reduction -= 30;
  }
  
  // Mutual follows - -10 to -20
  const mutualCount = userContext.mutualCount || 0;
  if (mutualCount >= 5) reduction -= 20;
  else if (mutualCount >= 2) reduction -= 10;
  else if (mutualCount >= 1) reduction -= 5;
  
  // Follower ratio
  reduction += getFollowerRatioReduction(
    accountData.followers || 0, 
    accountData.following || 0
  );
  
  // Verified - -15
  if (accountData.isVerified) reduction -= 15;
  
  // Account age > 2 years - -10
  if (accountData.createdAt) {
    const ageMs = Date.now() - new Date(accountData.createdAt).getTime();
    const ageYears = ageMs / (365 * 24 * 60 * 60 * 1000);
    if (ageYears >= 2) reduction -= 10;
    else if (ageYears >= 1) reduction -= 5;
  }
  
  // High followers (absolute) - -5 to -15
  const followers = accountData.followers || 0;
  if (followers >= 50000) reduction -= 15;
  else if (followers >= 10000) reduction -= 10;
  else if (followers >= 5000) reduction -= 5;
  
  return reduction;
}

// ============================================================================
// MAIN SCORING FUNCTION
// ============================================================================

/**
 * Calculate bot score for a reply
 * @param {Object} accountData - Account information
 * @param {string} replyText - The reply text
 * @param {Object} userContext - User following context
 * @param {Object} threadContext - Thread-level context
 * @returns {Object} { score, breakdown }
 */
function calculateBotScore(replyData, sensitivity = 3) {
  // Normalize input - replyData contains all account and reply info
  const accountData = replyData || {};
  const replyText = String(accountData.replyText || '');
  const userContext = {
    userFollows: accountData.userFollows || false,
    mutualCount: accountData.mutualCount || 0
  };
  const threadContext = {};
  
  const breakdown = {};
  
  // Positive signals (increases bot likelihood)
  breakdown.core = getCoreSignals(accountData);
  breakdown.content = getContentSignals(replyText);
  breakdown.crypto = getCryptoSignals(accountData);
  breakdown.behavioral = getBehavioralSignals(accountData, threadContext);
  
  // Calculate subtotal before location (location requires >= 25)
  const subtotal = breakdown.core + breakdown.content + breakdown.crypto + breakdown.behavioral;
  
  // Location signal (only if other signals >= 25)
  breakdown.location = getLocationScore(accountData.location, subtotal);
  
  // Positive total
  const positiveScore = subtotal + breakdown.location;
  
  // Negative signals (reduces bot likelihood)
  breakdown.legitimacy = calculateLegitimacyReduction(accountData, userContext);
  
  // Final score
  const rawScore = positiveScore + breakdown.legitimacy;
  const score = Math.max(0, Math.min(100, rawScore));
  
  return {
    score,
    breakdown,
    rawScore,
    positiveScore,
    legitimacyReduction: breakdown.legitimacy,
  };
}

/**
 * Determine action based on score
 * @param {number} score
 * @returns {'dim' | 'ai' | 'none'}
 */
function getActionForScore(score) {
  if (score >= 65) return 'dim';      // High confidence bot
  if (score >= 40) return 'ai';       // Send to AI
  return 'none';                       // Likely human
}

// Export for use in content.js
if (typeof window !== 'undefined') {
  window.BotDetection = {
    calculateBotScore,
    getActionForScore,
    // Expose constants for debugging
    CRYPTO_BIO_BUZZWORDS,
    CRYPTO_NAME_RED_FLAGS,
    VAPID_REPLY_PATTERNS,
    SPAM_REGION_TIERS,
  };
}
