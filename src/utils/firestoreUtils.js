import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { collection, doc, limit, orderBy, query, startAfter, where } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { getDoc, getDocs, onSnapshot } from '../services/ReadTracking/TrackedFirestore';
import {
    batchInvalidateCache,
    createDocCacheKey,
    createQueryCacheKey,
    getCacheKeys,
    getWithCache
} from './cacheUtils';
import { logFirestoreError, logGeneralError } from './errorMonitor';
import { retryFirestoreOperation } from './firebaseErrorHandler';
import { clearThrottledListener, getThrottledListener } from './throttledListener';

// Add read count tracking for rate limiting
let firestoreReadCount = 0;
const MAX_READS_PER_SESSION = 20000; // Increased from 1000 to 20000
const MAX_READS_PER_MINUTE = 20000; // New rate limit: max 20,000 reads per minute
const READ_COUNT_KEY = 'firestore_read_count';
const SESSION_START_KEY = 'firestore_session_start';
const READ_LIMIT_RESET_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

// Store timestamps of recent reads to track rate
const recentReads = [];

// Load initial read count from AsyncStorage
(async () => {
  try {
    const savedCount = await AsyncStorage.getItem(READ_COUNT_KEY);
    const sessionStart = await AsyncStorage.getItem(SESSION_START_KEY);
    
    if (savedCount && sessionStart) {
      const startTime = parseInt(sessionStart);
      const now = Date.now();
      
      // Reset counter if it's been more than the reset interval
      if (now - startTime > READ_LIMIT_RESET_INTERVAL) {
        firestoreReadCount = 0;
        await AsyncStorage.setItem(SESSION_START_KEY, now.toString());
      } else {
        firestoreReadCount = parseInt(savedCount);
      }
    } else {
      // Initialize session start time
      await AsyncStorage.setItem(SESSION_START_KEY, Date.now().toString());
    }
  } catch (error) {
    console.error('Error loading Firestore read count:', error);
  }
})();

// Function to increment read count
const incrementReadCount = async (increment = 1) => {
  firestoreReadCount += increment;
  
  // Track timestamp for rate limiting
  const now = Date.now();
  for (let i = 0; i < increment; i++) {
    recentReads.push(now);
  }
  
  // Clean up old timestamps (older than 1 minute)
  const oneMinuteAgo = now - 60000;
  while (recentReads.length > 0 && recentReads[0] < oneMinuteAgo) {
    recentReads.shift();
  }
  
  // Save to AsyncStorage occasionally to persist across app restarts
  if (firestoreReadCount % 10 === 0) { // Only save every 10 reads to reduce AsyncStorage writes
    try {
      await AsyncStorage.setItem(READ_COUNT_KEY, firestoreReadCount.toString());
    } catch (error) {
      console.error('Error saving read count:', error);
    }
  }
  
  // Log when approaching rate limits
  if (recentReads.length >= MAX_READS_PER_MINUTE * 0.8) {
    console.warn(`⚠️ Approaching Firestore read rate limit: ${recentReads.length}/${MAX_READS_PER_MINUTE} reads in the last minute`);
  }
  
  return firestoreReadCount;
};

// Check if we've exceeded read limits (either session or rate-based)
const hasExceededReadLimit = () => {
  // Check rate limit (reads per minute)
  if (recentReads.length >= MAX_READS_PER_MINUTE) {
    console.error(`⛔ Firestore read rate limit exceeded: ${recentReads.length} reads in the last minute`);
    return true;
  }
  
  // Also keep the session limit as a fallback protection
  if (firestoreReadCount >= MAX_READS_PER_SESSION) {
    console.error(`⛔ Firestore session read limit exceeded: ${firestoreReadCount}/${MAX_READS_PER_SESSION}`);
    return true;
  }
  
  return false;
};

// Network status tracking
let isNetworkConnected = true;
NetInfo.addEventListener(state => {
  isNetworkConnected = state.isConnected;
});

// Helper function to check network status
export const isConnected = () => isNetworkConnected;

