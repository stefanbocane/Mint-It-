/**
 * Centralized Caching Service
 * 
 * This service provides a unified caching layer that replaces:
 * - globalCacheManager.js
 * - UserCache.js (in-memory part)
 * - enhancedQueryCache.js
 * - Various other cache implementations
 * 
 * Features:
 * - Multi-level caching (memory + AsyncStorage)
 * - LRU eviction policy
 * - TTL support
 * - Namespace support
 * - Performance metrics
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDoc, getDocs } from 'firebase/firestore';

// Default cache TTL values if constants not available
const DEFAULT_CACHE_TTL = {
  SHORT: 60 * 1000,        // 1 minute
  MEDIUM: 5 * 60 * 1000,   // 5 minutes
  LONG: 30 * 60 * 1000,    // 30 minutes
  EXTENDED: 2 * 60 * 60 * 1000, // 2 hours
  PERMANENT: 0             // Never expires
};

// Default memory cache limits if constants not available
const DEFAULT_MEMORY_CACHE_LIMITS = {
  general: 200,
  documents: 100, 
  queries: 50,
  users: 20
};

// Use constants if available, otherwise use defaults
const CACHE_TTL = globalThis.CACHE_TTL || DEFAULT_CACHE_TTL;
const MEMORY_CACHE_LIMITS = globalThis.MEMORY_CACHE_LIMITS || DEFAULT_MEMORY_CACHE_LIMITS;

// Singleton memory cache by namespace
const memoryCaches = new Map();

// Cache statistics
const cacheStats = {
  hits: 0,
  misses: 0,
  collections: {}
};

/**
 * Get or create a memory cache for a specific namespace
 * 
 * @param {string} namespace - Cache namespace
 * @param {number} maxSize - Maximum number of items in this cache
 * @returns {Map} - The memory cache instance
 */
const getOrCreateMemoryCache = (namespace, maxSize) => {
  if (!memoryCaches.has(namespace)) {
    // Create a new cache for this namespace
    memoryCaches.set(namespace, {
      data: new Map(),
      maxSize: maxSize || MEMORY_CACHE_LIMITS.DEFAULT,
      stats: { hits: 0, misses: 0 }
    });
  }
  return memoryCaches.get(namespace);
};

/**
 * Track cache statistics for analytics
 * 
 * @param {string} namespace - Cache namespace
 * @param {string} collection - Collection name
 * @param {boolean} isHit - Whether this was a cache hit
 */
const trackCacheStats = (namespace, collection, isHit) => {
  const cacheObj = memoryCaches.get(namespace);
  if (cacheObj) {
    if (isHit) {
      cacheObj.stats.hits++;
      cacheStats.hits++;
    } else {
      cacheObj.stats.misses++;
      cacheStats.misses++;
    }
  }

  // Track by collection
  if (collection) {
    if (!cacheStats.collections[collection]) {
      cacheStats.collections[collection] = { hits: 0, misses: 0 };
    }
    
    const statsKey = isHit ? 'hits' : 'misses';
    cacheStats.collections[collection][statsKey]++;
  }
};

/**
 * Get a value from memory cache
 * 
 * @param {string} namespace - Cache namespace
 * @param {string} key - Cache key
 * @param {string} collection - Optional collection for metrics
 * @returns {any} - Cached value or null
 */
const getFromMemoryCache = (namespace, key, collection) => {
  const cacheObj = getOrCreateMemoryCache(namespace);
  const dataMap = cacheObj.data;
  
  if (dataMap.has(key)) {
    const entry = dataMap.get(key);
    const now = Date.now();
    
    if (now - entry.timestamp < entry.ttl) {
      // Valid cache entry found
      
      // Move to front of LRU (delete and re-add)
      dataMap.delete(key);
      dataMap.set(key, entry);
      
      // Track metrics
      trackCacheStats(namespace, collection, true);
      
      return entry.data;
    }
    
    // Expired, remove
    dataMap.delete(key);
  }
  
  // Cache miss
  trackCacheStats(namespace, collection, false);
  return null;
};

