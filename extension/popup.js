// Popup script for extension toggle
const TOGGLE_KEY = 'extension_enabled';
const DEFAULT_ENABLED = true;
const STATS_KEY = 'location_stats';

// Bot Detection Keys
const BOT_TOGGLE_KEY = 'bot_detection_enabled';
const BOT_SENSITIVITY_KEY = 'bot_sensitivity';
const BOT_WHITELIST_KEY = 'bot_whitelist';
const BOT_CACHE_KEY = 'bot_verdict_cache';

const SENSITIVITY_LABELS = ['Very Lenient', 'Lenient', 'Medium', 'Aggressive', 'Very Aggressive'];

// ============================================================================
// Tab Navigation (roving tabindex + arrow keys)
// ============================================================================

const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
const tabPanels = Array.from(document.querySelectorAll('[role="tabpanel"]'));

function activateTab(tab) {
  const targetId = tab.dataset.tab;
  tabs.forEach((t) => {
    const selected = t === tab;
    t.setAttribute('aria-selected', selected ? 'true' : 'false');
    t.tabIndex = selected ? 0 : -1;
  });
  tabPanels.forEach((panel) => {
    const active = panel.id === `tab-${targetId}`;
    panel.classList.toggle('active', active);
    if (active) {
      panel.removeAttribute('hidden');
    } else {
      panel.setAttribute('hidden', '');
    }
  });
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (e) => {
    const idx = tabs.indexOf(tab);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      tabs[next].focus();
      activateTab(tabs[next]);
    }
  });
});

// ============================================================================
// Location Tab
// ============================================================================

// Get toggle element
const toggleSwitch = document.getElementById('toggleSwitch');
const status = document.getElementById('status');
const statsTotal = document.getElementById('statsTotal');
const statsList = document.getElementById('statsList');
const resetStatsBtn = document.getElementById('resetStatsBtn');

// Load current state and statistics
chrome.storage.local.get([TOGGLE_KEY, STATS_KEY], (result) => {
  const isEnabled = result[TOGGLE_KEY] !== undefined ? result[TOGGLE_KEY] : DEFAULT_ENABLED;
  updateToggle(isEnabled);
  loadAndDisplayStats(result[STATS_KEY]);
});

// Listen for storage changes to update stats in real-time
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes[STATS_KEY]) {
      loadAndDisplayStats(changes[STATS_KEY].newValue);
    }
    if (changes[BOT_CACHE_KEY]) {
      loadBotStats();
    }
    if (changes[BOT_WHITELIST_KEY]) {
      loadWhitelist();
    }
  }
});

// Toggle click handler
toggleSwitch.addEventListener('click', () => {
  chrome.storage.local.get([TOGGLE_KEY], (result) => {
    const currentState = result[TOGGLE_KEY] !== undefined ? result[TOGGLE_KEY] : DEFAULT_ENABLED;
    const newState = !currentState;
    
    chrome.storage.local.set({ [TOGGLE_KEY]: newState }, () => {
      updateToggle(newState);
      
      // Notify content script to update
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'extensionToggle',
            enabled: newState
          }).catch(() => {
            // Tab might not have content script loaded yet, that's okay
          });
        }
      });
    });
  });
});

function updateToggle(isEnabled) {
  toggleSwitch.setAttribute('aria-checked', isEnabled ? 'true' : 'false');
  status.textContent = isEnabled ? 'Flags are on' : 'Flags are off';
  status.className = isEnabled ? 'meta meta--center meta--primary' : 'meta meta--center';
}

// Load and display statistics
function loadAndDisplayStats(stats) {
  if (!stats || Object.keys(stats).length === 0) {
    statsTotal.textContent = 'No profiles tracked yet';
    statsList.innerHTML = '<p class="empty">Browse X to see location stats</p>';
    return;
  }

  const total = Object.values(stats).reduce((sum, count) => sum + count, 0);
  statsTotal.textContent = `${total} unique profile${total !== 1 ? 's' : ''}`;

  const sorted = Object.entries(stats).sort((a, b) => b[1] - a[1]);

  statsList.innerHTML = sorted.map(([location, count]) => {
    const flag = getCountryFlag(location);
    const displayFlag = flag || '';
    const displayLocation = flag ? location : `(${location})`;

    return `
      <div class="list-row">
        <span class="list-muted">${displayFlag} ${displayLocation}</span>
        <span class="list-strong">${count}</span>
      </div>
    `;
  }).join('');
}