// Utility to execute Firestore operations with network status awareness
export const executeSafeFirestoreOperation = async (operation, fallbackValue = null) => {
  try {
    // Check if we've exceeded read limits
    if (hasExceededReadLimit()) {
      console.error('⛔ Firestore read limit exceeded. Operation aborted to control costs.');
      return fallbackValue;
    }
    
    if (!isNetworkConnected) {
      console.log('Network offline, falling back to cache');
      return fallbackValue;
    }
    
    // Increment read count before executing operation
    incrementReadCount();
    
    return await retryFirestoreOperation(operation);
  } catch (error) {
    console.error('Error executing Firestore operation:', error);
    return fallbackValue;
  }
};

// Smart query tracking to avoid duplicate queries
const recentQueryResults = new Map();
const RECENT_QUERY_TTL = 10000; // Increased to 10 seconds to reduce duplicates

let memoryCache = {};

// Define the CACHE_TTL if not already defined
const CACHE_TTL = {
  USER_PROFILE: 5 * 60 * 1000,       // 5 minutes
  AUCTION_DATA: 5 * 60 * 1000,        // Increased to 5 minutes
  AUCTION_BIDS: 2 * 60 * 1000,       // Increased to 2 minutes
  CARD_DATA: 5 * 60 * 1000,          // 5 minutes
  GROUP_DATA: 10 * 60 * 1000,        // 10 minutes
  DEFAULT: 5 * 60 * 1000             // 5 minutes default
};

/**
 * Update cache with new data
 * This function ensures it always returns a Promise
 * 
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {number} ttl - Time to live in milliseconds
 * @returns {Promise<boolean>} - Promise that resolves to success status
 */
const updateCache = async (key, data, ttl = CACHE_TTL.DEFAULT) => {
  try {
    // Store in memory cache first for immediate access
    memoryCache[key] = {
      data,
      timestamp: Date.now(),
      ttl
    };
    
    // Then try to store in AsyncStorage for persistence
    try {
      const storageKey = `firestore_cache_${key}`;
      const cacheItem = {
        data,
        timestamp: Date.now(),
        ttl
      };
      
      await AsyncStorage.setItem(storageKey, JSON.stringify(cacheItem));
      return Promise.resolve(true); // Ensure we return a Promise
    } catch (storageError) {
      console.error('Error updating AsyncStorage cache:', storageError);
      return Promise.resolve(false); // Still return a Promise on error
    }
  } catch (error) {
    console.error('Error updating cache:', error);
    return Promise.resolve(false); // Always return a Promise
  }
};

/**
 * Get a document with caching
 * 
 * @param {string} collectionName - Collection name
 * @param {string} documentId - Document ID
 * @param {Object} options - Cache options
 * @returns {Promise<Object|null>} - Document data or null
 */
export const getCachedDoc = async (collectionName, documentId, options = {}) => {
  // Log deprecation warning in development mode
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      'getCachedDoc is deprecated. Use CacheService.getDocument instead.'
    );
  }

  // Increment read count when we actually perform a read
  const incrementReadsOnMiss = () => {
    incrementReadCount(1);
  };
  
  // Check if we've exceeded read limits
  if (hasExceededReadLimit()) {
    // Use cached data only
    return null;
  }
  
  // Import the new CacheService
  const CacheService = require('../services/caching/CacheService').default;
  
  // Forward to the new implementation
  // Include the original options
  const result = await CacheService.getDocument(collectionName, documentId, {
    ...options,
    onReadSuccess: incrementReadsOnMiss
  });
  
  // Store in recent results if not null (for backward compatibility)
  if (result) {
    const docPath = `${collectionName}/${documentId}`;
    const cacheKey = createDocCacheKey(docPath);
    const now = Date.now();
    recentQueryResults.set(cacheKey, {
      data: result,
      timestamp: now
    });
    
    // If this is a user document, attempt to prefetch related data
    if (collectionName === 'users') {
      safePrefetchRelatedData('users', [result]);
    } else if (collectionName === 'cards') {
      safePrefetchRelatedData('cards', [result]);
    } else if (collectionName === 'auctions') {
      safePrefetchRelatedData('auctions', [result]);
    }
  }
  
  return result;
};

/**
 * Get a document with caching and selective field fetching
 * Only retrieves the specified fields to reduce data transfer
 * 
 * @param {string} collectionName - Collection name
 * @param {string} documentId - Document ID
 * @param {Array<string>} fields - Array of field names to fetch (null for all fields)
 * @param {Object} options - Cache options
 * @returns {Promise<Object|null>} - Document data (only requested fields) or null
 */
