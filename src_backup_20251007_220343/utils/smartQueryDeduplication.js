/**
 * Smart Query Deduplication Service
 * Prevents redundant queries across the entire application
 */

import CacheService from '../services/caching/CacheService';

// Global request tracking
const activeRequests = new Map();
const recentRequests = new Map();
const REQUEST_DEDUPE_WINDOW = 5000; // 5 seconds

/**
 * Create a unique key for any query operation
 */
const createQueryFingerprint = (operation, params) => {
  // Sort params to ensure consistent key generation
  const sortedParams = typeof params === 'object' && params !== null
    ? Object.keys(params).sort().reduce((sorted, key) => {
        sorted[key] = params[key];
        return sorted;
      }, {})
    : params;
  
  return `${operation}_${JSON.stringify(sortedParams)}`;
};

/**
 * Execute a query with automatic deduplication
 * If the same query is already running, returns the existing promise
 */
export const deduplicatedQuery = async (operation, params, fetchFunction, options = {}) => {
  const fingerprint = createQueryFingerprint(operation, params);
  const { ttl = 60000, forceRefresh = false } = options;
  
  // Check if we have a recent result
  if (!forceRefresh && recentRequests.has(fingerprint)) {
    const recentResult = recentRequests.get(fingerprint);
    const age = Date.now() - recentResult.timestamp;
    
    if (age < REQUEST_DEDUPE_WINDOW) {
      console.log(`Deduplicating recent query: ${fingerprint} (age: ${age}ms)`);
      return recentResult.data;
    }
  }
  
  // Check if this query is already in flight
  if (activeRequests.has(fingerprint)) {
    console.log(`Deduplicating active query: ${fingerprint}`);
    return activeRequests.get(fingerprint);
  }
  
  // Create new request
  const requestPromise = (async () => {
    try {
      console.log(`Executing deduplicated query: ${fingerprint}`);
      const result = await fetchFunction();
      
      // Store in recent results
      recentRequests.set(fingerprint, {
        data: result,
        timestamp: Date.now()
      });
      
      // Cleanup old recent requests
      cleanupRecentRequests();
      
      return result;
    } finally {
      // Remove from active requests
      activeRequests.delete(fingerprint);
    }
  })();
  
  // Store the active request
  activeRequests.set(fingerprint, requestPromise);
  
  return requestPromise;
};

/**
 * Clean up old recent requests periodically
 */
const cleanupRecentRequests = () => {
  const now = Date.now();
  const cutoff = now - REQUEST_DEDUPE_WINDOW * 2; // Keep for 2x the window
  
  for (const [key, request] of recentRequests.entries()) {
    if (request.timestamp < cutoff) {
      recentRequests.delete(key);
    }
  }
};

/**
 * Smart document fetcher with deduplication
 */
export const getDocumentDeduplicated = async (collectionName, documentId, options = {}) => {
  return deduplicatedQuery(
    'getDocument',
    { collection: collectionName, id: documentId },
    () => CacheService.getDocument(collectionName, documentId, options),
    options
  );
};

/**
 * Smart batch document fetcher with deduplication
 */
export const getDocumentsBatch = async (collectionName, documentIds, options = {}) => {
  if (!documentIds || documentIds.length === 0) return [];
  
  // Sort IDs to ensure consistent caching
  const sortedIds = [...documentIds].sort();
  
  return deduplicatedQuery(
    'getDocumentsBatch',
    { collection: collectionName, ids: sortedIds },
    () => CacheService.getDocuments(collectionName, sortedIds, options),
    options
  );
};

/**
 * Smart query with automatic deduplication
 */
export const queryWithDeduplication = async (queryConfig, options = {}) => {
  const { 
    collection: collectionName, 
    where: whereConditions = [], 
    orderBy = null,
    limit = null 
  } = queryConfig;
  
  return deduplicatedQuery(
    'query',
    { 
      collection: collectionName, 
      where: whereConditions,
      orderBy,
      limit
    },
    async () => {
      // Use existing cached query functionality
      const { getCachedQuery } = await import('./firestoreUtils');
      return getCachedQuery(collectionName, whereConditions, options);
    },
    options
  );
};

