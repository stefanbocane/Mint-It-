import NetInfo from '@react-native-community/netinfo';
import { collection, doc, limit, orderBy, query, where } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { getDoc, getDocs } from '../services/ReadTracking/TrackedFirestore';
import {
    CACHE_TTL,
    createDocCacheKey,
    createQueryCacheKey,
    getWithCache,
    updateCache
} from './cacheUtils';

// Track in-flight queries to prevent duplicate requests 
const activeQueryPromises = new Map();

// Store coalescence bookkeeping
const queryAccesses = new Map();
const FREQUENT_QUERY_THRESHOLD = 5;
const FREQUENT_QUERY_WINDOW = 1000 * 60 * 10; // 10 minutes

/**
 * Enhanced document fetch with intelligent caching strategies
 * 
 * @param {string} collectionName - Name of the collection
 * @param {string} docId - Document ID
 * @param {Object} options - Cache options
 * @returns {Promise<Object>} - Document data with ID
 */
export const getDocumentWithEnhancedCache = async (collectionName, docId, options = {}) => {
  const {
    ttl = CACHE_TTL.DEFAULT,
    forceRefresh = false,
    offlineFallback = true,
    fetchPolicy = 'cache-first' // One of: 'cache-first', 'network-only', 'cache-only', 'network-and-cache'
  } = options;
  
  const docRef = doc(db, collectionName, docId);
  const cacheKey = createDocCacheKey(`${collectionName}/${docId}`);
  
  // Create a debounce key for tracking this doc's popularity
  const accessKey = `access_${cacheKey}`;
  
  // Track access for coalescing frequently accessed docs
  recordQueryAccess(accessKey);
  
  // Handle different fetch policies
  switch (fetchPolicy) {
    case 'cache-only':
      return getWithCache(cacheKey, async () => null, { 
        offline: true 
      });
      
    case 'network-only':
      try {
        const docSnapshot = await getDoc(docRef);
        const data = docSnapshot.exists() ? { id: docSnapshot.id, ...docSnapshot.data() } : null;
        
        // Still update the cache even in network-only mode
        updateCache(cacheKey, data);
        
        return data;
      } catch (error) {
        if (offlineFallback) {
          return getWithCache(cacheKey, async () => null, { offline: true });
        }
        throw error;
      }
      
    case 'network-and-cache':
      try {
        // Get from network
        const docSnapshot = await getDoc(docRef);
        const networkData = docSnapshot.exists() ? { id: docSnapshot.id, ...docSnapshot.data() } : null;
        
        // Update cache
        updateCache(cacheKey, networkData);
        
        return networkData;
      } catch (error) {
        // Fall back to cache if network fails
        if (offlineFallback) {
          console.log(`Network request failed for ${cacheKey}, using cache`);
          return getWithCache(cacheKey, async () => null, { offline: true });
        }
        throw error;
      }
      
    case 'cache-first':
    default:
      // Defer to the standard cache-first behavior
      return getWithCache(cacheKey, async () => {
        try {
          const docSnapshot = await getDoc(docRef);
          
          if (docSnapshot.exists()) {
            return {
              id: docSnapshot.id,
              ...docSnapshot.data()
            };
          } else {
            return null;
          }
        } catch (error) {
          console.error(`Error fetching document ${cacheKey}:`, error);
          if (offlineFallback) {
            return getWithCache(cacheKey, async () => null, { offline: true });
          }
          throw error;
        }
      }, { ttl, forceRefresh });
  }
};

/**
 * Enhanced query fetch with intelligent caching and coalescence
 * 
 * @param {string} collectionName - Name of the collection
 * @param {Object} queryParams - Query parameters
 * @param {Object} options - Cache options
 * @returns {Promise<Array>} - Query results
 */
