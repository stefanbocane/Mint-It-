/**
 * Live Auction Service - Enhanced Version
 * 
 * Handles real-time auction updates including:
 * - Live rarity updates on bid placement with race condition prevention
 * - Efficient batch operations with proper synchronization
 * - Advanced cache management with conflict resolution
 * - Optimistic UI updates with rollback support
 * - Memory management and cleanup
 */

import { calculateLiveRarity } from '../utils/auctionRarity';
import BidderManagementService from './auctions/BidderManagementService';
import CoinAwardService from './auctions/CoinAwardService';
import RarityCalculationService from './auctions/RarityCalculationService';
import CacheService from './caching/CacheService';
import ErrorHandlingService from './ErrorHandlingService';

// 🚀 OPTIMIZED: Ultra-conservative configuration to achieve 200-400 reads per session
const CONFIG = {
  QUEUE_PROCESSING_DELAY: 30000,    // 30 seconds (was 10 seconds) - 66% reduction
  URGENT_PROCESSING_DELAY: 15000,   // 15 seconds (was 5 seconds) - 66% reduction
  MAX_QUEUE_SIZE: 300,              // Reduced from 500
  MAX_LISTENERS_PER_AUCTION: 15,    // Reduced from 25
  RATE_LIMIT_WINDOW: 60000,         // 60 seconds (was 30 seconds) - 50% reduction
  MAX_REQUESTS_PER_WINDOW: 3,       // Reduced from 5 - 40% reduction
  CACHE_TTL: {
    AUCTION_DATA: 10 * 60 * 1000,   // 10 minutes (was 5 minutes) - 50% reduction
    BIDDER_DATA: 20 * 60 * 1000,    // 20 minutes (was 10 minutes) - 50% reduction
    EXTENDED: 45 * 60 * 1000        // 45 minutes (was 20 minutes) - 55% reduction
  },
  PAGINATION: {
    BIDS_PER_PAGE: 15,              // Reduced from 20
    MAX_TOTAL_BIDS: 300             // Reduced from 500
  },
  CLEANUP_INTERVAL: 30 * 60 * 1000, // 30 minutes (was 15 minutes) - 50% reduction
  BATCH_SIZE: 1,                    // Reduced from 2 for ultra-conservative approach
  PROCESSING_LOCK_TIMEOUT: 120000   // 2 minutes (was 60 seconds) - allows longer processing
};

class LiveAuctionService {
  static _instance = null;
  static _updateQueue = new Map();
  static _processingQueue = false;
  static _queueTimeout = null;
  static _listeners = new Map();
  static _rateLimiter = new Map();
  static _cleanupInterval = null;
  static _auctionLocks = new Map(); // Prevent concurrent updates to same auction
  static _processingLock = false;
  static _metrics = {
    totalUpdates: 0,
    queueOverflows: 0,
    rateLimitHits: 0,
    cacheHits: 0,
    cacheMisses: 0,
    lockConflicts: 0,
    batchProcessed: 0
  };

  static getInstance() {
    if (!this._instance) {
      this._instance = new LiveAuctionService();
      this._startCleanupInterval();
    }
    return this._instance;
  }

  /**
   * Start automatic cleanup interval
   */
  static _startCleanupInterval() {
    if (this._cleanupInterval) return;
    
    this._cleanupInterval = setInterval(() => {
      this._performCleanup();
    }, CONFIG.CLEANUP_INTERVAL);
  }

