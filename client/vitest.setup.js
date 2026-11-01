// Vue Test Utils: stub <Teleport> so teleported content is queryable via wrapper.find()
try {
  // Lazy require so the project still works if @vue/test-utils isn't installed
  const { config } = require('@vue/test-utils')
  if (config && config.global) {
    config.global.stubs = { ...(config.global.stubs || {}), teleport: true }
  }
} catch (_) {
  // ignore — non-component tests don't need this
}

// Minimal browser-like globals for vitest tests in node environment.
// Provides localStorage so tests using web storage work without jsdom/happy-dom.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map()
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(String(key), String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null
    },
    get length() {
      return store.size
    }
  }
}
