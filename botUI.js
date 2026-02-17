// Bot Detection UI Components
// Handles visual rendering of bot detection results

// ============================================================================
// Styles
// ============================================================================

const BOT_UI_STYLES = `
/* Bot badge - compact inline pill like botblock.ai */
.bot-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 4px;
  vertical-align: baseline;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  line-height: 1.4;
  position: relative;
  top: -1px;
}

/* High confidence bot - Red */
.bot-badge-high {
  background: #dc2626;
  color: #fff;
}

/* Medium confidence - Orange/Yellow */
.bot-badge-medium {
  background: #f59e0b;
  color: #000;
}

/* Low/Suspicious - Muted */
.bot-badge-low {
  background: #6b7280;
  color: #fff;
}

/* Pending analysis */
.bot-badge-pending {
  background: #374151;
  color: #9ca3af;
}

/* Score number in badge */
.bot-badge-score {
  font-weight: 700;
  font-size: 10px;
  opacity: 0.9;
}

/* "Hide again" button */
.bot-hide-btn {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 4px;
  background: #374151;
  color: #9ca3af;
  border: none;
  cursor: pointer;
  vertical-align: baseline;
  line-height: 1.4;
  position: relative;
  top: -1px;
}

.bot-hide-btn:hover {
  background: #4b5563;
  color: #fff;
}

/* Dimmed reply - more subtle than before */
.bot-reply-dimmed {
  opacity: 0.35;
  transition: opacity 0.2s ease;
}

.bot-reply-dimmed:hover {
  opacity: 0.5;
}

/* Red left border for bot tweets */
.bot-reply-flagged {
  border-left: 3px solid #dc2626 !important;
  padding-left: 12px !important;
}

.bot-reply-flagged-medium {
  border-left: 3px solid #f59e0b !important;
  padding-left: 12px !important;
}

/* Container needs relative positioning for actions */
.bot-reply-container {
  position: relative;
}

/* Quick actions - appear on hover */
.bot-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s ease;
  z-index: 5;
}

.bot-reply-container:hover .bot-actions {
  opacity: 1;
}

.bot-action-btn {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.bot-action-whitelist {
  background: rgba(29, 155, 240, 0.15);
  color: #1d9bf0;
}

.bot-action-whitelist:hover {
  background: rgba(29, 155, 240, 0.25);
}

.bot-action-block {
  background: rgba(244, 33, 46, 0.15);
  color: #f4212e;
}

.bot-action-block:hover {
  background: rgba(244, 33, 46, 0.25);
}

/* Animation for pending state */
@keyframes bot-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.bot-badge-pending {
  animation: bot-pulse 1.5s ease-in-out infinite;
}

/* Tooltip on hover */
.bot-badge[title]:hover::after {
  content: attr(title);
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 4px;
  padding: 4px 8px;
  background: #1f2937;
  color: #fff;
  font-size: 11px;
  font-weight: 400;
  border-radius: 4px;
  white-space: nowrap;
  z-index: 100;
  pointer-events: none;
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

function createBotBadge(verdict) {
  const badge = document.createElement('span');
  badge.className = 'bot-badge';
  badge.setAttribute('data-bot-badge', 'true');
  
  if (verdict.isBot === 'pending') {
    badge.classList.add('bot-badge-pending');
    badge.textContent = '...';
    badge.title = 'Analyzing...';
  } else if (verdict.isBot) {
    const confidence = verdict.confidence || 0;
    const severity = getSeverityLevel(confidence);
    const label = getBadgeLabel(verdict);
    const score = Math.round(confidence * 100) / 10; // e.g., 8.2
    
    badge.classList.add(`bot-badge-${severity}`);
    
    // Format: "Bot · 8.2" or "Suspicious · 6.4"
    if (severity === 'high') {
      badge.innerHTML = `Bot<span class="bot-badge-score"> · Hidden</span>`;
    } else {
      badge.innerHTML = `${label}<span class="bot-badge-score"> · ${score.toFixed(1)}</span>`;
    }
    
    // Build detailed tooltip
    const category = CATEGORY_LABELS[verdict.category] || 'Bot';
    badge.title = `${category}: ${verdict.reason || 'Automated behavior detected'}`;
  }
  
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
 * Find the best place to insert the bot badge
 * We want it to appear right after the timestamp or handle
 */
function findBadgeInsertionPoint(replyElement) {
  // Strategy 1: Find the row with username/handle - look for the timestamp
  const timeElement = replyElement.querySelector('time');
  if (timeElement) {
    // Go up to find the link container, then insert after it
    const timeLink = timeElement.closest('a');
    if (timeLink && timeLink.parentElement) {
      return { parent: timeLink.parentElement, insertAfter: timeLink };
    }
  }
  
  // Strategy 2: Find the username row and append to it
  const userNameRow = replyElement.querySelector('[data-testid="User-Name"]');
  if (userNameRow) {
    // Find the last child that's part of the username row
    const spans = userNameRow.querySelectorAll(':scope > div > div > span, :scope > div > span');
    if (spans.length > 0) {
      const lastSpan = spans[spans.length - 1];
      return { parent: lastSpan.parentElement, insertAfter: lastSpan };
    }
    return { parent: userNameRow, insertAfter: null };
  }
  
  return null;
}

/**
 * Apply bot UI to a reply element
 * @param {HTMLElement} replyElement - The reply element
 * @param {Object} verdict - Bot verdict
 * @param {string} username - The username
 */
function applyBotUI(replyElement, verdict, username) {
  const container = getReplyContainer(replyElement);
  if (!container) return;
  
  // Skip if already processed with same verdict
  const existingVerdict = container.dataset.botVerdict;
  if (existingVerdict === JSON.stringify(verdict)) return;
  
  // Remove any existing bot UI
  removeBotUI(container);
  
  // Store verdict
  container.dataset.botVerdict = JSON.stringify(verdict);
  container.dataset.botUsername = username || '';
  
  // Skip if not a bot
  if (!verdict.isBot && verdict.isBot !== 'pending') return;
  
  const confidence = verdict.confidence || 0;
  const severity = getSeverityLevel(confidence);
  
  // Add badge - find the right insertion point
  const insertPoint = findBadgeInsertionPoint(container);
  if (insertPoint) {
    const badge = createBotBadge(verdict);
    
    if (insertPoint.insertAfter) {
      insertPoint.insertAfter.parentNode.insertBefore(
        badge, 
        insertPoint.insertAfter.nextSibling
      );
    } else {
      insertPoint.parent.appendChild(badge);
    }
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
    addQuickActions(container, username || '');
    
    // Click anywhere on dimmed reply to reveal
    container.addEventListener('click', function revealHandler(e) {
      // Don't trigger on button clicks
      if (e.target.closest('.bot-action-btn')) return;
      
      container.classList.remove('bot-reply-dimmed');
      container.removeEventListener('click', revealHandler);
      
      // Add "Hide again" button next to badge
      const badge = container.querySelector('[data-bot-badge]');
      if (badge && badge.parentElement) {
        const hideBtn = createHideAgainButton(container, verdict, username);
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
    applyBotUI,
    removeBotUI,
    updateBotVerdict,
    removeAllBotUI,
    createBotBadge,
    testOnTweet,  // Debug function
    CATEGORY_LABELS,
  };
}
