/**
 * @deprecated This file is deprecated. Use services/caching/CacheService.js instead.
 * This is a compatibility layer that forwards requests to the new centralized caching system.
 */

// Import the centralized cache service
import CacheService from '../services/caching/CacheService';
import { CACHE_TTL } from '../constants/cacheConfig';

// Global namespace for the cache
const GLOBAL_NAMESPACE = 'global';

// For compatibility with existing codebase
const warn = () => {
  console.warn('globalCacheManager is deprecated. Use CacheService instead.');
};

// This runs once at import time to warn developers
warn();

// Check global cache before AsyncStorage
export const checkGlobalCache = (key) => {
  warn();
  return CacheService.getFromMemoryCache(GLOBAL_NAMESPACE, key);
};

// Update global cache
export const updateGlobalCache = (key, data, ttl) => {
  warn();
  return CacheService.setInMemoryCache(GLOBAL_NAMESPACE, key, data, ttl);
};

// Get cache performance metrics
export const getCacheMetrics = () => {
  warn();
  const metrics = CacheService.getCacheMetrics();
  return {
    hitRate: metrics.namespaces[GLOBAL_NAMESPACE]?.hitRate || 0,
    hits: metrics.namespaces[GLOBAL_NAMESPACE]?.hits || 0,
    misses: metrics.namespaces[GLOBAL_NAMESPACE]?.misses || 0,
    size: metrics.namespaces[GLOBAL_NAMESPACE]?.size || 0,
    collections: metrics.collections || {}
  };
};

// Clear specific collections from global cache
export const clearGlobalCacheByPattern = (pattern) => {
  warn();
  return CacheService.clearMemoryCache(GLOBAL_NAMESPACE, pattern);
}; 