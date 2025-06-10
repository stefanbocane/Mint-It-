import { collection, doc, getDocs, limit, orderBy, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';
import CacheService from '../services/caching/CacheService';

/**
 * Enhanced batch operations utility for optimizing multiple database operations
 */

/**
 * Intelligent batch processor that combines similar operations
 */
export class BatchOperationManager {
  constructor() {
    this.batch = writeBatch(db);
    this.operations = [];
    this.cacheInvalidations = new Set();
  }

  /**
   * Add an update operation to the batch
   * @param {string} collection - Collection name
   * @param {string} id - Document ID
   * @param {Object} data - Data to update
   * @param {Object} options - Additional options
   */
  update(collection, id, data, options = {}) {
    const docRef = doc(db, collection, id);
    this.batch.update(docRef, data);
    
    this.operations.push({
      type: 'update',
      collection,
      id,
      data,
      options
    });

    // Mark for cache invalidation
    this.cacheInvalidations.add(`${collection}:${id}`);
    
    return this;
  }

  /**
   * Add a set operation to the batch
   * @param {string} collection - Collection name
   * @param {string} id - Document ID
   * @param {Object} data - Data to set
   * @param {Object} options - Additional options (merge, etc.)
   */
  set(collection, id, data, options = {}) {
    const docRef = doc(db, collection, id);
    this.batch.set(docRef, data, options);
    
    this.operations.push({
      type: 'set',
      collection,
      id,
      data,
      options
    });

    // Mark for cache invalidation
    this.cacheInvalidations.add(`${collection}:${id}`);
    
    return this;
  }

  /**
   * Add a delete operation to the batch
   * @param {string} collection - Collection name
   * @param {string} id - Document ID
   */
  delete(collection, id) {
    const docRef = doc(db, collection, id);
    this.batch.delete(docRef);
    
    this.operations.push({
      type: 'delete',
      collection,
      id
    });

    // Mark for cache invalidation
    this.cacheInvalidations.add(`${collection}:${id}`);
    
    return this;
  }

  /**
   * Execute the batch operation and handle cache invalidation
   * @returns {Promise<Object>} Result object with success status and details
   */
  async commit() {
    if (this.operations.length === 0) {
      return { success: true, operationsCount: 0, message: 'No operations to commit' };
    }

    try {
      console.log(`Executing batch with ${this.operations.length} operations`);
      
      // Execute the batch
      await this.batch.commit();
      
      // Invalidate all affected cache entries
      const invalidationPromises = Array.from(this.cacheInvalidations).map(cacheKey => 
        CacheService.invalidate(cacheKey).catch(err => 
          console.warn(`Failed to invalidate cache for ${cacheKey}:`, err)
        )
      );
      
      await Promise.allSettled(invalidationPromises);
      
      console.log(`Batch committed successfully with ${this.operations.length} operations`);
      console.log(`Invalidated ${this.cacheInvalidations.size} cache entries`);
      
      return {
        success: true,
        operationsCount: this.operations.length,
        cacheInvalidationsCount: this.cacheInvalidations.size,
        message: 'Batch operation completed successfully'
      };
      
    } catch (error) {
      console.error('Batch operation failed:', error);
      throw error;
    }
  }

  /**
   * Get the current operations count
   */
  getOperationsCount() {
    return this.operations.length;
  }

  /**
   * Clear all operations (useful for reusing the manager)
   */
  clear() {
    this.batch = writeBatch(db);
    this.operations = [];
    this.cacheInvalidations.clear();
    return this;
  }
}

/**
 * Convenience function for simple batch updates with caching
 * @param {Array} updates - Array of update objects
 * @param {Object} options - Batch options
 * @returns {Promise<Object>} Result object
 */
export const batchedUpdateDoc = async (updates, options = {}) => {
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new Error('Updates must be a non-empty array');
  }

  const batchManager = new BatchOperationManager();

  // Add all updates to the batch
  for (const update of updates) {
    const { collection, id, data, operation = 'update', ...operationOptions } = update;
    
    if (!collection || !id) {
      throw new Error('Each update must have collection and id properties');
    }

    switch (operation) {
      case 'update':
        batchManager.update(collection, id, data, operationOptions);
        break;
      case 'set':
        batchManager.set(collection, id, data, operationOptions);
        break;
      case 'delete':
        batchManager.delete(collection, id);
        break;
      default:
        throw new Error(`Unknown operation type: ${operation}`);
    }
  }

  // Execute the batch
  return await batchManager.commit();
};