export const getQueryWithEnhancedCache = async (collectionName, queryParams = {}, options = {}) => {
  const {
    ttl = CACHE_TTL.DEFAULT,
    forceRefresh = false,
    offlineFallback = true,
    waitForNetwork = false, // If true, will wait for network before returning cached data
    fetchPolicy = 'cache-first',
    whereConditions = [],  // Array of [field, operator, value] arrays
    orderByField = null,   // Field to order by
    orderDirection = 'asc', // 'asc' or 'desc'
    limitCount = null,      // Number of documents to limit
  } = options;
  
  // Create a cache key based on all query parameters
  const cacheKey = createQueryCacheKey(collectionName, {
    ...queryParams,
    where: whereConditions,
    orderBy: orderByField ? [orderByField, orderDirection] : null,
    limit: limitCount
  });
  
  // Record access for query coalescence
  const accessKey = `access_${cacheKey}`;
  recordQueryAccess(accessKey);
  
  // If this query is accessed frequently, increase its cache TTL
  const ttlToUse = isFrequentQuery(accessKey) ? 
    Math.max(ttl, CACHE_TTL.LONG) : ttl;
  
  // Check if we should wait for network
  if (waitForNetwork) {
    const networkState = await NetInfo.fetch();
    const isConnected = networkState.isConnected && networkState.isInternetReachable;
    
    if (!isConnected && offlineFallback) {
      // If offline and allowed to fall back, use cached data
      return getWithCache(cacheKey, async () => [], { offline: true });
    }
  }
  
  // Check if this query is already in flight
  if (activeQueryPromises.has(cacheKey) && !forceRefresh) {
    return activeQueryPromises.get(cacheKey);
  }
  
  // Handle different fetch policies
  switch (fetchPolicy) {
    case 'cache-only':
      return getWithCache(cacheKey, async () => [], { offline: true });
      
    case 'network-only':
      try {
        const queryPromise = executeFirestoreQuery(collectionName, whereConditions, orderByField, orderDirection, limitCount);
        
        // Store the promise for request coalescence
        activeQueryPromises.set(cacheKey, queryPromise);
        
        // Clean up when done
        queryPromise.finally(() => {
          activeQueryPromises.delete(cacheKey);
        });
        
        const data = await queryPromise;
        
        // Still update the cache even in network-only mode
        updateCache(cacheKey, data);
        
        return data;
      } catch (error) {
        if (offlineFallback) {
          return getWithCache(cacheKey, async () => [], { offline: true });
        }
        throw error;
      }
      
    case 'network-and-cache':
      try {
        const queryPromise = executeFirestoreQuery(collectionName, whereConditions, orderByField, orderDirection, limitCount);
        
        // Store the promise for request coalescence
        activeQueryPromises.set(cacheKey, queryPromise);
        
        // Clean up when done
        queryPromise.finally(() => {
          activeQueryPromises.delete(cacheKey);
        });
        
        const networkData = await queryPromise;
        
        // Update cache
        updateCache(cacheKey, networkData);
        
        return networkData;
      } catch (error) {
        // Fall back to cache if network fails
        if (offlineFallback) {
          console.log(`Network request failed for ${cacheKey}, using cache`);
          return getWithCache(cacheKey, async () => [], { offline: true });
        }
        throw error;
      }
      
    case 'cache-first':
    default:
      // Standard cache-first behavior using the helper function
      return getWithCache(cacheKey, async () => {
        const queryPromise = executeFirestoreQuery(collectionName, whereConditions, orderByField, orderDirection, limitCount);
        
        // Store the promise for request coalescence
        activeQueryPromises.set(cacheKey, queryPromise);
        
        // Clean up when done
        queryPromise.finally(() => {
          activeQueryPromises.delete(cacheKey);
        });
        
        return queryPromise;
      }, { ttl: ttlToUse, forceRefresh });
  }
};

/**
 * Helper function to execute a Firestore query with the given parameters
 * 
 * @param {string} collectionName - Collection name
 * @param {Array} whereConditions - Where conditions
 * @param {string} orderByField - Field to order by
 * @param {string} orderDirection - Order direction
 * @param {number} limitCount - Limit count
 * @returns {Promise<Array>} - Query results
 */
const executeFirestoreQuery = async (
  collectionName,
  whereConditions = [],
  orderByField = null,
  orderDirection = 'asc',
  limitCount = null
) => {
  try {
    const collectionRef = collection(db, collectionName);
    
    // Build query constraints
    const queryConstraints = [];
    
    // Add where conditions
    whereConditions.forEach(condition => {
      if (Array.isArray(condition) && condition.length === 3) {
        const [field, operator, value] = condition;
        queryConstraints.push(where(field, operator, value));
      }
    });
    
    // Add order by
    if (orderByField) {
      queryConstraints.push(orderBy(orderByField, orderDirection));
    }
    
    // Add limit
    if (limitCount && typeof limitCount === 'number') {
      queryConstraints.push(limit(limitCount));
    }
    
    // Execute query
    const q = query(collectionRef, ...queryConstraints);
    const querySnapshot = await getDocs(q);
    
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error(`Error executing Firestore query on ${collectionName}:`, error);
    throw error;
  }
};

/**
 * Record a query access for frequency analysis
 * 
 * @param {string} accessKey - Key representing the query
 */
