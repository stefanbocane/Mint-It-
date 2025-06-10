/**
 * Centralized Cache Management Utility
 * 
 * Consolidates cache operations across the application to:
 * - Eliminate redundant cache keys
 * - Provide consistent cache patterns
 * - Improve memory management
 * - Reduce cache-related bugs
 * 
 * Benefits:
 * - Single source of truth for cache keys
 * - Automatic cache cleanup and optimization
 * - Consistent TTL management
 * - Memory-efficient operations
 */

import { CACHE_KEYS, COLLECTION_CONFIG } from '../constants/collectionConstants';
import CacheService from '../services/caching/CacheService';

class CentralizedCacheManager {
  constructor() {
    this.cacheStats = {
      hits: 0,
      misses: 0,
      sets: 0,
      invalidations: 0,
      cleanups: 0,
      lastReset: Date.now()
    };
    
    this.keyPatterns = new Map();
    this.setupCleanupInterval();
  }

  /**
   * Generate consistent cache keys using centralized patterns
   */
  generateKey(type, ...params) {
    switch (type) {
      case 'user_data':
        return `consolidated_user_${params[0]}_${params[1]}`;
      
      case 'user_cards':
        return CACHE_KEYS.USER_CARDS(params[0], params[1]);
      
      case 'collection':
        return CACHE_KEYS.COLLECTION(params[0], params[1]);
      
      case 'status_verification':
        return CACHE_KEYS.STATUS_VERIFICATION(params[0], params[1]);
      
      case 'user_gems':
        return CACHE_KEYS.USER_GEMS(params[0]);
      
      case 'card_style':
        return `card_style_${params[0]}_${params[1] || 'default'}`;
      
      case 'group_data':
        return `group_data_${params[0]}`;
      
      case 'trade_data':
        return `trade_data_${params[0]}`;
      
      case 'auction_data':
        return `auction_data_${params[0]}`;
      
      default:
        console.warn(`Unknown cache key type: ${type}`);
        return `unknown_${type}_${params.join('_')}`;
    }
  }

  /**
   * Enhanced get operation with statistics tracking
   */
  async get(type, ...params) {
    const key = this.generateKey(type, ...params);
    
    try {
      const result = await CacheService.getValue(key);
      
      if (result !== null && result !== undefined) {
        this.cacheStats.hits++;
        return result;
      } else {
        this.cacheStats.misses++;
        return null;
      }
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      this.cacheStats.misses++;
      return null;
    }
  }

