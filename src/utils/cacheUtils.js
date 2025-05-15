import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearGlobalCacheByPattern } from './globalCacheManager';

/**
 * Utility for caching Firebase data to reduce reads
 * Implements a local caching system with TTL (time-to-live) functionality
 */

// Cache configuration constants
const DEFAULT_TTL = 1000 * 60 * 5; // 5 minutes in milliseconds
const DEFAULT_MAX_AGE = 1000 * 60 * 30; // 30 minutes in milliseconds
const CACHE_PREFIX = 'firebase_cache_';

// Cache TTL constants - export these so they can be imported elsewhere
export const CACHE_TTL = {
  DEFAULT: 5 * 60 * 1000, // 5 minutes
  SHORT: 60 * 1000, // 1 minute
  MEDIUM: 10 * 60 * 1000, // 10 minutes
  LONG: 30 * 60 * 1000, // 30 minutes
  VERY_LONG: 60 * 60 * 1000, // 1 hour
  PERSISTENT: 24 * 60 * 60 * 1000 // 24 hours for critical offline data
};

// In-memory cache for fastest access
const memoryCache = new Map();

// Batch update tracking for optimizing AsyncStorage writes
const pendingUpdates = new Map();
let batchUpdateTimeout = null;
const BATCH_UPDATE_DELAY = 500; // ms to wait before committing batch

/**
 * Invalidate cache entry
 * 
 * @param {string} key - Cache key to invalidate
 * @returns {Promise<void>}
 */
export const invalidateCache = async (key) => {
  const cacheKey = `${CACHE_PREFIX}${key}`;
  
  try {
    // Clear from both caches
    clearGlobalCacheByPattern(key);
    await AsyncStorage.removeItem(cacheKey);
    
    console.log(`🗑️ Cache invalidated for ${key}`);
  } catch (error) {
    console.error(`❌ Error invalidating cache for ${key}:`, error);
  }
};

/**
 * Get all cached keys matching a pattern
 * 
 * @param {string} pattern - Pattern to match against cache keys
 * @returns {Promise<string[]>} - Array of matching cache keys (without prefix)
 */
export const getCacheKeys = async (pattern = '') => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const filteredKeys = allKeys
      .filter(key => key.startsWith(CACHE_PREFIX))
      .filter(key => pattern ? key.includes(pattern) : true)
      .map(key => key.replace(CACHE_PREFIX, ''));
    
    return filteredKeys;
  } catch (error) {
    console.error('❌ Error getting cache keys:', error);
    return [];
  }
};

/**
 * Clear expired cache entries
 * 
 * @param {number} maxAge - Maximum age in milliseconds
 * @returns {Promise<number>} - Number of cleared cache entries
 */
export const clearExpiredCache = async (maxAge = DEFAULT_MAX_AGE) => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter(key => key.startsWith(CACHE_PREFIX));
    
    let clearedCount = 0;
    
    for (const key of cacheKeys) {
      try {
        const cachedData = await AsyncStorage.getItem(key);
        if (cachedData) {
          const { timestamp } = JSON.parse(cachedData);
          const age = Date.now() - timestamp;
          
          if (age > maxAge) {
            await AsyncStorage.removeItem(key);
            clearedCount++;
          }
        }
      } catch (error) {
        console.warn(`❌ Error processing cache key ${key}:`, error);
      }
    }
    
    console.log(`🧹 Cleared ${clearedCount} expired cache entries`);
    return clearedCount;
  } catch (error) {
    console.error('❌ Error clearing expired cache:', error);
    return 0;
  }
};

/**
 * Create a cache key for a collection query
 * 
 * @param {string} collectionPath - Firestore collection path
 * @param {Object} queryParams - Query parameters
 * @returns {string} - Cache key
 */
export const createQueryCacheKey = (collectionPath, queryParams = {}) => {
  const paramString = Object.entries(queryParams)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('&');
  
  return `query_${collectionPath}_${paramString}`;
};

/**
 * Create a cache key for a document
 * 
 * @param {string} documentPath - Firestore document path
 * @returns {string} - Cache key
 */
export const createDocCacheKey = (documentPath) => {
  return `doc_${documentPath}`;
};

/**
 * Get data with caching
 * 
 * @param {string} cacheKey - Cache key
 * @param {Function} fetchData - Function to fetch data if not in cache
 * @param {Object} options - Cache options
 * @returns {Promise<any>} - Cached or fresh data
 */