export const getCachedDocFields = async (collectionName, documentId, fields = null, options = {}) => {
  const docPath = `${collectionName}/${documentId}`;
  const cacheKey = fields 
    ? createDocCacheKey(`${docPath}_fields_${fields.join('_')}`) 
    : createDocCacheKey(docPath);
  
  // Check recent results first for very fast in-memory access to hot items
  const now = Date.now();
  if (recentQueryResults.has(cacheKey)) {
    const recentResult = recentQueryResults.get(cacheKey);
    if (now - recentResult.timestamp < RECENT_QUERY_TTL && !options.forceRefresh) {
      console.log(`Using recent result for ${cacheKey}, age: ${now - recentResult.timestamp}ms`);
      return recentResult.data;
    }
  }
  
  const result = await getWithCache(cacheKey, async () => {
    const docRef = doc(db, collectionName, documentId);
    const docSnapshot = await getDoc(docRef);
    
    if (docSnapshot.exists()) {
      const fullData = { id: docSnapshot.id, ...docSnapshot.data() };
      if (fields) {
        // Return only requested fields
        return fields.reduce((obj, field) => {
          if (field in fullData) obj[field] = fullData[field];
          return obj;
        }, { id: fullData.id });
      }
      return fullData;
    }
    return null;
  }, options);
  
  // Store in recent results if not null
  if (result) {
    recentQueryResults.set(cacheKey, {
      data: result,
      timestamp: now
    });
  }
  
  return result;
};

/**
 * Get query results with caching
 * This function accepts either a full Firestore query object or the traditional parameters
 * 
 * @param {object|string} queryOrCollectionName - Either a Firestore query object or a collection name
 * @param {Array|Object} whereConditionsOrOptions - Either where conditions or options object
 * @param {Object} [optionsParam] - Cache options when using collection name + where conditions
 * @returns {Promise<Array>} - Array of documents
 */
