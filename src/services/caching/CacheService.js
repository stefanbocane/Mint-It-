/**
 * Centralized Caching Service - Enhanced for Step 3.F.1
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
 * - STEP 3.F.1: Enhanced client-side caching strategies
 * - Cache-aside pattern implementation
 * - Intelligent cache warming
 * - User profile and settings optimization
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, documentId as firestoreDocumentId, getDoc, getDocs, query, where } from 'firebase/firestore';

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
  try {
    // Return default metrics if cache manager is not initialized
    if (!cacheStats || !memoryCaches) {
      return {
        hits: 0,
        misses: 0,
        hitRate: 0,
        namespaces: {},
        lastAccess: null,
        lastUpdate: null,
        isInitialized: false,
        error: 'Cache not initialized'
      };
    }

    const totalRequests = (cacheStats.hits || 0) + (cacheStats.misses || 0);
    const hitRate = totalRequests > 0 ? (cacheStats.hits || 0) / totalRequests : 0;
    
    const namespaceStats = {};
    for (const [namespace, cache] of memoryCaches.entries()) {
      const nsHits = cache.stats?.hits || 0;
      const nsMisses = cache.stats?.misses || 0;
      const nsTotal = nsHits + nsMisses;
      const nsHitRate = nsTotal > 0 ? nsHits / nsTotal : 0;
      
      namespaceStats[namespace] = {
        hits: nsHits,
        misses: nsMisses,
        hitRate: nsHitRate,
        size: cache.data?.size || 0,
        maxSize: cache.maxSize || 0
      };
    }

    return {
      hits: cacheStats.hits || 0,
      misses: cacheStats.misses || 0,
      hitRate: hitRate,
      totalRequests: totalRequests,
      namespaces: namespaceStats,
      collections: cacheStats.collections || {},
      lastAccess: cacheStats.lastAccess || null,
      lastUpdate: cacheStats.lastUpdate || null,
      isInitialized: true,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error getting cache metrics:', error);
    return {
      hits: 0,
      misses: 0,
      hitRate: 0,
      namespaces: {},
      lastAccess: null,
      lastUpdate: null,
      isInitialized: false,
      error: error.message || 'Error getting cache metrics'
    };
  }
};

// All namespace-specific helper functions are now unified below. If you need user, document, or query cache, use the methods on the CacheService object. See JSDoc for details.

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
      // console.log(`Cache: Direct Firestore fetch for document reference: ${docRef.path}`); // Example of more detailed logging
      const docSnapshot = await getDoc(docRef); // Uses imported getDoc
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
    console.error(`Cache: Error parsing document reference or initial fetch: ${error.message}`, { collectionOrDocRef, documentIdOrOptions });
    // If docRef was intended, attempt a direct fetch as a last resort.
    if (docRef) {
      try {
        // console.log(`Cache: Attempting fallback direct fetch for docRef: ${docRef.path}`);
        const docSnapshot = await getDoc(docRef);
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          return { id: docSnapshot.id, ...data };
        }
      } catch (finalError) {
        console.error(`Cache: Final error fetching document via docRef: ${finalError.message}`);
      }
    }
    return null;
  }
  
  if (!collectionName || !documentId) {
    // console.warn('Cache: getDocument called with invalid collectionName or documentId.', { collectionName, documentId });
    return null;
  }
  
  const namespace = 'documents';
  const cacheKey = createCacheKey(namespace, collectionName, documentId);
  
  // OPTIMIZATION: Support field selection for reduced payload
  const { fields = null, priority = 'normal' } = options;
  
  // Check memory cache first (fastest)
  if (!options.forceRefresh) {
    const memoryResult = getFromMemoryCache(namespace, cacheKey, collectionName);
    if (memoryResult !== null && memoryResult !== undefined) { // Ensure to handle null if "not found" is cached
      // console.log(`Cache HIT (Memory): ${cacheKey}`);
      
      // OPTIMIZATION: Apply field filtering to cached data if specified
      if (fields && Array.isArray(fields)) {
        const filteredData = { id: memoryResult.id };
        fields.forEach(field => {
          if (memoryResult[field] !== undefined) {
            filteredData[field] = memoryResult[field];
          }
        });
        return filteredData;
      }
      
      return memoryResult;
    }
  }
  
  // Default TTL from options or config
  const ttl = options.ttl || CACHE_TTL.MEDIUM; 
  
  try {
    // Try from AsyncStorage next
    if (!options.forceRefresh) {
      const storageKey = `storage:${cacheKey}`;
      const storageResult = await getFromStorage(storageKey, collectionName);
    
      if (storageResult !== null && storageResult !== undefined) {
        // console.log(`Cache HIT (Storage): ${storageKey}`);
        // Store in memory cache for faster access next time
        setInMemoryCache(namespace, cacheKey, storageResult, ttl);
        
        // OPTIMIZATION: Apply field filtering to cached storage data if specified
        if (fields && Array.isArray(fields)) {
          const filteredData = { id: storageResult.id };
          fields.forEach(field => {
            if (storageResult[field] !== undefined) {
              filteredData[field] = storageResult[field];
            }
          });
          return filteredData;
        }
        
        return storageResult;
      }
    }
    
    // console.log(`Cache MISS: ${cacheKey}. Fetching from Firestore.`);
    // If not in cache or force refresh, fetch from Firestore
    const { doc } = require('firebase/firestore'); 
    const { db } = require('../../config/firebase');
    
    const firestoreDocRef = doc(db, collectionName, documentId);
    const docSnapshot = await getDoc(firestoreDocRef); 
    
    if (docSnapshot.exists()) {
      const docData = { id: docSnapshot.id, ...docSnapshot.data() };
      
      // Update both memory and AsyncStorage caches (store full data)
      setInMemoryCache(namespace, cacheKey, docData, ttl);
      const storageKey = `storage:${cacheKey}`;
      // console.log(`Cache SET: ${cacheKey} (memory) & ${storageKey} (storage) for ID ${docSnapshot.id}`);
      await setInStorage(storageKey, docData, ttl);
      
      // OPTIMIZATION: Apply field filtering if specified
      if (fields && Array.isArray(fields)) {
        const filteredData = { id: docData.id };
        fields.forEach(field => {
          if (docData[field] !== undefined) {
            filteredData[field] = docData[field];
          }
        });
        return filteredData;
      }
      
      return docData;
    } else {
      // console.log(`Cache Firestore MISS: Document ${collectionName}/${documentId} does not exist.`);
      // Optionally cache "not found" for a short period to prevent repeated lookups for non-existent docs
      // setInMemoryCache(namespace, cacheKey, null, CACHE_TTL.SHORT); // Example
      // await setInStorage(`storage:${cacheKey}`, null, CACHE_TTL.SHORT); // Example
    }
    return null;
  } catch (error) {
    console.error(`Error in getDocument for ${collectionName}/${documentId}:`, error);
    return null;
  }
};

/**
 * Get multiple documents with efficient batching and caching
 * 
 * @param {string} collectionName - Collection name
 * @param {string[]} documentIds - Array of document IDs
 * @param {Object} options - Cache options (e.g., ttl, forceRefresh)
 * @returns {Promise<Object[]>} - Array of documents, preserving original order where possible for found items
 */