// Reset statistics
resetStatsBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to reset all statistics? This cannot be undone.')) {
    // Clear stats from storage
    chrome.storage.local.remove(STATS_KEY, () => {
      // Notify content script to clear in-memory stats
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'resetStats'
          }).catch(() => {
            // Tab might not have content script loaded yet, that's okay
          });
        }
      });
      
      // Refresh display
      loadAndDisplayStats(null);
    });
  }
});

// ============================================================================
// Mute / Block manager (Tools)
// ============================================================================

const MB = typeof window !== 'undefined' ? window.MuteBlock : null;
let mbState = null;
let mbPendingSuggestions = [];

const mbStatus = document.getElementById('mbStatus');
const mbHideSwitch = document.getElementById('mbHideSwitch');

function setMbStatus(text, kind = '') {
  if (!mbStatus) return;
  mbStatus.textContent = text || '';
  mbStatus.className = 'meta meta--center' + (kind === 'ok' ? ' meta--success' : kind === 'err' ? ' meta--danger' : '');
}

function renderChipList(container, items, { labelKey, prefix = '' }) {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = '<p class="empty">Empty</p>';
    return;
  }
  container.innerHTML = items
    .map((item) => {
      const label = prefix + (item[labelKey] || '');
      const src = item.source || 'manual';
      return `<label class="chip-row">
        <input type="checkbox" data-id="${item.id}" />
        <span class="chip-term" title="${label}">${label}</span>
        <span class="chip-src">${src}</span>
      </label>`;
    })
    .join('');
}

function selectedIds(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(
    (el) => el.dataset.id,
  );
}

async function refreshMuteBlockUI() {
  if (!MB) return;
  mbState = await MB.loadMuteBlockState();
  renderChipList(document.getElementById('mbWordsList'), mbState.muteWords, {
    labelKey: 'term',
  });
  renderChipList(document.getElementById('mbMuteAccList'), mbState.muteAccounts, {
    labelKey: 'username',
    prefix: '@',
  });
  renderChipList(document.getElementById('mbBlockAccList'), mbState.blockAccounts, {
    labelKey: 'username',
    prefix: '@',
  });
  if (mbHideSwitch) {
    const on = mbState.settings?.hideMatchingTweets !== false;
    mbHideSwitch.classList.toggle('on', on);
    mbHideSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
  }
}

// Subtabs
document.querySelectorAll('.subtab[data-mb]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.mb;
    document.querySelectorAll('.subtab[data-mb]').forEach((b) => {
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });
    document.querySelectorAll('.mb-panel').forEach((p) => {
      p.classList.toggle('active', p.id === `mb-panel-${id}`);
    });
  });
});

document.getElementById('mbAddWordsBtn')?.addEventListener('click', async () => {
  if (!MB) return;
  const ta = document.getElementById('mbBulkWords');
  const { words, accounts } = MB.parseBulkInput(ta?.value || '', { prefer: 'words' });
  const w = await MB.addMuteWords(words, 'manual');
  let a = { added: 0 };
  if (accounts.length) a = await MB.addMuteAccounts(accounts, 'manual');
  if (ta) ta.value = '';
  await refreshMuteBlockUI();
  setMbStatus(`Added ${w.added} word(s)${a.added ? `, ${a.added} account(s)` : ''}`, 'ok');
  notifyMuteBlockUpdated();
});

document.getElementById('mbStemBtn')?.addEventListener('click', async () => {
  if (!MB) return;
  const ids = selectedIds(document.getElementById('mbWordsList'));
  const { added } = await MB.expandStems(ids.length ? ids : null);
  await refreshMuteBlockUI();
  setMbStatus(
    added
      ? `Stem expand added ${added} variant(s)`
      : 'No new stem variants (select seeds or add packs like crypto, airdrop)',
    added ? 'ok' : '',
  );
  notifyMuteBlockUpdated();
});