export const getCachedQuery = async (queryOrCollectionName, whereConditionsOrOptions = [], optionsParam = {}) => {
  let firestoreQuery;
  let options;
  let cacheKey = null; // Initialize as null to detect when it's not set
  let collectionName;
  let result;
  
  // Debug information
  const debugInfo = {
    queryType: typeof queryOrCollectionName,
    isFirestoreQuery: queryOrCollectionName && typeof queryOrCollectionName === 'object',
    optionsType: typeof whereConditionsOrOptions,
    timestamp: new Date().toISOString()
  };

  // Log initial debug info
  console.log('[getCachedQuery] Initial debug info:', JSON.stringify(debugInfo, null, 2));
  
  try {
    // Check if first parameter is a Firestore query object
    if (typeof queryOrCollectionName === 'object' && queryOrCollectionName !== null) {
      try {
        firestoreQuery = queryOrCollectionName;
        options = whereConditionsOrOptions || {};
        
        // Extract collection name from query for prefetching
        collectionName = firestoreQuery._path?.segments?.[0] || 'unknown_collection';
        
        // Log collection name extraction
        console.log(`[getCachedQuery] Extracted collection name: ${collectionName}`);
        
        // Generate a cache key based on the query path (collection name)
        // If a custom cacheKey is provided in options, use that instead
        let queryHash = '';
        try {
          queryHash = JSON.stringify(firestoreQuery, (key, value) => {
            // Handle circular references and functions
            if (typeof value === 'function') return '[Function]';
            return value;
          });
        } catch (stringifyError) {
          console.error('[getCachedQuery] Error stringifying query:', stringifyError);
          // Fallback to a simpler representation
          queryHash = `query_${collectionName}_${Date.now()}`;
        }
        
        // Log cache key generation
        console.log(`[getCachedQuery] Generated query hash: ${queryHash.substring(0, 100)}...`);
        
        // Ensure we have a valid cache key
        if (options.cacheKey) {
          cacheKey = String(options.cacheKey).trim();
          console.log(`[getCachedQuery] Using provided cacheKey: ${cacheKey}`);
        } else {
          try {
            cacheKey = createQueryCacheKey(collectionName, { queryHash });
            console.log(`[getCachedQuery] Generated cacheKey: ${cacheKey}`);
          } catch (cacheKeyError) {
            console.error('[getCachedQuery] Error creating cache key:', cacheKeyError);
            cacheKey = `fallback_query_${collectionName}_${Date.now()}`;
            console.log(`[getCachedQuery] Using fallback cacheKey: ${cacheKey}`);
          }
        }
      } catch (queryError) {
        console.error('[getCachedQuery] Error processing Firestore query:', {
          error: queryError,
          queryType: typeof queryOrCollectionName,
          query: queryOrCollectionName
        });
        throw queryError;
      }
    } else {
      // Original method with collection name and where conditions
      try {
        collectionName = queryOrCollectionName || 'unknown_collection';
        const whereConditions = Array.isArray(whereConditionsOrOptions) ? whereConditionsOrOptions : [];
        options = typeof whereConditionsOrOptions === 'object' && !Array.isArray(whereConditionsOrOptions) 
          ? whereConditionsOrOptions 
          : optionsParam || {};
        
        console.log(`[getCachedQuery] Processing collection query for: ${collectionName}`);
        console.log(`[getCachedQuery] Where conditions:`, whereConditions);
        
        // Create a unique query params object for cache key generation
        const queryParams = {};
        whereConditions.forEach((condition, index) => {
          if (Array.isArray(condition) && condition.length >= 3) {
            queryParams[`where_${index}`] = condition.slice(0, 3);
          }
        });
        
        // Generate cache key
        try {
          cacheKey = createQueryCacheKey(collectionName, queryParams);
          console.log(`[getCachedQuery] Generated cache key: ${cacheKey}`);
        } catch (keyError) {
          console.error('[getCachedQuery] Error generating cache key:', keyError);
          // Fallback to a simple cache key if generation fails
          cacheKey = `fallback_${collectionName}_${Date.now()}`;
          console.log(`[getCachedQuery] Using fallback cache key: ${cacheKey}`);
        }
        
        // Build the query with where conditions
        const collectionRef = collection(db, collectionName);
        
        if (whereConditions.length > 0) {
          firestoreQuery = query(collectionRef);
          whereConditions.forEach(([field, operator, value]) => {
            if (field && operator) {
              firestoreQuery = query(firestoreQuery, where(field, operator, value));
            }
          });
        } else {
          firestoreQuery = query(collectionRef);
        }
        
        console.log(`[getCachedQuery] Built Firestore query`);
      } catch (collectionError) {
        console.error('[getCachedQuery] Error processing collection query:', {
          error: collectionError,
          collection: queryOrCollectionName,
          conditions: whereConditionsOrOptions
        });
        throw collectionError;
      }
    }
    
    // Final check to ensure we have a valid cache key
    if (!cacheKey || typeof cacheKey !== 'string' || cacheKey.trim() === '') {
      const fallbackKey = `emergency_fallback_${collectionName || 'unknown'}_${Date.now()}`;
      console.warn('[getCachedQuery] Invalid cache key detected, using emergency fallback:', {
        originalKey: cacheKey,
        fallbackKey,
        collectionName
      });
      cacheKey = fallbackKey;
    }
  
    // Check for identical query in recent results to avoid duplicate fetches
    const now = Date.now();
    if (recentQueryResults.has(cacheKey)) {
      const recentResult = recentQueryResults.get(cacheKey);
      if (now - recentResult.timestamp < RECENT_QUERY_TTL && !options.forceRefresh) {
        console.log(`Using recent result for ${cacheKey}, age: ${now - recentResult.timestamp}ms`);
        return recentResult.data;
      }
    }
    
    // Get with cache - ensure we pass a valid cache key
    result = await getWithCache(cacheKey, async () => {
      try {
        const querySnapshot = await getDocs(firestoreQuery);
        return querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
      } catch (error) {
        console.error('Error executing Firestore query:', error);
        
        // Log Firestore errors with context
        if (error.message && error.message.includes('index')) {
          logFirestoreError(error, {
            collectionName,
            cacheKey,
            query: 'getCachedQuery',
            queryType: 'collection_query'
          });
        } else {
          logGeneralError(error, {
            collectionName,
            cacheKey,
            function: 'getCachedQuery_fetchData'
          });
        }
        
        throw error;
      }
    }, options);
    
    // Store in recent results
    recentQueryResults.set(cacheKey, {
      data: result,
      timestamp: now
    });
    
    // Prefetch related data in background if results exist
    if (result?.length > 0) {
      safePrefetchRelatedData(collectionName, result);
    }
    
    return result;
  } catch (error) {
    console.error('Error in getCachedQuery:', {
      error: error.message,
      stack: error.stack,
      cacheKey: cacheKey || 'null',
      collectionName: collectionName || 'unknown',
      options
    });
    
    // If we have a fetch function in options, try to use it as a fallback
    if (options?.fetchData) {
      try {
        console.log('Attempting to use fallback fetchData function');
        return await options.fetchData();
      } catch (fetchError) {
        console.error('Fallback fetchData failed:', fetchError);
      }
    }
    
    // If we have a result from a previous operation, return it
    if (result) {
      return result;
    }
    
    // If all else fails, rethrow the error
    throw error;
  } finally {
    // Cleanup old results (periodically)
    const now = Date.now();
    if (Math.random() < 0.1) { // 10% chance to clean up
      for (const [key, value] of recentQueryResults.entries()) {
        if (now - (value?.timestamp || 0) > RECENT_QUERY_TTL * 10) {
          recentQueryResults.delete(key);
        }
      }
    }
  }
};

