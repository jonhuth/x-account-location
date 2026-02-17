// Bot Detection UI Components
// Handles visual rendering of bot detection results

// ============================================================================
// Styles
// ============================================================================

const BOT_UI_STYLES = `
/* Bot badge - inline like country flags */
.bot-badge {
  display: inline;
  font-size: 12px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: 4px;
  margin-left: 4px;
  margin-right: 2px;
  vertical-align: middle;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

/* High confidence bot - Red like botblock */
.bot-badge-high {
  background: #ef4444;
  color: #fff;
}

/* Medium confidence - Orange/Amber */
.bot-badge-medium {
  background: #f59e0b;
  color: #000;
}

/* Low/Suspicious - Gray */
.bot-badge-low {
  background: #6b7280;
  color: #fff;
}

/* Pending analysis */
.bot-badge-pending {
  background: #374151;
  color: #9ca3af;
}

/* Score display */
.bot-badge-score {
  font-weight: 400;
  opacity: 0.9;
  margin-left: 2px;
}

/* "Hide again" button - inline style */
.bot-hide-btn {
  display: inline;
  font-size: 12px;
  padding: 0 5px;
  border-radius: 4px;
  margin-left: 4px;
  background: #374151;
  color: #9ca3af;
  border: none;
  cursor: pointer;
  vertical-align: middle;
}

.bot-hide-btn:hover {
  background: #4b5563;
  color: #fff;
}

/* Dimmed reply */
.bot-reply-dimmed {
  opacity: 0.3 !important;
  transition: opacity 0.2s ease;
}

.bot-reply-dimmed:hover {
  opacity: 0.5 !important;
}

/* Red left border for bot tweets */
.bot-reply-flagged {
  border-left: 3px solid #ef4444 !important;
}

.bot-reply-flagged-medium {
  border-left: 3px solid #f59e0b !important;
}

/* Quick actions container - shows on hover */
.bot-actions {
  position: absolute;
  top: 8px;
  right: 48px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s ease;
  z-index: 10;
}

article[data-testid="tweet"]:hover .bot-actions {
  opacity: 1;
}

.bot-action-btn {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  background: rgba(0,0,0,0.7);
  backdrop-filter: blur(4px);
}

.bot-action-whitelist {
  color: #1d9bf0;
}

.bot-action-whitelist:hover {
  background: rgba(29, 155, 240, 0.3);
}

.bot-action-block {
  color: #f4212e;
}

.bot-action-block:hover {
  background: rgba(244, 33, 46, 0.3);
}

/* Pending pulse animation */
@keyframes bot-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.bot-badge-pending {
  animation: bot-pulse 1.5s ease-in-out infinite;
}
`;

// ============================================================================
// Style Injection
// ============================================================================