/**
 * Store a value in memory cache with TTL
 * 
 * @param {string} namespace - Cache namespace
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {number} ttl - Time to live in ms
 */
const setInMemoryCache = (namespace, key, data, ttl) => {
  const cacheObj = getOrCreateMemoryCache(namespace);
  const dataMap = cacheObj.data;
  const maxSize = cacheObj.maxSize;
  
  // Maintain LRU behavior
  if (dataMap.size >= maxSize) {
    const oldestKey = dataMap.keys().next().value;
    dataMap.delete(oldestKey);
  }
  
  // Store with timestamp and TTL
  dataMap.set(key, {
    data,
    timestamp: Date.now(),
    ttl: ttl || CACHE_TTL.DEFAULT
  });
};

/**
 * Clear items from memory cache
 * 
 * @param {string} namespace - Cache namespace
 * @param {string} pattern - Optional pattern to match keys
 * @returns {number} - Number of items cleared
 */
const clearMemoryCache = (namespace, pattern) => {
  const cacheObj = memoryCaches.get(namespace);
  if (!cacheObj) return 0;
  
  const dataMap = cacheObj.data;
  let clearedCount = 0;
  
  if (pattern) {
    // Clear by pattern
    for (const key of [...dataMap.keys()]) {
      if (key.includes(pattern)) {
        dataMap.delete(key);
        clearedCount++;
      }
    }
  } else {
    // Clear all
    clearedCount = dataMap.size;
    dataMap.clear();
  }
  
  return clearedCount;
};

/**
 * Generate a cache key that includes namespace and collection
 * 
 * @param {string} namespace - Cache namespace
 * @param {string} collection - Firestore collection
 * @param {string} id - Document or query identifier
 * @returns {string} - Formatted cache key
 */
const createCacheKey = (namespace, collection, id) => {
  return `${namespace}:${collection}:${id}`;
};

/**
 * Get value from AsyncStorage with memory cache fallback
 * 
 * @param {string} key - Full storage key
 * @param {string} collection - Optional collection name for metrics
 * @returns {Promise<any>} - Parsed data or null
 */
const getFromStorage = async (key, collection) => {
  try {
    const value = await AsyncStorage.getItem(key);
    if (value !== null) {
      const parsed = JSON.parse(value);
      
      // Check expiration
      if (parsed.expiry && Date.now() > parsed.expiry) {
        // Expired
        AsyncStorage.removeItem(key).catch(() => {});
        return null;
      }
      
      return parsed.data;
    }
  } catch (error) {
    console.error(`Error getting from storage (${key}):`, error);
  }
  return null;
};

/**
 * Store value in AsyncStorage with expiration
 * 
 * @param {string} key - Storage key
 * @param {any} data - Data to store
 * @param {number} ttl - Time to live in ms
 */
const setInStorage = async (key, data, ttl) => {
  try {
    const expiry = ttl ? Date.now() + ttl : null;
    await AsyncStorage.setItem(
      key,
      JSON.stringify({
        data,
        expiry,
        timestamp: Date.now()
      })
    );
  } catch (error) {
    console.error(`Error setting in storage (${key}):`, error);
  }
};

/**
 * Get cache performance metrics
 * 
 * @returns {Object} - Cache metrics
 */
const getCacheMetrics = () => {
  const totalRequests = cacheStats.hits + cacheStats.misses;
  const hitRate = totalRequests > 0 ? cacheStats.hits / totalRequests : 0;
  
  const namespaceStats = {};
  for (const [namespace, cache] of memoryCaches.entries()) {
    const nsTotal = cache.stats.hits + cache.stats.misses;
    const nsHitRate = nsTotal > 0 ? cache.stats.hits / nsTotal : 0;
    
    namespaceStats[namespace] = {
      size: cache.data.size,
      maxSize: cache.maxSize,
      hits: cache.stats.hits,
      misses: cache.stats.misses,
      hitRate: Math.round(nsHitRate * 100)
    };
  }
  
  return {
    overall: {
      hitRate: Math.round(hitRate * 100),
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      totalRequests
    },
    namespaces: namespaceStats,
    collections: cacheStats.collections
  };
};