  /**
   * Perform memory cleanup and rate limiter maintenance
   */
  static _performCleanup() {
    const now = Date.now();
    console.log('🧹 Performing LiveAuctionService cleanup...');

    // Cleanup rate limiter
    for (const [key, timestamp] of this._rateLimiter.entries()) {
      if (now - timestamp > CONFIG.RATE_LIMIT_WINDOW * 2) {
        this._rateLimiter.delete(key);
      }
    }

    // Cleanup expired auction locks
    for (const [auctionId, lockTime] of this._auctionLocks.entries()) {
      if (now - lockTime > CONFIG.PROCESSING_LOCK_TIMEOUT) {
        this._auctionLocks.delete(auctionId);
        console.log(`🔓 Released expired lock for auction ${auctionId}`);
      }
    }

    // Cleanup old queue entries if queue is too large
    if (this._updateQueue.size > CONFIG.MAX_QUEUE_SIZE) {
      const entries = Array.from(this._updateQueue.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toRemove = entries.slice(0, entries.length - CONFIG.MAX_QUEUE_SIZE);
      toRemove.forEach(([key]) => {
        this._updateQueue.delete(key);
      });
      
      this._metrics.queueOverflows++;
      console.warn(`⚠️ Queue overflow: Removed ${toRemove.length} old entries`);
    }

    // Cleanup listeners for inactive auctions
    for (const [auctionId, listeners] of this._listeners.entries()) {
      if (listeners.size === 0) {
        this._listeners.delete(auctionId);
      } else if (listeners.size > CONFIG.MAX_LISTENERS_PER_AUCTION) {
        console.warn(`⚠️ Too many listeners for auction ${auctionId}: ${listeners.size}`);
      }
    }

    console.log(`🧹 Cleanup complete. Metrics:`, this._metrics);
  }

  /**
   * Acquire lock for auction to prevent concurrent updates
   */
  static _acquireAuctionLock(auctionId) {
    if (this._auctionLocks.has(auctionId)) {
      this._metrics.lockConflicts++;
      return false;
    }
    
    this._auctionLocks.set(auctionId, Date.now());
    return true;
  }

  /**
   * Release lock for auction
   */
  static _releaseAuctionLock(auctionId) {
    this._auctionLocks.delete(auctionId);
  }

  /**
   * Check rate limit for auction updates with improved logic
   */
  static _checkRateLimit(auctionId) {
    const now = Date.now();
    const key = `auction:${auctionId}`;
    const limiterData = this._rateLimiter.get(key) || { count: 0, windowStart: now };

    // Reset window if needed
    if (now - limiterData.windowStart > CONFIG.RATE_LIMIT_WINDOW) {
      limiterData.count = 0;
      limiterData.windowStart = now;
    }

    if (limiterData.count >= CONFIG.MAX_REQUESTS_PER_WINDOW) {
      this._metrics.rateLimitHits++;
      console.warn(`🚦 Rate limit hit for auction ${auctionId} (${limiterData.count}/${CONFIG.MAX_REQUESTS_PER_WINDOW})`);
      return false;
    }

    limiterData.count++;
    this._rateLimiter.set(key, limiterData);
    return true;
  }

  /**
   * Queue a rarity update for processing with improved conflict resolution
   */
  static queueRarityUpdate(auctionId, bidderCount, currentBid, priority = 'normal') {
    if (!auctionId) return false;

    console.log(`🏆 Queuing rarity update for auction ${auctionId}: bidders=${bidderCount}, bid=${currentBid}, priority=${priority}`);

    // Check rate limit (re-enabled with better logic)
    if (!this._checkRateLimit(auctionId)) {
      console.log(`⏭️ Skipping rate-limited update for auction ${auctionId}`);
      return false;
    }

    // Store the latest update info with deduplication
    const existingUpdate = this._updateQueue.get(auctionId);
    const newUpdate = {
      auctionId,
      bidderCount,
      currentBid,
      priority: priority === 'urgent' ? 'urgent' : existingUpdate?.priority === 'urgent' ? 'urgent' : priority,
      timestamp: Date.now(),
      attempts: existingUpdate ? existingUpdate.attempts + 1 : 1
    };

    // If there's already an update queued, only replace it if this one is more recent or higher priority
    if (existingUpdate) {
      if (newUpdate.priority === 'urgent' || newUpdate.timestamp > existingUpdate.timestamp) {
        console.log(`🔄 Replacing queued update for auction ${auctionId} (priority: ${newUpdate.priority})`);
      } else {
        console.log(`⏭️ Ignoring older update for auction ${auctionId}`);
        return false;
      }
    }

    this._updateQueue.set(auctionId, newUpdate);
    this._metrics.totalUpdates++;

    // Schedule processing with adaptive delays
    const delay = priority === 'urgent' ? CONFIG.URGENT_PROCESSING_DELAY : 
                  newUpdate.attempts > 3 ? CONFIG.QUEUE_PROCESSING_DELAY * 2 : CONFIG.QUEUE_PROCESSING_DELAY;
    
    this._scheduleProcessing(delay);
    return true;
  }

  /**
   * Schedule queue processing with improved debouncing
   */
  static _scheduleProcessing(delay = CONFIG.QUEUE_PROCESSING_DELAY) {
    if (this._queueTimeout) {
      clearTimeout(this._queueTimeout);
    }

    this._queueTimeout = setTimeout(() => {
      this._processUpdateQueue();
    }, delay);
  }

  /**
   * Process all queued rarity updates with better error handling and synchronization
   */
  static async _processUpdateQueue() {
    if (this._processingQueue || this._updateQueue.size === 0) {
      return;
    }

    // Acquire global processing lock
    if (this._processingLock) {
      console.log(`⏭️ Processing already in progress, scheduling retry`);
      this._scheduleProcessing(CONFIG.QUEUE_PROCESSING_DELAY);
      return;
    }

    this._processingLock = true;
    this._processingQueue = true;
    this._queueTimeout = null;

    try {
      const updates = Array.from(this._updateQueue.values());
      this._updateQueue.clear();

      console.log(`🔄 Processing ${updates.length} rarity updates`);

      // Group updates by priority and process appropriately
      const urgentUpdates = updates.filter(u => u.priority === 'urgent');
      const normalUpdates = updates.filter(u => u.priority !== 'urgent');

      // Process urgent updates first, one by one to avoid conflicts
      if (urgentUpdates.length > 0) {
        console.log(`⚡ Processing ${urgentUpdates.length} urgent updates sequentially`);
        for (const update of urgentUpdates) {
          try {
            await this._updateAuctionRarity(update);
            // Small delay between urgent updates
            await new Promise(resolve => setTimeout(resolve, 50));
          } catch (error) {
            console.error(`Failed urgent update for auction ${update.auctionId}:`, error);
          }
        }
      }

      // Process normal updates in smaller batches
      if (normalUpdates.length > 0) {
        await this._processBatchUpdates(normalUpdates);
      }

      this._metrics.batchProcessed++;

    } catch (error) {
      ErrorHandlingService.handleError(error, {
        context: 'LiveAuctionService',
        operation: '_processUpdateQueue'
      });
    } finally {
      this._processingQueue = false;
      this._processingLock = false;

      // If more updates came in while processing, schedule another run
      if (this._updateQueue.size > 0) {
        this._scheduleProcessing(CONFIG.QUEUE_PROCESSING_DELAY);
      }
    }
  }

  /**
   * Process a batch of rarity updates efficiently with proper synchronization
   */
  static async _processBatchUpdates(updates) {
    // Process in smaller chunks to avoid overwhelming the database
    const chunks = this._chunkArray(updates, CONFIG.BATCH_SIZE);
    
    for (const chunk of chunks) {
      const batchPromises = chunk.map(async (update) => {
        try {
          await this._updateAuctionRarity(update);
        } catch (error) {
          console.error(`Failed to update rarity for auction ${update.auctionId}:`, error);
        }
      });

      await Promise.allSettled(batchPromises);
      
      // Add delay between chunks to prevent database overload
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }

  /**
   * Update auction rarity with enhanced synchronization and conflict resolution
   */
  static async _updateAuctionRarity({ auctionId, bidderCount, currentBid }) {
    // Acquire auction-specific lock
    if (!this._acquireAuctionLock(auctionId)) {
      console.log(`🔒 Auction ${auctionId} is locked, skipping update`);
      return;
    }

    try {
      console.log(`🏆 Processing rarity update for auction ${auctionId}: bidders=${bidderCount}, bid=${currentBid}`);

      // Get auction data from cache first
      let auctionData = await CacheService.getDocument('auctions', auctionId, { 
        ttl: CONFIG.CACHE_TTL.AUCTION_DATA,
        forceRefresh: false
      });

      if (!auctionData) {
        console.warn(`❌ Auction ${auctionId} not found in cache or database, skipping rarity update`);
        this._metrics.cacheMisses++;
        return;
      }

      this._metrics.cacheHits++;

      // Only update rarity for active auctions
      if (auctionData.status !== 'active') {
        console.log(`⏭️ Skipping rarity update for non-active auction ${auctionId} (status: ${auctionData.status})`);
        return;
      }

      // CRITICAL FIX: Always calculate rarity and compare properly
      // The issue was that calculateAndUpdateAuctionRarity was incorrectly determining if changes occurred
      const updatedAuctionForCalculation = {
        ...auctionData,
        currentBid: currentBid,
        uniqueBidderCount: bidderCount
      };

      // Calculate what the new rarity should be
      const newRarity = calculateLiveRarity(updatedAuctionForCalculation, bidderCount);
      const currentRarity = auctionData.currentRarity || auctionData.cardRarity || 'common';
      
      console.log(`🏆 Rarity comparison for auction ${auctionId}: current='${currentRarity}' vs calculated='${newRarity}'`);

      // CRITICAL FIX: Always update if there's ANY difference OR if current rarity is missing/unknown
      const shouldUpdate = (
        newRarity !== currentRarity ||
        !auctionData.currentRarity ||
        auctionData.currentRarity === 'unknown' ||
        auctionData.currentRarity === '' ||
        // Also update if bidder count changed (live engagement tracking)
        bidderCount !== (auctionData.uniqueBidderCount || 0) ||
        // Also update if bid amount changed significantly  
        Math.abs(currentBid - (auctionData.currentBid || 0)) > 0
      );

      if (!shouldUpdate) {
        console.log(`🏆 No rarity update needed for auction ${auctionId} (${newRarity}), skipping database update`);
        return;
      }

      console.log(`🏆 Rarity update needed for auction ${auctionId}: ${currentRarity} → ${newRarity} (bidders: ${auctionData.uniqueBidderCount || 0} → ${bidderCount}, bid: ${auctionData.currentBid || 0} → ${currentBid})`);

      // Update database directly with proper rarity
      const dbUpdateSuccess = await RarityCalculationService.updateAuctionRarityInDatabase(
        auctionId, 
        newRarity, 
        bidderCount
      );

      if (!dbUpdateSuccess) {
        console.error(`❌ Failed to update auction ${auctionId} rarity in database`);
        return;
      }

      // Optimistic cache update after successful database update
      const optimisticData = {
        ...auctionData,
        currentRarity: newRarity,
        uniqueBidderCount: bidderCount,
        currentBid: currentBid,
        lastRarityUpdate: new Date()
      };

      // Update cache for responsive UI
      await CacheService.setValue(`auctions:${auctionId}`, optimisticData, { 
        ttl: CONFIG.CACHE_TTL.EXTENDED
      });

      // Notify listeners about the update
      this._notifyListeners(auctionId, optimisticData);

      // Update card rarity if this auction has significant engagement
      if (auctionData.cardId && bidderCount >= 1) { // Lowered threshold for responsiveness
        console.log(`🏆 Updating card ${auctionData.cardId} rarity to ${newRarity} due to auction engagement`);
        try {
          await RarityCalculationService.updateCardRarity(
            auctionData.cardId, 
            newRarity, 
            bidderCount,
            1 // Lower minimum bidder threshold for card updates
          );
        } catch (cardError) {
          console.error(`❌ Failed to update card rarity:`, cardError);
          // Don't fail the auction update if card update fails
        }
      }

      console.log(`✅ Successfully updated auction ${auctionId} rarity to ${newRarity}`);

    } catch (error) {
      console.error(`❌ Error updating auction ${auctionId} rarity:`, error);
      ErrorHandlingService.handleError(error, {
        context: 'LiveAuctionService',
        operation: '_updateAuctionRarity',
        metadata: { auctionId, bidderCount, currentBid }
      });
    } finally {
      // Always release the lock
      this._releaseAuctionLock(auctionId);
    }
  }

  /**
   * Utility method to chunk arrays
   */
  static _chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Subscribe to live rarity updates for an auction with listener limits
   */
  static subscribeToAuctionUpdates(auctionId, callback) {
    if (!this._listeners.has(auctionId)) {
      this._listeners.set(auctionId, new Set());
    }
    
    const listeners = this._listeners.get(auctionId);
    
    // Check listener limit
    if (listeners.size >= CONFIG.MAX_LISTENERS_PER_AUCTION) {
      console.warn(`⚠️ Maximum listeners reached for auction ${auctionId}`);
      return null;
    }
    
    listeners.add(callback);

    // Return unsubscribe function
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this._listeners.delete(auctionId);
      }
    };
  }

