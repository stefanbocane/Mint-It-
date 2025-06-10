/**
 * Ultra Batch Service
 * 
 * Batches all database read operations with intelligent deduplication,
 * request merging, and cache-first strategies to achieve maximum read reduction.
 * 
 * Target: 80-90% reduction in individual database reads
 */

import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import CacheService from './caching/CacheService';

class UltraBatchService {
  constructor() {
    this.pendingRequests = new Map(); // Group pending requests by collection
    this.batchTimers = new Map(); // Timers for each collection
    this.requestQueue = new Map(); // Queue of callbacks waiting for data
    this.metrics = {
      totalRequests: 0,
      batchedRequests: 0,
      cacheHits: 0,
      duplicatesEliminated: 0,
      readsEliminated: 0
    };

    // Configuration
    this.config = {
      batchDelayMs: 50, // Wait 50ms to batch requests
      maxBatchSize: 30, // Firestore's 'in' query limit
      cacheFirstTTL: 60 * 1000, // 1 minute cache-first strategy
      deduplicationTTL: 5 * 1000, // 5 seconds for request deduplication
      maxConcurrentBatches: 3, // Limit concurrent batches per collection
    };

    // Request deduplication cache
    this.recentRequests = new Map();
    
    // Active batch tracking
    this.activeBatches = new Map();
  }

  /**
   * Batch get documents by IDs with intelligent deduplication
   */
  async batchGetDocuments(collectionName, documentIds, options = {}) {
    if (!documentIds || documentIds.length === 0) {
      return new Map();
    }

    this.metrics.totalRequests++;

    // Deduplicate and normalize IDs
    const uniqueIds = [...new Set(documentIds.filter(id => id))];
    
    if (uniqueIds.length === 0) {
      return new Map();
    }

    // Check cache first for all IDs
    const cacheResults = new Map();
    const uncachedIds = [];

    for (const id of uniqueIds) {
      const cacheKey = `${collectionName}_${id}`;
      const cached = await CacheService.getValue(cacheKey);
      
      if (cached && this.isCacheValid(cached, options)) {
        cacheResults.set(id, cached);
        this.metrics.cacheHits++;
      } else {
        uncachedIds.push(id);
      }
    }

    // If all data is cached, return immediately
    if (uncachedIds.length === 0) {
      console.log(`🚀 UltraBatch: 100% cache hit for ${collectionName} (${uniqueIds.length} docs)`);
      return cacheResults;
    }

    // Batch remaining uncached requests
    const batchResults = await this.executeBatchRequest(collectionName, uncachedIds, options);

    // Merge cache and batch results
    const finalResults = new Map([...cacheResults, ...batchResults]);
    
    console.log(`🚀 UltraBatch: ${collectionName} - ${cacheResults.size} cached, ${batchResults.size} fetched, ${this.metrics.duplicatesEliminated} duplicates eliminated`);
    
    return finalResults;
  }

  /**
   * Execute batch request with request queuing and deduplication
   */
  async executeBatchRequest(collectionName, documentIds, options = {}) {
    return new Promise((resolve, reject) => {
      // Create request signature for deduplication
      const requestSignature = this.createRequestSignature(collectionName, documentIds, options);
      
      // Check if identical request is already in progress
      if (this.recentRequests.has(requestSignature)) {
        const existingRequest = this.recentRequests.get(requestSignature);
        if (Date.now() - existingRequest.timestamp < this.config.deduplicationTTL) {
          this.metrics.duplicatesEliminated++;
          console.log(`🔄 UltraBatch: Deduplicating identical request for ${collectionName}`);
          
          // Wait for existing request to complete
          existingRequest.promise.then(resolve).catch(reject);
          return;
        }
      }

      // Create batch request entry
      const batchKey = `${collectionName}_${Date.now()}`;
      const requestPromise = this.processBatchRequest(collectionName, documentIds, options);
      
      // Store for deduplication
      this.recentRequests.set(requestSignature, {
        promise: requestPromise,
        timestamp: Date.now()
      });

      // Clean up old requests
      this.cleanupOldRequests();

      requestPromise.then(resolve).catch(reject);
    });
  }