export const getWithCache = async (cacheKey, fetchData, options = {}) => {
  const { 
    ttl = CACHE_TTL.DEFAULT, 
    forceRefresh = false,
    skipMemoryCache = false,
    offline = false // If true, will only use cache and not call fetchData
  } = options;
  
  // Check if offline-only mode is requested
  if (offline) {
    // Try memory cache first
    if (!skipMemoryCache && memoryCache.has(cacheKey)) {
      const { data, timestamp } = memoryCache.get(cacheKey);
      // For offline mode, we ignore TTL - we need the data regardless of how old it is
      return data;
    }
    
    // Try AsyncStorage
    try {
      const cachedItem = await AsyncStorage.getItem(cacheKey);
      if (cachedItem) {
        const { data } = JSON.parse(cachedItem);
        // Update memory cache
        memoryCache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
      }
    } catch (error) {
      console.error(`Error reading cache in offline mode (${cacheKey}):`, error);
    }
    
    // No data available offline
    return null;
  }
  
  // Normal operation (not offline-only)
  
  // Check memory cache first for fastest access
  if (!forceRefresh && !skipMemoryCache && memoryCache.has(cacheKey)) {
    const { data, timestamp } = memoryCache.get(cacheKey);
    if (Date.now() - timestamp < ttl) {
      return data;
    }
  }
  
  // Check AsyncStorage next
  if (!forceRefresh) {
    try {
      const cachedItem = await AsyncStorage.getItem(cacheKey);
      if (cachedItem) {
        const { data, timestamp } = JSON.parse(cachedItem);
        if (Date.now() - timestamp < ttl) {
          // Update memory cache with this data
          memoryCache.set(cacheKey, { data, timestamp });
          return data;
        }
      }
    } catch (error) {
      console.error(`Error reading cache (${cacheKey}):`, error);
    }
  }
  
  // Fetch fresh data
  try {
    const data = await fetchData();
    
    // Update caches
    const timestamp = Date.now();
    memoryCache.set(cacheKey, { data, timestamp });
    
    // Queue AsyncStorage update for batch processing
    pendingUpdates.set(cacheKey, { data, timestamp });
    
    if (!batchUpdateTimeout) {
      batchUpdateTimeout = setTimeout(commitBatchUpdate, BATCH_UPDATE_DELAY);
    }
    
    return data;
  } catch (error) {
    console.error(`Error fetching data (${cacheKey}):`, error);
    throw error;
  }
};

/**
 * Commit pending cache updates in a batch
 */
const commitBatchUpdate = async () => {
  batchUpdateTimeout = null;
  
  if (pendingUpdates.size === 0) return;
  
  const updates = Array.from(pendingUpdates.entries()).map(
    ([key, value]) => [key, JSON.stringify(value)]
  );
  
  pendingUpdates.clear();
  
  try {
    await AsyncStorage.multiSet(updates);
  } catch (error) {
    console.error('Error batch updating cache:', error);
  }
};

/**
 * Update cache item immediately
 * 
 * @param {string} cacheKey - Cache key
 * @param {any} data - Data to cache
 * @param {boolean} updateAsyncStorage - Whether to update AsyncStorage
 */
export const updateCache = (cacheKey, data, updateAsyncStorage = true) => {
  const timestamp = Date.now();
  
  // Update memory cache
  memoryCache.set(cacheKey, { data, timestamp });
  
  // Update AsyncStorage if requested
  if (updateAsyncStorage) {
    pendingUpdates.set(cacheKey, { data, timestamp });
    
    if (!batchUpdateTimeout) {
      batchUpdateTimeout = setTimeout(commitBatchUpdate, BATCH_UPDATE_DELAY);
    }
  }
};

/**
 * Remove item from cache
 * 
 * @param {string} cacheKey - Cache key
 * @param {boolean} removeFromAsyncStorage - Whether to remove from AsyncStorage
 */
export const removeFromCache = async (cacheKey, removeFromAsyncStorage = true) => {
  // Remove from memory cache
  memoryCache.delete(cacheKey);
  
  // Remove from pending updates if present
  pendingUpdates.delete(cacheKey);
  
  // Remove from AsyncStorage if requested
  if (removeFromAsyncStorage) {
    try {
      await AsyncStorage.removeItem(cacheKey);
    } catch (error) {
      console.error(`Error removing from cache (${cacheKey}):`, error);
    }
  }
};

/**
 * Clear all cache
 * 
 * @param {string} prefix - Optional prefix to clear only cache keys with this prefix
 */