const getDocuments = async (collectionName, documentIds, options = {}) => {
  if (!collectionName || typeof collectionName !== 'string') {
    console.error('Cache: getDocuments called with invalid collectionName.', { collectionName });
    return [];
  }
  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    return [];
  }

  const uniqueIds = [...new Set(documentIds.filter(id => typeof id === 'string' && id.trim() !== ''))];
  if (uniqueIds.length === 0) {
    return [];
  }

  const resultsMap = new Map(); // To store fetched documents by ID for correct ordering
  const idsToFetchFromFirestore = [];
  const namespace = 'documents';
  const ttl = options.ttl || CACHE_TTL.MEDIUM;

  // console.log(`Cache: getDocuments for ${collectionName}`, { count: uniqueIds.length, forceRefresh: options.forceRefresh });

  if (options.forceRefresh) {
    idsToFetchFromFirestore.push(...uniqueIds);
    // console.log(`Cache: Force refresh, all ${uniqueIds.length} IDs will be fetched from Firestore.`);
  } else {
    // Check caches first
    for (const id of uniqueIds) {
      const cacheKey = createCacheKey(namespace, collectionName, id);
      const memoryResult = getFromMemoryCache(namespace, cacheKey, collectionName);

      if (memoryResult !== null && memoryResult !== undefined) { // Ensure to handle null if "not found" is cached
        // console.log(`Cache HIT (Memory): ${cacheKey} for ID ${id}`);
        resultsMap.set(id, memoryResult);
      } else {
        const storageKey = `storage:${cacheKey}`;
        const storageResult = await getFromStorage(storageKey, collectionName);
        if (storageResult !== null && storageResult !== undefined) {
          // console.log(`Cache HIT (Storage): ${storageKey} for ID ${id}`);
          resultsMap.set(id, storageResult);
          setInMemoryCache(namespace, cacheKey, storageResult, ttl); // Populate memory cache
        } else {
          // console.log(`Cache MISS (Memory & Storage): ${cacheKey} for ID ${id}`);
          idsToFetchFromFirestore.push(id);
        }
      }
    }
  }

  // Fetch remaining documents from Firestore in batches
  if (idsToFetchFromFirestore.length > 0) {
    // console.log(`Cache: Fetching ${idsToFetchFromFirestore.length} IDs from Firestore for collection ${collectionName}.`);
    const { db } = require('../../config/firebase');
    // Firestore 'in' query supports up to 30 elements as of last update
    const batchSize = 30; 
    for (let i = 0; i < idsToFetchFromFirestore.length; i += batchSize) {
      const batchOfIds = idsToFetchFromFirestore.slice(i, i + batchSize);
      if (batchOfIds.length === 0) continue;

      // console.log(`Cache: Firestore batch fetch for ${collectionName}`, { batch: (i / batchSize) + 1, ids: batchOfIds });
      try {
        const docsQuery = query(
          collection(db, collectionName),
          where(firestoreDocumentId(), 'in', batchOfIds)
        );
        const querySnapshot = await getDocs(docsQuery);

        // console.log(`Cache: Firestore batch response for ${collectionName}`, { count: querySnapshot.size });
        querySnapshot.forEach(docSnap => {
          if (docSnap.exists()) {
            const docData = { id: docSnap.id, ...docSnap.data() };
            resultsMap.set(docSnap.id, docData);
            
            const cacheKey = createCacheKey(namespace, collectionName, docSnap.id);
            const storageKey = `storage:${cacheKey}`;
            // console.log(`Cache SET: ${cacheKey} (memory) & ${storageKey} (storage) for ID ${docSnap.id}`);
            setInMemoryCache(namespace, cacheKey, docData, ttl);
            setInStorage(storageKey, docData, ttl).catch(err => { // Non-blocking, log error
              console.warn(`Cache: Failed to set document ${docSnap.id} in AsyncStorage during batch fetch:`, err);
            });
          } else {
            // This case should ideally not happen if IDs are valid, but good to be aware.
            // console.warn(`Cache: Document ID ${docSnap.id} from batch query did not exist in ${collectionName}.`);
          }
        });
        
        // For IDs in the batch that were not returned by Firestore (e.g., non-existent),
        // we might want to cache them as "not found" to prevent repeated lookups.
        const fetchedIdsInBatch = new Set(querySnapshot.docs.map(d => d.id));
        for (const idInBatch of batchOfIds) {
            if (!fetchedIdsInBatch.has(idInBatch)) {
                // console.log(`Cache: Document ${collectionName}/${idInBatch} not found in Firestore batch. Caching as null.`);
                // resultsMap.set(idInBatch, null); // Explicitly mark as not found
                // const cacheKey = createCacheKey(namespace, collectionName, idInBatch);
                // setInMemoryCache(namespace, cacheKey, null, CACHE_TTL.SHORT); // Cache "not found"
                // const storageKey = `storage:${cacheKey}`;
                // setInStorage(storageKey, null, CACHE_TTL.SHORT).catch(err => {
                //   console.warn(`Cache: Failed to set "not found" for ${idInBatch} in AsyncStorage:`, err);
                // });
            }
        }

      } catch (error) {
        console.error(`Cache: Error fetching batch of documents from ${collectionName}:`, error, { batchOfIds });
        // If a batch fails, those IDs won't be in resultsMap.
        // Consider how to handle this (e.g., retry, mark as error, etc.)
      }
    }
  }

  // Assemble results in the original order of uniqueIds, returning only found documents
  // or null for documents explicitly cached as not found (if that logic is added)
  return uniqueIds.map(id => resultsMap.get(id)).filter(doc => doc !== undefined);
};

