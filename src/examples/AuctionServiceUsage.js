/**
 * Auction Service Usage Examples
 * 
 * Demonstrates how to use the optimized auction services together
 * for efficient auction management and coin awarding.
 */

import {
    AuctionServiceUtils,
    BidderManagementService,
    CoinAwardService,
    LiveAuctionService
} from '../services/auctions';

/**
 * Example: Complete auction flow with optimizations
 */
export class AuctionFlowExample {
  
  /**
   * Handle a new bid placement with all optimizations
   */
  static async handleNewBid(auctionId, bidAmount, bidderId) {
    try {
      console.log(`🎯 Processing new bid: ${bidAmount} from ${bidderId} on auction ${auctionId}`);

      // Step 1: Handle bid placement (includes rate limiting, caching, and rarity updates)
      const bidResult = await LiveAuctionService.handleBidPlacement(auctionId, bidAmount, bidderId);
      
      if (!bidResult) {
        console.warn('❌ Bid placement failed or was rate limited');
        return { success: false, reason: 'Rate limited or failed' };
      }

      // Step 2: Get updated bidder engagement stats
      const engagementStats = await BidderManagementService.getBidderEngagementStats(auctionId);
      console.log(`📊 Engagement stats:`, engagementStats);

      // Step 3: Subscribe to real-time updates for this auction
      const unsubscribe = LiveAuctionService.subscribeToAuctionUpdates(auctionId, (auctionData) => {
        console.log(`🔄 Real-time update for auction ${auctionId}:`, {
          currentRarity: auctionData.currentRarity,
          uniqueBidderCount: auctionData.uniqueBidderCount
        });
      });

      return {
        success: true,
        bidderCount: engagementStats.totalUniqueBidders,
        engagementRatio: engagementStats.engagementRatio,
        unsubscribe
      };

    } catch (error) {
      console.error('Error handling new bid:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Complete an auction and award coins
   */
  static async completeAuction(auctionId, finalBidAmount, winnerId) {
    try {
      console.log(`🏁 Completing auction ${auctionId} with final bid: ${finalBidAmount}`);

      // Step 1: Complete the auction and award coins
      const completionResult = await LiveAuctionService.handleAuctionCompletion(
        auctionId, 
        finalBidAmount, 
        winnerId
      );

      if (!completionResult.success) {
        console.error('❌ Auction completion failed:', completionResult.reason || completionResult.error);
        return completionResult;
      }

      // Step 2: Calculate platform earnings
      const platformFee = CoinAwardService.calculatePlatformFee(finalBidAmount);
      const sellerEarnings = CoinAwardService.calculateSellerEarnings(finalBidAmount);

      console.log(`💰 Auction completed successfully:`);
      console.log(`   - Final bid: ${finalBidAmount}`);
      console.log(`   - Seller earnings: ${sellerEarnings}`);
      console.log(`   - Platform fee: ${platformFee}`);

      // Step 3: Get updated user balance
      const auctionData = await import('../services/caching/CacheService').then(cs => 
        cs.default.getDocument('auctions', auctionId)
      );
      
      if (auctionData?.sellerId) {
        const newBalance = await CoinAwardService.getUserBalance(auctionData.sellerId);
        console.log(`💳 Seller's new balance: ${newBalance} coins`);
      }

      return {
        success: true,
        sellerEarnings,
        platformFee,
        transactionId: completionResult.transactionId
      };

    } catch (error) {
      console.error('Error completing auction:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Monitor auction performance with metrics
   */
  static async monitorAuctionPerformance() {
    try {
      console.log('📈 Getting auction performance metrics...');

      // Get comprehensive metrics from all services
      const metrics = await AuctionServiceUtils.getAggregatedMetrics();
      
      console.log('🔍 Service Metrics:');
      console.log('📦 Live Auction Service:', {
        totalUpdates: metrics.liveAuction.totalUpdates,
        queueSize: metrics.liveAuction.queueSize,
        rateLimitHits: metrics.liveAuction.rateLimitHits,
        activeListeners: metrics.liveAuction.activeListeners
      });

      console.log('👥 Bidder Management:', {
        cacheHitRatio: metrics.bidderManagement.cacheHitRatio,
        dbReads: metrics.bidderManagement.dbReads,
        paginatedQueries: metrics.bidderManagement.paginatedQueries
      });

      console.log('💰 Coin Award Service:', {
        totalCoinsAwarded: metrics.coinAward.totalCoinsAwarded,
        totalTransactions: metrics.coinAward.totalTransactions,
        successRate: metrics.coinAward.successRate,
        platformFees: metrics.coinAward.totalPlatformFees
      });

      console.log('🔄 Combined Metrics:', {
        overallCacheHitRatio: metrics.combined.overallCacheHitRatio,
        totalCacheOperations: metrics.combined.totalCacheHits + metrics.combined.totalCacheMisses
      });

      return metrics;

    } catch (error) {
      console.error('Error getting performance metrics:', error);
      return null;
    }
  }

  /**
   * Optimize performance for high-activity periods
   */
  static async optimizeForHighActivity(activeAuctionIds) {
    try {
      console.log(`🚀 Optimizing for high activity with ${activeAuctionIds.length} active auctions`);

      // Step 1: Pre-warm caches
      await AuctionServiceUtils.preWarmCaches(activeAuctionIds);

      // Step 2: Get current performance baseline
      const beforeMetrics = await AuctionServiceUtils.getAggregatedMetrics();
      console.log('📊 Performance baseline established');

      // Step 3: Return optimization suggestions
      const suggestions = [];

      if (beforeMetrics.combined.overallCacheHitRatio < 0.8) {
        suggestions.push('Consider increasing cache TTL values');
      }

      if (beforeMetrics.liveAuction.rateLimitHits > 0) {
        suggestions.push('Consider adjusting rate limiting parameters');
      }

      if (beforeMetrics.liveAuction.queueSize > 100) {
        suggestions.push('Consider processing queue more frequently');
      }

      console.log('💡 Optimization suggestions:', suggestions);

      return {
        success: true,
        suggestions,
        baselineMetrics: beforeMetrics
      };

    } catch (error) {
      console.error('Error optimizing for high activity:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle auction cancellation with refunds
   */
  static async cancelAuction(auctionId, reason = 'cancelled_by_seller') {
    try {
      console.log(`❌ Cancelling auction ${auctionId}: ${reason}`);

      // Get auction data
      const CacheService = await import('../services/caching/CacheService').then(m => m.default);
      const auctionData = await CacheService.getDocument('auctions', auctionId);

      if (!auctionData) {
        return { success: false, reason: 'Auction not found' };
      }

      // Process refund if coins were already awarded
      const refundResult = await CoinAwardService.processAuctionRefund(auctionData, reason);

      if (refundResult.success) {
        console.log(`✅ Auction cancelled and refund processed: ${refundResult.refundAmount || 0} coins`);
        
        // Clean up caches
        await BidderManagementService.invalidateAuctionCache(auctionId);
        await CacheService.invalidateDocument('auctions', auctionId);
      }

      return refundResult;

    } catch (error) {
      console.error('Error cancelling auction:', error);
      return { success: false, error: error.message };
    }
  }
}

/**
 * Usage Examples
 */
export const UsageExamples = {
  
  // Example 1: Simple bid handling
  async simpleBidExample() {
    const result = await AuctionFlowExample.handleNewBid('auction123', 150, 'user456');
    console.log('Bid result:', result);
  },

  // Example 2: Complete auction flow
  async completeAuctionExample() {
    const result = await AuctionFlowExample.completeAuction('auction123', 500, 'winner789');
    console.log('Completion result:', result);
  },

  // Example 3: Performance monitoring
  async monitoringExample() {
    const metrics = await AuctionFlowExample.monitorAuctionPerformance();
    console.log('Performance metrics:', metrics);
  },

  // Example 4: High-activity optimization
  async optimizationExample() {
    const activeAuctions = ['auction1', 'auction2', 'auction3'];
    const result = await AuctionFlowExample.optimizeForHighActivity(activeAuctions);
    console.log('Optimization result:', result);
  },

  // Example 5: Auction cancellation
  async cancellationExample() {
    const result = await AuctionFlowExample.cancelAuction('auction123', 'seller_request');
    console.log('Cancellation result:', result);
  }
};

export default AuctionFlowExample; 