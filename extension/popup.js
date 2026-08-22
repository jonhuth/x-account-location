const TOGGLE_KEY = 'extension_enabled';
const STATS_KEY = 'location_stats';
const BOT_TOGGLE_KEY = 'bot_detection_enabled';
const DEFAULT_ENABLED = true;
const CF = window.CountryFilter;
const FM = window.FocusMode;

if (!CF || !FM) {
  document.body.textContent = "Sift failed to load. Reload the extension.";
  throw new Error("Sift popup missing CountryFilter or FocusMode");
}

let statsState = {};
let hiddenState = { countries: [], updatedAt: 0 };

function setSwitch(element, enabled) {
  element?.setAttribute('aria-checked', enabled ? 'true' : 'false');
}

async function notifyActiveTab(message) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) await chrome.tabs.sendMessage(tabs[0].id, message);
  } catch {
    /* The active tab may not be X. */
  }
}

function activateTab(selectedTab) {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
  tabs.forEach((tab) => {
    const selected = tab === selectedTab;
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    tab.tabIndex = selected ? 0 : -1;
  });
  panels.forEach((panel) => {
    const active = panel.id === `tab-${selectedTab.dataset.tab}`;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
}

const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
tabs.forEach((tab) => {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (event) => {
    const current = tabs.indexOf(tab);
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % tabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    tabs[next].focus();
    activateTab(tabs[next]);
  });
});

function uniqueProfileCount(stats) {
  return Object.values(stats || {}).reduce((total, count) => total + (Number(count) || 0), 0);
}

function countryLabel(country) {
  const flag = getCountryFlag(country);
  return `${flag ? `${flag} ` : ''}${country}`;
}

async function removeHiddenCountry(country) {
  hiddenState = await CF.saveHiddenCountries(
    hiddenState.countries.filter((saved) => saved.toLowerCase() !== country.toLowerCase()),
  );
  renderLocation();
  await notifyActiveTab({ type: 'countryFilterUpdated' });
}

function renderHiddenCountries() {
  const list = document.getElementById('hidden-list');
  list.replaceChildren();
  if (hiddenState.countries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Tap a flag on the timeline to hide that country.';
    list.appendChild(empty);
    return;
  }

  hiddenState.countries.forEach((country) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    const label = document.createElement('span');
    label.textContent = countryLabel(country);
    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Show posts from ${country}`);
    remove.addEventListener('click', () => removeHiddenCountry(country));
    row.append(label, remove);
    list.appendChild(row);
  });
}

function seenCountries() {
  const totals = new Map();
  for (const [location, count] of Object.entries(statsState || {})) {
    const country = CF.canonicalCountry(location);
    if (!country) continue;
    totals.set(country, (totals.get(country) || 0) + (Number(count) || 0));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function renderQuickCountries() {
  const section = document.getElementById('quick-section');
  const chips = document.getElementById('quick-countries');
  const hidden = new Set(hiddenState.countries.map((country) => country.toLowerCase()));
  const available = seenCountries().filter(([country]) => !hidden.has(country.toLowerCase())).slice(0, 12);
  chips.replaceChildren();
  section.hidden = available.length === 0;

  available.forEach(([country, count]) => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.textContent = `${countryLabel(country)} · ${count}`;
    chip.setAttribute('aria-label', `Hide posts from ${country}`);
    chip.addEventListener('click', () => addHiddenCountry(country));
    chips.appendChild(chip);
  });
}

function renderLocation() {
  renderHiddenCountries();
  renderQuickCountries();
}

async function addHiddenCountry(rawCountry) {
  const country = CF.canonicalCountry(rawCountry);
  const status = document.getElementById('country-status');
  if (!country) {
    status.textContent = 'Enter a country or region.';
    return;
  }
  if (CF.isCountryHidden(country, hiddenState)) {
    status.textContent = `${country} is already hidden.`;
    return;
  }
  hiddenState = await CF.saveHiddenCountries([...hiddenState.countries, country]);
  document.getElementById('country-input').value = '';
  status.textContent = `Posts from ${country} are hidden.`;
  renderLocation();
  await notifyActiveTab({ type: 'countryFilterUpdated' });
}

document.getElementById('country-add').addEventListener('click', () => {
  addHiddenCountry(document.getElementById('country-input').value);
});

document.getElementById('country-input').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  document.getElementById('country-add').click();
});

document.getElementById('flags-toggle').addEventListener('click', async () => {
  const current = document.getElementById('flags-toggle').getAttribute('aria-checked') === 'true';
  const enabled = !current;
  await chrome.storage.local.set({ [TOGGLE_KEY]: enabled });
  setSwitch(document.getElementById('flags-toggle'), enabled);
  await notifyActiveTab({ type: 'extensionToggle', enabled });
});

document.getElementById('bots-toggle').addEventListener('click', async () => {
  const current = document.getElementById('bots-toggle').getAttribute('aria-checked') === 'true';
  const enabled = !current;
  await chrome.storage.local.set({ [BOT_TOGGLE_KEY]: enabled });
  setSwitch(document.getElementById('bots-toggle'), enabled);
  await notifyActiveTab({ type: 'botDetectionToggle', enabled });
  await notifyActiveTab({ type: 'hideBotsToggle', enabled });
});

function calmPreset() {
  return {
    hideForYouTab: true,
    forceFollowing: true,
    hideNewsExplore: true,
    hideTrends: true,
    hideWhoToFollow: true,
    hidePromoted: true,
    hideGrokNav: false,
    hideCommunitiesNav: false,
    hidePremiumUpsells: true,
    hideTopicsSpaces: true,
  };
}

function renderCalm(state) {
  const active = FM.anyFocusEnabled(state);
  document.getElementById('calm-status').textContent = active ? 'Calm home is on.' : 'Calm home is off.';
}

function refreshFocusSwitches(state) {
  document.querySelectorAll('[data-focus-key]').forEach((el) => {
    setSwitch(el, Boolean(state[el.dataset.focusKey]));
  });
}

document.querySelectorAll('[data-focus-key]').forEach((el) => {
  el.addEventListener('click', async () => {
    const next = el.getAttribute('aria-checked') !== 'true';
    setSwitch(el, next);
    const state = await FM.saveFocusState({ [el.dataset.focusKey]: next });
    renderCalm(state);
    await notifyActiveTab({ type: 'focusModeUpdated' });
  });
});

document.getElementById('calm-enable').addEventListener('click', async () => {
  const state = await FM.saveFocusState(calmPreset());
  refreshFocusSwitches(state);
  renderCalm(state);
  await notifyActiveTab({ type: 'focusModeUpdated' });
});

document.getElementById('calm-disable').addEventListener('click', async () => {
  const state = await FM.saveFocusState(FM.DEFAULT_FOCUS());
  refreshFocusSwitches(state);
  renderCalm(state);
  await notifyActiveTab({ type: 'focusModeUpdated' });
});

async function initPopup() {
  const [stored, hidden, focus] = await Promise.all([
    chrome.storage.local.get([TOGGLE_KEY, STATS_KEY, BOT_TOGGLE_KEY]),
    CF.loadHiddenCountries(),
    FM.loadFocusState(),
  ]);
  const enabled = stored[TOGGLE_KEY] !== undefined ? Boolean(stored[TOGGLE_KEY]) : DEFAULT_ENABLED;
  const botsOn = stored[BOT_TOGGLE_KEY] !== false;
  statsState = stored[STATS_KEY] && typeof stored[STATS_KEY] === 'object' ? stored[STATS_KEY] : {};
  hiddenState = hidden;
  setSwitch(document.getElementById('flags-toggle'), enabled);
  setSwitch(document.getElementById('bots-toggle'), botsOn);
  renderLocation();
  refreshFocusSwitches(focus);
  renderCalm(focus);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[STATS_KEY]) {
    statsState = changes[STATS_KEY].newValue || {};
    renderLocation();
  }
  if (changes[CF.HIDDEN_COUNTRIES_KEY]) {
    CF.loadHiddenCountries().then((state) => {
      hiddenState = state;
      renderLocation();
    });
  }
  if (changes[FM.FOCUS_KEY]) renderCalm(changes[FM.FOCUS_KEY].newValue || FM.DEFAULT_FOCUS());
});

initPopup().catch(() => {
  document.getElementById('country-status').textContent = 'Could not load settings. Reopen Sift.';
});