/**
 * Get a value from cache with simple key-value interface
 * ENHANCED FOR ULTRA-OPTIMIZATION: Supports both memory and storage fallback
 * 
 * @param {string} key - Cache key
 * @param {Object} options - Cache options
 * @returns {Promise<any>} - Cached value or null
 */
const getValue = async (key, options = {}) => {
  try {
    // First try memory cache for fastest access
    const memoryValue = getFromMemoryCache('general', key, 'general');
    if (memoryValue !== null) {
      return memoryValue;
    }
    
    // Fallback to AsyncStorage for persistence across app restarts
    const storageValue = await getFromStorage(key, 'general');
    if (storageValue !== null) {
      // Repopulate memory cache for next access
      const ttl = options.ttl || CACHE_TTL.MEDIUM;
      setInMemoryCache('general', key, storageValue, ttl);
      return storageValue;
    }
    
    return null;
  } catch (error) {
    console.error(`Cache: Error in getValue for key ${key}: ${error.message}`);
    return null;
  }
};

/**
 * Set a value in cache with simple key-value interface
 * ENHANCED FOR ULTRA-OPTIMIZATION: Stores in both memory and storage
 * 
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {Object} options - Cache options
 * @returns {Promise<boolean>} - Success flag
 */
const setValue = async (key, value, options = {}) => {
  try {
    const ttl = options.ttl || CACHE_TTL.MEDIUM;
    
    // Store in memory cache for immediate access
    setInMemoryCache('general', key, value, ttl);
    
    // Store in AsyncStorage for persistence (async, non-blocking)
    setInStorage(key, value, ttl).catch(err => {
      console.warn(`AsyncStorage failed for key ${key}:`, err);
    });
    
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
 * Invalidate a specific document cache entry
 * 
 * @param {string} collectionName - Collection name
 * @param {string} documentId - Document ID
 * @returns {Promise<boolean>} - Success flag
 */
const invalidateDocument = async (collectionName, documentId) => {
  try {
    const namespace = 'documents';
    const cacheKey = createCacheKey(namespace, collectionName, documentId);
    const storageKey = `storage:${cacheKey}`;
    
    // Clear from memory cache
    clearMemoryCache(namespace, cacheKey);
    
    // Clear from storage
    try {
      await AsyncStorage.removeItem(storageKey);
    } catch (storageError) {
      console.warn('Error removing document from AsyncStorage:', storageError);
    }
    
    return true;
  } catch (error) {
    console.error(`Error invalidating document cache for ${collectionName}/${documentId}:`, error);
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

/**
 * Get query results with caching support
 * 
 * @param {Query} firestoreQuery - Firestore Query object
 * @param {Object} options - Cache options
 * @returns {Promise<Array>} - Query results
 */
const getQuery = async (firestoreQuery, options = {}) => {
  try {
    const { forceRefresh = false, ttl = CACHE_TTL.MEDIUM } = options;
    
    // Extract query information to create a cache key
    // Use a simple hash function instead of Buffer for React Native compatibility
    const queryString = firestoreQuery.toString();
    const simpleHash = queryString.split('').reduce((hash, char) => {
      return ((hash << 5) - hash + char.charCodeAt(0)) & 0x7fffffff;
    }, 0);
    const cacheKey = `query:${simpleHash}`;
    const namespace = 'queries';
    
    // Check memory cache first (unless force refresh)
    if (!forceRefresh) {
      const memoryResult = getFromMemoryCache(namespace, cacheKey, 'queries');
      if (memoryResult !== null && memoryResult !== undefined) {
        trackCacheStats(namespace, 'queries', true);
        return memoryResult;
      }
    }
    
    // Check storage cache
    if (!forceRefresh) {
      const storageKey = `storage:${cacheKey}`;
      const storageResult = await getFromStorage(storageKey, 'queries');
      if (storageResult !== null && storageResult !== undefined) {
        // Store in memory cache for faster access next time
        setInMemoryCache(namespace, cacheKey, storageResult, ttl);
        trackCacheStats(namespace, 'queries', true);
        return storageResult;
      }
    }
    
    // Cache miss - execute the query
    trackCacheStats(namespace, 'queries', false);
    
    const { getDocs } = require('firebase/firestore');
    const querySnapshot = await getDocs(firestoreQuery);
    
    const results = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    // Update both memory and storage caches
    setInMemoryCache(namespace, cacheKey, results, ttl);
    const storageKey = `storage:${cacheKey}`;
    await setInStorage(storageKey, results, ttl);
    
    return results;
    
  } catch (error) {
    console.error('Error in getQuery:', error);
    throw error;
  }
};

// ***** NEW FUNCTION getOrSet *****
/**
 * Retrieves a value from the cache. If the value is not found or is stale,
 * it executes the provided fetchFn, stores its result in the cache, and
 * then returns the result.
 *
 * @param {string} key - The cache key.
 * @param {Function} fetchFn - An async function that fetches the data if not in cache.
 * @param {object} [options={}] - Options for caching (e.g., ttl).
 * @param {number} [options.ttl] - Time to live in milliseconds.
 * @returns {Promise<any>} - The cached or freshly fetched data.
 */
const getOrSet = async (key, fetchFn, options = {}) => {
  const { ttl = CACHE_TTL.MEDIUM } = options; // Default TTL if not provided

  // Try to get from memory cache first
  const memoryValue = getFromMemoryCache('default', key); // Assuming 'default' namespace or adjust
  if (memoryValue !== null) {
    return memoryValue;
  }

  // Try to get from AsyncStorage
  const storageValue = await getFromStorage(key); // AsyncStorage keys are typically global
  if (storageValue !== null) {
    // If found in storage, also populate memory cache for faster access next time
    setInMemoryCache('default', key, storageValue, ttl);
    return storageValue;
  }

  // If not in cache or stale, fetch it
  trackCacheStats('default', null, false); // Cache miss
  const freshData = await fetchFn();

  if (freshData !== undefined && freshData !== null) {
    // Store in both memory and AsyncStorage
    setInMemoryCache('default', key, freshData, ttl);
    await setInStorage(key, freshData, ttl);
  }
  return freshData;
};
// ***** END NEW FUNCTION getOrSet *****

// STEP 3.F.1: Enhanced Client-Side Caching Strategies

/**
 * Cache-aside pattern for user profiles with intelligent warming
 */
const getUserProfileCacheAside = async (userId, fetchFn, options = {}) => {
  const { 
    ttl = CACHE_TTL.LONG, // 30 minutes for user profiles
    warmCache = true,
    namespace = 'user_profiles'
  } = options;

  const cacheKey = `profile_${userId}`;

  try {
    console.log(`🎯 OPTIMIZED: Cache-aside lookup for user profile ${userId}`);

    // Step 1: Check cache first
    const cached = await getValue(cacheKey, { namespace, ttl });
    if (cached !== null) {
      console.log(`✅ OPTIMIZED: User profile cache hit for ${userId}`);
      
      // Background cache warming if enabled and cache is getting old
      if (warmCache) {
        const cacheAge = Date.now() - (cached._cacheTimestamp || 0);
        const warmThreshold = ttl * 0.8; // Warm when 80% of TTL has passed
        
        if (cacheAge > warmThreshold) {
          console.log(`🔄 OPTIMIZED: Background warming user profile cache for ${userId}`);
          // Warm cache in background without blocking
          Promise.resolve().then(async () => {
            try {
              const freshData = await fetchFn();
              await setValue(cacheKey, {
                ...freshData,
                _cacheTimestamp: Date.now()
              }, { ttl, namespace });
            } catch (error) {
              console.warn(`⚠️ Background cache warming failed for ${userId}:`, error);
            }
          });
        }
      }
      
      return cached;
    }

    // Step 2: Cache miss - fetch from source
    console.log(`📥 OPTIMIZED: User profile cache miss for ${userId}, fetching from source`);
    const freshData = await fetchFn();

    // Step 3: Store in cache with timestamp
    await setValue(cacheKey, {
      ...freshData,
      _cacheTimestamp: Date.now()
    }, { ttl, namespace });

    console.log(`💾 OPTIMIZED: Cached user profile for ${userId}`);
    return freshData;

  } catch (error) {
    console.error(`🚨 Error in user profile cache-aside for ${userId}:`, error);
    throw error;
  }
};

/**
 * Cache-aside pattern for application settings
 */
const getAppSettingsCacheAside = async (settingsKey, fetchFn, options = {}) => {
  const { 
    ttl = CACHE_TTL.EXTENDED, // 2 hours for app settings
    namespace = 'app_settings'
  } = options;

  const cacheKey = `settings_${settingsKey}`;

  try {
    console.log(`⚙️ OPTIMIZED: Cache-aside lookup for app settings ${settingsKey}`);

    // Check cache first
    const cached = await getValue(cacheKey, { namespace, ttl });
    if (cached !== null) {
      console.log(`✅ OPTIMIZED: App settings cache hit for ${settingsKey}`);
      return cached;
    }

    // Cache miss - fetch from source
    console.log(`📥 OPTIMIZED: App settings cache miss for ${settingsKey}, fetching from source`);
    const freshData = await fetchFn();

    // Store in cache
    await setValue(cacheKey, freshData, { ttl, namespace });

    console.log(`💾 OPTIMIZED: Cached app settings for ${settingsKey}`);
    return freshData;

  } catch (error) {
    console.error(`🚨 Error in app settings cache-aside for ${settingsKey}:`, error);
    throw error;
  }
};

/**
 * Intelligent cache warming for frequently accessed data
 */
const warmFrequentlyAccessedData = async (userId, groupId) => {
  if (!userId || !groupId) return;

  try {
    console.log(`🔥 OPTIMIZED: Warming frequently accessed data for user ${userId} in group ${groupId}`);

    const warmingPromises = [
      // Warm user profile
      getUserProfileCacheAside(userId, async () => {
        // This would normally fetch from Firestore
        return { id: userId, warmed: true };
      }, { warmCache: false }), // Don't warm while warming

      // Warm group data
      getValue(`group_${groupId}`, { 
        namespace: 'groups',
        ttl: CACHE_TTL.MEDIUM 
      }),

      // Warm user balance
      getValue(`balance_${userId}`, { 
        namespace: 'user_balances',
        ttl: CACHE_TTL.SHORT 
      }),

      // Warm recent cards (if any)
      getValue(`recent_cards_${userId}_${groupId}`, { 
        namespace: 'user_cards',
        ttl: CACHE_TTL.MEDIUM 
      })
    ];

    const results = await Promise.allSettled(warmingPromises);
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    
    console.log(`🎯 OPTIMIZED: Cache warming completed - ${successCount}/${warmingPromises.length} successful`);

  } catch (error) {
    console.warn('⚠️ Cache warming failed:', error);
  }
};

/**
 * Smart cache invalidation based on data relationships
 */
const smartInvalidate = async (entityType, entityId, relatedEntities = []) => {
  try {
    console.log(`🧹 OPTIMIZED: Smart invalidation for ${entityType}:${entityId}`);

    const invalidationPromises = [];

    // Invalidate the main entity
    invalidationPromises.push(invalidate(`${entityType}_${entityId}`));

    // Invalidate related entities based on type
    switch (entityType) {
      case 'user':
        // Invalidate user profile, balance, cards, etc.
        invalidationPromises.push(
          invalidate(`profile_${entityId}`),
          invalidate(`balance_${entityId}`),
          clearMemoryCache('user_cards', entityId),
          clearMemoryCache('user_trades', entityId)
        );
        break;

      case 'group':
        // Invalidate group data and related collections
        invalidationPromises.push(
          clearMemoryCache('group_auctions', entityId),
          clearMemoryCache('group_trades', entityId),
          clearMemoryCache('group_members', entityId)
        );
        break;

      case 'auction':
        // Invalidate auction and related bid data
        invalidationPromises.push(
          clearMemoryCache('auction_bids', entityId),
          invalidate(`auction_summary_${entityId}`)
        );
        break;

      case 'trade':
        // Invalidate trade and related user data
        invalidationPromises.push(
          clearMemoryCache('trade_participants', entityId)
        );
        break;
    }

    // Invalidate explicitly related entities
    for (const related of relatedEntities) {
      invalidationPromises.push(invalidate(`${related.type}_${related.id}`));
    }

    const results = await Promise.allSettled(invalidationPromises);
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    
    console.log(`✅ OPTIMIZED: Smart invalidation completed - ${successCount} operations successful`);

  } catch (error) {
    console.error(`🚨 Error in smart invalidation for ${entityType}:${entityId}:`, error);
  }
};

// Create a unified CacheService object with all methods
const CacheService = {
  // Memory cache functions
  getFromMemoryCache,
  setInMemoryCache,
  clearMemoryCache,
  
  // Storage functions
  getFromStorage,
  setInStorage,
  
  // Cache utilities
  createCacheKey,
  getCacheMetrics,
  
  // User cache functions
  getUser,
  
  // Document/query cache functions
  getDocument,
  getDocuments,
  getQuery,
  
  // Key-value cache functions
  getValue,
  setValue,
  getValueSync,
  setValueSync,
  
  // Cache management
  invalidate,
  invalidateDocument,
  clearAll,
  
  // Metrics and reporting
  getPaginationCacheStats,
  getQueryAccessReport,
  
  // Track stats for analytics
  trackCacheStats,
  
  // Constants
  CACHE_TTL,
  MEMORY_CACHE_LIMITS,
  
  // STEP 3.F.1: Enhanced caching strategies
  getUserProfileCacheAside,
  getAppSettingsCacheAside,
  warmFrequentlyAccessedData,
  smartInvalidate,
  
  // Alias for getCacheMetrics for backward compatibility
  getCacheMetrics: function() {
    console.warn('getCacheMetrics is deprecated. Use CacheService.getCacheMetrics() instead.');
    return getCacheMetrics();
  },
  
  // Add getMetrics as alias to prevent errors
  getMetrics: function() {
    return getCacheMetrics();
  },
  
  // Add other specific getters if they are still primary interfaces
  getOrSet, // ***** EXPORT getOrSet *****
};

// Make CacheService available globally for backward compatibility
if (typeof global !== 'undefined') {
  global.CacheService = CacheService;
}

// Export both as default and individual functions
export {
    clearAll, clearMemoryCache,
    createCacheKey, getCacheMetrics, getDocument,
    getDocuments, getFromMemoryCache, getFromStorage, getOrSet, getPaginationCacheStats,
    getQuery, getQueryAccessReport, getUser, getValue, getValueSync, invalidate, invalidateDocument, setInMemoryCache, setInStorage, setValue, setValueSync
};

export default CacheService;
