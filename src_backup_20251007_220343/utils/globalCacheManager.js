import AsyncStorage from '@react-native-async-storage/async-storage';

// Define CACHE_PREFIX locally to avoid circular dependency
const CACHE_PREFIX = 'firebase_cache_';

// Cache statistics
const cacheStats = {
  hits: 0,
  misses: 0,
  lastAccess: null,
  lastUpdate: null
};

// Ensure the global object exists
const globalObject = global || window || {};

/**
 * Clear cache entries that match a specific pattern
 * @param {string} pattern - The pattern to match against cache keys
 * @returns {Promise<number>} - Number of keys cleared
 */
const clearGlobalCacheByPattern = async (pattern = '') => {
  try {
    // Get all keys from AsyncStorage
    const allKeys = await AsyncStorage.getAllKeys();
    
    // Filter keys that match our cache prefix and the provided pattern
    const cacheKeys = allKeys.filter(key => 
      key.startsWith(CACHE_PREFIX) && 
      (pattern ? key.includes(pattern) : true)
    );
    
    // If no keys match, return early
    if (cacheKeys.length === 0) {
      console.log('No cache keys found matching pattern:', pattern);
      return 0;
    }
    
    // Remove all matching keys
    await AsyncStorage.multiRemove(cacheKeys);
    
    console.log(`Cleared ${cacheKeys.length} cache entries matching pattern: ${pattern}`);
    return cacheKeys.length;
    
  } catch (error) {
    console.error('Error clearing cache by pattern:', error);
    throw error;
  }
};

/**
 * Clear all cache entries
 * @returns {Promise<number>} - Number of keys cleared
 */
const clearAllGlobalCache = async () => {
  return clearGlobalCacheByPattern('');
};

/**
 * Get all cache keys matching a pattern
 * @param {string} pattern - The pattern to match against cache keys
 * @returns {Promise<string[]>} - Array of matching cache keys (without prefix)
 */
const getGlobalCacheKeys = async (pattern = '') => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    return allKeys
      .filter(key => 
        key.startsWith(CACHE_PREFIX) && 
        (pattern ? key.includes(pattern) : true)
      )
      .map(key => key.replace(CACHE_PREFIX, ''));
  } catch (error) {
    console.error('Error getting cache keys:', error);
    throw error;
  }
};

/**
 * Get cache metrics including hit rate and usage statistics
 * @returns {Object} Cache metrics
 */
const getCacheMetrics = () => {
  const totalRequests = cacheStats.hits + cacheStats.misses;
  const hitRate = totalRequests > 0 ? (cacheStats.hits / totalRequests) * 100 : 0;
  
  // Update last access time
  cacheStats.lastAccess = new Date().toISOString();
  
  return {
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    hitRate: Math.round(hitRate * 100) / 100, // Round to 2 decimal places
    lastAccess: cacheStats.lastAccess,
    lastUpdate: cacheStats.lastUpdate,
    timestamp: new Date().toISOString()
  };
};

// Create the cache manager object
const cacheManager = {
  // Cache management methods
  clearByPattern: clearGlobalCacheByPattern,
  clearAll: clearAllGlobalCache,
  getKeys: getGlobalCacheKeys,
  
  // Metrics and stats - provide both method names for backward compatibility
  getMetrics: () => {
    try {
      return getCacheMetrics();
    } catch (error) {
      console.error('Error getting cache metrics:', error);
      return {
        hits: 0,
        misses: 0,
        hitRate: 0,
        lastAccess: null,
        lastUpdate: null,
        timestamp: new Date().toISOString(),
        error: 'Failed to get cache metrics'
      };
    }
  },
  
  // Direct reference to getCacheMetrics for backward compatibility
  getCacheMetrics: getCacheMetrics,
  
  // Update cache stats
  recordHit: () => {
    cacheStats.hits++;
    cacheStats.lastAccess = new Date().toISOString();
  },
  
  recordMiss: () => {
    cacheStats.misses++;
    cacheStats.lastAccess = new Date().toISOString();
  },
  
  // Update last modified time
  updateLastModified: () => {
    cacheStats.lastUpdate = new Date().toISOString();
  }
};

// Create a safe getter for the cache manager
const getGlobalCacheManager = () => {
  if (!globalObject._globalCacheManager) {
    // Ensure all required methods are available
    globalObject._globalCacheManager = {
      ...cacheManager,
      // Add any missing methods that might be expected
      // Ensure getCacheMetrics is directly assigned from the local scope if cacheManager's version is problematic
      getCacheMetrics: cacheManager.getCacheMetrics || getCacheMetrics || (() => ({
        hits: 0,
        misses: 0,
        hitRate: 0,
        lastAccess: null,
        lastUpdate: null,
        isInitialized: false,
        error: 'Fallback metrics'
      }))
    };
  }
  return globalObject._globalCacheManager;
};

// Initialize the global cache manager instance
const globalCacheManager = getGlobalCacheManager();

// Export the cache manager as default
export default globalCacheManager;

// Export individual functions for backward compatibility
export {
    clearAllGlobalCache as clearAll, clearGlobalCacheByPattern as clearByPattern, getGlobalCacheManager, getGlobalCacheKeys as getKeys,
    getCacheMetrics as getMetrics
};

// Also set up the global reference for backward compatibility
if (typeof global !== 'undefined') {
  global._globalCacheManager = globalCacheManager;
}

// Also attach to global for direct access in development
if (__DEV__) {
  global.getCacheManager = getGlobalCacheManager;
}
