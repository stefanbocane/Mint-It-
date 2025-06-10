/**
 * Optimized Status Verification Service
 * 
 * Consolidates all card/auction/trade status verification operations
 * with intelligent caching and batch processing to eliminate redundant checks.
 * 
 * Target: 85-95% reduction in status verification reads
 */

import UltraBatchService from './UltraBatchService';

class OptimizedStatusVerificationService {
  constructor() {
    this.verificationCache = new Map(); // In-memory cache for recent verifications
    this.pendingVerifications = new Map(); // Track pending verification requests
    this.metrics = {
      totalVerifications: 0,
      cacheHits: 0,
      batchVerifications: 0,
      redundantChecksEliminated: 0
    };

    // Configuration
    this.config = {
      cacheExpiryMs: 2 * 60 * 1000, // 2 minutes for status verification cache
      batchDelayMs: 100, // 100ms delay for batching verifications
      maxBatchSize: 25, // Maximum items per batch
      recentCheckTTL: 30 * 1000, // 30 seconds for recent check deduplication
    };

    // Cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredCache();
    }, 60 * 1000); // Cleanup every minute
  }

  /**
   * Verify card statuses in batch with intelligent caching
   */
  async verifyCardStatuses(cards, options = {}) {
    if (!cards || cards.length === 0) {
      return new Map();
    }

    this.metrics.totalVerifications++;

    // Filter cards that need verification
    const cardsToVerify = [];
    const cachedResults = new Map();

    for (const card of cards) {
      if (!card || !card.id) continue;

      // Check in-memory cache first
      const cacheKey = this.createCacheKey('card_status', card.id);
      const cached = this.verificationCache.get(cacheKey);

      if (cached && this.isCacheValid(cached)) {
        cachedResults.set(card.id, cached.result);
        this.metrics.cacheHits++;
      } else {
        cardsToVerify.push(card);
      }
    }

    // If all results are cached, return immediately
    if (cardsToVerify.length === 0) {
      console.log(`🚀 StatusVerification: 100% cache hit for ${cards.length} cards`);
      return cachedResults;
    }

    // Batch verify remaining cards
    const batchResults = await this.batchVerifyCards(cardsToVerify, options);

    // Merge cached and batch results
    const finalResults = new Map([...cachedResults, ...batchResults]);

    console.log(`✅ StatusVerification: ${cachedResults.size} cached, ${batchResults.size} verified`);
    
    return finalResults;
  }

  /**
   * Batch verify cards with auction and trade status checks
   */
  async batchVerifyCards(cards, options = {}) {
    const results = new Map();

    try {
      // Extract cards that might be in auctions or trades
      const auctionCards = cards.filter(card => card.inAuction && card.auctionId);
      const tradeCards = cards.filter(card => card.inTrade && card.tradeId);

      // Batch verify auction statuses
      let auctionVerifications = new Map();
      if (auctionCards.length > 0) {
        auctionVerifications = await this.batchVerifyAuctionStatuses(auctionCards);
      }

      // Batch verify trade statuses
      let tradeVerifications = new Map();
      if (tradeCards.length > 0) {
        tradeVerifications = await this.batchVerifyTradeStatuses(tradeCards);
      }

      // Process verification results for each card
      for (const card of cards) {
        const cardResult = {
          cardId: card.id,
          needsUpdate: false,
          updates: {},
          issues: []
        };

        // Check auction status
        if (card.inAuction && card.auctionId) {
          const auctionVerification = auctionVerifications.get(card.auctionId);
          if (auctionVerification) {
            if (!auctionVerification.active) {
              cardResult.needsUpdate = true;
              cardResult.updates.inAuction = false;
              cardResult.updates.auctionId = null;
              cardResult.updates.status = 'available';
              cardResult.issues.push('Auction no longer active');
            }
          }
        }

        // Check trade status
        if (card.inTrade && card.tradeId) {
          const tradeVerification = tradeVerifications.get(card.tradeId);
          if (tradeVerification) {
            if (!tradeVerification.active) {
              cardResult.needsUpdate = true;
              cardResult.updates.inTrade = false;
              cardResult.updates.tradeId = null;
              cardResult.issues.push('Trade no longer active');
            }
          }
        }

        // Cache the result
        const cacheKey = this.createCacheKey('card_status', card.id);
        this.verificationCache.set(cacheKey, {
          result: cardResult,
          timestamp: Date.now()
        });

        results.set(card.id, cardResult);
      }

      this.metrics.batchVerifications++;

    } catch (error) {
      console.error('Batch card verification failed:', error);
      
      // Return empty results for failed cards
      cards.forEach(card => {
        results.set(card.id, {
          cardId: card.id,
          needsUpdate: false,
          updates: {},
          issues: ['Verification failed'],
          error: error.message
        });
      });
    }

    return results;
  }

  /**
   * Batch verify auction statuses
   */
  async batchVerifyAuctionStatuses(cards) {
    const auctionIds = [...new Set(cards.map(card => card.auctionId).filter(id => id))];
    
    if (auctionIds.length === 0) {
      return new Map();
    }

    console.log(`🔍 StatusVerification: Batch verifying ${auctionIds.length} auction statuses`);

    // Use UltraBatchService to get auction data
    const auctionData = await UltraBatchService.batchVerifyStatuses(
      auctionIds.map(id => ({ id })),
      {
        collectionName: 'auctions',
        statusField: 'status',
        activeStatuses: ['active'],
        idField: 'id'
      }
    );

    return auctionData;
  }

  /**
   * Batch verify trade statuses
   */
  async batchVerifyTradeStatuses(cards) {
    const tradeIds = [...new Set(cards.map(card => card.tradeId).filter(id => id))];
    
    if (tradeIds.length === 0) {
      return new Map();
    }

    console.log(`🔍 StatusVerification: Batch verifying ${tradeIds.length} trade statuses`);

    // Use UltraBatchService to get trade data
    const tradeData = await UltraBatchService.batchVerifyStatuses(
      tradeIds.map(id => ({ id })),
      {
        collectionName: 'trades',
        statusField: 'status',
        activeStatuses: ['pending', 'offered', 'active'],
        idField: 'id'
      }
    );

    return tradeData;
  }

  /**
   * Verify auction completion status for recently transferred cards
   */
  async verifyRecentAuctionCompletions(cards, options = {}) {
    const recentCards = cards.filter(card => {
      if (!card.lastTransferTime) return false;
      
      const transferTime = card.lastTransferTime?.toDate?.() || new Date(card.lastTransferTime);
      const timeSinceTransfer = Date.now() - transferTime.getTime();
      
      // Only check cards transferred in the last 5 minutes
      return timeSinceTransfer < 5 * 60 * 1000;
    });

    if (recentCards.length === 0) {
      return new Map();
    }

    console.log(`🔍 StatusVerification: Checking ${recentCards.length} recent transfers for auction completion`);

    // Check for completed auctions that might have transferred these cards
    const cardIds = recentCards.map(card => card.id);
    const completedAuctions = await UltraBatchService.batchVerifyStatuses(
      cardIds.map(id => ({ cardId: id })),
      {
        collectionName: 'auctions',
        statusField: 'status',
        activeStatuses: ['completed'],
        idField: 'cardId'
      }
    );

    const results = new Map();
    
    recentCards.forEach(card => {
      const auctionCompletion = completedAuctions.get(card.id);
      results.set(card.id, {
        cardId: card.id,
        recentlyCompleted: auctionCompletion?.active || false,
        completionData: auctionCompletion?.data || null
      });
    });

    return results;
  }

  /**
   * Smart status verification that adapts based on user activity
   */
  async smartVerifyStatuses(cards, userActivity = 'medium') {
    // Adjust verification strategy based on user activity
    const strategies = {
      low: {
        maxCardsToVerify: 10,
        cacheExpiryMs: 5 * 60 * 1000, // 5 minutes
        skipRecentChecks: true
      },
      medium: {
        maxCardsToVerify: 25,
        cacheExpiryMs: 2 * 60 * 1000, // 2 minutes
        skipRecentChecks: false
      },
      high: {
        maxCardsToVerify: 50,
        cacheExpiryMs: 30 * 1000, // 30 seconds
        skipRecentChecks: false
      }
    };

    const strategy = strategies[userActivity] || strategies.medium;

    // Limit cards to verify based on activity level
    const cardsToVerify = cards.slice(0, strategy.maxCardsToVerify);
    
    if (cardsToVerify.length < cards.length) {
      console.log(`🎯 StatusVerification: Limited verification to ${cardsToVerify.length}/${cards.length} cards for ${userActivity} activity`);
    }

    // Temporarily adjust cache expiry
    const originalExpiry = this.config.cacheExpiryMs;
    this.config.cacheExpiryMs = strategy.cacheExpiryMs;

    try {
      const results = await this.verifyCardStatuses(cardsToVerify);
      
      // Add empty results for skipped cards
      const allResults = new Map(results);
      cards.slice(strategy.maxCardsToVerify).forEach(card => {
        allResults.set(card.id, {
          cardId: card.id,
          needsUpdate: false,
          updates: {},
          issues: [],
          skipped: true
        });
      });

      return allResults;
    } finally {
      // Restore original cache expiry
      this.config.cacheExpiryMs = originalExpiry;
    }
  }

  /**
   * Create cache key for verification results
   */
  createCacheKey(type, id, suffix = '') {
    return `${type}_${id}${suffix ? '_' + suffix : ''}`;
  }

  /**
   * Check if cached verification result is still valid
   */
  isCacheValid(cached) {
    if (!cached || !cached.timestamp) {
      return false;
    }

    return Date.now() - cached.timestamp < this.config.cacheExpiryMs;
  }

  /**
   * Clean up expired cache entries
   */
  cleanupExpiredCache() {
    const now = Date.now();
    const expiredKeys = [];

    this.verificationCache.forEach((cached, key) => {
      if (!this.isCacheValid(cached)) {
        expiredKeys.push(key);
      }
    });

    expiredKeys.forEach(key => {
      this.verificationCache.delete(key);
    });

    if (expiredKeys.length > 0) {
      console.log(`🧹 StatusVerification: Cleaned up ${expiredKeys.length} expired cache entries`);
    }
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      cacheSize: this.verificationCache.size,
      cacheHitRate: this.metrics.totalVerifications > 0 ? 
        Math.round((this.metrics.cacheHits / this.metrics.totalVerifications) * 100) : 0,
      redundancyReduction: this.metrics.totalVerifications > 0 ?
        Math.round((this.metrics.redundantChecksEliminated / this.metrics.totalVerifications) * 100) : 0
    };
  }

  /**
   * Reset service state and metrics
   */
  reset() {
    this.verificationCache.clear();
    this.pendingVerifications.clear();
    
    this.metrics = {
      totalVerifications: 0,
      cacheHits: 0,
      batchVerifications: 0,
      redundantChecksEliminated: 0
    };

    console.log('🧹 OptimizedStatusVerificationService reset');
  }

  /**
   * Cleanup service resources
   */
  cleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.reset();
    console.log('🧹 OptimizedStatusVerificationService cleaned up');
  }
}

// Export singleton instance
export default new OptimizedStatusVerificationService(); 