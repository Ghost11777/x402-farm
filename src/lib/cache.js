// Cache TTL en mémoire : les agents re-demandent souvent les mêmes URLs/SIREN.
// Chaque hit servi depuis le cache = marge quasi 100 %.
const store = new Map();
const MAX_ENTRIES = 5000;

export function cached(key, ttlMs, fn) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  return Promise.resolve(fn()).then((value) => {
    if (store.size >= MAX_ENTRIES) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
    }
    store.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  });
}

export function cacheStats() {
  return { entries: store.size };
}