export const clearCache = async (prefix = '') => {
  // Clear from memory cache
  if (prefix) {
    for (const key of memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        memoryCache.delete(key);
      }
    }
    
    // Clear from pending updates
    for (const key of pendingUpdates.keys()) {
      if (key.startsWith(prefix)) {
        pendingUpdates.delete(key);
      }
    }
    
    // Clear from AsyncStorage
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const keysToRemove = allKeys.filter(key => key.startsWith(prefix));
      if (keysToRemove.length > 0) {
        await AsyncStorage.multiRemove(keysToRemove);
      }
    } catch (error) {
      console.error(`Error clearing cache with prefix ${prefix}:`, error);
    }
  } else {
    // Clear all cache
    memoryCache.clear();
    pendingUpdates.clear();
    
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      // Only clear keys that look like our cache keys
      const cacheKeys = allKeys.filter(key => key.startsWith('doc:') || key.startsWith('query:'));
      if (cacheKeys.length > 0) {
        await AsyncStorage.multiRemove(cacheKeys);
      }
    } catch (error) {
      console.error('Error clearing all cache:', error);
    }
  }
};

/**
 * Invalidate cache for a collection
 * 
 * @param {string} collectionName - Collection name
 */
export const invalidateCollectionCache = async (collectionName) => {
  await clearCache(`query:${collectionName}`);
};

/**
 * Batch invalidate cache for multiple collections
 * 
 * @param {string[]} collectionNames - Array of collection names
 */
export const batchInvalidateCache = async (collectionNames) => {
  for (const name of collectionNames) {
    await invalidateCollectionCache(name);
  }
};

/**
 * Store data for offline use with a persistent TTL
 * This is particularly useful for critical data that should be available offline
 * 
 * @param {string} key - Storage key
 * @param {any} data - Data to store
 */
export const storeOfflineData = async (key, data) => {
  const offlineKey = `offline:${key}`;
  const timestamp = Date.now();
  const ttl = CACHE_TTL.PERSISTENT; // Use persistent TTL for offline data
  
  try {
    await AsyncStorage.setItem(offlineKey, JSON.stringify({
      data,
      timestamp,
      ttl
    }));
    
    // Also update memory cache
    memoryCache.set(offlineKey, { data, timestamp });
  } catch (error) {
    console.error(`Error storing offline data (${key}):`, error);
  }
};

/**
 * Retrieve offline data
 * 
 * @param {string} key - Storage key
 * @param {boolean} ignoreExpiry - Whether to ignore expiry (default: true for offline data)
 * @returns {Promise<any>} - Stored data or null
 */
export const getOfflineData = async (key, ignoreExpiry = true) => {
  const offlineKey = `offline:${key}`;
  
  // Check memory cache first
  if (memoryCache.has(offlineKey)) {
    const { data } = memoryCache.get(offlineKey);
    return data;
  }
  
  try {
    const storedItem = await AsyncStorage.getItem(offlineKey);
    
    if (!storedItem) return null;
    
    const { data, timestamp, ttl } = JSON.parse(storedItem);
    
    // Check if expired, unless we're ignoring expiry
    if (!ignoreExpiry && Date.now() - timestamp > ttl) {
      await AsyncStorage.removeItem(offlineKey);
      return null;
    }
    
    // Update memory cache
    memoryCache.set(offlineKey, { data, timestamp });
    
    return data;
  } catch (error) {
    console.error(`Error retrieving offline data (${key}):`, error);
    return null;
  }
};

/**
 * Get the timestamp of the last cache update
 * 
 * @param {string} cacheKey - Cache key
 * @returns {Promise<number|null>} - Timestamp or null
 */
export const getLastCacheUpdateTime = async (cacheKey) => {
  // Check memory cache first
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey).timestamp;
  }
  
  // Check AsyncStorage
  try {
    const cachedItem = await AsyncStorage.getItem(cacheKey);
    if (cachedItem) {
      const { timestamp } = JSON.parse(cachedItem);
      return timestamp;
    }
  } catch (error) {
    console.error(`Error getting last cache update time (${cacheKey}):`, error);
  }
  
  return null;
};

// Export the module
export default {
  CACHE_TTL,
  createDocCacheKey,
  createQueryCacheKey,
  getCacheKeys,
  getWithCache,
  updateCache,
  removeFromCache,
  clearCache,
  invalidateCollectionCache,
  batchInvalidateCache,
  storeOfflineData,
  getOfflineData,
  getLastCacheUpdateTime
}; 