document.getElementById('mbSuggestBtn')?.addEventListener('click', async () => {
  if (!MB) return;
  const seed =
    document.getElementById('mbSuggestSeed')?.value?.trim() ||
    document.getElementById('mbBulkWords')?.value?.trim()?.split(/[\n,]/)[0] ||
    '';
  if (!seed) {
    setMbStatus('Enter a seed word to suggest', 'err');
    return;
  }
  setMbStatus('Suggesting…');
  const { suggestions, source } = await MB.suggestFromSeed(seed, { useAi: true, limit: 16 });
  mbPendingSuggestions = suggestions;
  const box = document.getElementById('mbSuggestList');
  if (!box) return;
  if (!suggestions.length) {
    box.hidden = true;
    setMbStatus('No suggestions', 'err');
    return;
  }
  box.hidden = false;
  box.innerHTML = suggestions
    .map(
      (s) =>
        `<button type="button" class="suggest-chip" data-term="${s.replace(/"/g, '&quot;')}">+ ${s}</button>`,
    )
    .join('');
  box.querySelectorAll('.suggest-chip').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const term = chip.dataset.term;
      await MB.addMuteWords([term], source === 'ai' ? 'ai' : 'stem');
      chip.remove();
      await refreshMuteBlockUI();
      notifyMuteBlockUpdated();
      setMbStatus(`Added “${term}”`, 'ok');
    });
  });
  setMbStatus(`${suggestions.length} suggestions (${source}) — click to add`, 'ok');
});

document.getElementById('mbRemoveWordsBtn')?.addEventListener('click', async () => {
  if (!MB) return;
  const ids = selectedIds(document.getElementById('mbWordsList'));
  if (!ids.length) {
    setMbStatus('Select words to remove', 'err');
    return;
  }
  await MB.removeByIds('words', ids);
  await refreshMuteBlockUI();
  setMbStatus(`Removed ${ids.length}`, 'ok');
  notifyMuteBlockUpdated();
});

document.getElementById('mbClearWordsBtn')?.addEventListener('click', async () => {
  if (!MB || !confirm('Clear all mute words?')) return;
  await MB.clearList('words');
  await refreshMuteBlockUI();
  setMbStatus('Words cleared', 'ok');
  notifyMuteBlockUpdated();
});

document.getElementById('mbAddMuteAccBtn')?.addEventListener('click', async () => {
  if (!MB) return;
  const ta = document.getElementById('mbBulkMuteAcc');
  const { accounts, words } = MB.parseBulkInput(ta?.value || '', { prefer: 'accounts' });
  const handles = [...accounts, ...words.map((w) => MB.normalizeUsername(w)).filter(Boolean)];
  const { added } = await MB.addMuteAccounts(handles, 'manual');
  if (ta) ta.value = '';
  await refreshMuteBlockUI();
  setMbStatus(`Muted ${added} account(s)`, 'ok');
  notifyMuteBlockUpdated();
});

document.getElementById('mbRemoveMuteAccBtn')?.addEventListener('click', async () => {
  if (!MB) return;
  const ids = selectedIds(document.getElementById('mbMuteAccList'));
  if (!ids.length) return setMbStatus('Select accounts', 'err');
  await MB.removeByIds('muteAccounts', ids);
  await refreshMuteBlockUI();
  notifyMuteBlockUpdated();
  setMbStatus(`Removed ${ids.length}`, 'ok');
});

document.getElementById('mbClearMuteAccBtn')?.addEventListener('click', async () => {
  if (!MB || !confirm('Clear all muted accounts?')) return;
  await MB.clearList('muteAccounts');
  await refreshMuteBlockUI();
  notifyMuteBlockUpdated();
  setMbStatus('Mute accounts cleared', 'ok');
});