/**
 * Get paginated query results with cursor-based pagination and caching
 * 
 * @param {string} collectionName - Collection name
 * @param {Array} whereConditions - Where conditions array of [field, operator, value]
 * @param {Object} options - Options for pagination and caching
 * @param {number} options.pageSize - Number of items per page
 * @param {Object} options.startAfterDoc - Document to start after for pagination
 * @param {string} options.orderByField - Field to order by
 * @param {string} options.orderDirection - Order direction ('asc' or 'desc')
 * @param {number} options.ttl - Cache TTL
 * @returns {Promise<{docs: Array, lastDoc: Object}>} - Documents and last document for next pagination
 */
export const getPaginatedQuery = async (
  collectionName, 
  whereConditions = [], 
  options = {}
) => {
  const { 
    pageSize = 20, 
    startAfterDoc = null,
    orderByField = 'createdAt',
    orderDirection = 'desc',
    ttl = CACHE_TTL || 5 * 60 * 1000, // Default 5 min TTL if not specified
    forceRefresh = false
  } = options;
  
  const collectionRef = collection(db, collectionName);
  let baseQuery = query(collectionRef);
  
  // Apply where conditions
  whereConditions.forEach(([field, operator, value]) => {
    baseQuery = query(baseQuery, where(field, operator, value));
  });
  
  // Apply order
  baseQuery = query(baseQuery, orderBy(orderByField, orderDirection));
  
  // Apply pagination
  if (startAfterDoc) {
    baseQuery = query(baseQuery, startAfter(startAfterDoc), limit(pageSize));
  } else {
    baseQuery = query(baseQuery, limit(pageSize));
  }
  
  // Create a unique cache key
  const cacheKey = createQueryCacheKey(collectionName, {
    where: whereConditions,
    orderBy: `${orderByField}_${orderDirection}`,
    startAfter: startAfterDoc ? startAfterDoc.id : 'first',
    limit: pageSize
  });
  
  // Check recent results first (in-memory cache)
  const now = Date.now();
  if (!forceRefresh && recentQueryResults.has(cacheKey)) {
    const recentResult = recentQueryResults.get(cacheKey);
    if (now - recentResult.timestamp < RECENT_QUERY_TTL) {
      console.log(`Using recent result for pagination ${cacheKey}, age: ${now - recentResult.timestamp}ms`);
      return recentResult.data;
    }
  }
  
  // Try to get from cache or fetch from Firestore
  const result = await getWithCache(cacheKey, async () => {
    const querySnapshot = await getDocs(baseQuery);
    const lastDoc = querySnapshot.docs.length > 0 
      ? querySnapshot.docs[querySnapshot.docs.length - 1] 
      : null;
      
    return {
      docs: querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })),
      lastDoc
    };
  }, { ttl, forceRefresh });
  
  // Store in recent results
  recentQueryResults.set(cacheKey, {
    data: result,
    timestamp: now
  });
  
  return result;
};

/**
 * Get multiple documents with caching
 * 
 * @param {string} collectionName - Collection name
 * @param {string[]} documentIds - Array of document IDs
 * @param {Object} options - Cache options
 * @returns {Promise<Object[]>} - Array of documents
 */
