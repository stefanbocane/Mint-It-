/**
 * Centralized Batch Processing Service
 * 
 * This service provides a unified approach to batch operations:
 * - Consolidates various batch processing implementations
 * - Intelligent batching with queue management
 * - Cache invalidation coordination
 * - Error handling and retry mechanism
 */
import { doc, writeBatch, collection, addDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import ErrorHandlingService, { ERROR_CATEGORY } from './ErrorHandlingService';
import CacheService from './caching/CacheService';

// Configuration
const BATCH_DELAY = 500; // ms to wait before processing
const MAX_BATCH_SIZE = 20; // Firestore batch limit is 500, but we use smaller for safety
const MAX_RETRY_COUNT = 3; // Number of times to retry a failed batch
const RETRY_DELAY = 1000; // ms to wait between retries

// Batch operation types
const OPERATION_TYPE = {
  UPDATE: 'update',
  CREATE: 'create',
  DELETE: 'delete',
  SET: 'set'
};

// Internal state
const operationQueue = [];
let processingQueue = false;
let batchProcessTimeout = null;

/**
 * Queue an update operation
 * 
 * @param {string} collection - Firestore collection name
 * @param {string} docId - Document ID
 * @param {Object} data - Data to update
 * @param {Object} options - Additional options
 * @returns {string} - Operation ID
 */
export const queueUpdate = (collection, docId, data, options = {}) => {
  return queueOperation(OPERATION_TYPE.UPDATE, collection, docId, data, options);
};

/**
 * Queue a create operation
 * 
 * @param {string} collection - Firestore collection name
 * @param {string} docId - Document ID (optional)
 * @param {Object} data - Data to create
 * @param {Object} options - Additional options
 * @returns {string} - Operation ID
 */
export const queueCreate = (collection, docId, data, options = {}) => {
  return queueOperation(OPERATION_TYPE.CREATE, collection, docId, data, options);
};

/**
 * Queue a delete operation
 * 
 * @param {string} collection - Firestore collection name
 * @param {string} docId - Document ID
 * @param {Object} options - Additional options
 * @returns {string} - Operation ID
 */
export const queueDelete = (collection, docId, options = {}) => {
  return queueOperation(OPERATION_TYPE.DELETE, collection, docId, null, options);
};

/**
 * Queue a set operation (creates or overwrites)
 * 
 * @param {string} collection - Firestore collection name
 * @param {string} docId - Document ID
 * @param {Object} data - Data to set
 * @param {Object} options - Additional options
 * @returns {string} - Operation ID
 */
export const queueSet = (collection, docId, data, options = {}) => {
  return queueOperation(OPERATION_TYPE.SET, collection, docId, data, options);
};

/**
 * Internal function to queue an operation
 * 
 * @param {string} type - Operation type
 * @param {string} collectionName - Collection name
 * @param {string} docId - Document ID
 * @param {Object} data - Operation data
 * @param {Object} options - Additional options
 * @returns {string} - Operation ID
 */
const queueOperation = (type, collectionName, docId, data, options = {}) => {
  const {
    invalidateCache = true,
    priority = 0,
    onSuccess = null,
    onError = null
  } = options;
  
  // Generate a unique operation ID
  const operationId = `${type}_${collectionName}_${docId || 'new'}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Add to the queue
  operationQueue.push({
    id: operationId,
    type,
    collection: collectionName,
    docId,
    data,
    invalidateCache,
    priority,
    onSuccess,
    onError,
    timestamp: Date.now(),
    retryCount: 0
  });
  
  // Sort queue by priority (higher first)
  operationQueue.sort((a, b) => b.priority - a.priority);
  
  // Schedule processing if not already scheduled
  if (!batchProcessTimeout) {
    batchProcessTimeout = setTimeout(processBatchQueue, BATCH_DELAY);
  }
  
  return operationId;
};

/**
 * Process the batch operation queue
 */
const processBatchQueue = async () => {
  // Clear the timeout
  batchProcessTimeout = null;
  
  // If already processing or queue is empty, exit
  if (processingQueue || operationQueue.length === 0) {
    return;
  }
  
  try {
    processingQueue = true;
    
    // Process in batches of MAX_BATCH_SIZE
    while (operationQueue.length > 0) {
      const batch = writeBatch(db);
      const currentBatch = operationQueue.splice(0, MAX_BATCH_SIZE);
      const collectionsToInvalidate = new Set();
      const autoIdOperations = [];
      
      // Add each operation to the batch
      currentBatch.forEach(operation => {
        const { type, collection: collectionName, docId, data, invalidateCache } = operation;
        
        // Skip operations with missing collection
        if (!collectionName) {
          ErrorHandlingService.logEvent(
            `Skipping operation due to missing collection: ${type}`,
            ErrorHandlingService.ERROR_SEVERITY.WARNING
          );
          return;
        }
        
        // Handle operations that need auto-generated IDs
        if (type === OPERATION_TYPE.CREATE && !docId) {
          // Can't add to batch, need to handle separately
          autoIdOperations.push(operation);
          return;
        }
        
        try {
          const docRef = doc(db, collectionName, docId);
          
          switch (type) {
            case OPERATION_TYPE.UPDATE:
              batch.update(docRef, data);
              break;
            case OPERATION_TYPE.CREATE:
              batch.set(docRef, data);
              break;
            case OPERATION_TYPE.DELETE:
              batch.delete(docRef);
              break;
            case OPERATION_TYPE.SET:
              batch.set(docRef, data, { merge: true });
              break;
          }
          
          // Track collections for cache invalidation
          if (invalidateCache) {
            collectionsToInvalidate.add(collectionName);
          }
        } catch (error) {
          // Handle operation-specific errors
          ErrorHandlingService.handleError(error, {
            context: 'BatchService',
            category: ERROR_CATEGORY.DATABASE,
            metadata: { operation }
          });
          
          if (operation.onError) {
            operation.onError(error);
          }
        }
      });
      
      // Commit the batch
      try {
        await batch.commit();
        
        // Handle success callbacks
        currentBatch.forEach(operation => {
          if (operation.onSuccess && 
              operation.type !== OPERATION_TYPE.CREATE && 
              operation.docId) {
            operation.onSuccess();
          }
        });
        
        // Process auto-ID operations separately
        if (autoIdOperations.length > 0) {
          await processAutoIdOperations(autoIdOperations, collectionsToInvalidate);
        }
        
        // Invalidate caches if needed
        if (collectionsToInvalidate.size > 0) {
          // Clear caches for affected collections
          for (const collectionName of collectionsToInvalidate) {
            await CacheService.clearMemoryCache('documents', collectionName);
          }
        }
      } catch (error) {
        // Handle batch commit error
        ErrorHandlingService.handleError(error, {
          context: 'BatchService.commit',
          category: ERROR_CATEGORY.DATABASE,
          metadata: { operationCount: currentBatch.length }
        });
        
        // Retry logic for failed operations
        const failedOperations = currentBatch.filter(op => op.retryCount < MAX_RETRY_COUNT);
        if (failedOperations.length > 0) {
          // Increment retry count and push back to the queue
          failedOperations.forEach(op => {
            op.retryCount++;
            op.priority += 1; // Increase priority for retries
          });
          
          operationQueue.push(...failedOperations);
          
          // Sort queue again
          operationQueue.sort((a, b) => b.priority - a.priority);
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
        
        // Handle operation-specific errors
        failedOperations.forEach(operation => {
          if (operation.onError) {
            operation.onError(error);
          }
        });
      }
    }
  } catch (error) {
    ErrorHandlingService.handleError(error, {
      context: 'BatchService.processBatchQueue',
      category: ERROR_CATEGORY.DATABASE,
      severity: ErrorHandlingService.ERROR_SEVERITY.ERROR
    });
  } finally {
    processingQueue = false;
    
    // If more operations came in while processing, schedule another run
    if (operationQueue.length > 0 && !batchProcessTimeout) {
      batchProcessTimeout = setTimeout(processBatchQueue, BATCH_DELAY);
    }
  }
};

/**
 * Process operations that need auto-generated IDs
 * 
 * @param {Array} operations - List of operations needing auto-IDs
 * @param {Set} collectionsToInvalidate - Set of collections to invalidate
 */
const processAutoIdOperations = async (operations, collectionsToInvalidate) => {
  // Process each operation sequentially
  for (const operation of operations) {
    const { collection: collectionName, data, invalidateCache, onSuccess, onError } = operation;
    
    try {
      const collectionRef = collection(db, collectionName);
      const docRef = await addDoc(collectionRef, data);
      
      // Call success callback with the new ID
      if (onSuccess) {
        onSuccess(docRef.id);
      }
      
      // Track for cache invalidation
      if (invalidateCache) {
        collectionsToInvalidate.add(collectionName);
      }
    } catch (error) {
      ErrorHandlingService.handleError(error, {
        context: 'BatchService.processAutoIdOperations',
        category: ERROR_CATEGORY.DATABASE,
        metadata: { operation }
      });
      
      if (onError) {
        onError(error);
      }
    }
  }
};

/**
 * Force immediate processing of the queue
 * 
 * @returns {Promise<void>}
 */
export const flushQueue = async () => {
  clearTimeout(batchProcessTimeout);
  batchProcessTimeout = null;
  await processBatchQueue();
};

/**
 * Get the current queue length
 * 
 * @returns {number} Queue length
 */
export const getQueueLength = () => {
  return operationQueue.length;
};

/**
 * Clear the queue without processing
 */
export const clearQueue = () => {
  operationQueue.length = 0;
  clearTimeout(batchProcessTimeout);
  batchProcessTimeout = null;
};

/**
 * Get the operation queue status
 * 
 * @returns {Object} Queue status
 */
export const getQueueStatus = () => {
  return {
    queueLength: operationQueue.length,
    isProcessing: processingQueue,
    operations: operationQueue.map(op => ({
      id: op.id,
      type: op.type,
      collection: op.collection,
      timestamp: op.timestamp,
      retryCount: op.retryCount
    }))
  };
};

// Add createBatch for compatibility with auctionRarity
export const createBatch = () => {
  return writeBatch(db);
};

// Export all functions as a default object for backward compatibility
export default {
  createBatch,
  queueUpdate,
  queueCreate,
  queueDelete,
  queueSet,
  flushQueue,
  getQueueLength,
  clearQueue,
  getQueueStatus
};
