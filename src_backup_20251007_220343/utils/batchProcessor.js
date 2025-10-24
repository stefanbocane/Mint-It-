import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';
import { batchInvalidateCache } from './cacheUtils';

// Queue for batched updates
const updateQueue = [];

// State tracking
let processingQueue = false;
let batchProcessTimeout = null;
const BATCH_DELAY = 500; // ms to wait before processing
const MAX_BATCH_SIZE = 20; // Firestore batch limit is 500, but we use a smaller number

/**
 * Add an update operation to the queue
 * 
 * @param {string} collection - Firestore collection name
 * @param {string} docId - Document ID
 * @param {Object} data - Data to update
 * @param {boolean} invalidateCache - Whether to invalidate cache after update
 */
export const queueUpdate = (collection, docId, data, invalidateCache = true) => {
  updateQueue.push({
    collection,
    docId,
    data,
    invalidateCache,
    timestamp: Date.now()
  });
  
  // Schedule processing if not already scheduled
  if (!batchProcessTimeout) {
    batchProcessTimeout = setTimeout(processBatchQueue, BATCH_DELAY);
  }
};

/**
 * Process the batch update queue
 */
const processBatchQueue = async () => {
  // Clear the timeout
  batchProcessTimeout = null;
  
  // If already processing or queue is empty, exit
  if (processingQueue || updateQueue.length === 0) {
    return;
  }
  
  try {
    processingQueue = true;
    
    // Process in batches of MAX_BATCH_SIZE
    while (updateQueue.length > 0) {
      const batch = writeBatch(db);
      const currentBatch = updateQueue.splice(0, MAX_BATCH_SIZE);
      const collectionsToInvalidate = new Set();
      
      // Add each update to the batch
      currentBatch.forEach(update => {
        const { collection, docId, data, invalidateCache } = update;
        const docRef = doc(db, collection, docId);
        batch.update(docRef, data);
        
        // Track collections for cache invalidation
        if (invalidateCache) {
          collectionsToInvalidate.add(collection);
        }
      });
      
      // Commit the batch
      await batch.commit();
      console.log(`Batch processed: ${currentBatch.length} updates`);
      
      // Invalidate caches if needed
      if (collectionsToInvalidate.size > 0) {
        await batchInvalidateCache(Array.from(collectionsToInvalidate));
      }
    }
  } catch (error) {
    console.error('Error processing batch queue:', error);
    
    // If there was an error, we should retry the failed updates
    // We could implement retry logic here, but for now we'll just log
  } finally {
    processingQueue = false;
    
    // If more updates came in while processing, schedule another run
    if (updateQueue.length > 0 && !batchProcessTimeout) {
      batchProcessTimeout = setTimeout(processBatchQueue, BATCH_DELAY);
    }
  }
};

/**
 * Add a create operation to the queue
 * 
 * @param {string} collection - Firestore collection name
 * @param {string} docId - Document ID (optional, will be auto-generated if not provided)
 * @param {Object} data - Data to create
 * @param {boolean} invalidateCache - Whether to invalidate cache after create
 */
export const queueCreate = (collection, docId, data, invalidateCache = true) => {
  updateQueue.push({
    collection,
    docId,
    data,
    operation: 'create',
    invalidateCache,
    timestamp: Date.now()
  });
  
  // Schedule processing if not already scheduled
  if (!batchProcessTimeout) {
    batchProcessTimeout = setTimeout(processBatchQueue, BATCH_DELAY);
  }
};

/**
 * Add a delete operation to the queue
 * 
 * @param {string} collection - Firestore collection name
 * @param {string} docId - Document ID
 * @param {boolean} invalidateCache - Whether to invalidate cache after delete
 */
export const queueDelete = (collection, docId, invalidateCache = true) => {
  updateQueue.push({
    collection,
    docId,
    operation: 'delete',
    invalidateCache,
    timestamp: Date.now()
  });
  
  // Schedule processing if not already scheduled
  if (!batchProcessTimeout) {
    batchProcessTimeout = setTimeout(processBatchQueue, BATCH_DELAY);
  }
};

/**
 * Force immediate processing of the queue
 * 
 * @returns {Promise<void>}
 */
export const flushQueue = async () => {
  if (batchProcessTimeout) {
    clearTimeout(batchProcessTimeout);
    batchProcessTimeout = null;
  }
  
  return processBatchQueue();
};

/**
 * Alias for flushQueue - for backward compatibility
 * 
 * @returns {Promise<void>}
 */
export const flushUpdateQueue = async () => {
  return flushQueue();
};

/**
 * Get the current queue length
 * 
 * @returns {number} Queue length
 */
export const getQueueLength = () => {
  return updateQueue.length;
};

/**
 * Clear the queue without processing
 */
export const clearQueue = () => {
  updateQueue.length = 0;
  
  if (batchProcessTimeout) {
    clearTimeout(batchProcessTimeout);
    batchProcessTimeout = null;
  }
};

export default {
  queueUpdate,
  queueCreate,
  queueDelete,
  flushQueue,
  flushUpdateQueue,
  getQueueLength,
  clearQueue
}; 