// Client-only country filter shared by the timeline and popup.
(function initCountryFilter(global) {
  const HIDDEN_COUNTRIES_KEY = 'hidden_countries';
  let hiddenCountryState = { countries: [], updatedAt: 0 };

  function flagMap() {
    return typeof COUNTRY_FLAGS === 'object' && COUNTRY_FLAGS ? COUNTRY_FLAGS : {};
  }

  function canonicalCountry(location) {
    const raw = String(location || '').trim();
    if (!raw) return '';

    const entries = Object.keys(flagMap());
    const rawLower = raw.toLowerCase();
    const exact = entries.find((country) => country.toLowerCase() === rawLower);
    if (exact) return exact;

    const lastPart = String(raw.split(',').pop() || '').trim();
    const lastLower = lastPart.toLowerCase();
    const lastMatch = entries.find((country) => country.toLowerCase() === lastLower);
    if (lastMatch) return lastMatch;

    const containsMatch = entries
      .filter((country) => country.length >= 4 && rawLower.includes(country.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    return containsMatch || raw;
  }

  function normalizeCountries(countries) {
    const seen = new Set();
    const normalized = [];
    for (const value of Array.isArray(countries) ? countries : []) {
      const country = canonicalCountry(value);
      const key = country.toLowerCase();
      if (!country || seen.has(key)) continue;
      seen.add(key);
      normalized.push(country);
    }
    return normalized.sort((a, b) => a.localeCompare(b));
  }

  async function loadHiddenCountries() {
    try {
      const result = await chrome.storage.local.get(HIDDEN_COUNTRIES_KEY);
      const saved = result?.[HIDDEN_COUNTRIES_KEY];
      hiddenCountryState = {
        countries: normalizeCountries(saved?.countries),
        updatedAt: Number(saved?.updatedAt) || 0,
      };
    } catch {
      hiddenCountryState = { countries: [], updatedAt: 0 };
    }
    return hiddenCountryState;
  }

  async function saveHiddenCountries(value) {
    const countries = normalizeCountries(Array.isArray(value) ? value : value?.countries);
    hiddenCountryState = { countries, updatedAt: Date.now() };
    try {
      await chrome.storage.local.set({ [HIDDEN_COUNTRIES_KEY]: hiddenCountryState });
    } catch {
      /* Safari storage */
    }
    return hiddenCountryState;
  }

  function isCountryHidden(location, state = hiddenCountryState) {
    const country = canonicalCountry(location);
    if (!country) return false;
    const target = country.toLowerCase();
    return (Array.isArray(state?.countries) ? state.countries : []).some(
      (saved) => canonicalCountry(saved).toLowerCase() === target,
    );
  }

  function usernameFromTweet(articleEl) {
    const root = articleEl?.querySelector?.('[data-testid="UserName"], [data-testid="User-Name"]');
    for (const link of root?.querySelectorAll?.('a[href^="/"]') || []) {
      const text = String(link.textContent || '').trim();
      const match = String(link.getAttribute('href') || '').match(/^\/([^/?]+)/);
      if (match?.[1] && (text.startsWith('@') || text.toLowerCase() === match[1].toLowerCase())) {
        return match[1].toLowerCase();
      }
    }
    return '';
  }

  function mapLocation(usernameToLocationMap, username) {
    if (!usernameToLocationMap || !username) return '';
    const entry = typeof usernameToLocationMap.get === 'function'
      ? usernameToLocationMap.get(username) || usernameToLocationMap.get(username.toLowerCase())
      : usernameToLocationMap[username] || usernameToLocationMap[username.toLowerCase()];
    return typeof entry === 'object' && entry ? entry.location : entry;
  }

  function tweetMatchesHiddenCountry(
    articleEl,
    usernameToLocationMap,
    state = hiddenCountryState,
  ) {
    if (!articleEl?.matches?.('article[data-testid="tweet"]')) return false;
    const storedCountry = String(articleEl.dataset?.xatCountry || '').trim();
    const location = storedCountry || mapLocation(usernameToLocationMap, usernameFromTweet(articleEl));
    return isCountryHidden(location, state);
  }

  async function toggleHiddenCountry(location) {
    const country = canonicalCountry(location);
    if (!country) return hiddenCountryState;
    const current = await loadHiddenCountries();
    const target = country.toLowerCase();
    const exists = current.countries.some((saved) => saved.toLowerCase() === target);
    const countries = exists
      ? current.countries.filter((saved) => saved.toLowerCase() !== target)
      : [...current.countries, country];
    return saveHiddenCountries(countries);
  }

  const CountryFilter = {
    HIDDEN_COUNTRIES_KEY,
    canonicalCountry,
    loadHiddenCountries,
    saveHiddenCountries,
    isCountryHidden,
    tweetMatchesHiddenCountry,
    toggleHiddenCountry,
  };

  global.CountryFilter = CountryFilter;
})(typeof window !== 'undefined' ? window : globalThis);