function injectBotStyles() {
  if (document.getElementById('bot-ui-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'bot-ui-styles';
  style.textContent = BOT_UI_STYLES;
  document.head.appendChild(style);
  console.log('BotUI: Styles injected'); // Debug: confirm styles load
}

// ============================================================================
// Badge Creation
// ============================================================================

const CATEGORY_LABELS = {
  engagement_farmer: 'Farmer',
  sycophant: 'Bot',
  self_promoter: 'Shill',
  airdrop_farmer: 'Airdrop',
  crypto_spam: 'Spam',
  genuine: 'Human',
};

/**
 * Get severity level based on confidence score
 * Matches botblock.ai styling
 */
function getSeverityLevel(confidence) {
  if (confidence >= 0.75) return 'high';      // Red - "Bot"
  if (confidence >= 0.5) return 'medium';     // Orange - "Suspicious"
  return 'low';                                // Gray
}

/**
 * Get display label based on confidence
 * High confidence = "Bot", lower = "Suspicious"
 */
function getBadgeLabel(verdict) {
  if (verdict.isBot === 'pending') return '...';
  if (!verdict.isBot) return 'OK';
  
  const conf = verdict.confidence || 0;
  if (conf >= 0.75) return 'Bot';
  if (conf >= 0.5) return 'Suspicious';
  return 'Low';
}

// Badge colors matching botblock.ai
const BADGE_COLORS = {
  high: { bg: '#ef4444', fg: '#ffffff' },    // Red
  medium: { bg: '#f59e0b', fg: '#000000' },  // Amber
  low: { bg: '#6b7280', fg: '#ffffff' },     // Gray
  pending: { bg: '#374151', fg: '#9ca3af' }  // Dark gray
};

function createBotBadge(verdict) {
  const badge = document.createElement('span');
  badge.setAttribute('data-bot-badge', 'true');
  
  let severity = 'pending';
  let text = '...';
  let title = 'Analyzing...';
  
  if (verdict.isBot === 'pending') {
    severity = 'pending';
    text = '...';
    title = 'Analyzing...';
  } else if (verdict.isBot) {
    const confidence = verdict.confidence || 0;
    severity = getSeverityLevel(confidence);
    const label = getBadgeLabel(verdict);
    const score = Math.round(confidence * 100) / 10;
    
    if (severity === 'high') {
      text = 'Bot · Hidden';
    } else {
      text = `${label} · ${score.toFixed(1)}`;
    }
    
    const category = CATEGORY_LABELS[verdict.category] || 'Bot';
    title = `${category}: ${verdict.reason || 'Automated behavior detected'}`;
  }
  
  const colors = BADGE_COLORS[severity];
  
  // Apply inline styles directly (ensures they work even if stylesheet fails)
  Object.assign(badge.style, {
    display: 'inline',
    fontSize: '12px',
    fontWeight: '600',
    padding: '0 5px',
    borderRadius: '4px',
    marginLeft: '4px',
    marginRight: '2px',
    verticalAlign: 'middle',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    backgroundColor: colors.bg,
    color: colors.fg
  });
  
  badge.textContent = text;
  badge.title = title;
  badge.className = `bot-badge bot-badge-${severity}`;
  
  return badge;
}

/**
 * Create "Hide again" button for revealed bots
 */
function createHideAgainButton(container, verdict, username) {
  const btn = document.createElement('button');
  btn.className = 'bot-hide-btn';
  btn.setAttribute('data-bot-hide-btn', 'true');
  btn.textContent = 'Hide again';
  btn.title = 'Re-hide this bot reply';
  
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    // Re-apply dimming
    container.classList.add('bot-reply-dimmed');
    btn.remove();
  });
  
  return btn;
}

// ============================================================================
// Reply Element Processing
// ============================================================================

function getReplyContainer(element) {
  // Find the article element (tweet container)
  return element.closest('article[data-testid="tweet"]') || element;
}

/**
 * Find the @handle section within the username container
 * MUST match the exact approach in content.js for country flags
 */
function findHandleSection(container, screenName) {
  if (!screenName) return null;
  
  // Match EXACTLY how content.js does it (case-sensitive, no 'i' flag)
  return Array.from(container.querySelectorAll('div')).find(div => {
    const link = div.querySelector(`a[href="/${screenName}"]`);
    return link && link.textContent?.trim() === `@${screenName}`;
  });
}

/**
 * Insert bot badge into the username container
 * 
 * PRIORITY ORDER:
 * 1. After country flag (if exists) - keeps them together
 * 2. Before @handle section (same as flag placement)
 * 3. After display name
 * 4. Fallback: append
 */
