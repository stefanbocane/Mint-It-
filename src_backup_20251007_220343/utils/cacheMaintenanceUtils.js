import { CACHE_MAINTENANCE, MEMORY_CACHE_LIMITS } from '../constants/cacheConfig';
import { clearExpiredCache, getCacheKeys } from './cacheUtils';

// Store references to cleanup timers
let cacheCleanupTimer = null;
let memoryCacheCleanupTimer = null;

// Store references to memory caches for cleanup
const memoryCaches = new Map();

/**
 * Register a memory cache for cleanup
 * 
 * @param {string} cacheId - Unique identifier for the memory cache
 * @param {Map} cacheInstance - The memory cache instance
 */
export const registerMemoryCache = (cacheId, cacheInstance) => {
  memoryCaches.set(cacheId, cacheInstance);
};

/**
 * Start the cache maintenance task
 * Should be called during app initialization
 */
export const startCacheMaintenanceTasks = () => {
  stopCacheMaintenanceTasks(); // Ensure no duplicate timers
  
  // Schedule async storage cache cleanup
  cacheCleanupTimer = setInterval(() => {
    console.log('Running scheduled cache maintenance...');
    clearExpiredCache(CACHE_MAINTENANCE.MAX_CACHE_AGE)
      .then(count => {
        console.log(`Cache maintenance completed, cleared ${count} expired entries`);
      })
      .catch(error => {
        console.error('Error during cache maintenance:', error);
      });
  }, CACHE_MAINTENANCE.CLEANUP_INTERVAL);
  
  // Schedule memory cache cleanup
  memoryCacheCleanupTimer = setInterval(() => {
    console.log('Running memory cache cleanup...');
    cleanupMemoryCaches();
  }, CACHE_MAINTENANCE.MEMORY_CACHE_CLEANUP);
};

/**
 * Stop all cache maintenance tasks
 * Should be called when app is terminated
 */
export const stopCacheMaintenanceTasks = () => {
  if (cacheCleanupTimer) {
    clearInterval(cacheCleanupTimer);
    cacheCleanupTimer = null;
  }
  
  if (memoryCacheCleanupTimer) {
    clearInterval(memoryCacheCleanupTimer);
    memoryCacheCleanupTimer = null;
  }
};

/**
 * Clean up memory caches to prevent memory leaks
 */
const cleanupMemoryCaches = () => {
  let totalCleared = 0;
  
  for (const [cacheId, cacheInstance] of memoryCaches.entries()) {
    if (cacheInstance instanceof Map) {
      const now = Date.now();
      const itemsToDelete = [];
      
      // Find expired entries
      for (const [key, value] of cacheInstance.entries()) {
        if (value.timestamp && (now - value.timestamp) > CACHE_MAINTENANCE.MAX_CACHE_AGE) {
          itemsToDelete.push(key);
        }
      }
      
      // Delete expired entries
      for (const key of itemsToDelete) {
        cacheInstance.delete(key);
        totalCleared++;
      }
      
      console.log(`Cleared ${itemsToDelete.length} expired items from memory cache '${cacheId}'`);
    }
  }
  
  console.log(`Memory cache cleanup completed, cleared ${totalCleared} expired entries`);
};

/**
 * Get cache statistics for monitoring
 * @returns {Promise<Object>} Cache statistics
 */
export const getCacheStats = async () => {
  try {
    // Get all cache keys
    const cacheKeys = await getCacheKeys();
    
    // Organize by collection type
    const stats = {
      total: cacheKeys.length,
      collections: {},
      memory: {}
    };
    
    // Count keys by collection prefix
    for (const key of cacheKeys) {
      const parts = key.split('_');
      if (parts.length >= 2) {
        const type = parts[0]; // 'doc' or 'query'
        const collection = parts[1].split('/')[0]; // Extract collection name
        
        if (!stats.collections[collection]) {
          stats.collections[collection] = { total: 0, docs: 0, queries: 0 };
        }
        
        stats.collections[collection].total++;
        if (type === 'doc') {
          stats.collections[collection].docs++;
        } else if (type === 'query') {
          stats.collections[collection].queries++;
        }
      }
    }
    
    // Add memory cache stats
    for (const [cacheId, cacheInstance] of memoryCaches.entries()) {
      if (cacheInstance instanceof Map) {
        stats.memory[cacheId] = {
          size: cacheInstance.size,
          limit: MEMORY_CACHE_LIMITS[cacheId.toUpperCase()] || 'unknown'
        };
      }
    }
    
    return stats;
  } catch (error) {
    console.error('Error getting cache stats:', error);
    return { error: error.message };
  }
}; 