  /**
   * Enhanced set operation with automatic TTL management
   */
  async set(type, data, customTTL = null, ...params) {
    const key = this.generateKey(type, ...params);
    
    // Determine appropriate TTL based on data type
    const ttl = customTTL || this.getDefaultTTL(type);
    
    try {
      await CacheService.setValue(key, data, { ttl });
      this.cacheStats.sets++;
      
      // Track key patterns for cleanup
      this.trackKeyPattern(type, key);
      
      return true;
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get default TTL based on data type
   */
  getDefaultTTL(type) {
    const ttlMap = {
      'user_data': 2 * 60 * 1000, // 2 minutes
      'user_cards': COLLECTION_CONFIG.CACHE_TTL.GENERAL,
      'collection': COLLECTION_CONFIG.CACHE_TTL.GENERAL,
      'status_verification': COLLECTION_CONFIG.DATABASE.STATUS_VERIFICATION_TTL,
      'user_gems': COLLECTION_CONFIG.CACHE_TTL.USER_GEMS,
      'card_style': 10 * 60 * 1000, // 10 minutes
      'group_data': 5 * 60 * 1000, // 5 minutes
      'trade_data': 2 * 60 * 1000, // 2 minutes
      'auction_data': 2 * 60 * 1000, // 2 minutes
    };
    
    return ttlMap[type] || COLLECTION_CONFIG.CACHE_TTL.GENERAL;
  }

  /**
   * Track key patterns for intelligent cleanup
   */
  trackKeyPattern(type, key) {
    if (!this.keyPatterns.has(type)) {
      this.keyPatterns.set(type, new Set());
    }
    this.keyPatterns.get(type).add(key);
  }

  /**
   * Invalidate cache by type or specific key
   */
  async invalidate(type, ...params) {
    if (params.length === 0) {
      // Invalidate all keys of this type
      return this.invalidateByType(type);
    } else {
      // Invalidate specific key
      const key = this.generateKey(type, ...params);
      try {
        await CacheService.invalidate(key);
        this.cacheStats.invalidations++;
        return true;
      } catch (error) {
        console.error(`Cache invalidation error for key ${key}:`, error);
        return false;
      }
    }
  }

  /**
   * Invalidate all keys of a specific type
   */
  async invalidateByType(type) {
    const keys = this.keyPatterns.get(type);
    if (!keys || keys.size === 0) {
      return true;
    }

    try {
      const invalidationPromises = Array.from(keys).map(key => 
        CacheService.invalidate(key).catch(error => 
          console.warn(`Failed to invalidate key ${key}:`, error)
        )
      );
      
      await Promise.all(invalidationPromises);
      this.cacheStats.invalidations += keys.size;
      
      // Clear tracked keys
      this.keyPatterns.set(type, new Set());
      
      return true;
    } catch (error) {
      console.error(`Batch invalidation error for type ${type}:`, error);
      return false;
    }
  }

  /**
   * Invalidate user-specific caches (useful on logout or user change)
   */
  async invalidateUserCaches(userId, groupId) {
    const userCacheTypes = [
      'user_data',
      'user_cards', 
      'collection',
      'user_gems'
    ];

    const invalidationPromises = userCacheTypes.map(type => 
      this.invalidate(type, userId, groupId).catch(error =>
        console.warn(`Failed to invalidate ${type} for user ${userId}:`, error)
      )
    );

    await Promise.all(invalidationPromises);
    console.log(`✅ Invalidated user caches for user ${userId}`);
  }

  /**
   * Smart cache cleanup based on usage patterns
   */
  async performSmartCleanup() {
    try {
      // Clean expired entries using the correct method from cacheUtils
      const { clearExpiredCache } = await import('./cacheUtils');
      const clearedCount = await clearExpiredCache();
      
      // Clean least recently used entries if cache is getting large
      const cacheSize = await this.getCacheSize();
      const maxSize = 1000; // Maximum number of cache entries
      
      if (cacheSize > maxSize) {
        // Note: CacheService doesn't have clearLRU method, skip for now
        console.log(`⚠️ Cache size (${cacheSize}) exceeds maximum (${maxSize}), but LRU cleanup is not implemented`);
      }
      
      this.cacheStats.cleanups++;
      console.log(`🧹 Smart cache cleanup completed. Cleared ${clearedCount} expired entries. Cache size: ${cacheSize}`);
      
    } catch (error) {
      console.error('Smart cache cleanup error:', error);
    }
  }

  /**
   * Get cache size (if supported by cache service)
   */
  async getCacheSize() {
    try {
      return await CacheService.getSize?.() || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Setup automatic cleanup interval
   */
  setupCleanupInterval() {
    // Run cleanup every 10 minutes
    this.cleanupInterval = setInterval(() => {
      this.performSmartCleanup();
    }, 10 * 60 * 1000);
  }

  /**
   * Get cache statistics for monitoring
   */
  getStats() {
    const now = Date.now();
    const timeSinceReset = now - this.cacheStats.lastReset;
    const hours = timeSinceReset / (1000 * 60 * 60);
    
    return {
      ...this.cacheStats,
      hitRate: this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) || 0,
      operationsPerHour: {
        hits: this.cacheStats.hits / hours,
        misses: this.cacheStats.misses / hours,
        sets: this.cacheStats.sets / hours,
        invalidations: this.cacheStats.invalidations / hours
      },
      trackedKeyTypes: Array.from(this.keyPatterns.keys()),
      totalTrackedKeys: Array.from(this.keyPatterns.values()).reduce((sum, set) => sum + set.size, 0)
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.cacheStats = {
      hits: 0,
      misses: 0,
      sets: 0,
      invalidations: 0,
      cleanups: 0,
      lastReset: Date.now()
    };
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.keyPatterns.clear();
  }

  /**
   * Batch operations for better performance
   */
  async batchGet(requests) {
    const promises = requests.map(({ type, params = [] }) => 
      this.get(type, ...params).then(result => ({ type, params, result }))
    );
    
    return Promise.all(promises);
  }

  async batchSet(operations) {
    const promises = operations.map(({ type, data, ttl, params = [] }) => 
      this.set(type, data, ttl, ...params)
    );
    
    return Promise.all(promises);
  }

  async batchInvalidate(requests) {
    const promises = requests.map(({ type, params = [] }) => 
      this.invalidate(type, ...params)
    );
    
    return Promise.all(promises);
  }
}

// Create singleton instance
const centralizedCacheManager = new CentralizedCacheManager();

export default centralizedCacheManager; 