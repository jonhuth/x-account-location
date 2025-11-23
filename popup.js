// Popup script for extension toggle
const TOGGLE_KEY = 'extension_enabled';
const DEFAULT_ENABLED = true;
const STATS_KEY = 'location_stats';

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
  if (areaName === 'local' && changes[STATS_KEY]) {
    // Stats have been updated, refresh the display
    loadAndDisplayStats(changes[STATS_KEY].newValue);
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