const recordQueryAccess = (accessKey) => {
  const now = Date.now();
  
  if (!queryAccesses.has(accessKey)) {
    queryAccesses.set(accessKey, []);
  }
  
  const accesses = queryAccesses.get(accessKey);
  
  // Add this access
  accesses.push(now);
  
  // Remove old accesses outside the window
  const windowStart = now - FREQUENT_QUERY_WINDOW;
  
  // Filter to recent accesses only
  const recentAccesses = accesses.filter(time => time >= windowStart);
  queryAccesses.set(accessKey, recentAccesses);
};

/**
 * Check if a query is frequently accessed
 * 
 * @param {string} accessKey - Key representing the query
 * @returns {boolean} - Whether the query is frequently accessed
 */
const isFrequentQuery = (accessKey) => {
  if (!queryAccesses.has(accessKey)) {
    return false;
  }
  
  const accesses = queryAccesses.get(accessKey);
  const now = Date.now();
  const windowStart = now - FREQUENT_QUERY_WINDOW;
  
  // Count accesses in the window
  const recentAccessCount = accesses.filter(time => time >= windowStart).length;
  
  return recentAccessCount >= FREQUENT_QUERY_THRESHOLD;
};

/**
 * Prefetch documents that are frequently accessed
 * This can be called during app idle time to proactively refresh cache
 * 
 * @param {number} threshold - Access threshold to consider frequent
 * @returns {Promise<number>} - Number of queries prefetched
 */
export const prefetchFrequentQueries = async (threshold = FREQUENT_QUERY_THRESHOLD) => {
  let prefetchCount = 0;
  
  for (const [accessKey, accesses] of queryAccesses.entries()) {
    // Format: access_query_collection_parameters or access_doc_collection/id
    const now = Date.now();
    const windowStart = now - FREQUENT_QUERY_WINDOW;
    const recentAccessCount = accesses.filter(time => time >= windowStart).length;
    
    if (recentAccessCount >= threshold) {
      try {
        // Extract the actual cache key
        const cacheKey = accessKey.replace('access_', '');
        
        if (cacheKey.startsWith('query_')) {
          // It's a query - parse it back to parameters
          const parts = cacheKey.split('_');
          if (parts.length >= 3) {
            const collectionName = parts[1];
            const paramString = parts.slice(2).join('_');
            
            try {
              // Try to parse the parameters
              const params = {};
              
              // Simple parsing for demonstration
              if (paramString.includes('where=')) {
                const whereMatch = paramString.match(/where=(\[[^\]]+\])/);
                if (whereMatch && whereMatch[1]) {
                  params.whereConditions = JSON.parse(whereMatch[1]);
                }
              }
              
              // Execute with cache refresh to update
              await getQueryWithEnhancedCache(collectionName, params, {
                forceRefresh: true,
                ttl: CACHE_TTL.LONG // Use a longer TTL for frequent queries
              });
              
              prefetchCount++;
            } catch (parseError) {
              console.warn(`Error parsing query parameters for prefetch: ${cacheKey}`, parseError);
            }
          }
        } else if (cacheKey.startsWith('doc_')) {
          // It's a document
          const parts = cacheKey.replace('doc_', '').split('/');
          if (parts.length >= 2) {
            const collectionName = parts[0];
            const docId = parts.slice(1).join('/');
            
            // Execute with cache refresh to update
            await getDocumentWithEnhancedCache(collectionName, docId, {
              forceRefresh: true,
              ttl: CACHE_TTL.LONG // Use a longer TTL for frequent docs
            });
            
            prefetchCount++;
          }
        }
      } catch (error) {
        console.warn(`Error prefetching query: ${accessKey}`, error);
      }
    }
  }
  
  return prefetchCount;
};

/**
 * Clear the query access tracking
 */
export const clearQueryAccessTracking = () => {
  queryAccesses.clear();
};

/**
 * Get a usage report of query access patterns
 * 
 * @returns {Array} - Array of query access stats
 */
export const getQueryAccessReport = () => {
  const now = Date.now();
  const windowStart = now - FREQUENT_QUERY_WINDOW;
  
  const report = [];
  
  for (const [accessKey, accesses] of queryAccesses.entries()) {
    const recentAccesses = accesses.filter(time => time >= windowStart);
    
    if (recentAccesses.length > 0) {
      report.push({
        key: accessKey.replace('access_', ''),
        accessCount: recentAccesses.length,
        lastAccess: Math.max(...recentAccesses),
        isFrequent: recentAccesses.length >= FREQUENT_QUERY_THRESHOLD
      });
    }
  }
  
  // Sort by access count (most accessed first)
  report.sort((a, b) => b.accessCount - a.accessCount);
  
  return report;
};

export default {
  getDocumentWithEnhancedCache,
  getQueryWithEnhancedCache,
  prefetchFrequentQueries,
  clearQueryAccessTracking,
  getQueryAccessReport
}; 