// Namespace-specific helper functions

/**
 * User cache functions - replaces UserCache.js
 */

/**
 * Get user data with multi-level caching
 * 
 * @param {string} userId - User ID
 * @param {Object} options - Cache options
 * @returns {Promise<Object>} - User data
 */
const getUser = async (userId, options = {}) => {
  if (!userId) return null;
  
  const namespace = 'users';
  const collection = 'users';
  const cacheKey = createCacheKey(namespace, collection, userId);
  
  // Check memory cache first (fastest)
  const memoryResult = getFromMemoryCache(namespace, cacheKey, collection);
  if (memoryResult) return memoryResult;
  
  // Default TTL from options or config
  const ttl = options.ttl || CACHE_TTL.USER_PROFILE;
  
  try {
    // Try from AsyncStorage next
    const storageKey = `storage:${cacheKey}`;
    const storageResult = await getFromStorage(storageKey);
    
    if (storageResult && !options.forceRefresh) {
      // Store in memory cache for faster access next time
      setInMemoryCache(namespace, cacheKey, storageResult, ttl);
      return storageResult;
    }
    
    // Fallback to Firestore if needed
    // Use the existing getCachedDoc from firestoreUtils
    const { getCachedDoc } = require('../../utils/firestoreUtils');
    const userData = await getCachedDoc(collection, userId, options);
    
    if (userData) {
      // Update both memory and AsyncStorage caches
      setInMemoryCache(namespace, cacheKey, userData, ttl);
      await setInStorage(storageKey, userData, ttl);
    }
    
    return userData;
  } catch (error) {
    console.error(`Error in getUser for ${userId}:`, error);
    return null;
  }
};

/**
 * Document/query cache functions - replaces functions from enhancedQueryCache.js
 * and firestoreUtils.js getCachedDoc function
 */

/**
 * Get a document with intelligent caching
 * This replaces both getCachedDoc from firestoreUtils and
 * getDocumentWithEnhancedCache from enhancedQueryCache
 * 
 * @param {string|DocumentReference} collectionOrDocRef - Collection name or document reference
 * @param {string|Object} documentIdOrOptions - Document ID or options object
 * @param {Object} options - Cache options
 * @returns {Promise<Object|null>} - Document data or null
 */
/**
 * Get a document with intelligent caching
 * This replaces both getCachedDoc from firestoreUtils and
 * getDocumentWithEnhancedCache from enhancedQueryCache
 *
 * @param {string|DocumentReference} collectionOrDocRef - Collection name or document reference
 * @param {string|Object} documentIdOrOptions - Document ID or options object
 * @param {Object} options - Cache options
 * @returns {Promise<Object|null>} - Document data or null
 */