function insertBotBadge(container, badge, screenName) {
  // BEST: Insert after country flag (keeps flag + badge together inline)
  const existingFlag = container.querySelector('[data-twitter-flag]');
  if (existingFlag) {
    try {
      // Insert badge right after the flag
      existingFlag.after(badge);
      return true;
    } catch (e) { /* continue */ }
  }
  
  // Find handle section (@username)
  const handleSection = findHandleSection(container, screenName);
  
  // Strategy 2: Insert before handle section if direct child
  if (handleSection && handleSection.parentNode === container) {
    try {
      container.insertBefore(badge, handleSection);
      return true;
    } catch (e) { /* continue */ }
  }
  
  // Strategy 3: Insert before handle section's parent
  if (handleSection?.parentNode && handleSection.parentNode !== container) {
    try {
      handleSection.parentNode.insertBefore(badge, handleSection);
      return true;
    } catch (e) { /* continue */ }
  }
  
  // Strategy 4: Insert after display name link
  const displayNameLink = container.querySelector('a[href^="/"]');
  if (displayNameLink) {
    const displayContainer = displayNameLink.closest('div');
    if (displayContainer?.parentNode) {
      try {
        displayContainer.parentNode.insertBefore(badge, displayContainer.nextSibling);
        return true;
      } catch (e) { /* continue */ }
    }
  }
  
  // Strategy 5: Fallback - append to container
  try {
    container.appendChild(badge);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Apply bot UI to a reply element
 * @param {HTMLElement} replyElement - The reply element
 * @param {Object} verdict - Bot verdict (should contain username)
 * @param {string} [username] - Optional override for username
 */
function applyBotUI(replyElement, verdict, username) {
  const container = getReplyContainer(replyElement);
  if (!container) return;
  
  // Get username from verdict or parameter
  const resolvedUsername = username || verdict?.username || '';
  
  // Skip if already processed with same verdict
  const existingVerdict = container.dataset.botVerdict;
  if (existingVerdict === JSON.stringify(verdict)) return;
  
  // Remove any existing bot UI
  removeBotUI(container);
  
  // Store verdict
  container.dataset.botVerdict = JSON.stringify(verdict);
  container.dataset.botUsername = resolvedUsername;
  
  // Skip if not a bot
  if (!verdict.isBot && verdict.isBot !== 'pending') return;
  
  const confidence = verdict.confidence || 0;
  const severity = getSeverityLevel(confidence);
  
  // Find the User-Name container (MUST match content.js flag logic exactly)
  // content.js uses: '[data-testid="UserName"], [data-testid="User-Name"]'
  const userNameContainer = container.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  if (userNameContainer) {
    const badge = createBotBadge(verdict);
    const inserted = insertBotBadge(userNameContainer, badge, resolvedUsername);
    if (inserted) {
      console.log('BotUI: Badge inserted for', resolvedUsername, '- parent:', badge.parentElement?.tagName);
    } else {
      console.warn('BotUI: Failed to insert badge for', resolvedUsername);
    }
  } else {
    console.warn('BotUI: No User-Name container found for', resolvedUsername);
  }
  
  // Add colored left border to make bots visually distinct
  if (verdict.isBot === true) {
    if (severity === 'high') {
      container.classList.add('bot-reply-flagged');
    } else if (severity === 'medium') {
      container.classList.add('bot-reply-flagged-medium');
    }
  }
  
  // Apply dimming for high-confidence bots (not pending)
  if (verdict.isBot === true && confidence >= 0.75) {
    container.classList.add('bot-reply-dimmed');
    container.classList.add('bot-reply-container');
    addQuickActions(container, resolvedUsername);
    
    // Click anywhere on dimmed reply to reveal
    container.addEventListener('click', function revealHandler(e) {
      // Don't trigger on button clicks
      if (e.target.closest('.bot-action-btn')) return;
      
      container.classList.remove('bot-reply-dimmed');
      container.removeEventListener('click', revealHandler);
      
      // Add "Hide again" button next to badge
      const badge = container.querySelector('[data-bot-badge]');
      if (badge && badge.parentElement) {
        const hideBtn = createHideAgainButton(container, verdict, resolvedUsername);
        badge.parentElement.insertBefore(hideBtn, badge.nextSibling);
      }
    });
  }
}

/**
 * Remove bot UI from an element
 */
function removeBotUI(container) {
  // Remove badge
  const badge = container.querySelector('[data-bot-badge]');
  if (badge) badge.remove();
  
  // Remove hide button
  const hideBtn = container.querySelector('[data-bot-hide-btn]');
  if (hideBtn) hideBtn.remove();
  
  // Remove all bot classes
  container.classList.remove(
    'bot-reply-dimmed',
    'bot-reply-container',
    'bot-reply-flagged',
    'bot-reply-flagged-medium'
  );
  
  // Remove actions
  const actions = container.querySelector('.bot-actions');
  if (actions) actions.remove();
  
  // Remove inline styles we may have added
  container.style.removeProperty('position');
  
  // Remove data attributes
  delete container.dataset.botVerdict;
  delete container.dataset.botUsername;
}

// ============================================================================
// Quick Actions
// ============================================================================

function addQuickActions(container, username) {
  const actions = document.createElement('div');
  actions.className = 'bot-actions';
  
  // Whitelist button
  const whitelistBtn = document.createElement('button');
  whitelistBtn.className = 'bot-action-btn bot-action-whitelist';
  whitelistBtn.textContent = '✓ Not a bot';
  whitelistBtn.title = 'Add to whitelist';
  whitelistBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.BotCache) {
      window.BotCache.addToWhitelist(username);
    }
    removeBotUI(container);
  });
  
  // Block button (uses Twitter's native block)
  const blockBtn = document.createElement('button');
  blockBtn.className = 'bot-action-btn bot-action-block';
  blockBtn.textContent = '🚫 Block';
  blockBtn.title = 'Block this account';
  blockBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Find and click Twitter's more menu, then block
    const moreBtn = container.querySelector('[data-testid="caret"]');
    if (moreBtn) {
      moreBtn.click();
      // Wait for menu to open, then click block
      setTimeout(() => {
        const blockOption = document.querySelector('[data-testid="block"]');
        if (blockOption) blockOption.click();
      }, 100);
    }
  });
  
  actions.appendChild(whitelistBtn);
  actions.appendChild(blockBtn);
  container.appendChild(actions);
}

