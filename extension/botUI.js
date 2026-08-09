// Bot Detection UI Components
// Compact, X-native chips — vanilla CSS only, layout-safe

// ============================================================================
// Styles — small inline pills that sit in the username row
// ============================================================================

const BOT_UI_STYLES = `
/* Injected chip system — content-sized, X-density, layout-safe */
:root {
  --xat-chip-h: 18px;
  --xat-chip-fs: 11px;
  --xat-chip-pad-x: 6px;
  --xat-chip-gap: 3px;
  --xat-chip-radius: 999px;
  --xat-font: TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --xat-muted: #71767b;
  --xat-danger: #f4212e;
  --xat-warn: #ffad1f;
  --xat-warn-text: #d97706;
  --xat-success: #00ba7c;
  --xat-slop: #c084fc;
  --xat-slop-bar: #a855f7;
  --xat-trust: #1d9bf0;
}

/*
 * Shared host for flag + bot chips — lives on the *first line* of User-Name
 * (same flex row as display name / verified), never as a column flex child
 * under the whole User-Name block (that pushes chips under the name).
 */
.xat-chip-host {
  box-sizing: border-box;
  display: inline-flex !important;
  flex-direction: row !important;
  flex: 0 0 auto !important;
  flex-grow: 0 !important;
  flex-shrink: 0 !important;
  align-items: center !important;
  align-self: center !important;
  justify-content: flex-start;
  gap: 2px;
  margin: 0 0 0 2px;
  padding: 0;
  width: max-content !important;
  max-width: max-content !important;
  min-width: 0;
  height: auto;
  max-height: var(--xat-chip-h);
  line-height: 1;
  white-space: nowrap !important;
  vertical-align: middle;
  overflow: visible;
  pointer-events: auto;
  /* Stay in flow with name; never stretch full row width */
  position: static !important;
  float: none !important;
  clear: none !important;
}

/* Never let X flex rows stretch chips to full name width */
.bot-badge,
.bot-hide-btn,
.bot-skeleton,
.bot-checked,
.xat-chip-host > * {
  box-sizing: border-box;
  flex: 0 0 auto !important;
  flex-grow: 0 !important;
  flex-shrink: 0 !important;
  align-self: center !important;
  width: max-content !important;
  max-width: max-content !important;
  min-width: 0;
  font-family: var(--xat-font);
  -webkit-font-smoothing: antialiased;
}

.bot-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: var(--xat-chip-h);
  min-height: var(--xat-chip-h);
  margin: 0; /* host gap handles spacing next to flag */
  padding: 0 var(--xat-chip-pad-x);
  border-radius: var(--xat-chip-radius);
  border: 1px solid transparent;
  font-size: var(--xat-chip-fs);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  letter-spacing: 0.01em;
  vertical-align: middle;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  user-select: none;
  transition: filter 0.12s ease, background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;
}

.bot-badge:hover { filter: brightness(1.08); }
.bot-badge:focus-visible {
  outline: 2px solid var(--xat-trust);
  outline-offset: 1px;
}

@keyframes bot-badge-enter {
  from { opacity: 0; transform: translateY(1px); }
  to { opacity: 1; transform: translateY(0); }
}
.bot-badge-enter { animation: bot-badge-enter 0.14s ease-out both; }

.bot-badge-high {
  background: rgba(244, 33, 46, 0.16);
  border-color: rgba(244, 33, 46, 0.45);
  color: var(--xat-danger);
}
.bot-badge-medium {
  background: rgba(255, 173, 31, 0.16);
  border-color: rgba(255, 173, 31, 0.45);
  color: var(--xat-warn-text);
}
.bot-badge-low {
  background: rgba(113, 118, 123, 0.14);
  border-color: rgba(113, 118, 123, 0.35);
  color: var(--xat-muted);
}
.bot-badge-human {
  background: rgba(0, 186, 124, 0.12);
  border-color: rgba(0, 186, 124, 0.35);
  color: var(--xat-success);
}
.bot-badge-slop {
  background: rgba(168, 85, 247, 0.14);
  border-color: rgba(168, 85, 247, 0.45);
  color: var(--xat-slop);
}
.bot-badge-trust {
  background: rgba(29, 155, 240, 0.12);
  border-color: rgba(29, 155, 240, 0.35);
  color: var(--xat-trust);
}
.bot-badge-pending {
  background: rgba(113, 118, 123, 0.12);
  border-color: rgba(113, 118, 123, 0.25);
  color: var(--xat-muted);
  min-width: 28px !important;
  width: 28px !important;
  max-width: 28px !important;
  padding: 0;
  cursor: default;
}
/* Unknown / failed classify — not a human score of 0 */
.bot-badge-unknown {
  background: rgba(113, 118, 123, 0.14);
  border-color: rgba(113, 118, 123, 0.4);
  color: var(--xat-muted);
  min-width: 28px !important;
  max-width: max-content !important;
  cursor: pointer;
}

.bot-hide-btn {
  display: inline-flex;
  align-items: center;
  height: var(--xat-chip-h);
  margin: 0 0 0 var(--xat-chip-gap);
  padding: 0 7px;
  border-radius: var(--xat-chip-radius);
  border: 1px solid rgba(113, 118, 123, 0.35);
  background: rgba(15, 20, 25, 0.04);
  color: var(--xat-muted);
  font-size: var(--xat-chip-fs);
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

/* Dim / accent — no layout reflow */
.bot-reply-dimmed {
  opacity: 0.32 !important;
  transition: opacity 0.18s ease;
}
.bot-reply-dimmed:hover,
.bot-reply-dimmed:focus-within { opacity: 0.72 !important; }

.bot-reply-slop {
  opacity: 0.55 !important;
  transition: opacity 0.18s ease;
}
.bot-reply-slop:hover,
.bot-reply-slop:focus-within { opacity: 0.88 !important; }

.bot-reply-flagged { box-shadow: inset 3px 0 0 var(--xat-danger) !important; }
.bot-reply-flagged-medium { box-shadow: inset 3px 0 0 var(--xat-warn) !important; }
.bot-reply-flagged-slop { box-shadow: inset 3px 0 0 var(--xat-slop-bar) !important; }

/* Quick actions — desktop hover + badge click (toggle) on touch */
.bot-actions {
  position: absolute;
  top: 8px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 0.12s ease, transform 0.12s ease;
  z-index: 50;
  pointer-events: none;
}
.bot-actions.bot-actions--open,
article[data-testid="tweet"]:hover > .bot-actions,
article[data-testid="tweet"]:focus-within > .bot-actions {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

/* Touch / narrow: always-open only when --open (no hover); keep near content */
@media (hover: none), (max-width: 500px) {
  .bot-actions {
    top: auto;
    bottom: 8px;
    right: 12px;
    left: auto;
  }
  /* Without hover, never leave a half-visible bar that can't dismiss */
  article[data-testid="tweet"]:hover > .bot-actions:not(.bot-actions--open),
  article[data-testid="tweet"]:focus-within > .bot-actions:not(.bot-actions--open) {
    opacity: 0;
    pointer-events: none;
  }
}

.bot-action-btn {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--xat-chip-radius);
  border: 1px solid rgba(113, 118, 123, 0.4);
  background: rgba(0, 0, 0, 0.78);
  color: #e7e9ea;
  font-family: var(--xat-font);
  font-size: 12px;
  font-weight: 650;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.bot-action-btn:focus-visible {
  outline: 2px solid var(--xat-trust);
  outline-offset: 1px;
}
.bot-action-whitelist { color: var(--xat-success); }
.bot-action-whitelist:hover {
  background: rgba(0, 186, 124, 0.2);
  border-color: rgba(0, 186, 124, 0.55);
  color: var(--xat-success);
}
.bot-action-block { color: var(--xat-danger); }
.bot-action-block:hover {
  background: rgba(244, 33, 46, 0.18);
  border-color: rgba(244, 33, 46, 0.55);
  color: var(--xat-danger);
}
.bot-action-close {
  min-width: 28px;
  padding: 0 8px;
  color: var(--xat-muted);
  font-weight: 700;
}
.bot-action-close:hover {
  background: rgba(113, 118, 123, 0.22);
  border-color: rgba(113, 118, 123, 0.5);
  color: #e7e9ea;
}

.bot-toast {
  position: fixed;
  bottom: max(24px, env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  max-width: min(90vw, 360px);
  padding: 10px 16px;
  border-radius: var(--xat-chip-radius);
  border: 1px solid rgba(113, 118, 123, 0.35);
  background: rgba(15, 20, 25, 0.94);
  color: #e7e9ea;
  font-family: var(--xat-font);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.25;
  text-align: center;
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

@keyframes bot-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.bot-skeleton {
  display: inline-block;
  width: 30px !important;
  max-width: 30px !important;
  min-width: 30px !important;
  height: 14px;
  margin: 0 0 0 var(--xat-chip-gap);
  vertical-align: middle;
  border-radius: var(--xat-chip-radius);
  background: linear-gradient(
    90deg,
    rgba(113, 118, 123, 0.12) 0%,
    rgba(113, 118, 123, 0.28) 50%,
    rgba(113, 118, 123, 0.12) 100%
  );
  background-size: 200% 100%;
  animation: bot-shimmer 1.2s ease-in-out infinite;
}

.bot-checked {
  display: inline-block;
  width: 6px !important;
  max-width: 6px !important;
  min-width: 6px !important;
  height: 6px;
  margin: 0 0 0 var(--xat-chip-gap);
  border-radius: 50%;
  background: var(--xat-success);
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

/** True when classify failed / conf=0 placeholder — not a real human score. */
function isUnknownVerdict(verdict) {
  if (!verdict || verdict.isBot === 'pending') return false;
  if (verdict.unknown === true || verdict.source === 'fallback') return true;
  // Zero-confidence non-bot without trust/override = unusable (was rendering as green ✓0)
  const conf = Number(verdict.confidence);
  if (verdict.isBot || verdict.isSlop) return false;
  if (
    verdict.source === 'trust' ||
    verdict.source === 'override' ||
    verdict.trustTier === 'mutual' ||
    verdict.trustTier === 'following' ||
    verdict.trustTier === 'whitelist' ||
    verdict.trustTier === 'override_human'
  ) {
    return false;
  }
  return !Number.isFinite(conf) || conf <= 0;
}

function buildTooltip(verdict) {
  const conf = Math.round((verdict.confidence || 0) * 100);
  const lines = [];

  if (isUnknownVerdict(verdict)) {
    lines.push('Score unavailable');
  } else if (verdict.isBot) {
    lines.push(`${conf}% bot confidence`);
  } else if (verdict.isSlop) {
    lines.push(`${conf}% slop confidence (human, low-info)`);
  } else {
    lines.push(`${conf}% human confidence`);
  }

  if (verdict.category && verdict.category !== 'genuine' && !isUnknownVerdict(verdict)) {
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

  lines.push('Click badge to toggle feedback');

  return lines.join('\n');
}

function createBotBadge(verdict, animate = true) {
  const badge = document.createElement('span');
  badge.setAttribute('data-bot-badge', 'true');
  badge.setAttribute('role', 'button');
  badge.tabIndex = 0;

  // Compact fixed vocabulary: color = class, text = score (or short tag).
  // Avoids long labels that reflow the name row on mobile Safari.
  const conf = Math.round((verdict.confidence || 0) * 100);
  let severity = 'pending';
  let text = '···';
  let title = 'Analyzing…';

  if (verdict.isBot === 'pending') {
    severity = 'pending';
    text = '···';
    title = 'Analyzing…';
    badge.tabIndex = -1;
    badge.removeAttribute('role');
  } else if (isUnknownVerdict(verdict)) {
    // Never show green ✓0 — that looked like "100% human with score zero"
    severity = 'unknown';
    text = '?';
    title = buildTooltip(verdict);
  } else if (
    verdict.source === 'trust' ||
    verdict.trustTier === 'following' ||
    verdict.trustTier === 'mutual' ||
    verdict.trustTier === 'whitelist'
  ) {
    severity = 'trust';
    // Mutuals: compact mark; following/whitelist share trust styling
    text = verdict.trustTier === 'mutual' ? `↔${conf}` : `✓${conf}`;
    title = buildTooltip(verdict);
  } else if (verdict.isBot) {
    severity = getSeverityLevel(verdict.confidence || 0);
    text = String(conf);
    title = buildTooltip(verdict);
  } else if (verdict.isSlop) {
    severity = 'slop';
    text = `s${conf}`;
    title = buildTooltip(verdict);
  } else {
    severity = 'human';
    text = `✓${conf}`;
    title = buildTooltip(verdict);
  }

  badge.textContent = text;
  badge.title = title;
  badge.setAttribute('aria-label', title.split('\n')[0] || 'Bot score');
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
// Reply Element Processing + first-line chip host
// ============================================================================

function getReplyContainer(element) {
  return element.closest('article[data-testid="tweet"]') || element;
}

/** Resolve User-Name root whether `from` is the root, an ancestor, or a child. */
function getUserNameRoot(from) {
  if (!from) return null;
  if (from.matches?.('[data-testid="UserName"], [data-testid="User-Name"]')) return from;
  return (
    from.querySelector?.('[data-testid="UserName"], [data-testid="User-Name"]') ||
    from.closest?.('[data-testid="UserName"], [data-testid="User-Name"]') ||
    null
  );
}

function isHandleLink(link) {
  if (!link) return false;
  if (link.querySelector('time')) return true;
  const text = String(link.textContent || '').trim();
  return text.startsWith('@');
}

function hrefMatchesScreen(link, screenName) {
  if (!screenName) return true;
  const href = link.getAttribute('href') || '';
  const name = String(screenName).replace(/^@/, '');
  return href === `/${name}` || href.startsWith(`/${name}?`) || href.startsWith(`/${name}/`);
}

/**
 * Display-name <a> on the first line — never the @handle or time link.
 */
function findDisplayNameLink(userNameRoot, screenName) {
  if (!userNameRoot) return null;
  const links = userNameRoot.querySelectorAll('a[href^="/"]');
  let fallback = null;
  for (const link of links) {
    if (isHandleLink(link)) continue;
    if (!hrefMatchesScreen(link, screenName) && screenName) {
      // Keep as weak fallback if no exact match
      if (!fallback) fallback = link;
      continue;
    }
    return link;
  }
  return fallback;
}

function findHandleLink(userNameRoot, screenName) {
  if (!userNameRoot) return null;
  for (const link of userNameRoot.querySelectorAll('a[href^="/"]')) {
    if (!isHandleLink(link)) continue;
    if (hrefMatchesScreen(link, screenName)) return link;
  }
  return null;
}

function isFlexRow(el) {
  if (!el || el.nodeType !== 1) return false;
  try {
    const s = window.getComputedStyle(el);
    const d = s.display || '';
    if (d !== 'flex' && d !== 'inline-flex') return false;
    const dir = s.flexDirection || 'row';
    return dir === 'row' || dir === 'row-reverse';
  } catch {
    return false;
  }
}

/**
 * Innermost flex *row* that contains the display name — the true first line of the card.
 * Avoids column User-Name wrappers that would stack chips under the name.
 */
function findFirstLineRow(displayNameLink, userNameRoot) {
  if (!displayNameLink) return null;
  let el = displayNameLink.parentElement;
  let innermostRow = null;
  while (el && el !== userNameRoot) {
    if (isFlexRow(el)) innermostRow = el;
    el = el.parentElement;
  }
  // Prefer innermost row that still has horizontal room for siblings
  if (innermostRow) return innermostRow;
  return displayNameLink.parentElement;
}

/** Direct child of `row` that contains `node`. */
function directChildContaining(row, node) {
  if (!row || !node || !row.contains(node)) return null;
  let child = node;
  while (child.parentElement && child.parentElement !== row) {
    child = child.parentElement;
  }
  return child.parentElement === row ? child : null;
}

function isDecorOnly(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.matches?.('[data-xat-chip-host], [data-bot-badge], [data-bot-skeleton], [data-twitter-flag], [data-twitter-flag-shimmer], [data-bot-hide-btn]')) {
    return false;
  }
  // Verified / private lock icons — svg wrappers with no profile links
  if (el.tagName === 'svg' || el.querySelector?.(':scope > svg, svg')) {
    if (!el.querySelector?.('a[href^="/"]')) return true;
  }
  return false;
}

/**
 * Ensure a single inline host on the first line:
 * [DisplayName] [Verified] [host: flag + badge] [@handle] [time]
 */
function ensureChipHost(userNameRoot, screenName) {
  if (!userNameRoot) return null;
  injectBotStyles();

  const existing = userNameRoot.querySelector('[data-xat-chip-host]');
  if (existing && userNameRoot.contains(existing)) {
    // Re-home if a previous insert landed under a column wrapper
    if (!isHostOnFirstLine(existing, userNameRoot, screenName)) {
      placeChipHost(existing, userNameRoot, screenName);
    }
    return existing;
  }

  const host = document.createElement('span');
  host.setAttribute('data-xat-chip-host', 'true');
  host.className = 'xat-chip-host';
  host.setAttribute('aria-hidden', 'false');
  placeChipHost(host, userNameRoot, screenName);
  return host;
}

function isHostOnFirstLine(host, userNameRoot, screenName) {
  const nameLink = findDisplayNameLink(userNameRoot, screenName);
  if (!nameLink) return userNameRoot.contains(host);
  const row = findFirstLineRow(nameLink, userNameRoot);
  return row ? row.contains(host) : nameLink.parentElement?.contains(host);
}

function placeChipHost(host, userNameRoot, screenName) {
  const nameLink = findDisplayNameLink(userNameRoot, screenName);
  if (!nameLink) {
    // Last resort: still try not to full-width stack — inline at start of root
    try {
      userNameRoot.insertBefore(host, userNameRoot.firstChild);
    } catch {
      userNameRoot.appendChild(host);
    }
    return;
  }

  const row = findFirstLineRow(nameLink, userNameRoot);
  const handleLink = findHandleLink(userNameRoot, screenName);

  // Prefer: same row as display name, after name+verified, before @handle when co-located
  if (row) {
    const nameChild = directChildContaining(row, nameLink);
    const handleChild =
      handleLink && row.contains(handleLink) ? directChildContaining(row, handleLink) : null;

    if (nameChild) {
      let insertAfter = nameChild;
      let next = nameChild.nextElementSibling;
      while (next && next !== handleChild && isDecorOnly(next)) {
        insertAfter = next;
        next = next.nextElementSibling;
      }
      // If handle is on this row, sit just before it
      if (handleChild && insertAfter.nextElementSibling === handleChild) {
        handleChild.before(host);
        return;
      }
      if (handleChild && row.contains(handleChild) && insertAfter.compareDocumentPosition(handleChild) & Node.DOCUMENT_POSITION_FOLLOWING) {
        // insert between decor and handle
        insertAfter.after(host);
        return;
      }
      insertAfter.after(host);
      return;
    }
  }

  // Fallback: after display name link (and trailing verified sibling)
  let anchor = nameLink;
  let sib = nameLink.nextElementSibling;
  while (sib && isDecorOnly(sib)) {
    anchor = sib;
    sib = sib.nextElementSibling;
  }
  try {
    anchor.after(host);
  } catch {
    nameLink.parentElement?.appendChild(host);
  }
}

/**
 * Insert flag or bot chip into the shared first-line host (stable order).
 * kind: 'flag' | 'shimmer' | 'badge' | 'skeleton' | 'hide'
 */
function insertIntoChipHost(userNameRootOrFrom, el, screenName, kind = 'badge') {
  const root = getUserNameRoot(userNameRootOrFrom);
  if (!root || !el) return false;

  // Dedupe same-kind nodes outside host
  if (kind === 'badge' || kind === 'skeleton') {
    root.querySelectorAll('[data-bot-badge], [data-bot-skeleton]').forEach((n) => {
      if (n !== el) n.remove();
    });
  }
  if (kind === 'flag' || kind === 'shimmer') {
    root.querySelectorAll('[data-twitter-flag], [data-twitter-flag-shimmer]').forEach((n) => {
      if (n !== el) n.remove();
    });
  }

  const host = ensureChipHost(root, screenName);
  if (!host) return false;

  try {
    if (kind === 'flag' || kind === 'shimmer') {
      // Flags leftmost inside host
      const firstBadge = host.querySelector(
        '[data-bot-badge], [data-bot-skeleton], [data-bot-hide-btn], .bot-badge, .bot-skeleton',
      );
      if (firstBadge) firstBadge.before(el);
      else host.insertBefore(el, host.firstChild);
    } else if (kind === 'hide') {
      host.appendChild(el);
    } else {
      // badge / skeleton after flags
      const hideBtn = host.querySelector('[data-bot-hide-btn]');
      if (hideBtn) hideBtn.before(el);
      else host.appendChild(el);
    }
    return true;
  } catch {
    return false;
  }
}

function findHandleSection(container, screenName) {
  if (!screenName) return null;
  return Array.from(container.querySelectorAll('div')).find(div => {
    const link = div.querySelector(`a[href="/${screenName}"]`);
    return link && link.textContent?.trim() === `@${screenName}`;
  });
}

function insertBotBadge(container, badge, screenName) {
  // Layout: first line of card — [Name] [Verified] [flag][badge] [@handle] …
  return insertIntoChipHost(container, badge, screenName, 'badge');
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
  
  // ALWAYS show a score badge (human, slop, bot, or unknown)
  if (userNameContainer) {
    const badge = createBotBadge(verdict, true);
    const toggleActions = (e) => {
      e.stopPropagation();
      e.preventDefault();
      // Badge click toggles the action bar open/closed (especially on touch)
      toggleQuickActions(container, resolvedUsername);
    };
    badge.addEventListener('click', toggleActions);
    badge.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') toggleActions(e);
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
        const hideBtn = createHideAgainButton(container);
        if (badge && window.BotUI?.insertIntoChipHost) {
          insertIntoChipHost(container, hideBtn, resolvedUsername, 'hide');
        } else if (badge?.parentElement) {
          badge.parentElement.insertBefore(hideBtn, badge.nextSibling);
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
  hideQuickActions(container);
  container.querySelector('[data-bot-badge]')?.remove();
  container.querySelector('[data-bot-hide-btn]')?.remove();
  container.querySelector('[data-bot-skeleton]')?.remove();
  container.querySelector('[data-bot-checked]')?.remove();
  // Drop empty chip host only when no location flag remains
  const host = container.querySelector('[data-xat-chip-host]');
  if (host && !host.querySelector('[data-twitter-flag], [data-twitter-flag-shimmer]')) {
    host.remove();
  }

  container.classList.remove(
    'bot-reply-dimmed', 'bot-reply-container', 'bot-reply-slop',
    'bot-reply-flagged', 'bot-reply-flagged-medium', 'bot-reply-flagged-slop'
  );

  container.style.removeProperty('position');
  delete container.dataset.botVerdict;
  delete container.dataset.botActionsOpen;
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

function clearActionsAutoHide(actions) {
  const tid = Number(actions?.dataset?.hideTimer);
  if (tid) {
    clearTimeout(tid);
    delete actions.dataset.hideTimer;
  }
}

function hideQuickActions(container) {
  if (!container) return;
  const actions = container.querySelector('.bot-actions');
  if (actions) {
    clearActionsAutoHide(actions);
    actions.remove();
  }
  delete container.dataset.botActionsOpen;
}

function isQuickActionsOpen(container) {
  return Boolean(
    container?.dataset?.botActionsOpen === '1' ||
      container?.querySelector?.('.bot-actions.bot-actions--open')
  );
}

/** Badge click path: open if closed, close if open. */
function toggleQuickActions(container, username) {
  if (isQuickActionsOpen(container)) {
    hideQuickActions(container);
    return;
  }
  addQuickActions(container, username, true);
}

function addQuickActions(container, username, forceShow = false) {
  // forceShow=true is the explicit open path (badge tap). If already open, close.
  if (forceShow && isQuickActionsOpen(container)) {
    hideQuickActions(container);
    return;
  }

  container.querySelector('.bot-actions')?.remove();
  delete container.dataset.botActionsOpen;

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
  actions.className = forceShow ? 'bot-actions bot-actions--open' : 'bot-actions';
  if (forceShow) container.dataset.botActionsOpen = '1';

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

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'bot-action-btn bot-action-close';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Hide actions';
  closeBtn.setAttribute('aria-label', 'Hide actions');
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    hideQuickActions(container);
  });

  actions.appendChild(humanBtn);
  actions.appendChild(botBtn);
  actions.appendChild(slopBtn);
  actions.appendChild(blockBtn);
  actions.appendChild(closeBtn);

  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  container.insertBefore(actions, container.firstChild);

  // Auto-hide forced-open bar (touch) after idle — removes bar entirely so it can reopen cleanly
  if (forceShow) {
    const tid = setTimeout(() => {
      if (!actions.isConnected) return;
      // Keep open while user is actively hovering the bar/tweet (desktop)
      if (container.matches(':hover') || actions.matches(':hover')) {
        // Re-arm once more
        const again = setTimeout(() => {
          if (actions.isConnected) hideQuickActions(container);
        }, 4000);
        actions.dataset.hideTimer = String(again);
        return;
      }
      hideQuickActions(container);
    }, 6000);
    actions.dataset.hideTimer = String(tid);
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
    isUnknownVerdict,
    hideQuickActions,
    toggleQuickActions,
    addQuickActions,
    getUserNameRoot,
    ensureChipHost,
    insertIntoChipHost,
    insertBotBadge,
    findDisplayNameLink,
    CATEGORY_LABELS,
  };
}
