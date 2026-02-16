// Bot Detection UI Components
// Handles visual rendering of bot detection results

// ============================================================================
// Styles
// ============================================================================

const BOT_UI_STYLES = `
/* Bot badge */
.bot-badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 6px;
  vertical-align: middle;
  cursor: default;
  user-select: none;
}

.bot-badge-high {
  background: rgba(244, 33, 46, 0.15);
  color: #f4212e;
  border: 1px solid rgba(244, 33, 46, 0.3);
}

.bot-badge-medium {
  background: rgba(255, 173, 31, 0.15);
  color: #ffad1f;
  border: 1px solid rgba(255, 173, 31, 0.3);
}

.bot-badge-pending {
  background: rgba(113, 118, 123, 0.15);
  color: #71767b;
  border: 1px solid rgba(113, 118, 123, 0.3);
}

/* Dimmed reply */
.bot-reply-dimmed {
  opacity: 0.3;
  filter: grayscale(40%);
  transition: opacity 0.2s ease, filter 0.2s ease;
}

.bot-reply-dimmed:hover {
  opacity: 0.6;
  filter: grayscale(20%);
}

/* Click to reveal overlay */
.bot-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  z-index: 10;
  cursor: pointer;
  border-radius: 4px;
}

.bot-overlay-text {
  color: #fff;
  font-size: 13px;
  font-weight: 500;
}

.bot-overlay-reason {
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  max-width: 80%;
  text-align: center;
}

/* Quick actions */
.bot-actions {
  position: absolute;
  bottom: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
  z-index: 5;
}

.bot-reply-container:hover .bot-actions {
  opacity: 1;
}

.bot-action-btn {
  padding: 4px 8px;
  font-size: 11px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: background 0.15s ease;
}

.bot-action-whitelist {
  background: rgba(29, 155, 240, 0.2);
  color: #1d9bf0;
}

.bot-action-whitelist:hover {
  background: rgba(29, 155, 240, 0.3);
}

.bot-action-block {
  background: rgba(244, 33, 46, 0.2);
  color: #f4212e;
}

.bot-action-block:hover {
  background: rgba(244, 33, 46, 0.3);
}

/* Bot indicator icon */
.bot-icon {
  display: inline-block;
  margin-right: 4px;
}

/* Animation for pending state */
@keyframes bot-pulse {
  0%, 100% { opacity: 0.6; }
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
}

// ============================================================================
// Badge Creation
// ============================================================================

const CATEGORY_LABELS = {
  engagement_farmer: '🌾 Farmer',
  sycophant: '🤖 Bot',
  self_promoter: '📢 Shill',
  airdrop_farmer: '🪂 Airdrop',
  crypto_spam: '💩 Spam',
  genuine: '✓ Human',
};

const CATEGORY_COLORS = {
  engagement_farmer: 'high',
  sycophant: 'high',
  self_promoter: 'medium',
  airdrop_farmer: 'medium',
  crypto_spam: 'high',
  genuine: 'low',
};

function createBotBadge(verdict) {
  const badge = document.createElement('span');
  badge.className = 'bot-badge';
  badge.setAttribute('data-bot-badge', 'true');
  
  if (verdict.isBot === 'pending') {
    badge.classList.add('bot-badge-pending');
    badge.textContent = '⏳';
    badge.title = 'Analyzing...';
  } else if (verdict.isBot) {
    const colorClass = CATEGORY_COLORS[verdict.category] || 'high';
    badge.classList.add(`bot-badge-${colorClass}`);
    badge.textContent = CATEGORY_LABELS[verdict.category] || '🤖 Bot';
    badge.title = verdict.reason || 'Likely bot/spam';
  }
  
  return badge;
}

// ============================================================================
// Reply Element Processing
// ============================================================================

function getReplyContainer(element) {
  // Find the article element (tweet container)
  return element.closest('article[data-testid="tweet"]') || element;
}

function findUsernameContainer(replyElement) {
  return replyElement.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
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
  container.dataset.botUsername = username;
  
  // Skip if not a bot
  if (!verdict.isBot && verdict.isBot !== 'pending') return;
  
  // Add badge next to username
  const usernameContainer = findUsernameContainer(container);
  if (usernameContainer) {
    const badge = createBotBadge(verdict);
    usernameContainer.appendChild(badge);
  }
  
  // Apply dimming for high-confidence bots (not pending)
  if (verdict.isBot === true && verdict.confidence >= 0.7) {
    container.classList.add('bot-reply-dimmed');
    addClickToReveal(container, verdict, username);
    addQuickActions(container, username);
  }
}

/**
 * Remove bot UI from an element
 */
function removeBotUI(container) {
  // Remove badge
  const badge = container.querySelector('[data-bot-badge]');
  if (badge) badge.remove();
  
  // Remove dimming
  container.classList.remove('bot-reply-dimmed');
  
  // Remove overlay
  const overlay = container.querySelector('.bot-overlay');
  if (overlay) overlay.remove();
  
  // Remove actions
  const actions = container.querySelector('.bot-actions');
  if (actions) actions.remove();
  
  // Remove data attributes
  delete container.dataset.botVerdict;
  delete container.dataset.botUsername;
}

// ============================================================================
// Click to Reveal
// ============================================================================

function addClickToReveal(container, verdict, username) {
  // Make container position relative for overlay
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  container.classList.add('bot-reply-container');
  
  const overlay = document.createElement('div');
  overlay.className = 'bot-overlay';
  overlay.innerHTML = `
    <span class="bot-overlay-text">🤖 ${CATEGORY_LABELS[verdict.category] || 'Bot'} Detected</span>
    <span class="bot-overlay-reason">${verdict.reason || 'Click to reveal'}</span>
  `;
  
  overlay.addEventListener('click', (e) => {
    e.stopPropagation();
    // Reveal the reply
    container.classList.remove('bot-reply-dimmed');
    overlay.remove();
    // Keep badge but user can still see the content
  });
  
  container.appendChild(overlay);
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
  // Remove all badges
  document.querySelectorAll('[data-bot-badge]').forEach(el => el.remove());
  
  // Remove all dimming
  document.querySelectorAll('.bot-reply-dimmed').forEach(el => {
    el.classList.remove('bot-reply-dimmed');
  });
  
  // Remove all overlays
  document.querySelectorAll('.bot-overlay').forEach(el => el.remove());
  
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

// Export
if (typeof window !== 'undefined') {
  window.BotUI = {
    initBotUI,
    applyBotUI,
    removeBotUI,
    updateBotVerdict,
    removeAllBotUI,
    createBotBadge,
    CATEGORY_LABELS,
  };
}
