/**
 * Auction Services Index
 * 
 * Centralized exports for all auction-related services
 */

export { default as LiveAuctionService } from '../LiveAuctionService';
export { default as BidderManagementService } from './BidderManagementService';
export { default as CoinAwardService } from './CoinAwardService';
export { default as RarityCalculationService } from './RarityCalculationService';

// Export a convenience object with all services
export const AuctionServices = {
  LiveAuctionService: () => import('../LiveAuctionService').then(m => m.default),
  RarityCalculationService: () => import('./RarityCalculationService').then(m => m.default),
  BidderManagementService: () => import('./BidderManagementService').then(m => m.default),
  CoinAwardService: () => import('./CoinAwardService').then(m => m.default)
};

// Export utility functions
export const AuctionServiceUtils = {
  /**
   * Initialize all auction services
   */
  async initializeServices() {
    const liveAuctionService = (await import('../LiveAuctionService')).default.getInstance();
    return {
      liveAuctionService
    };
  },

  /**
   * Get combined metrics from all services
   */
  async getAggregatedMetrics() {
    const LiveAuctionService = (await import('../LiveAuctionService')).default;
    return LiveAuctionService.getMetrics();
  },

  /**
   * Cleanup all auction services
   */
  async cleanupAllServices() {
    const LiveAuctionService = (await import('../LiveAuctionService')).default;
    const BidderManagementService = (await import('./BidderManagementService')).default;
    const CoinAwardService = (await import('./CoinAwardService')).default;
    
    LiveAuctionService.cleanup();
    BidderManagementService.resetMetrics();
    CoinAwardService.resetMetrics();
    
    console.log('✅ All auction services cleaned up');
  },

  /**
   * Pre-warm caches for active auctions
   */
  async preWarmCaches(activeAuctionIds) {
    const BidderManagementService = (await import('./BidderManagementService')).default;
    await BidderManagementService.preWarmCache(activeAuctionIds);
  }
}; 