export const getCachedDocs = async (collectionName, documentIds, options = {}) => {
  // Log deprecation warning in development mode
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      'getCachedDocs is deprecated. Use CacheService.getDocuments instead.'
    );
  }
  
  // Import the new CacheService
  const CacheService = require('../services/caching/CacheService').default;
  
  // Forward to the new implementation
  return CacheService.getDocuments(collectionName, documentIds, options);
};

// ⚠️ DEPRECATED: setupCachedQueryListener and setupCachedQueryListenerWithChanges have been removed
// These functions used onSnapshot() Firestore listeners which caused excessive reads.
// Migration path:
// - Use getCachedDoc() or getCachedQuery() for one-time cached fetches
// - Use push notifications (FCM) for real-time updates
// - See docs-claude/claude-phase2-listener-analysis.md for details

/**
 * Invalidate cache entries for a collection
 * 
 * @param {string} collectionName - Collection name
 * @returns {Promise<void>}
 */
export const invalidateCollectionCache = async (collectionName) => {
  try {
    const allCacheKeys = await getCacheKeys();
    const collectionCacheKeys = allCacheKeys.filter(key => 
      key.startsWith(`query_${collectionName}_`) || 
      key.startsWith(`doc_${collectionName}/`)
    );
    
    if (collectionCacheKeys.length > 0) {
      await batchInvalidateCache(collectionCacheKeys);
      console.log(`Invalidated ${collectionCacheKeys.length} cache entries for collection: ${collectionName}`);
    }
  } catch (error) {
    console.error(`Error invalidating cache for collection ${collectionName}:`, error);
  }
};

/**
 * Execute a Firestore query with fallback for index errors
 * This function tries to run a query, and if it fails with an index error,
 * it falls back to a simpler query that doesn't require complex indexes
 * 
 * @param {object} originalQuery - The original Firestore query
 * @param {object} [fallbackQuery] - A simpler fallback query to use if the original fails (optional)
 * @param {function} [processResults] - Optional function to process results
 * @returns {Promise<Array>} - Query results
 */
export const executeQueryWithFallback = async (originalQuery, fallbackQuery, processResults = null) => {
  try {
    // Try the original query first
    const querySnapshot = await getDocs(originalQuery);
    const results = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    // Process results if a processor function is provided
    return processResults ? processResults(results) : results;
  } catch (error) {
    console.error('Query error:', error);
    
    // Check if it's an index error
    if (error.message && error.message.includes('requires an index')) {
      console.log('Index error detected, using fallback query');
      
      // Extract the index creation URL to log it
      const indexUrl = extractIndexCreationUrl(error);
      if (indexUrl) {
        console.log('Create the index by clicking this link:', indexUrl);
      }
      
      // Use provided fallback query or create an automatic one
      let fallbackQueryToUse = fallbackQuery;
      
      if (!fallbackQueryToUse && originalQuery._query && originalQuery._query.path) {
        // Create the simplest possible query without any complex filters
        try {
          const collectionPath = originalQuery._query.path;
          const collectionRef = collection(db, collectionPath);
          fallbackQueryToUse = query(collectionRef, limit(50));
          console.log('Created simple collection query as fallback');
        } catch (lastResortError) {
          console.error('Error creating fallback query:', lastResortError);
          // Return empty results rather than throwing
          return processResults ? processResults([]) : [];
        }
      }
      
      if (fallbackQueryToUse) {
        try {
          // Try the fallback query
          const fallbackSnapshot = await getDocs(fallbackQueryToUse);
          let fallbackResults = fallbackSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          
          // If we need to apply client-side filtering to match the original query
          if (originalQuery._query && originalQuery._query.filters) {
            // Extract filters from original query
            const filters = originalQuery._query.filters || [];
            
            // Apply each filter manually
            filters.forEach(filter => {
              if (filter.field && filter.op && filter.value !== undefined) {
                fallbackResults = fallbackResults.filter(doc => {
                  if (filter.op === '==') {
                    return doc[filter.field] === filter.value;
                  }
                  return true; // Skip other operators for simplicity
                });
              }
            });
          }
          
          // Process results if a processor function is provided
          return processResults ? processResults(fallbackResults) : fallbackResults;
        } catch (fallbackError) {
          console.error('Fallback query error:', fallbackError);
          
          // Return empty results rather than throwing errors
          return processResults ? processResults([]) : [];
        }
      } else {
        // No fallback query available, return empty results
        console.log('No fallback query could be created, returning empty results');
        return processResults ? processResults([]) : [];
      }
    } else {
      // If it's not an index error, log and return empty results instead of re-throwing
      console.error('Non-index query error:', error);
      return processResults ? processResults([]) : [];
    }
  }
};