/**
 * Convenience function for batch updates with optimistic UI updates
 * @param {Array} updates - Array of update objects
 * @param {Function} optimisticUpdateFn - Function to run optimistic updates
 * @param {Function} rollbackFn - Function to rollback optimistic updates on failure
 * @returns {Promise<Object>} Result object
 */
export const optimisticBatchUpdate = async (updates, optimisticUpdateFn, rollbackFn) => {
  // Apply optimistic updates first
  if (optimisticUpdateFn) {
    try {
      await optimisticUpdateFn(updates);
    } catch (optimisticError) {
      console.warn('Optimistic update failed:', optimisticError);
    }
  }

  try {
    // Execute the actual batch operation
    const result = await batchedUpdateDoc(updates);
    return result;
  } catch (error) {
    // Rollback optimistic updates on failure
    if (rollbackFn) {
      try {
        await rollbackFn(updates);
      } catch (rollbackError) {
        console.error('Rollback failed:', rollbackError);
      }
    }
    throw error;
  }
};

/**
 * Batch operation with automatic retry logic
 * @param {Array} updates - Array of update objects
 * @param {Object} retryOptions - Retry configuration
 * @returns {Promise<Object>} Result object
 */
export const retryableBatchUpdate = async (updates, retryOptions = {}) => {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    exponentialBackoff = true
  } = retryOptions;

  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await batchedUpdateDoc(updates);
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        break; // Last attempt failed
      }

      // Calculate delay
      const delay = exponentialBackoff 
        ? retryDelay * Math.pow(2, attempt)
        : retryDelay;
      
      console.warn(`Batch operation attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error);
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Batch operation failed after ${maxRetries + 1} attempts. Last error: ${lastError.message}`);
};

/**
 * Optimized document reader using cache-first strategy
 * @param {string} collection - Collection name
 * @param {string} documentId - Document ID
 * @param {Object} options - Options including TTL
 * @returns {Promise<Object>} Document data
 */
export const batchedGetDoc = async (collection, documentId, options = {}) => {
  const { ttl = 2 * 60 * 1000 } = options;
  
  try {
    return await CacheService.getDocument(collection, documentId, { ttl });
  } catch (error) {
    console.error(`Error in batchedGetDoc for ${collection}/${documentId}:`, error);
    throw error;
  }
};

/**
 * Optimized document setter with cache invalidation
 * @param {string} collection - Collection name
 * @param {string} documentId - Document ID  
 * @param {Object} data - Data to set
 * @param {Object} options - Set options
 * @returns {Promise<void>}
 */
export const batchedSetDoc = async (collection, documentId, data, options = {}) => {
  try {
    const batchManager = new BatchOperationManager();
    await batchManager.set(collection, documentId, data, options).commit();
  } catch (error) {
    console.error(`Error in batchedSetDoc for ${collection}/${documentId}:`, error);
    throw error;
  }
};

/**
 * Batch fetch related data for multiple documents
 * This is useful when you have a list of items and need to fetch related data
 */
export const batchFetchRelatedData = async (items, relationConfig) => {
  /*
   * relationConfig example:
   * {
   *   users: { idField: 'userId', collection: 'users' },
   *   cards: { idField: 'cardId', collection: 'cards' }
   * }
   */
  
  if (!items || items.length === 0) return { items, related: {} };
  
  const relatedIds = {};
  
  // Collect all related IDs
  Object.entries(relationConfig).forEach(([key, config]) => {
    relatedIds[key] = new Set();
    
    items.forEach(item => {
      const id = item[config.idField];
      if (id) {
        if (Array.isArray(id)) {
          id.forEach(subId => relatedIds[key].add(subId));
        } else {
          relatedIds[key].add(id);
        }
      }
    });
  });
  
  // Batch fetch all related data
  const relatedData = {};
  
  await Promise.all(
    Object.entries(relationConfig).map(async ([key, config]) => {
      const ids = Array.from(relatedIds[key]);
      if (ids.length > 0) {
        const docs = await CacheService.getDocuments(config.collection, ids, {
          ttl: config.ttl || 2 * 60 * 1000 // 2 minute default cache
        });
        relatedData[key] = new Map(docs.map(doc => [doc.id, doc]));
      } else {
        relatedData[key] = new Map();
      }
    })
  );
  
  return { items, related: relatedData };
};

