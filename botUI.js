// Bot Detection UI Components
// Real-time feel with optimistic updates and smooth animations

// ============================================================================
// Styles - Optimized for perceived performance
// ============================================================================

const BOT_UI_STYLES = `
/* Bot badge - compact, inline */
.bot-badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  margin-left: 4px;
  vertical-align: middle;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  transition: all 0.15s ease;
  transform: scale(1);
}

/* Entrance animation */
@keyframes bot-badge-enter {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}

.bot-badge-enter {
  animation: bot-badge-enter 0.15s ease forwards;
}

/* High confidence bot - Red */
.bot-badge-high {
  background: #dc2626;
  color: #fff;
}

/* Medium confidence - Amber */
.bot-badge-medium {
  background: #f59e0b;
  color: #000;
}

/* Low/Suspicious - Muted */
.bot-badge-low {
  background: #525252;
  color: #e5e5e5;
}

/* Pending analysis - subtle shimmer */
.bot-badge-pending {
  background: linear-gradient(90deg, #27272a 0%, #3f3f46 50%, #27272a 100%);
  background-size: 200% 100%;
  color: #71717a;
  animation: bot-shimmer 1.5s ease-in-out infinite;
}

@keyframes bot-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* "Hide again" button */
.bot-hide-btn {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  margin-left: 4px;
  background: #27272a;
  color: #a1a1aa;
  border: none;
  cursor: pointer;
  vertical-align: middle;
  transition: all 0.1s ease;
}

.bot-hide-btn:hover {
  background: #3f3f46;
  color: #fff;
}

/* Dimmed reply - smooth transition */
.bot-reply-dimmed {
  opacity: 0.2 !important;
  filter: grayscale(0.6) blur(0.5px);
  transition: opacity 0.2s ease, filter 0.2s ease;
}

.bot-reply-dimmed:hover {
  opacity: 0.5 !important;
  filter: grayscale(0.3) blur(0);
}

/* Left border accent */
.bot-reply-flagged {
  border-left: 2px solid #dc2626 !important;
  padding-left: 12px !important;
  transition: border-color 0.15s ease;
}

.bot-reply-flagged-medium {
  border-left: 2px solid #f59e0b !important;
  padding-left: 12px !important;
}

/* Quick actions - appear on hover */
.bot-actions {
  position: absolute;
  top: 4px;
  right: 44px;
  display: flex;
  gap: 6px;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity 0.1s ease, transform 0.1s ease;
  z-index: 100;
  pointer-events: none;
}

article[data-testid="tweet"]:hover .bot-actions {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.bot-action-btn {
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  background: rgba(0,0,0,0.9);
  backdrop-filter: blur(8px);
  transition: all 0.1s ease;
}

.bot-action-whitelist {
  color: #22c55e;
}

.bot-action-whitelist:hover {
  background: #22c55e;
  color: #000;
  transform: scale(1.05);
}

.bot-action-block {
  color: #ef4444;
}

.bot-action-block:hover {
  background: #ef4444;
  color: #fff;
  transform: scale(1.05);
}

/* Toast notification */
.bot-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%) translateY(0);
  background: #18181b;
  color: #fafafa;
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  z-index: 10000;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  animation: bot-toast-in 0.2s ease;
}

@keyframes bot-toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* Skeleton loading for pending */
.bot-skeleton {
  display: inline-block;
  width: 36px;
  height: 14px;
  margin-left: 4px;
  vertical-align: middle;
  border-radius: 3px;
  background: linear-gradient(90deg, #27272a 0%, #3f3f46 50%, #27272a 100%);
  background-size: 200% 100%;
  animation: bot-shimmer 1.2s ease-in-out infinite;
}

/* Processed indicator (subtle) */
.bot-checked {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 4px;
  border-radius: 50%;
  background: #22c55e;
  opacity: 0.4;
  vertical-align: middle;
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
// Toast Notifications
// ============================================================================

function showToast(message, duration = 2000) {
  const existing = document.querySelector('.bot-toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = 'bot-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => toast.remove(), 150);
  }, duration);
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

function getSeverityLevel(confidence) {
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

const BADGE_COLORS = {
  high: { bg: '#dc2626', fg: '#ffffff' },
  medium: { bg: '#f59e0b', fg: '#000000' },
  low: { bg: '#525252', fg: '#ffffff' },
  pending: { bg: '#374151', fg: '#9ca3af' }
};

function createBotBadge(verdict, animate = true) {
  const badge = document.createElement('span');
  badge.setAttribute('data-bot-badge', 'true');
  
  let severity = 'pending';
  let text = '•••';
  let title = 'Analyzing...';
  
  if (verdict.isBot === 'pending') {
    severity = 'pending';
    text = '•••';
    title = 'Analyzing...';
  } else if (verdict.isBot) {
    const confidence = verdict.confidence || 0;
    severity = getSeverityLevel(confidence);
    
    if (severity === 'high') {
      text = '🤖 BOT';
    } else if (severity === 'medium') {
      text = '⚠️ SUS';
    } else {
      text = '? LOW';
    }
    
    const category = CATEGORY_LABELS[verdict.category] || 'Bot';
    const pct = Math.round(confidence * 100);
    title = `${pct}% · ${category}\n${verdict.reason || ''}`;
  }
  
  const colors = BADGE_COLORS[severity];
  
  Object.assign(badge.style, {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: '11px',
    fontWeight: '600',
    padding: '1px 6px',
    borderRadius: '3px',
    marginLeft: '4px',
    verticalAlign: 'middle',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    backgroundColor: colors.bg,
    color: colors.fg,
    lineHeight: '1.3'
  });
  
  badge.textContent = text;
  badge.title = title;
  badge.className = `bot-badge bot-badge-${severity}${animate ? ' bot-badge-enter' : ''}`;
  
  return badge;
}

// Create skeleton loader for pending state
function createSkeleton() {
  const skeleton = document.createElement('span');
  skeleton.className = 'bot-skeleton';
  skeleton.setAttribute('data-bot-skeleton', 'true');
  return skeleton;
}

// Create subtle "checked" dot for verified humans
function createCheckedDot() {
  const dot = document.createElement('span');
  dot.className = 'bot-checked';
  dot.setAttribute('data-bot-checked', 'true');
  dot.title = 'Verified human';
  return dot;
}

function createHideAgainButton(container) {
  const btn = document.createElement('button');
  btn.className = 'bot-hide-btn';
  btn.setAttribute('data-bot-hide-btn', 'true');
  btn.textContent = 'Hide';
  btn.title = 'Re-hide this reply';
  
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    container.classList.add('bot-reply-dimmed');
    btn.remove();
  });
  
  return btn;
}

// ============================================================================
// Reply Element Processing
// ============================================================================

function getReplyContainer(element) {
  return element.closest('article[data-testid="tweet"]') || element;
}

function findHandleSection(container, screenName) {
  if (!screenName) return null;
  return Array.from(container.querySelectorAll('div')).find(div => {
    const link = div.querySelector(`a[href="/${screenName}"]`);
    return link && link.textContent?.trim() === `@${screenName}`;
  });
}

function insertBotBadge(container, badge, screenName) {
  // After country flag if exists
  const existingFlag = container.querySelector('[data-twitter-flag]');
  if (existingFlag) {
    try { existingFlag.after(badge); return true; } catch { /* continue */ }
  }
  
  const handleSection = findHandleSection(container, screenName);
  
  if (handleSection && handleSection.parentNode === container) {
    try { container.insertBefore(badge, handleSection); return true; } catch { /* continue */ }
  }
  
  if (handleSection?.parentNode && handleSection.parentNode !== container) {
    try { handleSection.parentNode.insertBefore(badge, handleSection); return true; } catch { /* continue */ }
  }
  
  const displayNameLink = container.querySelector('a[href^="/"]');
  if (displayNameLink) {
    const displayContainer = displayNameLink.closest('div');
    if (displayContainer?.parentNode) {
      try { displayContainer.parentNode.insertBefore(badge, displayContainer.nextSibling); return true; } catch { /* continue */ }
    }
  }
  
  try { container.appendChild(badge); return true; } catch { return false; }
}

// ============================================================================
// Optimistic UI Updates
// ============================================================================

// Show immediate skeleton while waiting for server
function showPending(replyElement, username) {
  const container = getReplyContainer(replyElement);
  if (!container) return;
  
  // Skip if already has UI
  if (container.querySelector('[data-bot-badge], [data-bot-skeleton]')) return;
  
  const userNameContainer = container.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  if (userNameContainer) {
    const skeleton = createSkeleton();
    insertBotBadge(userNameContainer, skeleton, username);
  }
  
  container.dataset.botUsername = username?.toLowerCase() || '';
}

// Transition from skeleton to final verdict
function resolvePending(replyElement, verdict, username) {
  const container = getReplyContainer(replyElement);
  if (!container) return;
  
  // Remove skeleton
  const skeleton = container.querySelector('[data-bot-skeleton]');
  if (skeleton) skeleton.remove();
  
  // Apply final verdict
  applyBotUI(replyElement, verdict, username);
}

// ============================================================================
// Main Apply Function
// ============================================================================

function applyBotUI(replyElement, verdict, username) {
  const container = getReplyContainer(replyElement);
  if (!container) return;
  
  const resolvedUsername = username || verdict?.username || '';
  
  // Skip if same verdict
  const existingVerdict = container.dataset.botVerdict;
  if (existingVerdict === JSON.stringify(verdict)) return;
  
  // Remove any existing UI
  removeBotUI(container);
  
  // Store verdict
  container.dataset.botVerdict = JSON.stringify(verdict);
  container.dataset.botUsername = resolvedUsername.toLowerCase();
  
  // Not a bot - optionally show subtle indicator
  if (!verdict.isBot && verdict.isBot !== 'pending') {
    // Uncomment to show green dot for verified humans:
    // const userNameContainer = container.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
    // if (userNameContainer) insertBotBadge(userNameContainer, createCheckedDot(), resolvedUsername);
    return;
  }
  
  const confidence = verdict.confidence || 0;
  const severity = getSeverityLevel(confidence);
  
  // Add badge
  const userNameContainer = container.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  if (userNameContainer) {
    const badge = createBotBadge(verdict, true);
    insertBotBadge(userNameContainer, badge, resolvedUsername);
  }
  
  // Add colored border
  if (verdict.isBot === true) {
    if (severity === 'high') {
      container.classList.add('bot-reply-flagged');
    } else if (severity === 'medium') {
      container.classList.add('bot-reply-flagged-medium');
    }
  }
  
  // Dim high-confidence bots
  if (verdict.isBot === true && confidence >= 0.7) {
    container.classList.add('bot-reply-dimmed');
    addQuickActions(container, resolvedUsername);
    
    container.addEventListener('click', function revealHandler(e) {
      if (e.target.closest('.bot-action-btn')) return;
      
      container.classList.remove('bot-reply-dimmed');
      container.removeEventListener('click', revealHandler);
      
      const badge = container.querySelector('[data-bot-badge]');
      if (badge?.parentElement) {
        badge.parentElement.insertBefore(createHideAgainButton(container), badge.nextSibling);
      }
    });
  }
}

function removeBotUI(container) {
  container.querySelector('[data-bot-badge]')?.remove();
  container.querySelector('[data-bot-hide-btn]')?.remove();
  container.querySelector('[data-bot-skeleton]')?.remove();
  container.querySelector('[data-bot-checked]')?.remove();
  container.querySelector('.bot-actions')?.remove();
  
  container.classList.remove(
    'bot-reply-dimmed', 'bot-reply-container',
    'bot-reply-flagged', 'bot-reply-flagged-medium'
  );
  
  container.style.removeProperty('position');
  delete container.dataset.botVerdict;
}

// ============================================================================
// Quick Actions
// ============================================================================

function addQuickActions(container, username) {
  container.querySelector('.bot-actions')?.remove();
  
  const actions = document.createElement('div');
  actions.className = 'bot-actions';
  
  const whitelistBtn = document.createElement('button');
  whitelistBtn.className = 'bot-action-btn bot-action-whitelist';
  whitelistBtn.textContent = '✓ Human';
  whitelistBtn.title = `Whitelist @${username}`;
  whitelistBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    window.BotCache?.addToWhitelist?.(username);
    removeBotUI(container);
    showToast(`@${username} whitelisted`);
    
    // Update all instances
    document.querySelectorAll(`[data-bot-username="${username.toLowerCase()}"]`).forEach(el => {
      removeBotUI(el);
      el.dataset.botProcessed = 'whitelisted';
    });
    container.dataset.botProcessed = 'whitelisted';
  });
  
  const blockBtn = document.createElement('button');
  blockBtn.className = 'bot-action-btn bot-action-block';
  blockBtn.textContent = '🚫 Block';
  blockBtn.title = `Block @${username}`;
  blockBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const moreBtn = container.querySelector('[data-testid="caret"]');
    if (moreBtn) {
      moreBtn.click();
      setTimeout(() => {
        document.querySelector('[data-testid="block"]')?.click();
      }, 100);
    }
  });
  
  actions.appendChild(whitelistBtn);
  actions.appendChild(blockBtn);
  
  container.style.position = 'relative';
  container.insertBefore(actions, container.firstChild);
}

// ============================================================================
// Batch Update
// ============================================================================

function updateBotVerdict(username, verdict) {
  document.querySelectorAll(`[data-bot-username="${username.toLowerCase()}"]`).forEach(container => {
    try {
      const current = JSON.parse(container.dataset.botVerdict || '{}');
      if (current.isBot === 'pending') {
        applyBotUI(container, verdict, username);
      }
    } catch { /* ignore */ }
  });
}

function removeAllBotUI() {
  document.querySelectorAll('[data-bot-badge], [data-bot-hide-btn], [data-bot-skeleton], [data-bot-checked], .bot-actions').forEach(el => el.remove());
  document.querySelectorAll('.bot-reply-dimmed, .bot-reply-container, .bot-reply-flagged, .bot-reply-flagged-medium').forEach(el => {
    el.classList.remove('bot-reply-dimmed', 'bot-reply-container', 'bot-reply-flagged', 'bot-reply-flagged-medium');
  });
  document.querySelectorAll('[data-bot-verdict]').forEach(el => {
    delete el.dataset.botVerdict;
    delete el.dataset.botUsername;
  });
}

function initBotUI() {
  injectBotStyles();
}

// Debug
function testOnTweet(severity = 'high') {
  const tweet = document.querySelector('article[data-testid="tweet"]:not([data-bot-verdict])');
  if (!tweet) { console.log('No unprocessed tweets'); return; }
  
  const verdict = {
    username: 'test_bot',
    isBot: true,
    confidence: severity === 'high' ? 0.92 : 0.65,
    category: 'crypto_spam',
    reason: 'Test verdict',
    source: 'debug'
  };
  
  applyBotUI(tweet, verdict);
  console.log('Applied', severity, 'verdict');
}

// Export
if (typeof window !== 'undefined') {
  window.BotUI = {
    initBotUI,
    injectBotStyles,
    applyBotUI,
    removeBotUI,
    updateBotVerdict,
    removeAllBotUI,
    createBotBadge,
    showPending,
    resolvePending,
    showToast,
    testOnTweet,
    CATEGORY_LABELS,
  };
}
