import AsyncStorage from '@react-native-async-storage/async-storage';
import CacheService from '../services/caching/CacheService';
import { logCacheError } from './errorMonitor';

/**
 * Utility for caching Firebase data to reduce reads
 * Implements a local caching system with TTL (time-to-live) functionality
 */

// Cache configuration constants
const DEFAULT_TTL = 1000 * 60 * 5; // 5 minutes in milliseconds
const DEFAULT_MAX_AGE = 1000 * 60 * 30; // 30 minutes in milliseconds
export const CACHE_PREFIX = 'firebase_cache_';

// Cache TTL constants
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
const invalidateCache = async (key) => {
  const cacheKey = `${CACHE_PREFIX}${key}`;
  
  try {
    // Clear from AsyncStorage
    await AsyncStorage.removeItem(cacheKey);
    
    // Try to clear from global cache manager if available (avoid circular dependency)
    try {
      const { default: globalCacheManager } = await import('./globalCacheManager.js');
      if (globalCacheManager && typeof globalCacheManager.clearByPattern === 'function') {
        await globalCacheManager.clearByPattern(key);
      }
    } catch (importError) {
      // Ignore import errors to avoid circular dependency issues
      console.warn('Could not import globalCacheManager:', importError.message);
    }
    
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
const getCacheKeys = async (pattern = '') => {
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
 * Clear expired cache entries with intelligent prioritization
 * OPTIMIZATION: Prioritizes keeping boot-critical data
 */
export const clearExpiredCache = async () => {
  console.log('🧹 Starting intelligent cache cleanup...');
  
  try {
    let clearedCount = 0;
    const startTime = Date.now();
    
    // Get all cache keys
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter(key => 
      key.startsWith('cache:') || 
      key.startsWith('storage:') ||
      key.startsWith('query:')
    );
    
    console.log(`Found ${cacheKeys.length} cache entries to evaluate`);
    
    // Batch process cache keys for efficiency
    const batchSize = 50;
    for (let i = 0; i < cacheKeys.length; i += batchSize) {
      const batch = cacheKeys.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(key => processCacheKey(key))
      );
      
      // Count successful deletions
      clearedCount += batchResults.filter(result => 
        result.status === 'fulfilled' && result.value === true
      ).length;
    }
    
    const duration = Date.now() - startTime;
    console.log(`✅ Cache cleanup completed: ${clearedCount} entries cleared in ${duration}ms`);
    
    // Update cache metrics
    await updateCacheMetrics(clearedCount, duration);
    
    return clearedCount;
    
  } catch (error) {
    console.error('Error during cache cleanup:', error);
    return 0;
  }
};

/**
 * Process individual cache key for expiration and priority
 */
const processCacheKey = async (key) => {
  try {
    const item = await AsyncStorage.getItem(key);
    if (!item) return false;
    
    const parsed = JSON.parse(item);
    const now = Date.now();
    
    // Check if expired
    if (parsed.expiresAt && now > parsed.expiresAt) {
      // Check if this is boot-critical data that should be preserved longer
      if (isBootCriticalData(key, parsed)) {
        // Extend TTL for boot-critical data
        const extendedTTL = 15 * 60 * 1000; // 15 minutes
        parsed.expiresAt = now + extendedTTL;
        await AsyncStorage.setItem(key, JSON.stringify(parsed));
        console.log(`🔄 Extended TTL for boot-critical data: ${key}`);
        return false; // Not deleted
      } else {
        // Safe to delete expired non-critical data
        await AsyncStorage.removeItem(key);
        return true; // Deleted
      }
    }
    
    return false; // Not expired, not deleted
    
  } catch (error) {
    console.error(`Error processing cache key ${key}:`, error);
    return false;
  }
};

/**
 * Determine if cache data is critical for boot performance
 */
const isBootCriticalData = (key, data) => {
  // Boot-critical patterns
  const criticalPatterns = [
    'userGroupData_',
    'users_',
    'groups_',
    'userPatterns_',
    'userCards_',
    'activeAuctions_',
    'userTrades_'
  ];
  
  // Check if key matches critical patterns
  const isCriticalKey = criticalPatterns.some(pattern => key.includes(pattern));
  
  // Check if data was recently accessed (within last hour)
  const recentlyAccessed = data.lastAccessed && 
    (Date.now() - data.lastAccessed) < (60 * 60 * 1000);
  
  // Check if data has high access frequency
  const highFrequency = data.accessCount && data.accessCount > 5;
  
  return isCriticalKey || recentlyAccessed || highFrequency;
};

/**
 * Update cache performance metrics
 */
const updateCacheMetrics = async (clearedCount, duration) => {
  try {
    const metricsKey = 'cacheCleanupMetrics';
    const existing = await AsyncStorage.getItem(metricsKey);
    
    let metrics = {
      totalCleanups: 0,
      totalEntriesCleared: 0,
      totalDuration: 0,
      averageDuration: 0,
      lastCleanup: null
    };
    
    if (existing) {
      metrics = { ...metrics, ...JSON.parse(existing) };
    }
    
    metrics.totalCleanups++;
    metrics.totalEntriesCleared += clearedCount;
    metrics.totalDuration += duration;
    metrics.averageDuration = Math.round(metrics.totalDuration / metrics.totalCleanups);
    metrics.lastCleanup = Date.now();
    
    await AsyncStorage.setItem(metricsKey, JSON.stringify(metrics));
    
  } catch (error) {
    console.error('Error updating cache metrics:', error);
  }
};

/**
 * Smart cache prewarming for frequently accessed data
 * OPTIMIZATION: Preloads data likely to be needed soon
 */
export const prewarmFrequentlyAccessedCache = async (userId, groupId) => {
  if (!userId || !groupId) return;
  
  console.log('🔥 Prewarming frequently accessed cache...');
  
  try {
    const prewarmPromises = [];
    
    // Prewarm user patterns (used by smart prefetching)
    prewarmPromises.push(
      CacheService.getDocument('userPatterns', userId, {
        ttl: 24 * 60 * 60 * 1000 // 24 hours
      })
    );
    
    // Prewarm denormalized user+group data
    const denormalizedKey = `userGroupData_${userId}_${groupId}`;
    prewarmPromises.push(
      CacheService.getDocument('userGroupData', denormalizedKey, {
        ttl: 15 * 60 * 1000 // 15 minutes
      })
    );
    
    // Execute prewarming in parallel
    await Promise.allSettled(prewarmPromises);
    
    console.log('✅ Cache prewarming completed');
    
  } catch (error) {
    console.error('Error during cache prewarming:', error);
  }
};

/**
 * Optimize cache storage by compacting fragmented data
 * OPTIMIZATION: Reduces storage overhead and improves access speed
 */
export const optimizeCacheStorage = async () => {
  console.log('⚡ Optimizing cache storage...');
  
  try {
    const startTime = Date.now();
    let optimizedCount = 0;
    
    // Get all cache keys
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter(key => 
      key.startsWith('cache:') || 
      key.startsWith('storage:')
    );
    
    // Process in batches to avoid memory issues
    const batchSize = 25;
    for (let i = 0; i < cacheKeys.length; i += batchSize) {
      const batch = cacheKeys.slice(i, i + batchSize);
      const batchData = await AsyncStorage.multiGet(batch);
      
      const optimizedBatch = [];
      
      for (const [key, value] of batchData) {
        if (value) {
          try {
            const parsed = JSON.parse(value);
            
            // Optimize data structure
            const optimized = optimizeCacheEntry(parsed);
            
            if (optimized !== parsed) {
              optimizedBatch.push([key, JSON.stringify(optimized)]);
              optimizedCount++;
            }
          } catch (error) {
            console.error(`Error optimizing cache entry ${key}:`, error);
          }
        }
      }
      
      // Write optimized batch
      if (optimizedBatch.length > 0) {
        await AsyncStorage.multiSet(optimizedBatch);
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`✅ Cache optimization completed: ${optimizedCount} entries optimized in ${duration}ms`);
    
    return { optimizedCount, duration };
    
  } catch (error) {
    console.error('Error during cache optimization:', error);
    return { optimizedCount: 0, duration: 0 };
  }
};

/**
 * Optimize individual cache entry
 */
const optimizeCacheEntry = (entry) => {
  // Remove unnecessary metadata
  const optimized = { ...entry };
  
  // Remove debug information in production
  if (!__DEV__) {
    delete optimized.debug;
    delete optimized.stackTrace;
    delete optimized.sourceLocation;
  }
  
  // Compress large arrays by removing duplicates
  if (optimized.data && Array.isArray(optimized.data)) {
    optimized.data = removeDuplicatesFromArray(optimized.data);
  }
  
  // Round timestamps to reduce precision (saves space)
  if (optimized.timestamp) {
    optimized.timestamp = Math.round(optimized.timestamp / 1000) * 1000;
  }
  
  if (optimized.expiresAt) {
    optimized.expiresAt = Math.round(optimized.expiresAt / 1000) * 1000;
  }
  
  return optimized;
};

/**
 * Remove duplicates from array while preserving order
 */
const removeDuplicatesFromArray = (array) => {
  const seen = new Set();
  return array.filter(item => {
    const key = typeof item === 'object' ? JSON.stringify(item) : item;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/**
 * Get cache statistics for monitoring
 */
export const getCacheStatistics = async () => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter(key => 
      key.startsWith('cache:') || 
      key.startsWith('storage:') ||
      key.startsWith('query:')
    );
    
    let totalSize = 0;
    let expiredCount = 0;
    let validCount = 0;
    const now = Date.now();
    
    // Sample a subset for size calculation (performance optimization)
    const sampleSize = Math.min(50, cacheKeys.length);
    const sampleKeys = cacheKeys.slice(0, sampleSize);
    const sampleData = await AsyncStorage.multiGet(sampleKeys);
    
    for (const [key, value] of sampleData) {
      if (value) {
        totalSize += value.length;
        
        try {
          const parsed = JSON.parse(value);
          if (parsed.expiresAt && now > parsed.expiresAt) {
            expiredCount++;
          } else {
            validCount++;
          }
        } catch (error) {
          // Invalid JSON, count as expired
          expiredCount++;
        }
      }
    }
    
    // Extrapolate from sample
    const totalEntries = cacheKeys.length;
    const estimatedTotalSize = Math.round((totalSize / sampleSize) * totalEntries);
    const estimatedExpired = Math.round((expiredCount / sampleSize) * totalEntries);
    const estimatedValid = Math.round((validCount / sampleSize) * totalEntries);
    
    return {
      totalEntries,
      estimatedTotalSize,
      estimatedValid,
      estimatedExpired,
      healthScore: Math.round((estimatedValid / totalEntries) * 100),
      lastUpdated: now
    };
    
  } catch (error) {
    console.error('Error getting cache statistics:', error);
    return {
      totalEntries: 0,
      estimatedTotalSize: 0,
      estimatedValid: 0,
      estimatedExpired: 0,
      healthScore: 0,
      lastUpdated: Date.now(),
      error: error.message
    };
  }
};

/**
 * Emergency cache reset (for troubleshooting)
 */
export const emergencyCacheReset = async () => {
  console.warn('🚨 Performing emergency cache reset...');
  
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter(key => 
      key.startsWith('cache:') || 
      key.startsWith('storage:') ||
      key.startsWith('query:')
    );
    
    await AsyncStorage.multiRemove(cacheKeys);
    
    console.log(`🗑️ Emergency cache reset completed: ${cacheKeys.length} entries removed`);
    
    return cacheKeys.length;
    
  } catch (error) {
    console.error('Error during emergency cache reset:', error);
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
const createQueryCacheKey = (collectionPath, queryParams = {}) => {
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
const createDocCacheKey = (documentPath) => {
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
const getWithCache = async (cacheKeyParam, fetchData, options = {}) => {
  let cacheKey = null; // Declare cacheKey in the function scope
  
  // Ensure we have a valid cache key before proceeding
  if (cacheKeyParam === undefined || cacheKeyParam === null) {
    console.error('Cache key is undefined or null. Using fallback behavior.');
    if (fetchData) {
      try {
        return await fetchData();
      } catch (error) {
        console.error('Error in fetchData with invalid cache key:', error);
        throw error;
      }
    }
    return null;
  }
  
  try {
    // Ensure cacheKey is a valid string
    cacheKey = typeof cacheKeyParam === 'string' ? cacheKeyParam.trim() : String(cacheKeyParam).trim();
    
    if (!cacheKey) {
      throw new Error('Empty cache key provided');
    }
      
    // Extract options with defaults
    const { 
      ttl = CACHE_TTL.DEFAULT, 
      forceRefresh = false,
      skipMemoryCache = false,
      offline = false, // If true, will only use cache and not call fetchData
      debug = false
    } = options;
    
    const debugLog = debug ? (...args) => console.log('[getWithCache]', ...args) : () => {};
    
    debugLog('Starting with cacheKey:', cacheKey || 'null');
    debugLog('Options:', { ttl, forceRefresh, skipMemoryCache, offline });
  
    // Check if we have a valid cache key
    if (!cacheKey) {
      const error = new Error(`Invalid cacheKey: ${cacheKeyParam}`);
      console.warn('[getWithCache] Invalid cacheKey:', { cacheKey: cacheKeyParam, error });
      if (fetchData) {
        try {
          debugLog('Attempting to fetch fresh data due to invalid cacheKey');
          return await fetchData();
        } catch (fetchError) {
          console.error('[getWithCache] Error in fetchData with invalid cacheKey:', fetchError);
          throw fetchError;
        }
      }
      return null;
    }
  
    // Check if offline-only mode is requested
    if (offline) {
    debugLog('[getWithCache] Offline mode - checking memory cache');
    // Try memory cache first
    if (!skipMemoryCache) {
      try {
        if (memoryCache.has(cacheKey)) {
          const cached = memoryCache.get(cacheKey);
          debugLog('[getWithCache] Found in memory cache:', { cacheKey, cached });
          // For offline mode, we ignore TTL - we need the data regardless of how old it is
          return cached?.data;
        }
      } catch (memCacheError) {
        console.error('[getWithCache] Error accessing memory cache:', memCacheError);
      }
    }
    
    // Try AsyncStorage
    debugLog('[getWithCache] Offline mode - checking AsyncStorage');
    try {
      const cachedItem = await AsyncStorage.getItem(cacheKey);
      if (cachedItem) {
        try {
          const parsed = JSON.parse(cachedItem);
          debugLog('[getWithCache] Retrieved from AsyncStorage:', { cacheKey, parsed });
          if (parsed?.data !== undefined) {
            // Update memory cache
            const cacheEntry = { data: parsed.data, timestamp: parsed.timestamp || Date.now() };
            memoryCache.set(cacheKey, cacheEntry);
            return parsed.data;
          }
        } catch (parseError) {
          console.error(`[getWithCache] Error parsing cached item (${cacheKey}):`, parseError);
          // Remove invalid cache entry
          await AsyncStorage.removeItem(cacheKey).catch(console.error);
        }
      } else {
        debugLog('[getWithCache] No cached item found in AsyncStorage for key:', cacheKey);
      }
    } catch (error) {
      console.error(`[getWithCache] Error reading from AsyncStorage (${cacheKey}):`, error);
    }
    
    // No data available offline
    return null;
  }
  
    // Normal operation (not offline-only)
    debugLog('Online mode - checking caches');
    
    // Check memory cache first for fastest access
  if (!forceRefresh && !skipMemoryCache) {
    try {
      if (memoryCache.has(cacheKey)) {
        const cached = memoryCache.get(cacheKey);
        debugLog('[getWithCache] Memory cache entry:', { cacheKey, cached });
        if (cached && Date.now() - cached.timestamp < ttl) {
          debugLog('[getWithCache] Returning data from memory cache');
          return cached.data;
        }
        debugLog('[getWithCache] Memory cache entry expired or invalid');
      } else {
        debugLog('[getWithCache] No entry in memory cache for key:', cacheKey);
      }
    } catch (error) {
      console.error(`[getWithCache] Error reading from memory cache (${cacheKey}):`, error);
      // Continue to try other cache sources
    }
  }
  
    // Check AsyncStorage next
    if (!forceRefresh) {
    debugLog('[getWithCache] Checking AsyncStorage');
    try {
      const cachedItem = await AsyncStorage.getItem(cacheKey);
      if (cachedItem) {
        try {
          const parsed = JSON.parse(cachedItem);
          debugLog('[getWithCache] Parsed AsyncStorage item:', { cacheKey, parsed });
          
          if (parsed && parsed.data !== undefined && parsed.timestamp) {
            const age = Date.now() - parsed.timestamp;
            debugLog(`[getWithCache] Cache entry age: ${age}ms, TTL: ${ttl}ms`);
            
            if (age < ttl) {
              // Update memory cache with this data
              const cacheEntry = { data: parsed.data, timestamp: parsed.timestamp };
              memoryCache.set(cacheKey, cacheEntry);
              debugLog('[getWithCache] Returning data from AsyncStorage');
              return parsed.data;
            } else {
              debugLog('[getWithCache] Cache entry expired');
            }
          } else {
            debugLog('[getWithCache] Invalid cache entry format');
          }
        } catch (parseError) {
          console.error(`[getWithCache] Error parsing cached item (${cacheKey}):`, parseError);
          // Remove invalid cache entry
          await AsyncStorage.removeItem(cacheKey).catch(console.error);
        }
      } else {
        debugLog('[getWithCache] No cache entry found in AsyncStorage for key:', cacheKey);
      }
    } catch (error) {
      console.error(`[getWithCache] Error reading from AsyncStorage (${cacheKey}):`, error);
    }
  }
  
    // Fetch fresh data
    debugLog('Fetching fresh data');
    
    if (!fetchData) {
      const error = new Error('No fetchData function provided');
      console.error('[getWithCache] Cannot fetch data - no fetchData function');
      throw error;
    }
    
    const data = await fetchData();
    debugLog('Fetched fresh data:', { cacheKey, data: data ? '[data]' : 'null' });
    
    if (data !== undefined) {
      // Update caches
      const timestamp = Date.now();
      const cacheEntry = { data, timestamp };
      
      try {
        // Update memory cache
        memoryCache.set(cacheKey, cacheEntry);
        debugLog('Updated memory cache');
        
        // Queue AsyncStorage update for batch processing
        try {
          pendingUpdates.set(cacheKey, cacheEntry);
          debugLog('Queued AsyncStorage update');
          
          if (!batchUpdateTimeout) {
            debugLog('Setting up batch update timer');
            batchUpdateTimeout = setTimeout(() => {
              debugLog('Executing batch update');
              commitBatchUpdate().catch(error => {
                console.error('[getWithCache] Error in batch update:', error);
              });
            }, BATCH_UPDATE_DELAY);
          }
        } catch (cacheError) {
          console.error('[getWithCache] Error queuing cache update:', cacheError);
        }
      } catch (memCacheError) {
        console.error('[getWithCache] Error updating memory cache:', memCacheError);
      }
    }
    
    return data;
  } catch (error) {
    // Log the error with context for debugging
    logCacheError(error, {
      cacheKey: cacheKey || 'unknown',
      function: 'getWithCache',
      hasFetchData: !!fetchData,
      options
    });
    
    console.error(`[getWithCache] Error in fetchData (${cacheKey || 'unknown'}):`, error);
    
    // If we have a fetchData function, try to use it as a fallback
    if (fetchData) {
      try {
        console.log('[getWithCache] Attempting to fetch fresh data after error');
        return await fetchData();
      } catch (fetchError) {
        console.error('[getWithCache] Error in fetchData after cache error:', fetchError);
        logCacheError(fetchError, {
          cacheKey: cacheKey || 'unknown',
          function: 'getWithCache_fallback',
          originalError: error.message
        });
        throw fetchError;
      }
    }
    
    // Log the error details
    console.error('[getWithCache] Error details:', {
      errorMessage: error.message,
      errorStack: error.stack,
      cacheKey: cacheKey || 'undefined',
      hasFetchData: !!fetchData
    });
    
    throw error; // Re-throw to be handled by the caller
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
const updateCache = (cacheKey, data, updateAsyncStorage = true) => {
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
const removeFromCache = async (cacheKey, removeFromAsyncStorage = true) => {
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
const clearCache = async (prefix = '') => {
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
const invalidateCollectionCache = async (collectionName) => {
  await clearCache(`query:${collectionName}`);
};

/**
 * Batch invalidate cache for multiple collections
 * 
 * @param {string[]} collectionNames - Array of collection names
 */
const batchInvalidateCache = async (collectionNames) => {
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
const storeOfflineData = async (key, data) => {
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
const getOfflineData = async (key, ignoreExpiry = true) => {
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
const getLastCacheUpdateTime = async (cacheKey) => {
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

// Legacy constants and functions for backward compatibility

// Export legacy functions that might be used elsewhere
export {
    batchInvalidateCache,
    clearCache,
    createDocCacheKey,
    createQueryCacheKey,
    getCacheKeys,
    getLastCacheUpdateTime,
    getOfflineData,
    getWithCache,
    invalidateCache,
    invalidateCollectionCache,
    removeFromCache,
    storeOfflineData,
    updateCache
};

// New optimized functions (default export)
export default {
  clearExpiredCache,
  prewarmFrequentlyAccessedCache,
  optimizeCacheStorage,
  getCacheStatistics,
  emergencyCacheReset
};