/**
 * Smart query optimizer that can combine similar queries
 */
export const optimizedQuery = async (querySpecs) => {
  /*
   * querySpecs example:
   * [
   *   {
   *     collection: 'cards',
   *     where: [['ownerId', '==', userId], ['groupId', '==', groupId]],
   *     orderBy: ['createdAt', 'desc'],
   *     limit: 20,
   *     cacheKey: 'user_cards_owner'
   *   }
   * ]
   */
  
  const results = await Promise.all(
    querySpecs.map(async (spec) => {
      const cacheKey = spec.cacheKey || `query_${JSON.stringify(spec)}`;
      
      return CacheService.getOrSet(cacheKey, async () => {
        let queryRef = collection(db, spec.collection);
        
        // Apply where clauses
        if (spec.where) {
          spec.where.forEach(([field, operator, value]) => {
            queryRef = query(queryRef, where(field, operator, value));
          });
        }
        
        // Apply ordering
        if (spec.orderBy) {
          const [field, direction] = spec.orderBy;
          queryRef = query(queryRef, orderBy(field, direction));
        }
        
        // Apply limit
        if (spec.limit) {
          queryRef = query(queryRef, limit(spec.limit));
        }
        
        const snapshot = await getDocs(queryRef);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }, { ttl: spec.ttl || 2 * 60 * 1000 });
    })
  );
  
  return results;
};

/**
 * Utility to verify and fix data consistency in batches
 */
export const batchVerifyConsistency = async (items, verificationRules) => {
  /*
   * verificationRules example:
   * {
   *   checkTradeStatus: async (card) => {
   *     if (card.inTrade && card.tradeId) {
   *       const trade = await batchedGetDoc('trades', card.tradeId);
   *       return trade && ['active', 'offered', 'pending'].includes(trade.status);
   *     }
   *     return !card.inTrade;
   *   }
   * }
   */
  
  const fixOperations = [];
  
  for (const item of items) {
    for (const [ruleName, ruleFunction] of Object.entries(verificationRules)) {
      try {
        const isValid = await ruleFunction(item);
        if (!isValid) {
          // Add fix operation based on rule
          fixOperations.push({
            item,
            rule: ruleName,
            fix: await generateFix(item, ruleName)
          });
        }
      } catch (error) {
        console.error(`Error in verification rule ${ruleName}:`, error);
      }
    }
  }
  
  // Execute fix operations in batches
  if (fixOperations.length > 0) {
    const batchUpdates = fixOperations.map(({ item, fix }) => ({
      collection: 'cards', // or determine dynamically
      id: item.id,
      data: fix,
      operation: 'update'
    }));
    
    await batchedUpdateDoc(batchUpdates);
  }
  
  return fixOperations.length;
};

/**
 * Generate fix data based on verification rule
 */
const generateFix = async (item, ruleName) => {
  switch (ruleName) {
    case 'checkTradeStatus':
      return {
        inTrade: false,
        tradeId: null,
        fixedAt: new Date().toISOString(),
        fixedBy: 'batchVerifyConsistency'
      };
    case 'checkAuctionStatus':
      return {
        inAuction: false,
        auctionId: null,
        fixedAt: new Date().toISOString(),
        fixedBy: 'batchVerifyConsistency'
      };
    default:
      return {
        fixedAt: new Date().toISOString(),
        fixedBy: 'batchVerifyConsistency'
      };
  }
};

export default {
  BatchOperationManager,
  batchedGetDoc,
  batchedUpdateDoc,
  batchedSetDoc,
  optimisticBatchUpdate,
  retryableBatchUpdate,
  batchFetchRelatedData,
  optimizedQuery,
  batchVerifyConsistency
}; 