document.getElementById('mbAddBlockAccBtn')?.addEventListener('click', async () => {
  if (!MB) return;
  const ta = document.getElementById('mbBulkBlockAcc');
  const { accounts, words } = MB.parseBulkInput(ta?.value || '', { prefer: 'accounts' });
  const handles = [...accounts, ...words.map((w) => MB.normalizeUsername(w)).filter(Boolean)];
  const { added } = await MB.addBlockAccounts(handles, 'manual');
  if (ta) ta.value = '';
  await refreshMuteBlockUI();
  setMbStatus(`Queued ${added} block(s) in list`, 'ok');
  notifyMuteBlockUpdated();
});

document.getElementById('mbRemoveBlockAccBtn')?.addEventListener('click', async () => {
  if (!MB) return;
  const ids = selectedIds(document.getElementById('mbBlockAccList'));
  if (!ids.length) return setMbStatus('Select accounts', 'err');
  await MB.removeByIds('blockAccounts', ids);
  await refreshMuteBlockUI();
  notifyMuteBlockUpdated();
  setMbStatus(`Removed ${ids.length}`, 'ok');
});

document.getElementById('mbClearBlockAccBtn')?.addEventListener('click', async () => {
  if (!MB || !confirm('Clear all block accounts?')) return;
  await MB.clearList('blockAccounts');
  await refreshMuteBlockUI();
  notifyMuteBlockUpdated();
  setMbStatus('Block list cleared', 'ok');
});

mbHideSwitch?.addEventListener('click', async () => {
  if (!MB) return;
  const on = mbHideSwitch.getAttribute('aria-checked') !== 'true';
  await MB.updateSettings({ hideMatchingTweets: on });
  mbHideSwitch.classList.toggle('on', on);
  mbHideSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
  notifyMuteBlockUpdated();
  setMbStatus(on ? 'Hiding matching tweets on timeline' : 'Timeline hide off', 'ok');
});

document.getElementById('mbApplyXBtn')?.addEventListener('click', async () => {
  if (!MB) return;
  setMbStatus('Applying…');
  try {
    const state = await MB.loadMuteBlockState();
    const words = state.muteWords.map((w) => w.term);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    if (!tab.url?.includes('x.com') && !tab.url?.includes('twitter.com')) {
      setMbStatus('Open x.com/settings/muted_keywords first', 'err');
      return;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: MB.applyMutedKeywordsOnPage,
      args: [words],
    });
    const result = results[0]?.result;
    setMbStatus(result?.message || 'Done', result?.success ? 'ok' : 'err');
  } catch (e) {
    setMbStatus('Apply failed: ' + (e.message || e), 'err');
  }
});

function notifyMuteBlockUpdated() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs
        .sendMessage(tabs[0].id, { type: 'muteBlockUpdated' })
        .catch(() => {});
    }
  });
}

// Init mute/block UI when popup opens
if (MB) {
  refreshMuteBlockUI().catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[MB.MUTE_BLOCK_KEY]) {
      refreshMuteBlockUI().catch(() => {});
    }
  });
}

// Clean Interests functionality
const cleanInterestsBtn = document.getElementById('cleanInterestsBtn');
const cleanStatus = document.getElementById('cleanStatus');

// MY_INTERESTS is loaded from myInterests.js

cleanInterestsBtn.addEventListener('click', async () => {
  cleanInterestsBtn.disabled = true;
  cleanStatus.textContent = 'Cleaning interests…';
  cleanStatus.className = 'status-line';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('No active tab found');
    }

    if (!tab.url?.includes('x.com') && !tab.url?.includes('twitter.com')) {
      cleanStatus.textContent = 'Open x.com interests settings first';
      cleanStatus.className = 'status-line meta--danger';
      cleanInterestsBtn.disabled = false;
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: cleanInterests,
      args: [MY_INTERESTS]
    });

    const result = results[0]?.result;
    if (result?.success) {
      cleanStatus.textContent = result.message;
      cleanStatus.className = 'status-line meta--success';
    } else {
      cleanStatus.textContent = result?.message || 'No interests found on this page';
      cleanStatus.className = 'status-line';
    }
  } catch (error) {
    console.error('Error:', error);
    cleanStatus.textContent = 'Error: ' + error.message;
    cleanStatus.className = 'status-line meta--danger';
  } finally {
    cleanInterestsBtn.disabled = false;
  }
});