const getDocument = async (collectionOrDocRef, documentIdOrOptions, options = {}) => {
  let collectionName, documentId, docRef;
  
  try {
    // Handle different parameter formats
    if (typeof collectionOrDocRef === 'string') {
      // Format: getDocument(collectionName, documentId, options)
      collectionName = collectionOrDocRef;
      documentId = documentIdOrOptions;
    } else if (collectionOrDocRef && collectionOrDocRef.path) {
      // Format: getDocument(docRef, options)
      docRef = collectionOrDocRef;
      options = documentIdOrOptions || {};
      
      // Go straight to Firestore for document reference
      console.log(`Cache: Direct Firestore fetch for document reference`);
      const docSnapshot = await getDoc(docRef);
      if (!docSnapshot.exists()) {
        return null;
      }
      
      // Return document data with ID
      const data = docSnapshot.data();
      return { id: docSnapshot.id, ...data };
    } else {
      // Invalid parameters
      console.error('Cache: Invalid parameters for getDocument', { collectionOrDocRef, documentIdOrOptions });
      return null;
    }
  } catch (error) {
    console.error(`Cache: Error parsing document reference: ${error.message}`);
    // If we're here, try direct Firestore access as last resort
    if (docRef) {
      try {
        const docSnapshot = await getDoc(docRef);
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          return { id: docSnapshot.id, ...data };
        }
      } catch (finalError) {
        console.error(`Cache: Final error fetching document: ${finalError.message}`);
      }
    }
    return null;
  }
  
  if (!collectionName || !documentId) return null;
  
  const namespace = 'documents';
  const cacheKey = createCacheKey(namespace, collectionName, documentId);
  
  // Check memory cache first (fastest)
  const memoryResult = getFromMemoryCache(namespace, cacheKey, collectionName);
  if (memoryResult && !options.forceRefresh) return memoryResult;
  
  // Default TTL from options or config
  const ttl = options.ttl || CACHE_TTL.DEFAULT;
  
  try {
    // Try from AsyncStorage next
    const storageKey = `storage:${cacheKey}`;
    const storageResult = await getFromStorage(storageKey, collectionName);
    
    if (storageResult && !options.forceRefresh) {
      // Store in memory cache for faster access next time
      setInMemoryCache(namespace, cacheKey, storageResult, ttl);
      return storageResult;
    }
    
    // If not in cache or force refresh, fetch from Firestore
    const { getDoc, doc } = require('firebase/firestore');
    const { db } = require('../../config/firebase');
    
    const docRef = doc(db, collectionName, documentId);
    const docSnapshot = await getDoc(docRef);
    
    if (docSnapshot.exists()) {
      const docData = { id: docSnapshot.id, ...docSnapshot.data() };
      
      // Update both memory and AsyncStorage caches
      setInMemoryCache(namespace, cacheKey, docData, ttl);
      await setInStorage(storageKey, docData, ttl);
      
      return docData;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching document ${collectionName}/${documentId}:`, error);
    return null;
  }
};

/**
 * Get multiple documents with efficient batching and caching
 * 
 * @param {string} collectionName - Collection name
 * @param {string[]} documentIds - Array of document IDs
 * @param {Object} options - Cache options
 * @returns {Promise<Object[]>} - Array of documents
 */
/**
 * Get multiple documents with efficient batching and caching
 * 
 * @param {string} collectionName - Collection name
 * @param {string[]} documentIds - Array of document IDs
 * @param {Object} options - Cache options
 * @returns {Promise<Object[]>} - Array of documents
 */
const getDocuments = async (collectionName, documentIds, options = {}) => {
  if (!documentIds || !documentIds.length) return [];
  
  // Filter out duplicates
  const uniqueIds = [...new Set(documentIds)];
  
  // Use Promise.all to fetch all documents in parallel
  const docPromises = uniqueIds.map(id => getDocument(collectionName, id, options));
  const docs = await Promise.all(docPromises);
  
  // Filter out null results
  return docs.filter(Boolean);
};

/**
 * Get a value from cache with simple key-value interface
 * 
 * @param {string} key - Cache key
 * @param {Object} options - Cache options
 * @returns {Promise<any>} - Cached value or null
 */
const getValue = async (key, options = {}) => {
  try {
    return getFromMemoryCache('general', key, 'general');
  } catch (error) {
    console.error(`Cache: Error in getValue for key ${key}: ${error.message}`);
    return null;
  }
};

/**
 * Set a value in cache with simple key-value interface
 * 
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {Object} options - Cache options
 * @returns {Promise<boolean>} - Success flag
 */
const setValue = async (key, value, options = {}) => {
  try {
    const ttl = options.ttl || CACHE_TTL.MEDIUM;
    setInMemoryCache('general', key, value, ttl);
    return true;
  } catch (error) {
    console.error(`Cache: Error in setValue for key ${key}: ${error.message}`);
    return false;
  }
};

/**
 * Get a value from cache synchronously (memory only)
 * 
 * @param {string} key - Cache key
 * @returns {any} - Cached value or null
 */
const getValueSync = (key) => {
  try {
    return getFromMemoryCache('general', key, 'general');
  } catch (error) {
    console.error(`Cache: Error in getValueSync for key ${key}: ${error.message}`);
    return null;
  }
};

/**
 * Set a value in cache synchronously (memory only)
 * 
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {Object} options - Cache options
 * @returns {boolean} - Success flag
 */
const setValueSync = (key, value, options = {}) => {
  try {
    const ttl = options?.ttl || CACHE_TTL.MEDIUM;
    setInMemoryCache('general', key, value, ttl);
    return true;
  } catch (error) {
    console.error(`Cache: Error in setValueSync for key ${key}: ${error.message}`);
    return false;
  }
};

/**
 * Invalidate a cache entry
 * 
 * @param {string} key - Cache key to invalidate
 * @returns {Promise<boolean>} - Success flag
 */
const invalidate = async (key) => {
  try {
    // Clear from memory cache
    clearMemoryCache('general', key);
    // Clear from storage if needed
    try {
      await AsyncStorage.removeItem(`general:${key}`);
    } catch (storageError) {
      console.warn('Error removing from AsyncStorage:', storageError);
    }
    return true;
  } catch (error) {
    console.error('Error invalidating cache:', error);
    return false;
  }
};

/**
 * Clear all cache entries
 * 
 * @returns {Promise<boolean>} - Success flag
 */
const clearAll = async () => {
  try {
    // Clear all memory caches
    memoryCaches.forEach((cache, namespace) => {
      cache.clear();
    });
    memoryCaches.clear();
    
    // Reset stats
    cacheStats.hits = 0;
    cacheStats.misses = 0;
    cacheStats.collections = {};
    
    // Try to clear AsyncStorage cache
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(key => key.includes(':'));
      if (cacheKeys.length > 0) {
        await AsyncStorage.multiRemove(cacheKeys);
      }
    } catch (storageError) {
      console.warn('Error clearing AsyncStorage cache:', storageError);
    }
    
    return true;
  } catch (error) {
    console.error('Error clearing all caches:', error);
    return false;
  }
};

/**
 * Get pagination cache statistics
 * 
 * @returns {Object} - Pagination cache stats
 */
const getPaginationCacheStats = async () => {
  return {
    totalCaches: Object.keys(cacheStats.collections).length,
    collections: cacheStats.collections
  };
};

/**
 * Get query access report
 * 
 * @returns {Array} - Query access statistics
 */
const getQueryAccessReport = async () => {
  const collections = Object.keys(cacheStats.collections);
  return collections.map(collectionName => {
    const stats = cacheStats.collections[collectionName] || {};
    return {
      collection: collectionName,
      hits: stats.hits || 0,
      misses: stats.misses || 0,
      hitRate: stats.hits + stats.misses > 0 ? 
        Math.round((stats.hits / (stats.hits + stats.misses)) * 100) : 0
    };
  }).sort((a, b) => (b.hits + b.misses) - (a.hits + a.misses));
};

// Create a unified CacheService object with all methods
const CacheService = {
  // Memory cache functions
  getFromMemoryCache,
  setInMemoryCache,
  clearMemoryCache,
  createCacheKey,
  
  // Storage functions
  getFromStorage,
  setInStorage,
  
  // Metrics
  getCacheMetrics,
  
  // User cache (former UserCache.js)
  getUser,
  
  // Document/query cache functions
  getDocument,
  getDocuments,
  
  // Simple key-value interface
  getValue,
  setValue,
  getValueSync,
  setValueSync,
  
  // Cache management
  invalidate,
  clearAll,
  
  // Analytics
  getPaginationCacheStats,
  getQueryAccessReport
};

// Export both as default and individual functions
export {
  getFromMemoryCache,
  setInMemoryCache,
  clearMemoryCache,
  createCacheKey,
  getFromStorage,
  setInStorage,
  getCacheMetrics,
  getUser,
  getDocument,
  getDocuments,
  getValue,
  setValue,
  getValueSync,
  setValueSync,
  invalidate,
  clearAll,
  getPaginationCacheStats,
  getQueryAccessReport
};

export default CacheService;