/**
 * Preload multiple queries with deduplication
 * Useful for warming cache before screen navigation
 */
export const preloadQueries = async (querySpecs, options = {}) => {
  const { priority = 'normal' } = options;
  
  console.log(`Preloading ${querySpecs.length} queries with priority: ${priority}`);
  
  // For high priority, await all queries
  // For normal/low priority, fire and forget
  const promises = querySpecs.map(spec => {
    const { type, ...params } = spec;
    
    switch (type) {
      case 'document':
        return getDocumentDeduplicated(params.collection, params.id, { 
          ttl: 2 * 60 * 1000, // 2 minute cache for preload
          ...params.options 
        });
        
      case 'documents':
        return getDocumentsBatch(params.collection, params.ids, { 
          ttl: 2 * 60 * 1000,
          ...params.options 
        });
        
      case 'query':
        return queryWithDeduplication(params.queryConfig, { 
          ttl: 2 * 60 * 1000,
          ...params.options 
        });
        
      default:
        console.warn(`Unknown preload query type: ${type}`);
        return Promise.resolve(null);
    }
  });
  
  if (priority === 'high') {
    return Promise.all(promises);
  } else {
    // Fire and forget for normal/low priority
    Promise.all(promises).catch(error => 
      console.warn('Error in preload queries:', error)
    );
    return Promise.resolve();
  }
};

/**
 * Get statistics about query deduplication effectiveness
 */
export const getDeduplicationStats = () => {
  return {
    activeRequests: activeRequests.size,
    recentRequests: recentRequests.size,
    recentRequestsDetails: Array.from(recentRequests.entries()).map(([key, data]) => ({
      query: key,
      age: Date.now() - data.timestamp,
      timestamp: data.timestamp
    }))
  };
};

/**
 * Clear all deduplication caches
 * Useful for testing or memory management
 */
export const clearDeduplicationCache = () => {
  activeRequests.clear();
  recentRequests.clear();
  console.log('Cleared query deduplication cache');
};

/**
 * Smart screen data preloader
 * Preloads data patterns commonly needed for specific screens
 */
export const preloadScreenData = async (screenName, context = {}, options = {}) => {
  const { userId, groupId } = context;
  
  const preloadSpecs = {
    'AuctionScreen': [
      { type: 'query', queryConfig: { collection: 'auctions', where: [['groupId', '==', groupId], ['status', '==', 'active']] }},
      { type: 'document', collection: 'users', id: userId },
      { type: 'document', collection: 'groups', id: groupId }
    ],
    
    'TradesScreen': [
      { type: 'query', queryConfig: { collection: 'trades', where: [['groupId', '==', groupId]] }},
      { type: 'document', collection: 'users', id: userId }
    ],
    
    'CollectionScreen': [
      { type: 'query', queryConfig: { collection: 'cards', where: [['ownerId', '==', userId], ['groupId', '==', groupId]] }},
      { type: 'document', collection: 'users', id: userId }
    ],
    
    'LeaderboardScreen': [
      { type: 'query', queryConfig: { collection: 'cards', where: [['groupId', '==', groupId]] }},
      { type: 'query', queryConfig: { collection: 'users', where: [['groupId', '==', groupId]] }}
    ]
  };
  
  const specs = preloadSpecs[screenName];
  if (!specs) {
    console.log(`No preload pattern defined for screen: ${screenName}`);
    return;
  }
  
  console.log(`Preloading data for ${screenName} screen`);
  return preloadQueries(specs, options);
};

export default {
  deduplicatedQuery,
  getDocumentDeduplicated,
  getDocumentsBatch,
  queryWithDeduplication,
  preloadQueries,
  preloadScreenData,
  getDeduplicationStats,
  clearDeduplicationCache
}; 