// ============================================================================
// Bot Detection Tab
// ============================================================================

const botToggleSwitch = document.getElementById('botToggleSwitch');
const sensitivitySlider = document.getElementById('sensitivitySlider');
const sensitivityValue = document.getElementById('sensitivityValue');
const botCount = document.getElementById('botCount');
const humanCount = document.getElementById('humanCount');
const botCategories = document.getElementById('botCategories');
const botStatsEmpty = document.getElementById('botStatsEmpty');
const lookupInput = document.getElementById('lookupInput');
const lookupBtn = document.getElementById('lookupBtn');
const lookupResult = document.getElementById('lookupResult');
const whitelistList = document.getElementById('whitelistList');
const exportDataBtn = document.getElementById('exportDataBtn');
const clearAllDataBtn = document.getElementById('clearAllDataBtn');

// Category labels
const CATEGORY_LABELS = {
  engagement_farmer: 'Engagement farmer',
  sycophant: 'Sycophant',
  self_promoter: 'Self-promoter',
  airdrop_farmer: 'Airdrop farmer',
  crypto_spam: 'Crypto spam',
  llm_slop: 'LLM slop',
  genuine: 'Human',
};

// Load bot detection state
chrome.storage.local.get([BOT_TOGGLE_KEY, BOT_SENSITIVITY_KEY, BOT_WHITELIST_KEY, BOT_CACHE_KEY], (result) => {
  // Toggle
  const botEnabled = result[BOT_TOGGLE_KEY] !== false; // Default enabled
  updateBotToggle(botEnabled);
  
  // Sensitivity
  const sensitivity = result[BOT_SENSITIVITY_KEY] || 3;
  sensitivitySlider.value = sensitivity;
  sensitivityValue.textContent = SENSITIVITY_LABELS[sensitivity - 1];
  
  // Stats
  loadBotStats();
  
  // Whitelist
  loadWhitelist();
});

// Bot toggle handler
botToggleSwitch.addEventListener('click', () => {
  chrome.storage.local.get([BOT_TOGGLE_KEY], (result) => {
    const currentState = result[BOT_TOGGLE_KEY] !== false;
    const newState = !currentState;
    
    chrome.storage.local.set({ [BOT_TOGGLE_KEY]: newState }, () => {
      updateBotToggle(newState);
      
      // Notify content script
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'botDetectionToggle',
            enabled: newState
          }).catch(() => {});
        }
      });
    });
  });
});

function updateBotToggle(isEnabled) {
  botToggleSwitch.setAttribute('aria-checked', isEnabled ? 'true' : 'false');
}

// Sensitivity slider handler
sensitivitySlider.addEventListener('input', () => {
  const value = parseInt(sensitivitySlider.value);
  sensitivityValue.textContent = SENSITIVITY_LABELS[value - 1];
  
  chrome.storage.local.set({ [BOT_SENSITIVITY_KEY]: value }, () => {
    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'botSensitivityChange',
          sensitivity: value
        }).catch(() => {});
      }
    });
  });
});

// Load bot stats
function loadBotStats() {
  chrome.storage.local.get([BOT_CACHE_KEY], (result) => {
    const cache = result[BOT_CACHE_KEY] || {};
    let bots = 0;
    let humans = 0;
    const categories = {};

    for (const [, verdict] of Object.entries(cache)) {
      if (verdict.isBot) {
        bots++;
        const cat = verdict.category || 'crypto_spam';
        categories[cat] = (categories[cat] || 0) + 1;
      } else {
        humans++;
      }
    }

    botCount.textContent = bots;
    humanCount.textContent = humans;

    const hasData = bots + humans > 0;
    if (botStatsEmpty) {
      botStatsEmpty.hidden = hasData;
    }

    if (Object.keys(categories).length > 0) {
      botCategories.hidden = false;
      botCategories.innerHTML = Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, count]) => `
          <div class="list-row">
            <span class="list-muted">${CATEGORY_LABELS[cat] || cat}</span>
            <span class="list-strong">${count}</span>
          </div>
        `).join('');
    } else {
      botCategories.hidden = true;
      botCategories.innerHTML = '';
    }
  });
}

