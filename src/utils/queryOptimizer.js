import { collection, getDocs, limit, orderBy, query, startAfter, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import CacheService from '../services/caching/CacheService';

/**
 * Optimized query utility for consolidating similar data fetches
 */

/**
 * Optimized user cards fetcher that consolidates ownerId and userId queries
 * @param {Object} params - Query parameters
 * @param {string} params.userId - User ID
 * @param {string} params.groupId - Group ID  
 * @param {number} params.pageSize - Page size for pagination
 * @param {string} params.orderField - Field to order by
 * @param {string} params.orderDirection - Order direction ('asc' or 'desc')
 * @param {Object} params.startAfterDocs - Pagination cursors
 * @returns {Promise<Object>} Optimized query result
 */
export const fetchUserCardsOptimized = async ({
  userId,
  groupId,
  pageSize = 20,
  orderField = 'createdAt',
  orderDirection = 'desc',
  startAfterDocs = {}
}) => {
  if (!userId || !groupId) {
    return { cards: [], hasMore: { owner: false, user: false }, startAfterDocs: {} };
  }

  try {
    // Define base query configurations
    const ownerQueryConfig = {
      collection: 'cards',
      where: [
        ['ownerId', '==', userId],
        ['groupId', '==', groupId]
      ],
      orderBy: [orderField, orderDirection],
      limit: pageSize,
      startAfter: startAfterDocs.owner,
      cacheKey: `cards_owner_${userId}_${groupId}_${orderField}_${orderDirection}`,
      ttl: 2 * 60 * 1000 // 2 minute cache
    };

    const userQueryConfig = {
      collection: 'cards',
      where: [
        ['userId', '==', userId],
        ['groupId', '==', groupId]
      ],
      orderBy: [orderField, orderDirection],
      limit: pageSize,
      startAfter: startAfterDocs.user,
      cacheKey: `cards_userid_${userId}_${groupId}_${orderField}_${orderDirection}`,
      ttl: 2 * 60 * 1000 // 2 minute cache
    };

    // Execute both queries in parallel
    const [ownerResult, userResult] = await Promise.all([
      executeOptimizedQuery(ownerQueryConfig),
      executeOptimizedQuery(userQueryConfig)
    ]);

    // Combine and deduplicate results
    const combinedCards = [];
    const seenCardIds = new Set();

    // Add owner cards first
    ownerResult.documents.forEach(card => {
      if (!seenCardIds.has(card.id)) {
        combinedCards.push(card);
        seenCardIds.add(card.id);
      }
    });

    // Add user cards that aren't already included
    userResult.documents.forEach(card => {
      if (!seenCardIds.has(card.id)) {
        combinedCards.push(card);
        seenCardIds.add(card.id);
      }
    });

    // Sort combined results by the specified order
    combinedCards.sort((a, b) => {
      const aValue = a[orderField];
      const bValue = b[orderField];
      
      if (orderField === 'createdAt') {
        const aTime = aValue?.toDate?.() || new Date(aValue || 0);
        const bTime = bValue?.toDate?.() || new Date(bValue || 0);
        return orderDirection === 'desc' ? bTime - aTime : aTime - bTime;
      } else if (typeof aValue === 'string') {
        const comparison = aValue.localeCompare(bValue);
        return orderDirection === 'desc' ? -comparison : comparison;
      } else {
        return orderDirection === 'desc' ? bValue - aValue : aValue - bValue;
      }
    });

    return {
      cards: combinedCards,
      hasMore: {
        owner: ownerResult.hasMore,
        user: userResult.hasMore
      },
      startAfterDocs: {
        owner: ownerResult.lastDoc,
        user: userResult.lastDoc
      }
    };

  } catch (error) {
    console.error('Error in fetchUserCardsOptimized:', error);
    throw error;
  }
};

/**
 * Execute an optimized query with caching
 * @param {Object} config - Query configuration
 * @returns {Promise<Object>} Query result with documents and pagination info
 */
export const executeOptimizedQuery = async (config) => {
  const {
    collection: collectionName,
    where: whereClause = [],
    orderBy: orderByClause,
    limit: limitValue,
    startAfter: startAfterDoc,
    cacheKey,
    ttl = 2 * 60 * 1000,
    forceRefresh = false
  } = config;

  try {
    // Try to get from cache first (unless forcing refresh or using pagination)
    if (!forceRefresh && !startAfterDoc && cacheKey) {
      const cachedResult = await CacheService.getValue(cacheKey);
      if (cachedResult) {
        console.log(`Cache hit for query: ${cacheKey}`);
        return cachedResult;
      }
    }

    // Build the query
    let queryRef = collection(db, collectionName);

    // Apply where clauses
    whereClause.forEach(([field, operator, value]) => {
      queryRef = query(queryRef, where(field, operator, value));
    });

    // Apply ordering
    if (orderByClause) {
      const [field, direction] = orderByClause;
      queryRef = query(queryRef, orderBy(field, direction));
    }

    // Apply pagination
    if (startAfterDoc) {
      queryRef = query(queryRef, startAfter(startAfterDoc));
    }

    // Apply limit
    if (limitValue) {
      queryRef = query(queryRef, limit(limitValue));
    }

    // Execute the query
    const snapshot = await getDocs(queryRef);
    const documents = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    const result = {
      documents,
      hasMore: documents.length === limitValue,
      lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
      count: documents.length
    };

    // Cache the result if not using pagination and we have a cache key
    if (!startAfterDoc && cacheKey && documents.length > 0) {
      await CacheService.setValue(cacheKey, result, { ttl });
    }

    console.log(`Query executed: ${cacheKey || 'uncached'} - ${documents.length} documents`);
    return result;

  } catch (error) {
    console.error('Error executing optimized query:', error);
    throw error;
  }
};

/**
 * Batch execute multiple optimized queries
 * @param {Array} queryConfigs - Array of query configurations
 * @returns {Promise<Array>} Array of query results
 */
export const batchExecuteQueries = async (queryConfigs) => {
  if (!Array.isArray(queryConfigs) || queryConfigs.length === 0) {
    return [];
  }

  try {
    return await Promise.all(
      queryConfigs.map(config => executeOptimizedQuery(config))
    );
  } catch (error) {
    console.error('Error in batch query execution:', error);
    throw error;
  }
};

/**
 * Smart query deduplicator that avoids redundant queries
 * @param {Array} queryConfigs - Array of query configurations
 * @returns {Promise<Map>} Map of results keyed by cache key
 */
export const smartQueryDeduplicator = async (queryConfigs) => {
  const uniqueQueries = new Map();
  const resultMapping = new Map();

  // Deduplicate queries by cache key
  queryConfigs.forEach((config, index) => {
    const key = config.cacheKey || `query_${index}`;
    
    if (!uniqueQueries.has(key)) {
      uniqueQueries.set(key, config);
    }
    
    // Track which original queries map to which deduplicated query
    if (!resultMapping.has(key)) {
      resultMapping.set(key, []);
    }
    resultMapping.get(key).push(index);
  });

  // Execute unique queries
  const uniqueResults = await Promise.all(
    Array.from(uniqueQueries.values()).map(config => executeOptimizedQuery(config))
  );

  // Build result map
  const results = new Map();
  Array.from(uniqueQueries.keys()).forEach((key, index) => {
    results.set(key, uniqueResults[index]);
  });

  return results;
};

/**
 * Query performance analyzer
 * @param {string} cacheKey - Cache key to analyze
 * @param {Object} queryConfig - Query configuration
 * @returns {Promise<Object>} Performance metrics
 */
export const analyzeQueryPerformance = async (cacheKey, queryConfig) => {
  const startTime = Date.now();
  
  try {
    const result = await executeOptimizedQuery({
      ...queryConfig,
      cacheKey,
      forceRefresh: true // Force refresh for accurate timing
    });
    
    const executionTime = Date.now() - startTime;
    
    return {
      cacheKey,
      executionTime,
      documentCount: result.documents.length,
      hasMore: result.hasMore,
      performance: {
        fast: executionTime < 500,
        medium: executionTime >= 500 && executionTime < 1500,
        slow: executionTime >= 1500
      }
    };
  } catch (error) {
    return {
      cacheKey,
      executionTime: Date.now() - startTime,
      error: error.message,
      performance: { failed: true }
    };
  }
};

/**
 * Query result merger for combining similar queries
 * @param {Array} results - Array of query results
 * @param {Object} mergeOptions - Merge configuration
 * @returns {Object} Merged result
 */
export const mergeQueryResults = (results, mergeOptions = {}) => {
  const {
    deduplicateBy = 'id',
    sortBy = null,
    sortDirection = 'desc',
    maxResults = null
  } = mergeOptions;

  if (!Array.isArray(results) || results.length === 0) {
    return { documents: [], hasMore: false, count: 0 };
  }

  // Combine all documents
  const allDocuments = [];
  const seen = new Set();
  let hasMore = false;

  results.forEach(result => {
    if (result.hasMore) hasMore = true;
    
    result.documents.forEach(doc => {
      const key = doc[deduplicateBy];
      if (!seen.has(key)) {
        seen.add(key);
        allDocuments.push(doc);
      }
    });
  });

  // Sort if requested
  if (sortBy) {
    allDocuments.sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];
      
      if (sortBy === 'createdAt') {
        const aTime = aValue?.toDate?.() || new Date(aValue || 0);
        const bTime = bValue?.toDate?.() || new Date(bValue || 0);
        return sortDirection === 'desc' ? bTime - aTime : aTime - bTime;
      } else if (typeof aValue === 'string') {
        const comparison = aValue.localeCompare(bValue);
        return sortDirection === 'desc' ? -comparison : comparison;
      } else {
        return sortDirection === 'desc' ? bValue - aValue : aValue - bValue;
      }
    });
  }

  // Limit results if requested
  const finalDocuments = maxResults ? 
    allDocuments.slice(0, maxResults) : 
    allDocuments;

  return {
    documents: finalDocuments,
    hasMore: hasMore || (maxResults && allDocuments.length > maxResults),
    count: finalDocuments.length,
    totalFound: allDocuments.length
  };
};