  /**
   * Process batch request with intelligent chunking
   */
  async processBatchRequest(collectionName, documentIds, options = {}) {
    const results = new Map();
    
    // Check if we're at batch limit
    const activeBatchKey = `${collectionName}_active`;
    const activeBatchCount = this.activeBatches.get(activeBatchKey) || 0;
    
    if (activeBatchCount >= this.config.maxConcurrentBatches) {
      console.log(`⏳ UltraBatch: Queue full for ${collectionName}, waiting...`);
      await this.waitForBatchSlot(collectionName);
    }

    // Increment active batch count
    this.activeBatches.set(activeBatchKey, activeBatchCount + 1);

    try {
      // Split into chunks based on Firestore's 'in' query limit
      const chunks = this.chunkArray(documentIds, this.config.maxBatchSize);
      
      console.log(`🔥 UltraBatch: Fetching ${documentIds.length} docs from ${collectionName} in ${chunks.length} chunk(s)`);

      // Execute all chunks in parallel
      const chunkPromises = chunks.map(chunk => this.fetchChunk(collectionName, chunk, options));
      const chunkResults = await Promise.allSettled(chunkPromises);

      // Merge results from all chunks
      chunkResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          result.value.forEach((doc, id) => {
            results.set(id, doc);
          });
        } else {
          console.error(`UltraBatch chunk ${index} failed for ${collectionName}:`, result.reason);
        }
      });

      this.metrics.batchedRequests++;
      this.metrics.readsEliminated += Math.max(0, documentIds.length - chunks.length);

    } finally {
      // Decrement active batch count
      this.activeBatches.set(activeBatchKey, Math.max(0, activeBatchCount));
    }

    return results;
  }

  /**
   * Fetch a chunk of documents
   */
  async fetchChunk(collectionName, documentIds, options = {}) {
    const results = new Map();

    try {
      const collectionRef = collection(db, collectionName);
      const chunkQuery = query(
        collectionRef,
        where(documentId(), 'in', documentIds)
      );

      const snapshot = await getDocs(chunkQuery);
      
      snapshot.forEach(doc => {
        const docData = { id: doc.id, ...doc.data() };
        results.set(doc.id, docData);

        // Cache the result for future requests
        const cacheKey = `${collectionName}_${doc.id}`;
        CacheService.setValue(cacheKey, docData, {
          ttl: options.cacheTTL || this.config.cacheFirstTTL
        }).catch(err => console.warn(`Cache set failed for ${cacheKey}:`, err));
      });

      // Handle missing documents (not found in Firestore)
      const foundIds = new Set(Array.from(results.keys()));
      const missingIds = documentIds.filter(id => !foundIds.has(id));
      
      // Cache 'not found' results to prevent repeated queries
      missingIds.forEach(id => {
        results.set(id, null);
        const cacheKey = `${collectionName}_${id}`;
        CacheService.setValue(cacheKey, null, {
          ttl: options.cacheTTL || 30 * 1000 // Cache 'not found' for 30 seconds
        }).catch(err => console.warn(`Cache set failed for missing ${cacheKey}:`, err));
      });

      console.log(`✅ UltraBatch: Fetched ${results.size} docs from ${collectionName} chunk`);

    } catch (error) {
      console.error(`UltraBatch chunk fetch failed for ${collectionName}:`, error);
      
      // Return empty results for this chunk, but don't fail the entire batch
      documentIds.forEach(id => {
        results.set(id, null);
      });
    }

    return results;
  }

  /**
   * Batch verify statuses for cards/auctions/trades
   */
  async batchVerifyStatuses(items, verificationConfig) {
    const { 
      collectionName, 
      statusField = 'status', 
      activeStatuses = ['active'], 
      idField = 'id' 
    } = verificationConfig;

    if (!items || items.length === 0) {
      return new Map();
    }

    // Extract IDs to verify
    const idsToVerify = items
      .map(item => item[idField])
      .filter(id => id);

    if (idsToVerify.length === 0) {
      return new Map();
    }

    console.log(`🔍 UltraBatch: Verifying ${idsToVerify.length} ${collectionName} statuses`);

    // Batch fetch all status documents
    const statusDocs = await this.batchGetDocuments(collectionName, idsToVerify, {
      cacheTTL: 30 * 1000 // Short cache for status verification
    });

    // Create status verification results
    const verificationResults = new Map();
    
    statusDocs.forEach((doc, id) => {
      if (doc && doc[statusField]) {
        const isActive = activeStatuses.includes(doc[statusField]);
        verificationResults.set(id, {
          exists: true,
          active: isActive,
          status: doc[statusField],
          data: doc
        });
      } else {
        verificationResults.set(id, {
          exists: false,
          active: false,
          status: null,
          data: null
        });
      }
    });

    console.log(`✅ UltraBatch: Verified ${verificationResults.size} ${collectionName} statuses`);
    
    return verificationResults;
  }

  /**
   * Batch get user data with profile enrichment
   */
  async batchGetUsers(userIds, options = {}) {
    const users = await this.batchGetDocuments('users', userIds, options);
    
    // Enrich with commonly needed fields
    const enrichedUsers = new Map();
    
    users.forEach((userData, userId) => {
      if (userData) {
        enrichedUsers.set(userId, {
          ...userData,
          displayName: userData.displayName || userData.username || 'Unknown User',
          // Add other commonly accessed fields here
        });
      } else {
        enrichedUsers.set(userId, null);
      }
    });

    return enrichedUsers;
  }

  /**
   * Batch get cards with owner data
   */
  async batchGetCardsWithOwners(cardIds, options = {}) {
    // First get all cards
    const cards = await this.batchGetDocuments('cards', cardIds, options);
    
    // Extract unique owner IDs
    const ownerIds = [...new Set(
      Array.from(cards.values())
        .filter(card => card && card.ownerId)
        .map(card => card.ownerId)
    )];

    // Batch get owner data
    const owners = await this.batchGetUsers(ownerIds, options);

    // Merge card and owner data
    const cardsWithOwners = new Map();
    
    cards.forEach((cardData, cardId) => {
      if (cardData) {
        const ownerData = owners.get(cardData.ownerId);
        cardsWithOwners.set(cardId, {
          ...cardData,
          ownerData: ownerData || null
        });
      } else {
        cardsWithOwners.set(cardId, null);
      }
    });

    return cardsWithOwners;
  }

  /**
   * Create request signature for deduplication
   */
  createRequestSignature(collectionName, documentIds, options = {}) {
    const sortedIds = [...documentIds].sort().join(',');
    const optionsStr = JSON.stringify(options);
    return `${collectionName}_${sortedIds}_${optionsStr}`;
  }

  /**
   * Check if cached data is valid
   */
  isCacheValid(cachedData, options = {}) {
    if (!cachedData || typeof cachedData !== 'object') {
      return false;
    }

    // Check if force refresh is requested
    if (options.forceRefresh) {
      return false;
    }

    // Additional validation can be added here
    return true;
  }

  /**
   * Wait for batch slot to become available
   */
  async waitForBatchSlot(collectionName) {
    return new Promise((resolve) => {
      const checkSlot = () => {
        const activeBatchKey = `${collectionName}_active`;
        const activeBatchCount = this.activeBatches.get(activeBatchKey) || 0;
        
        if (activeBatchCount < this.config.maxConcurrentBatches) {
          resolve();
        } else {
          setTimeout(checkSlot, 10); // Check again in 10ms
        }
      };
      
      checkSlot();
    });
  }

  /**
   * Chunk array into smaller arrays
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Clean up old request signatures
   */
  cleanupOldRequests() {
    const now = Date.now();
    const expiredKeys = [];

    this.recentRequests.forEach((request, key) => {
      if (now - request.timestamp > this.config.deduplicationTTL * 2) {
        expiredKeys.push(key);
      }
    });

    expiredKeys.forEach(key => {
      this.recentRequests.delete(key);
    });
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      pendingRequests: this.pendingRequests.size,
      activeBatches: Array.from(this.activeBatches.values()).reduce((a, b) => a + b, 0),
      recentRequestsCache: this.recentRequests.size,
      readReduction: this.metrics.totalRequests > 0 ? 
        Math.round((this.metrics.readsEliminated / this.metrics.totalRequests) * 100) : 0
    };
  }

  /**
   * Clear all pending requests and reset metrics
   */
  reset() {
    this.pendingRequests.clear();
    this.batchTimers.forEach(timer => clearTimeout(timer));
    this.batchTimers.clear();
    this.requestQueue.clear();
    this.recentRequests.clear();
    this.activeBatches.clear();
    
    this.metrics = {
      totalRequests: 0,
      batchedRequests: 0,
      cacheHits: 0,
      duplicatesEliminated: 0,
      readsEliminated: 0
    };

    console.log('🧹 UltraBatchService reset');
  }
}

// Export singleton instance
export default new UltraBatchService(); 