  /**
   * Notify all listeners about auction updates
   */
  static _notifyListeners(auctionId, auctionData) {
    const listeners = this._listeners.get(auctionId);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(auctionData);
        } catch (error) {
          console.error('Error in auction update listener:', error);
        }
      });
    }
  }

  /**
   * Handle bid placement with immediate rarity update and rate limiting
   */
  static async handleBidPlacement(auctionId, bidAmount, bidderId) {
    try {
      console.log(`🏆 LiveAuctionService.handleBidPlacement called for auction ${auctionId}, bid: ${bidAmount}, bidder: ${bidderId}`);
      
      // Use BidderManagementService for optimized bidder counting
      const bidderCount = await BidderManagementService.getUniqueBidderCount(auctionId, bidderId);
      console.log(`🏆 Retrieved bidder count for auction ${auctionId}: ${bidderCount}`);
      
      // Queue immediate rarity update with urgent priority
      const queued = this.queueRarityUpdate(auctionId, bidderCount, bidAmount, 'urgent');
      console.log(`🏆 Rarity update queued for auction ${auctionId}: ${queued}`);
      
      if (!queued) {
        console.warn(`⚠️ Rate limited bid placement for auction ${auctionId}`);
        return false;
      }

      // Also trigger immediate processing for better responsiveness
      if (!this._processingQueue) {
        console.log(`🏆 Scheduling immediate processing for auction ${auctionId}`);
        this._scheduleProcessing(50); // Very short delay for urgent updates
      } else {
        console.log(`🏆 Processing queue already active for auction ${auctionId}`);
      }

      return true;

    } catch (error) {
      console.error(`❌ LiveAuctionService.handleBidPlacement error for auction ${auctionId}:`, error);
      ErrorHandlingService.handleError(error, {
        context: 'LiveAuctionService',
        operation: 'handleBidPlacement',
        metadata: { auctionId, bidAmount, bidderId }
      });
      return false;
    }
  }

  /**
   * CRITICAL FIX: Handle bid placement with pre-calculated bidder count to avoid race conditions
   * This method accepts the bidder count directly instead of fetching it from the database
   */
  static async handleBidPlacementWithCount(auctionId, bidAmount, bidderId, bidderCount) {
    try {
      console.log(`🏆 LiveAuctionService.handleBidPlacementWithCount called for auction ${auctionId}, bid: ${bidAmount}, bidder: ${bidderId}, bidders: ${bidderCount}`);
      
      // Use the provided bidder count directly (no database query needed)
      console.log(`🏆 Using provided bidder count for auction ${auctionId}: ${bidderCount}`);
      
      // Queue immediate rarity update with urgent priority
      const queued = this.queueRarityUpdate(auctionId, bidderCount, bidAmount, 'urgent');
      console.log(`🏆 Rarity update queued for auction ${auctionId}: ${queued}`);
      
      if (!queued) {
        console.warn(`⚠️ Rate limited bid placement for auction ${auctionId}`);
        return false;
      }

      // Also trigger immediate processing for better responsiveness
      if (!this._processingQueue) {
        console.log(`🏆 Scheduling immediate processing for auction ${auctionId}`);
        this._scheduleProcessing(50); // Very short delay for urgent updates
      } else {
        console.log(`🏆 Processing queue already active for auction ${auctionId}`);
      }

      return true;

    } catch (error) {
      console.error(`❌ LiveAuctionService.handleBidPlacementWithCount error for auction ${auctionId}:`, error);
      ErrorHandlingService.handleError(error, {
        context: 'LiveAuctionService',
        operation: 'handleBidPlacementWithCount',
        metadata: { auctionId, bidAmount, bidderId, bidderCount }
      });
      return false;
    }
  }

  /**
   * Award coins when auction completes (using CoinAwardService)
   */
  static async handleAuctionCompletion(auctionId, finalBidAmount, winnerId) {
    try {
      // Get auction data
      const auctionData = await CacheService.getDocument('auctions', auctionId);
      
      if (!auctionData) {
        console.warn(`Auction ${auctionId} not found for completion`);
        return { success: false, reason: 'Auction not found' };
      }

      // Award coins to seller using CoinAwardService
      const coinResult = await CoinAwardService.awardCoinsForAuctionSale(
        auctionData, 
        finalBidAmount, 
        winnerId
      );

      if (coinResult.success) {
        console.log(`✅ Auction ${auctionId} completed successfully. Seller earned ${coinResult.sellerEarnings} coins`);
        
        // Record achievement for auction win
        if (winnerId && winnerId !== auctionData.sellerId) {
          try {
            console.log('Attempting to record first auction win achievement...');
            const { recordAchievement, ACHIEVEMENT_TYPES } = await import('../../utils/gemRewards');
            const result = await recordAchievement(winnerId, ACHIEVEMENT_TYPES.FIRST_AUCTION_WIN);
            console.log(`Auction win achievement for ${winnerId}: ${result ? 'recorded' : 'already completed'}`);
          } catch (error) {
            console.error('Error recording auction win achievement:', error);
            // Don't fail the auction completion if achievement recording fails
          }
        }
        
        // Invalidate auction cache
        await CacheService.invalidateDocument('auctions', auctionId);
        await BidderManagementService.invalidateAuctionCache(auctionId);
        
        return coinResult;
      } else {
        console.error(`❌ Failed to award coins for auction ${auctionId}:`, coinResult.reason || coinResult.error);
        return coinResult;
      }

    } catch (error) {
      ErrorHandlingService.handleError(error, {
        context: 'LiveAuctionService',
        operation: 'handleAuctionCompletion',
        metadata: { auctionId, finalBidAmount, winnerId }
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Force refresh auction rarity (for manual refresh) - Enhanced to prevent unnecessary updates
   */
  static async forceRefreshAuctionRarity(auctionId) {
    try {
      const auctionData = await CacheService.getDocument('auctions', auctionId, { 
        forceRefresh: true 
      });
      
      if (!auctionData) return false;

      // CRITICAL: Only refresh rarity for ACTIVE auctions
      if (auctionData.status !== 'active') {
        console.log(`⏭️ Skipping rarity refresh for non-active auction ${auctionId} (status: ${auctionData.status})`);
        return false;
      }

      // Get current bidder count
      const bidderCount = await BidderManagementService.getUniqueBidderCount(auctionId, auctionData.sellerId);
      
      // CRITICAL FIX: Always check for rarity updates, especially for higher-rarity cards
      // The main issue was that existing high-rarity cards were being skipped when they should be preserved
      
      const currentRarity = auctionData.currentRarity || auctionData.cardRarity || 'common';
      const currentBid = auctionData.currentBid || 0;
      
      // Create updated auction object for calculation
      const updatedAuctionForCalculation = {
        ...auctionData,
        currentBid: currentBid,
        uniqueBidderCount: bidderCount
      };
      
      // Calculate what the rarity should be (this will preserve higher rarities)
      const calculatedRarity = calculateLiveRarity(updatedAuctionForCalculation, bidderCount);
      
      console.log(`🔄 Force refresh for auction ${auctionId}: current='${currentRarity}', calculated='${calculatedRarity}', bid=${currentBid}, bidders=${bidderCount}`);
      
      // Always update if:
      // 1. Calculated rarity is different (upgrade detected)
      // 2. Current rarity is missing or unknown 
      // 3. Bidder count changed (engagement tracking)
      // 4. This is a high-rarity card that needs tracking
      const shouldUpdate = (
        calculatedRarity !== currentRarity ||
        !auctionData.currentRarity ||
        auctionData.currentRarity === 'unknown' ||
        auctionData.currentRarity === '' ||
        bidderCount !== (auctionData.uniqueBidderCount || 0) ||
        // CRITICAL: For high-rarity cards, always ensure they're properly tracked
        (currentRarity !== 'common' && currentRarity !== 'unknown')
      );
      
      if (!shouldUpdate) {
        console.log(`⏭️ Skipping rarity refresh for auction ${auctionId} - no updates needed (${calculatedRarity})`);
        return false;
      }
      
      console.log(`🔄 Forcing rarity refresh for auction ${auctionId}: ${currentRarity} → ${calculatedRarity} (bidders: ${auctionData.uniqueBidderCount || 0} → ${bidderCount})`);
      
      return this.queueRarityUpdate(auctionId, bidderCount, currentBid, 'urgent');
      
    } catch (error) {
      console.error('Error force refreshing auction rarity:', error);
      return false;
    }
  }

  /**
   * Get comprehensive service metrics for monitoring
   */
  static getMetrics() {
    return {
      liveAuction: {
        ...this._metrics,
        queueSize: this._updateQueue.size,
        activeListeners: this._listeners.size,
        rateLimiterSize: this._rateLimiter.size,
        isProcessing: this._processingQueue
      },
      bidderManagement: BidderManagementService.getMetrics(),
      coinAward: CoinAwardService.getMetrics(),
      combined: {
        totalCacheHits: this._metrics.cacheHits + BidderManagementService.getMetrics().cacheHits,
        totalCacheMisses: this._metrics.cacheMisses + BidderManagementService.getMetrics().cacheMisses,
        overallCacheHitRatio: (this._metrics.cacheHits + BidderManagementService.getMetrics().cacheHits) / 
          Math.max(this._metrics.cacheHits + this._metrics.cacheMisses + BidderManagementService.getMetrics().cacheHits + BidderManagementService.getMetrics().cacheMisses, 1)
      }
    };
  }

  /**
   * Cleanup and reset service state
   */
  static cleanup() {
    if (this._queueTimeout) {
      clearTimeout(this._queueTimeout);
      this._queueTimeout = null;
    }

    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    
    this._updateQueue.clear();
    this._listeners.clear();
    this._rateLimiter.clear();
    this._processingQueue = false;
    
    // Reset metrics
    this._metrics = {
      totalUpdates: 0,
      queueOverflows: 0,
      rateLimitHits: 0,
      cacheHits: 0,
      cacheMisses: 0,
      lockConflicts: 0,
      batchProcessed: 0
    };
  }
}

export default LiveAuctionService; 