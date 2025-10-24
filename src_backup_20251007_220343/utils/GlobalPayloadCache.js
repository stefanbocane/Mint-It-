// GlobalPayloadCache - lightweight in-memory LRU-ish cache for pre-fetched screen payloads
// Stores the last ~100 payloads (size not strictly enforced; prunes by TTL)
// Each entry: { data: any, lastSynced: number }
const CACHE = new Map();
const TTL_MS = 10 * 60 * 1000; // 10 minutes

export const setPayload = (id, data) => {
  if (!id) return;
  CACHE.set(id, { data, lastSynced: Date.now() });
  // Soft cap of 100 entries
  if (CACHE.size > 110) prune();
};

export const getPayload = (id) => {
  const entry = CACHE.get(id);
  if (!entry) return null;
  if (Date.now() - entry.lastSynced > TTL_MS) {
    CACHE.delete(id);
    return null;
  }
  return entry.data;
};

export const prune = () => {
  const now = Date.now();
  for (const [key, entry] of CACHE) {
    if (now - entry.lastSynced > TTL_MS) CACHE.delete(key);
  }
};

export default { setPayload, getPayload, prune }; 