/**
 * Batch fetch multiple document types with optimized caching
 * 
 * @param {Array} fetchSpecs - Array of {collection, ids, ttl} objects
 * @returns {Promise<Object>} - Object with results keyed by collection name
 */
export const batchFetchMultipleCollections = async (fetchSpecs) => {
  try {
    const results = {};
    
    // Execute all fetches in parallel
    const fetchPromises = fetchSpecs.map(async ({ collection, ids, ttl = 60000 }) => {
      if (!ids || ids.length === 0) return { collection, data: [] };
      
      const data = await CacheService.getDocuments(collection, ids, { ttl });
      return { collection, data };
    });
    
    const fetchResults = await Promise.all(fetchPromises);
    
    // Organize results by collection
    fetchResults.forEach(({ collection, data }) => {
      results[collection] = data;
    });
    
    return results;
  } catch (error) {
    console.error('Error in batchFetchMultipleCollections:', error);
    throw error;
  }
};

/**
 * Optimized query for trade-related data that often needs user and card info together
 * 
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} - Optimized trade data with related info
 */
export const fetchTradeDataOptimized = async ({ 
  tradeId, 
  includeSender = true, 
  includeReceiver = true, 
  includeCards = true 
}) => {
  try {
    // First get the trade document
    const trade = await CacheService.getDocument('trades', tradeId, { ttl: 30000 });
    if (!trade) return null;
    
    // Collect all IDs we need to fetch
    const userIds = [];
    const cardIds = [];
    
    if (includeSender && trade.senderId) userIds.push(trade.senderId);
    if (includeReceiver && trade.receiverId) userIds.push(trade.receiverId);
    
    if (includeCards) {
      if (trade.offeredCards) cardIds.push(...trade.offeredCards);
      if (trade.requestedCards) cardIds.push(...trade.requestedCards);
    }
    
    // Batch fetch all related data
    const relatedData = await batchFetchMultipleCollections([
      { collection: 'users', ids: userIds, ttl: 60000 },
      { collection: 'cards', ids: cardIds, ttl: 120000 }
    ]);
    
    // Organize the data for easy access
    const users = new Map(relatedData.users.map(user => [user.id, user]));
    const cards = new Map(relatedData.cards.map(card => [card.id, card]));
    
    return {
      trade,
      senderData: users.get(trade.senderId),
      receiverData: users.get(trade.receiverId),
      offeredCardsData: (trade.offeredCards || []).map(cardId => cards.get(cardId)).filter(Boolean),
      requestedCardsData: (trade.requestedCards || []).map(cardId => cards.get(cardId)).filter(Boolean),
      allUsers: Object.fromEntries(users),
      allCards: Object.fromEntries(cards)
    };
  } catch (error) {
    console.error('Error in fetchTradeDataOptimized:', error);
    throw error;
  }
};

export default {
  fetchUserCardsOptimized,
  batchFetchMultipleCollections,
  fetchTradeDataOptimized
}; 