function setLookupMessage(html) {
  lookupResult.innerHTML = html;
}

// Lookup handler
lookupBtn.addEventListener('click', async () => {
  const username = lookupInput.value.trim().replace(/^@/, '');
  if (!username) {
    setLookupMessage('<p class="meta meta--danger">Enter a username</p>');
    return;
  }

  lookupBtn.disabled = true;
  lookupBtn.textContent = '…';
  setLookupMessage('<p class="meta">Checking…</p>');

  try {
    const cacheResult = await chrome.storage.local.get([BOT_CACHE_KEY]);
    const cache = cacheResult[BOT_CACHE_KEY] || {};
    const cached = cache[username.toLowerCase()];

    if (cached && cached.expiry && cached.expiry > Date.now()) {
      displayLookupResult(username, cached);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'botLookup',
            username: username
          }, (response) => {
            if (response && response.verdict) {
              displayLookupResult(username, response.verdict);
            } else {
              setLookupMessage('<p class="meta">Could not check this user. Open X in this tab.</p>');
            }
          });
        } else {
          setLookupMessage('<p class="meta">Open X to use lookup.</p>');
        }
      });
    }
  } catch (error) {
    console.error('Lookup error:', error);
    setLookupMessage('<p class="meta meta--danger">Error checking user</p>');
  } finally {
    lookupBtn.disabled = false;
    lookupBtn.textContent = 'Check';
  }
});

lookupInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    lookupBtn.click();
  }
});

function displayLookupResult(username, verdict) {
  const isBot = verdict.isBot;
  const isSlop = verdict.isSlop && !isBot;
  const kind = isBot ? 'bot' : (isSlop ? 'slop' : 'human');
  const verdictText = isBot ? 'Bot' : (isSlop ? 'Slop' : 'Human');

  lookupResult.innerHTML = `
    <div class="result result--${kind}">
      <div class="result-head">
        <span class="result-user">@${username}</span>
        <span class="result-verdict result-verdict--${kind}">${verdictText}</span>
      </div>
      ${(isBot || isSlop) ? `<div class="result-reason">${verdict.reason || CATEGORY_LABELS[verdict.category] || 'Detected'}</div>` : ''}
    </div>
  `;
}

// Whitelist management
function loadWhitelist() {
  chrome.storage.local.get([BOT_WHITELIST_KEY], (result) => {
    const whitelist = result[BOT_WHITELIST_KEY] || [];

    if (whitelist.length === 0) {
      whitelistList.innerHTML = '<p class="empty">No whitelisted accounts</p>';
      return;
    }

    whitelistList.innerHTML = whitelist.map(username => `
      <div class="whitelist-item">
        <span>@${username}</span>
        <button type="button" class="icon-btn whitelist-remove" data-username="${username}" aria-label="Remove @${username}">×</button>
      </div>
    `).join('');

    whitelistList.querySelectorAll('.whitelist-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        removeFromWhitelist(btn.dataset.username);
      });
    });
  });
}

function removeFromWhitelist(username) {
  chrome.storage.local.get([BOT_WHITELIST_KEY], (result) => {
    const whitelist = result[BOT_WHITELIST_KEY] || [];
    const newWhitelist = whitelist.filter(u => u.toLowerCase() !== username.toLowerCase());
    
    chrome.storage.local.set({ [BOT_WHITELIST_KEY]: newWhitelist }, () => {
      loadWhitelist();
      
      // Notify content script
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'botWhitelistUpdate',
            whitelist: newWhitelist
          }).catch(() => {});
        }
      });
    });
  });
}