/**
 * Extract index creation URL from Firebase error
 * 
 * @param {Error} error - Firebase error
 * @returns {string|null} - Index creation URL or null
 */
export const extractIndexCreationUrl = (error) => {
  if (!error || !error.message) {
    return null;
  }
  
  // Look for URLs in the error message
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = error.message.match(urlRegex);
  
  if (matches && matches.length > 0) {
    // Find the Firebase console URL for creating an index
    const indexUrl = matches.find(url => 
      url.includes('console.firebase.google.com') && 
      url.includes('firestore/indexes')
    );
    
    return indexUrl || null;
  }
  
  return null;
};

/**
 * Extract detailed query information from a Firestore error
 * This helps diagnose exactly what fields need to be indexed
 * 
 * @param {Error} error - Firestore error object
 * @returns {Object|null} - Extracted query details or null
 */
export const extractQueryDetails = (error) => {
  if (!error || !error.message) {
    return null;
  }
  
  try {
    // Parse error message for useful information
    const indexMatch = error.message.match(/collection:\s*([^,\s]+)/i);
    const fieldsMatch = error.message.match(/\[([^\]]+)\]/g);
    
    const result = {
      collection: indexMatch ? indexMatch[1] : null,
      fields: [],
      indexUrl: extractIndexCreationUrl(error)
    };
    
    // Extract field information
    if (fieldsMatch && fieldsMatch.length) {
      fieldsMatch.forEach(match => {
        const fieldText = match.replace(/[\[\]]/g, '');
        const fieldParts = fieldText.split(',').map(part => part.trim());
        result.fields.push(...fieldParts);
      });
    }
    
    return result;
  } catch (parseError) {
    console.error('Error parsing Firestore error message:', parseError);
    return null;
  }
};

/**
 * Clear all Firestore cache data
 * This is a utility function to clear all cache related to Firestore queries and documents
 * 
 * @returns {Promise<void>}
 */
export const clearFirestoreCache = async () => {
  try {
    const allCacheKeys = await getCacheKeys();
    const firestoreCacheKeys = allCacheKeys.filter(key => 
      key.startsWith('query_') || 
      key.startsWith('doc_')
    );
    
    if (firestoreCacheKeys.length > 0) {
      await batchInvalidateCache(firestoreCacheKeys);
      console.log(`Cleared ${firestoreCacheKeys.length} Firestore cache entries`);
    } else {
      console.log('No Firestore cache entries to clear');
    }
  } catch (error) {
    console.error('Error clearing Firestore cache:', error);
  }
};

/**
 * Safely import and use smartPrefetch to avoid circular dependency
 */
const safePrefetchRelatedData = async (entityType, entities) => {
  try {
    const { prefetchRelatedData } = await import('./smartPrefetch');
    await prefetchRelatedData(entityType, entities);
  } catch (error) {
    // Ignore prefetch errors to avoid breaking main functionality
    console.warn('Could not prefetch related data:', error.message);
  }
};

/**
 * Get user cards with caching
 * 
 * @param {string} userId - User ID  
 * @param {string} groupId - Group ID
 * @param {Object} options - Options including ttl, sortBy
 * @returns {Promise<Array>} - Array of user cards
 */
export const getCachedUserCards = async (userId, groupId, options = {}) => {
  const { ttl = CACHE_TTL.DEFAULT, sortBy = 'createdAt' } = options;
  
  try {
    const cardsRef = collection(db, 'cards');
    let cardsQuery = query(
      cardsRef, 
      where('ownerId', '==', userId),
      where('groupId', '==', groupId)
    );
    
    // Add ordering if specified
    if (sortBy) {
      cardsQuery = query(cardsQuery, orderBy(sortBy));
    }
    
    const cards = await getCachedQuery(cardsQuery, { ttl });
    return cards || [];
    
  } catch (error) {
    console.error('Error fetching user cards:', error);
    return [];
  }
};

export default {
  getCachedDoc,
  getCachedDocFields,
  getCachedQuery,
  clearFirestoreCache,
  executeQueryWithFallback,
  extractIndexCreationUrl,
  extractQueryDetails,
  getCachedUserCards
}; 