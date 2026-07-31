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
// Tab Navigation
// ============================================================================

const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const targetId = tab.dataset.tab;
    
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    document.getElementById(`tab-${targetId}`).classList.add('active');
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
  if (isEnabled) {
    toggleSwitch.classList.add('enabled');
    status.textContent = 'Extension is enabled';
    status.style.color = '#1d9bf0';
  } else {
    toggleSwitch.classList.remove('enabled');
    status.textContent = 'Extension is disabled';
    status.style.color = '#536471';
  }
}

// Load and display statistics
function loadAndDisplayStats(stats) {
  if (!stats || Object.keys(stats).length === 0) {
    statsTotal.textContent = 'No profiles tracked yet';
    statsList.innerHTML = '<div class="stats-empty">Start browsing Twitter to see statistics</div>';
    return;
  }
  
  // Calculate total
  const total = Object.values(stats).reduce((sum, count) => sum + count, 0);
  statsTotal.textContent = `Total: ${total} unique profile${total !== 1 ? 's' : ''}`;
  
  // Sort by count (descending)
  const sorted = Object.entries(stats)
    .sort((a, b) => b[1] - a[1]);
  
  // Display stats
  statsList.innerHTML = sorted.map(([location, count]) => {
    const flag = getCountryFlag(location);
    const displayFlag = flag || '';
    const displayLocation = flag ? location : `(${location})`;
    
    return `
      <div class="stats-item">
        <div class="stats-item-location">
          <span>${displayFlag}</span>
          <span>${displayLocation}</span>
        </div>
        <span>${count}</span>
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

// Clean Interests functionality
const cleanInterestsBtn = document.getElementById('cleanInterestsBtn');
const cleanStatus = document.getElementById('cleanStatus');

// MY_INTERESTS is loaded from myInterests.js

cleanInterestsBtn.addEventListener('click', async () => {
  cleanInterestsBtn.disabled = true;
  cleanStatus.textContent = 'Cleaning interests...';
  cleanStatus.className = 'action-status';
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      throw new Error('No active tab found');
    }
    
    // Check if we're on a Twitter/X page
    if (!tab.url?.includes('x.com') && !tab.url?.includes('twitter.com')) {
      cleanStatus.textContent = 'Navigate to x.com/settings/your_twitter_data/twitter_interests first';
      cleanStatus.className = 'action-status error';
      cleanInterestsBtn.disabled = false;
      return;
    }
    
    // Execute the clean interests script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: cleanInterests,
      args: [MY_INTERESTS]
    });
    
    const result = results[0]?.result;
    if (result?.success) {
      cleanStatus.textContent = result.message;
      cleanStatus.className = 'action-status success';
    } else {
      cleanStatus.textContent = result?.message || 'No interests found on this page';
      cleanStatus.className = 'action-status';
    }
  } catch (error) {
    console.error('Error:', error);
    cleanStatus.textContent = 'Error: ' + error.message;
    cleanStatus.className = 'action-status error';
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
const lookupInput = document.getElementById('lookupInput');
const lookupBtn = document.getElementById('lookupBtn');
const lookupResult = document.getElementById('lookupResult');
const whitelistList = document.getElementById('whitelistList');
const exportDataBtn = document.getElementById('exportDataBtn');
const clearAllDataBtn = document.getElementById('clearAllDataBtn');

// Category labels
const CATEGORY_LABELS = {
  engagement_farmer: '🌾 Engagement Farmer',
  sycophant: '🤖 Sycophant Bot',
  self_promoter: '📢 Self-Promoter',
  airdrop_farmer: '🪂 Airdrop Farmer',
  crypto_spam: '💩 Crypto Spam',
  llm_slop: '🟣 LLM Slop',
  genuine: '✓ Human',
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
  if (isEnabled) {
    botToggleSwitch.classList.add('enabled');
  } else {
    botToggleSwitch.classList.remove('enabled');
  }
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
    
    // Display categories
    if (Object.keys(categories).length > 0) {
      botCategories.innerHTML = Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, count]) => `
          <div class="bot-category-item">
            <span class="bot-category-name">${CATEGORY_LABELS[cat] || cat}</span>
            <span class="bot-category-count">${count}</span>
          </div>
        `).join('');
    } else {
      botCategories.innerHTML = '';
    }
  });
}

// Lookup handler
lookupBtn.addEventListener('click', async () => {
  const username = lookupInput.value.trim().replace(/^@/, '');
  if (!username) {
    lookupResult.innerHTML = '<div style="color: #f4212e; font-size: 12px;">Please enter a username</div>';
    return;
  }
  
  lookupBtn.disabled = true;
  lookupBtn.textContent = '...';
  lookupResult.innerHTML = '<div style="color: #536471; font-size: 12px;">Checking...</div>';
  
  try {
    // Check cache first
    const cacheResult = await chrome.storage.local.get([BOT_CACHE_KEY]);
    const cache = cacheResult[BOT_CACHE_KEY] || {};
    const cached = cache[username.toLowerCase()];
    
    if (cached && cached.expiry && cached.expiry > Date.now()) {
      displayLookupResult(username, cached);
    } else {
      // Send to content script to use the backend
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'botLookup',
            username: username
          }, (response) => {
            if (response && response.verdict) {
              displayLookupResult(username, response.verdict);
            } else {
              lookupResult.innerHTML = '<div style="color: #536471; font-size: 12px;">Could not check this user. Make sure you\'re on Twitter/X.</div>';
            }
          });
        } else {
          lookupResult.innerHTML = '<div style="color: #536471; font-size: 12px;">Open Twitter/X to use this feature.</div>';
        }
      });
    }
  } catch (error) {
    console.error('Lookup error:', error);
    lookupResult.innerHTML = '<div style="color: #f4212e; font-size: 12px;">Error checking user</div>';
  } finally {
    lookupBtn.disabled = false;
    lookupBtn.textContent = 'Check';
  }
});

function displayLookupResult(username, verdict) {
  const isBot = verdict.isBot;
  const isSlop = verdict.isSlop && !isBot;
  const verdictClass = isBot ? 'bot' : (isSlop ? 'bot' : 'human');
  const verdictText = isBot ? '🤖 Bot' : (isSlop ? '🟣 Slop' : '✓ Human');
  
  lookupResult.innerHTML = `
    <div class="lookup-result ${verdictClass}">
      <div class="lookup-result-header">
        <span class="lookup-result-username">@${username}</span>
        <span class="lookup-result-verdict ${verdictClass}">${verdictText}</span>
      </div>
      ${(isBot || isSlop) ? `<div class="lookup-result-reason">${verdict.reason || CATEGORY_LABELS[verdict.category] || 'Detected'}</div>` : ''}
    </div>
  `;
}

// Whitelist management
function loadWhitelist() {
  chrome.storage.local.get([BOT_WHITELIST_KEY], (result) => {
    const whitelist = result[BOT_WHITELIST_KEY] || [];
    
    if (whitelist.length === 0) {
      whitelistList.innerHTML = '<div class="whitelist-empty">No whitelisted accounts</div>';
      return;
    }
    
    whitelistList.innerHTML = whitelist.map(username => `
      <div class="whitelist-item">
        <span>@${username}</span>
        <button class="whitelist-remove" data-username="${username}">×</button>
      </div>
    `).join('');
    
    // Add remove handlers
    whitelistList.querySelectorAll('.whitelist-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const usernameToRemove = btn.dataset.username;
        removeFromWhitelist(usernameToRemove);
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