// Export data
exportDataBtn.addEventListener('click', async () => {
  try {
    const data = await chrome.storage.local.get(null);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `x-account-tools-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Export error:', error);
    alert('Failed to export data');
  }
});

// Clear all data
clearAllDataBtn.addEventListener('click', async () => {
  if (confirm('Are you sure you want to clear ALL extension data? This cannot be undone.')) {
    try {
      await chrome.storage.local.clear();
      
      // Reload the popup to reset state
      window.location.reload();
      
      // Notify content script
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'dataCleared'
          }).catch(() => {});
        }
      });
    } catch (error) {
      console.error('Clear error:', error);
      alert('Failed to clear data');
    }
  }
});

// Function to be injected into the page
function cleanInterests(myInterests) {
  const myInterestsLower = myInterests.map(i => i.toLowerCase());
  let uncheckedCount = 0;
  let checkedCount = 0;
  const processedCheckboxes = new Set(); // Track which checkboxes we've already processed
  
  // Get the label/text associated with a checkbox
  function getCheckboxLabel(checkbox) {
    // Try various strategies to find the label text
    const container = checkbox.closest('[role="listitem"]') || 
                      checkbox.closest('label') || 
                      checkbox.closest('div');
    
    if (container) {
      // Get all text content, excluding nested checkboxes
      const text = container.textContent?.trim() || '';
      return text;
    }
    
    // Try aria-label
    if (checkbox.getAttribute('aria-label')) {
      return checkbox.getAttribute('aria-label');
    }
    
    // Try nearby span or label
    const parent = checkbox.parentElement;
    if (parent) {
      const label = parent.querySelector('span, label');
      if (label) return label.textContent?.trim() || '';
    }
    
    return '';
  }
  
  // Check if an interest label matches any of our preferred interests
  // Only matches if the label exactly equals one of your interests (case-insensitive)
  function isMyInterest(label) {
    const labelLower = label.toLowerCase().trim();
    return myInterestsLower.some(interest => labelLower === interest);
  }
  
  function processCheckboxes() {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    let delay = 0;
    let actionsQueued = 0;
    
    checkboxes.forEach((checkbox) => {
      const label = getCheckboxLabel(checkbox);
      
      // Skip if we've already processed this checkbox (by label)
      if (processedCheckboxes.has(label)) {
        return;
      }
      
      const isChecked = checkbox.checked;
      const shouldBeChecked = isMyInterest(label);
      
      // If it's checked but shouldn't be, uncheck it
      if (isChecked && !shouldBeChecked) {
        processedCheckboxes.add(label);
        setTimeout(() => {
          checkbox.click();
          uncheckedCount++;
          console.log(`Unchecked: "${label}"`);
        }, delay);
        delay += 800 + Math.random() * 400; // Slower: 800-1200ms between clicks
        actionsQueued++;
      }
      // If it's not checked but should be, check it
      else if (!isChecked && shouldBeChecked) {
        processedCheckboxes.add(label);
        setTimeout(() => {
          checkbox.click();
          checkedCount++;
          console.log(`Checked: "${label}"`);
        }, delay);
        delay += 800 + Math.random() * 400; // Slower: 800-1200ms between clicks
        actionsQueued++;
      }
    });
    
    if (actionsQueued > 0) {
      console.log(`Queued ${actionsQueued} actions, will complete in ~${Math.round(delay/1000)}s`);
    }
    
    return delay;
  }
  
  // Initial processing
  const initialDelay = processCheckboxes();
  
  // Set up observer to catch dynamically loaded checkboxes
  let lastProcessTime = Date.now();
  const observer = new MutationObserver(() => {
    // Debounce - only process if 2 seconds have passed (to avoid overwhelming X)
    const now = Date.now();
    if (now - lastProcessTime > 2000) {
      lastProcessTime = now;
      setTimeout(processCheckboxes, 1000);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Auto-disconnect observer after 5 minutes (longer to allow slow scrolling)
  setTimeout(() => {
    observer.disconnect();
    console.log(`Clean interests complete. Unchecked: ${uncheckedCount}, Checked: ${checkedCount}`);
  }, 300000);
  
  const totalCheckboxes = document.querySelectorAll('input[type="checkbox"]').length;
  
  return {
    success: totalCheckboxes > 0,
    message: totalCheckboxes > 0 
      ? `Processing ${totalCheckboxes} interests... (scroll to load more)` 
      : 'No interests found. Make sure you are on the interests page.'
  };
}