// ============================================================================
// Update Pending to Final
// ============================================================================

function updateBotVerdict(username, verdict) {
  // Find all containers with this username that are pending
  const containers = document.querySelectorAll(`[data-bot-username="${username}"]`);
  
  containers.forEach(container => {
    try {
      const currentVerdict = JSON.parse(container.dataset.botVerdict || '{}');
      if (currentVerdict.isBot === 'pending') {
        applyBotUI(container, verdict, username);
      }
    } catch (e) {
      // Ignore parse errors
    }
  });
}

// ============================================================================
// Remove All Bot UI
// ============================================================================

function removeAllBotUI() {
  // Remove all badges and hide buttons
  document.querySelectorAll('[data-bot-badge], [data-bot-hide-btn]').forEach(el => el.remove());
  
  // Remove all bot classes
  document.querySelectorAll('.bot-reply-dimmed, .bot-reply-container, .bot-reply-flagged, .bot-reply-flagged-medium').forEach(el => {
    el.classList.remove('bot-reply-dimmed', 'bot-reply-container', 'bot-reply-flagged', 'bot-reply-flagged-medium');
  });
  
  // Remove all actions
  document.querySelectorAll('.bot-actions').forEach(el => el.remove());
  
  // Remove all data attributes
  document.querySelectorAll('[data-bot-verdict]').forEach(el => {
    delete el.dataset.botVerdict;
    delete el.dataset.botUsername;
  });
}

// ============================================================================
// Initialize
// ============================================================================

function initBotUI() {
  injectBotStyles();
}

// ============================================================================
// Debug: Test UI on any tweet (call from console)
// Usage: BotUI.testOnTweet() or BotUI.testOnTweet('high') or BotUI.testOnTweet('medium')
// ============================================================================

function testOnTweet(severity = 'high') {
  const tweet = document.querySelector('article[data-testid="tweet"]:not([data-bot-verdict])');
  if (!tweet) {
    console.log('No unprocessed tweets found');
    return;
  }
  
  const verdict = {
    username: 'test_bot_' + Date.now(),
    isBot: true,
    confidence: severity === 'high' ? 0.92 : 0.65,
    category: 'crypto_spam',
    reason: 'DEBUG: Testing bot UI overlay',
    source: 'debug',
    expiry: Date.now() + 60000 // 1 minute
  };
  
  applyBotUI(tweet, verdict);
  console.log(`✅ Applied ${severity} bot UI to tweet. Verdict:`, verdict);
}

// Export
if (typeof window !== 'undefined') {
  window.BotUI = {
    initBotUI,
    injectBotStyles,  // CRITICAL: Must be exported for content.js to call it
    applyBotUI,
    removeBotUI,
    updateBotVerdict,
    removeAllBotUI,
    createBotBadge,
    testOnTweet,  // Debug function
    CATEGORY_LABELS,
  };
}
