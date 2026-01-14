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

// Function to be injected into the page
function cleanInterests(myInterests) {
  const myInterestsLower = myInterests.map(i => i.toLowerCase());
  let uncheckedCount = 0;
  let checkedCount = 0;
  
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
  function isMyInterest(label) {
    const labelLower = label.toLowerCase();
    return myInterestsLower.some(interest => 
      labelLower.includes(interest) || interest.includes(labelLower)
    );
  }
  
  function processCheckboxes() {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    let delay = 0;
    
    checkboxes.forEach((checkbox) => {
      const label = getCheckboxLabel(checkbox);
      const isChecked = checkbox.checked;
      const shouldBeChecked = isMyInterest(label);
      
      // If it's checked but shouldn't be, uncheck it
      if (isChecked && !shouldBeChecked) {
        setTimeout(() => {
          checkbox.click();
          uncheckedCount++;
          console.log(`Unchecked: "${label}"`);
        }, delay);
        delay += 200 + Math.random() * 150;
      }
      // If it's not checked but should be, check it
      else if (!isChecked && shouldBeChecked) {
        setTimeout(() => {
          checkbox.click();
          checkedCount++;
          console.log(`Checked: "${label}"`);
        }, delay);
        delay += 200 + Math.random() * 150;
      }
    });
    
    return delay;
  }
  
  // Initial processing
  const initialDelay = processCheckboxes();
  
  // Set up observer to catch dynamically loaded checkboxes
  let lastProcessTime = Date.now();
  const observer = new MutationObserver(() => {
    // Debounce - only process if 500ms have passed
    const now = Date.now();
    if (now - lastProcessTime > 500) {
      lastProcessTime = now;
      setTimeout(processCheckboxes, 300);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Auto-disconnect observer after 60 seconds
  setTimeout(() => {
    observer.disconnect();
    console.log(`Clean interests complete. Unchecked: ${uncheckedCount}, Checked: ${checkedCount}`);
  }, 60000);
  
  const totalCheckboxes = document.querySelectorAll('input[type="checkbox"]').length;
  
  return {
    success: totalCheckboxes > 0,
    message: totalCheckboxes > 0 
      ? `Processing ${totalCheckboxes} interests... (scroll to load more)` 
      : 'No interests found. Make sure you are on the interests page.'
  };
}
