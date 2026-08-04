// Bot Detection UI Components
// Compact, X-native chips — vanilla CSS only, layout-safe

// ============================================================================
// Styles — small inline pills that sit in the username row
// ============================================================================

const BOT_UI_STYLES = `
/* Shared chip base — matches X username density */
.bot-badge,
.bot-hide-btn,
.bot-skeleton {
  box-sizing: border-box;
  flex: 0 0 auto;
  max-width: none;
  font-family: TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* Bot score chip */
.bot-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 18px;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0;
  vertical-align: middle;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;
}

.bot-badge:hover {
  filter: brightness(1.08);
}

@keyframes bot-badge-enter {
  from { opacity: 0; transform: translateY(1px); }
  to { opacity: 1; transform: translateY(0); }
}

.bot-badge-enter {
  animation: bot-badge-enter 0.14s ease-out both;
}

/* High confidence bot */
.bot-badge-high {
  background: rgba(244, 33, 46, 0.16);
  border-color: rgba(244, 33, 46, 0.45);
  color: #f4212e;
}

/* Medium confidence */
.bot-badge-medium {
  background: rgba(255, 173, 31, 0.16);
  border-color: rgba(255, 173, 31, 0.45);
  color: #d97706;
}

/* Low / uncertain */
.bot-badge-low {
  background: rgba(113, 118, 123, 0.14);
  border-color: rgba(113, 118, 123, 0.35);
  color: #71767b;
}

/* Human */
.bot-badge-human {
  background: rgba(0, 186, 124, 0.12);
  border-color: rgba(0, 186, 124, 0.35);
  color: #00ba7c;
}

/* Pending */
.bot-badge-pending {
  background: rgba(113, 118, 123, 0.12);
  border-color: rgba(113, 118, 123, 0.25);
  color: #71767b;
  min-width: 28px;
}

/* Hide-again chip */
.bot-hide-btn {
  display: inline-flex;
  align-items: center;
  height: 18px;
  margin-left: 4px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid rgba(113, 118, 123, 0.35);
  background: rgba(15, 20, 25, 0.04);
  color: #71767b;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  vertical-align: middle;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.bot-hide-btn:hover {
  background: rgba(113, 118, 123, 0.16);
  border-color: rgba(113, 118, 123, 0.5);
  color: inherit;
}

/* Dimmed bot reply — no blur (keeps layout crisp) */
.bot-reply-dimmed {
  opacity: 0.32 !important;
  transition: opacity 0.18s ease;
}

.bot-reply-dimmed:hover {
  opacity: 0.72 !important;
}

/* Slop (human but low-info) — lighter dim than hard bots */
.bot-reply-slop {
  opacity: 0.55 !important;
  transition: opacity 0.18s ease;
}

.bot-reply-slop:hover {
  opacity: 0.88 !important;
}

/* Layout-safe accent: inset shadow, no padding/border reflow */
.bot-reply-flagged {
  box-shadow: inset 3px 0 0 #f4212e !important;
}

.bot-reply-flagged-medium {
  box-shadow: inset 3px 0 0 #ffad1f !important;
}

.bot-reply-flagged-slop {
  box-shadow: inset 3px 0 0 #a855f7 !important;
}

/* Slop badge */
.bot-badge-slop {
  background: rgba(168, 85, 247, 0.14);
  border-color: rgba(168, 85, 247, 0.45);
  color: #c084fc;
}

/* Trust / followed */
.bot-badge-trust {
  background: rgba(29, 155, 240, 0.12);
  border-color: rgba(29, 155, 240, 0.35);
  color: #1d9bf0;
}

/* Hover quick actions */
.bot-actions {
  position: absolute;
  top: 6px;
  right: 48px;
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 0.12s ease, transform 0.12s ease;
  z-index: 50;
  pointer-events: none;
}

article[data-testid="tweet"]:hover > .bot-actions,
article[data-testid="tweet"]:focus-within > .bot-actions {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.bot-action-btn {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(113, 118, 123, 0.35);
  background: rgba(0, 0, 0, 0.72);
  color: #e7e9ea;
  font-family: TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.bot-action-whitelist {
  color: #00ba7c;
}

.bot-action-whitelist:hover {
  background: rgba(0, 186, 124, 0.18);
  border-color: rgba(0, 186, 124, 0.55);
  color: #00ba7c;
}

.bot-action-block {
  color: #f4212e;
}

.bot-action-block:hover {
  background: rgba(244, 33, 46, 0.16);
  border-color: rgba(244, 33, 46, 0.5);
  color: #f4212e;
}

/* Toast */
.bot-toast {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 16px;
  border-radius: 999px;
  border: 1px solid rgba(113, 118, 123, 0.3);
  background: rgba(15, 20, 25, 0.92);
  color: #e7e9ea;
  font-family: TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  z-index: 10000;
  pointer-events: none;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  animation: bot-toast-in 0.18s ease-out both;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

@keyframes bot-toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(8px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* Pending skeleton */
@keyframes bot-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.bot-skeleton {
  display: inline-block;
  width: 32px;
  height: 14px;
  margin-left: 4px;
  vertical-align: middle;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    rgba(113, 118, 123, 0.12) 0%,
    rgba(113, 118, 123, 0.28) 50%,
    rgba(113, 118, 123, 0.12) 100%
  );
  background-size: 200% 100%;
  animation: bot-shimmer 1.2s ease-in-out infinite;
}

/* Subtle human check dot (legacy helper) */
.bot-checked {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 4px;
  border-radius: 50%;
  background: #00ba7c;
  opacity: 0.45;
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
  sycophant: 'Sycophant',
  self_promoter: 'Shill',
  airdrop_farmer: 'Airdrop',
  crypto_spam: 'Spam',
  llm_slop: 'Slop',
  genuine: 'Human',
};

function getSeverityLevel(confidence) {
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

/**
 * SCORING: confidence = how sure AI is about its classification
 * - isBot=true, confidence=0.95 → 95% sure it's a bot
 * - isBot=false, confidence=0.95 → 95% sure it's human
 *
 * DISPLAY: Compact score chip; styling lives entirely in BOT_UI_STYLES
 */

function buildTooltip(verdict) {
  const conf = Math.round((verdict.confidence || 0) * 100);
  const lines = [];

  if (verdict.isBot) {
    lines.push(`${conf}% bot confidence`);
  } else if (verdict.isSlop) {
    lines.push(`${conf}% slop confidence (human, low-info)`);
  } else {
    lines.push(`${conf}% human confidence`);
  }

  if (verdict.category && verdict.category !== 'genuine') {
    const categoryLabel = CATEGORY_LABELS[verdict.category] || verdict.category;
    lines.push(`Type: ${categoryLabel}`);
  }

  if (verdict.source) {
    lines.push(`Source: ${verdict.source}`);
  }

  if (verdict.trustTier && verdict.trustTier !== 'none') {
    lines.push(`Trust: ${verdict.trustTier}`);
  }

  if (verdict.accountScore != null) {
    lines.push(`Account prior: ${Math.round(Number(verdict.accountScore) * 100)}%`);
  }

  if (verdict.reason) {
    lines.push(verdict.reason);
  }

  if (Array.isArray(verdict.signals) && verdict.signals.length > 0) {
    lines.push(verdict.signals.map((s) => `• ${s}`).join('\n'));
  }

  lines.push('Click badge for feedback');

  return lines.join('\n');
}

function createBotBadge(verdict, animate = true) {
  const badge = document.createElement('span');
  badge.setAttribute('data-bot-badge', 'true');

  const conf = Math.round((verdict.confidence || 0) * 100);
  let severity = 'pending';
  let text = '···';
  let title = 'Analyzing…';

  if (verdict.isBot === 'pending') {
    severity = 'pending';
    text = '···';
    title = 'Analyzing…';
  } else if (verdict.source === 'trust' || verdict.trustTier === 'following') {
    severity = 'trust';
    text = `✓ ${conf}`;
    title = buildTooltip(verdict);
  } else if (verdict.isBot) {
    severity = getSeverityLevel(verdict.confidence || 0);
    if (severity === 'high') {
      text = `bot ${conf}`;
    } else if (severity === 'medium') {
      text = `? ${conf}`;
    } else {
      text = `~ ${conf}`;
    }
    title = buildTooltip(verdict);
  } else if (verdict.isSlop) {
    severity = 'slop';
    text = `slop ${conf}`;
    title = buildTooltip(verdict);
  } else {
    severity = 'human';
    text = `✓ ${conf}`;
    title = buildTooltip(verdict);
  }

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
  btn.type = 'button';
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
  // Layout goal: [DisplayName] [VerifiedBadge] [Flag] [BotBadge] [@handle] [time]
  // Container is UserName div - we want to insert INLINE within the first row
  
  // PRIORITY 1: After existing flag (keeps flag + badge together)
  const existingFlag = container.querySelector('[data-twitter-flag]');
  if (existingFlag) {
    try { 
      existingFlag.after(badge); 
      return true; 
    } catch { /* continue */ }
  }
  
  // PRIORITY 2: After flag shimmer (flag is loading)
  const flagShimmer = container.querySelector('[data-twitter-flag-shimmer]');
  if (flagShimmer) {
    try { 
      flagShimmer.after(badge); 
      return true; 
    } catch { /* continue */ }
  }
  
  // PRIORITY 3: Find the display name link and insert after it
  // Look for the first link that is NOT the @handle link
  const allLinks = container.querySelectorAll('a[href^="/"]');
  for (const link of allLinks) {
    const text = link.textContent?.trim() || '';
    // Skip @handle links
    if (text.startsWith('@')) continue;
    // Skip time/date links
    if (link.querySelector('time')) continue;
    // This should be the display name link
    try {
      link.after(badge);
      return true;
    } catch { /* continue */ }
  }
  
  // PRIORITY 4: Insert as first child (fallback for unusual DOM structures)
  try { 
    container.insertBefore(badge, container.firstChild?.nextSibling || null); 
    return true; 
  } catch { /* continue */ }
  
  // FALLBACK: Append to end
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
  
  // Extract username from DOM if not provided
  let resolvedUsername = username || verdict?.username || '';
  if (!resolvedUsername) {
    // Try to extract from the container
    const usernameLink = container.querySelector('[data-testid="UserName"] a[href^="/"], [data-testid="User-Name"] a[href^="/"]');
    if (usernameLink) {
      const href = usernameLink.getAttribute('href');
      const match = href?.match(/^\/([^\/\?]+)/);
      if (match?.[1]) resolvedUsername = match[1];
    }
  }
  
  // Skip if same verdict
  const existingVerdict = container.dataset.botVerdict;
  if (existingVerdict === JSON.stringify(verdict)) return;
  
  // Remove any existing UI
  removeBotUI(container);
  
  // Store verdict
  container.dataset.botVerdict = JSON.stringify(verdict);
  container.dataset.botUsername = resolvedUsername.toLowerCase();
  
  const confidence = verdict.confidence || 0;
  const userNameContainer = container.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  
  // ALWAYS show a score badge (human, slop, or bot)
  if (userNameContainer) {
    const badge = createBotBadge(verdict, true);
    // Click badge → feedback actions
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      addQuickActions(container, resolvedUsername, true);
    });
    insertBotBadge(userNameContainer, badge, resolvedUsername);
  }
  
  // Dim / flag bots
  if (verdict.isBot === true) {
    const severity = getSeverityLevel(confidence);
    
    if (severity === 'high') {
      container.classList.add('bot-reply-flagged');
    } else if (severity === 'medium') {
      container.classList.add('bot-reply-flagged-medium');
    }
    
    // Dim high-confidence bots (sensitivity can raise/lower later via dataset)
    const dimThreshold = Number(container.dataset.botDimThreshold) || 0.7;
    if (confidence >= dimThreshold) {
      container.classList.add('bot-reply-dimmed');
      addQuickActions(container, resolvedUsername);
      
      container.addEventListener('click', function revealHandler(e) {
        if (e.target.closest('.bot-action-btn') || e.target.closest('[data-bot-badge]')) return;
        
        container.classList.remove('bot-reply-dimmed');
        container.removeEventListener('click', revealHandler);
        
        const badge = container.querySelector('[data-bot-badge]');
        if (badge?.parentElement) {
          badge.parentElement.insertBefore(createHideAgainButton(container), badge.nextSibling);
        }
      });
    }
  } else if (verdict.isSlop === true && confidence >= 0.65) {
    // Lighter treatment for slop-only (not hard bot)
    container.classList.add('bot-reply-flagged-slop');
    container.classList.add('bot-reply-slop');
    addQuickActions(container, resolvedUsername);
    
    container.addEventListener('click', function revealHandler(e) {
      if (e.target.closest('.bot-action-btn') || e.target.closest('[data-bot-badge]')) return;
      container.classList.remove('bot-reply-slop');
      container.removeEventListener('click', revealHandler);
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
    'bot-reply-dimmed', 'bot-reply-container', 'bot-reply-slop',
    'bot-reply-flagged', 'bot-reply-flagged-medium', 'bot-reply-flagged-slop'
  );
  
  container.style.removeProperty('position');
  delete container.dataset.botVerdict;
}

// ============================================================================
// Quick Actions
// ============================================================================

function applyOverrideEverywhere(username, verdict, status) {
  const lower = String(username).toLowerCase();
  document.querySelectorAll(`[data-bot-username="${lower}"]`).forEach((el) => {
    removeBotUI(el);
    if (verdict) applyBotUI(el, verdict, username);
    el.dataset.botProcessed = status;
  });
}

function addQuickActions(container, username, forceShow = false) {
  container.querySelector('.bot-actions')?.remove();
  
  let resolvedUsername = username;
  if (!resolvedUsername) {
    const usernameLink = container.querySelector('[data-testid="UserName"] a[href^="/"], [data-testid="User-Name"] a[href^="/"]');
    if (usernameLink) {
      const href = usernameLink.getAttribute('href');
      const match = href?.match(/^\/([^\/\?]+)/);
      if (match?.[1]) resolvedUsername = match[1];
    }
  }
  
  if (!resolvedUsername) return;
  
  const actions = document.createElement('div');
  actions.className = 'bot-actions';
  if (forceShow) {
    actions.style.opacity = '1';
    actions.style.pointerEvents = 'auto';
    actions.style.transform = 'translateY(0)';
  }

  const humanBtn = document.createElement('button');
  humanBtn.type = 'button';
  humanBtn.className = 'bot-action-btn bot-action-whitelist';
  humanBtn.textContent = 'Human';
  humanBtn.title = `Mark @${resolvedUsername} as human (whitelist)`;
  humanBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    await window.BotCache?.addToWhitelist?.(resolvedUsername);
    const verdict = {
      isBot: false,
      isSlop: false,
      confidence: 0.99,
      category: 'genuine',
      reason: 'You marked this account as human',
      signals: ['user_override_human'],
      source: 'override',
      trustTier: 'override_human',
    };
    window.BotCache?.saveBotCache?.(resolvedUsername, verdict);
    showToast(`@${resolvedUsername} marked human`);
    applyOverrideEverywhere(resolvedUsername, verdict, 'whitelisted');
  });

  const botBtn = document.createElement('button');
  botBtn.type = 'button';
  botBtn.className = 'bot-action-btn bot-action-block';
  botBtn.textContent = 'Bot';
  botBtn.title = `Mark @${resolvedUsername} as bot`;
  botBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    await window.BotCache?.setOverride?.(resolvedUsername, {
      forceBot: true,
      forceHuman: false,
      forceSlop: false,
    });
    const verdict = window.BotCache?.getOverrideVerdict?.(resolvedUsername);
    if (verdict) window.BotCache?.saveBotCache?.(resolvedUsername, verdict);
    showToast(`@${resolvedUsername} marked bot`);
    applyOverrideEverywhere(resolvedUsername, verdict, 'bot');
  });

  const slopBtn = document.createElement('button');
  slopBtn.type = 'button';
  slopBtn.className = 'bot-action-btn';
  slopBtn.textContent = 'Slop';
  slopBtn.title = `Mark @${resolvedUsername} as slop (not bot)`;
  slopBtn.style.color = '#c084fc';
  slopBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    await window.BotCache?.setOverride?.(resolvedUsername, {
      forceSlop: true,
      forceBot: false,
      forceHuman: false,
    });
    const verdict = window.BotCache?.getOverrideVerdict?.(resolvedUsername);
    if (verdict) window.BotCache?.saveBotCache?.(resolvedUsername, verdict);
    showToast(`@${resolvedUsername} marked slop`);
    applyOverrideEverywhere(resolvedUsername, verdict, 'slop');
  });

  const blockBtn = document.createElement('button');
  blockBtn.type = 'button';
  blockBtn.className = 'bot-action-btn bot-action-block';
  blockBtn.textContent = 'Block';
  blockBtn.title = `Block @${resolvedUsername} on X`;
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

  actions.appendChild(humanBtn);
  actions.appendChild(botBtn);
  actions.appendChild(slopBtn);
  actions.appendChild(blockBtn);

  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  container.insertBefore(actions, container.firstChild);

  // Auto-hide forced feedback bar
  if (forceShow) {
    setTimeout(() => {
      if (actions.isConnected && !container.matches(':hover')) {
        actions.style.opacity = '';
        actions.style.pointerEvents = '';
      }
    }, 4000);
  }
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
  document.querySelectorAll('.bot-reply-dimmed, .bot-reply-slop, .bot-reply-container, .bot-reply-flagged, .bot-reply-flagged-medium, .bot-reply-flagged-slop').forEach(el => {
    el.classList.remove('bot-reply-dimmed', 'bot-reply-slop', 'bot-reply-container', 'bot-reply-flagged', 'bot-reply-flagged-medium', 'bot-reply-flagged-slop');
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
