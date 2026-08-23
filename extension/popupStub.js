// Preview / missing-API shim. No-ops inside a real extension.
(function stubChrome(global) {
  if (global.chrome?.storage?.local && global.chrome?.tabs) return;

  const store = {
    hidden_countries: {
      countries: ["India", "Nigeria"],
      updatedAt: Date.now(),
    },
    location_stats: {
      India: 41,
      Nigeria: 18,
      "United States": 87,
      Philippines: 9,
    },
    extension_enabled: true,
    bot_detection_enabled: true,
  };
  const listeners = [];

  global.chrome = {
    runtime: { id: "preview" },
    storage: {
      local: {
        get(keys) {
          const list = !keys ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) out[key] = store[key];
          return Promise.resolve(out);
        },
        set(patch) {
          Object.assign(store, patch);
          const changes = {};
          for (const [key, value] of Object.entries(patch)) {
            changes[key] = { newValue: value };
          }
          listeners.forEach((fn) => fn(changes, "local"));
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener(fn) {
          listeners.push(fn);
        },
      },
    },
    tabs: {
      query: async () => [],
      sendMessage: async () => {},
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
