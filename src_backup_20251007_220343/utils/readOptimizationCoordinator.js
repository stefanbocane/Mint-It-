/**
 * Read Optimization Coordinator
 * Manages the integration of all read optimization services
 * Ensures smooth transition without breaking existing functionality
 */

import CacheService from '../services/caching/CacheService';
import { collectionOptimizer } from './collectionScreenOptimizer';
import consolidatedQueryService from './consolidatedQueryService';
import navigationPrefetcher from './navigationPrefetcher';
import { profileOptimizer } from './profileScreenOptimizer';
import smartBidderCountService from './smartBidderCountService';
import smartQueryDeduplication from './smartQueryDeduplication';
import { storeOptimizer } from './storeScreenOptimizer';

/**
 * Central optimization manager
 * Routes requests to the appropriate optimization service
 */
class ReadOptimizationCoordinator {
  constructor() {
    this.isEnabled = true;
    this.metrics = {
      optimizedRequests: 0,
      savedReads: 0,
      deduplicatedRequests: 0
    };
  }

  /**
   * Optimized user data fetching with deduplication
   * Drop-in replacement for CacheService.getDocument('users', ...)
   */
  async getUser(userId, options = {}) {
    if (!this.isEnabled || !userId) {
      return CacheService.getDocument('users', userId, options);
    }

    this.metrics.optimizedRequests++;
    return CacheService.getDocument('users', userId, options);
  }

  /**
   * Optimized bidder count fetching with batching
   * Drop-in replacement for individual bidder count queries
   */
  async getBidderCount(auctionId, options = {}) {
    if (!this.isEnabled || !auctionId) {
      // Fallback to original implementation
      return this.fallbackGetBidderCount(auctionId, options);
    }

    this.metrics.optimizedRequests++;
    return smartBidderCountService.getBidderCount(auctionId, options);
  }

  /**
   * Batch bidder counts for multiple auctions
   */
  async getBidderCounts(auctionIds, options = {}) {
    if (!this.isEnabled || !auctionIds || auctionIds.length === 0) {
      return {};
    }

    this.metrics.optimizedRequests++;
    this.metrics.savedReads += Math.max(0, auctionIds.length - 1); // Estimate reads saved
    return smartBidderCountService.getBidderCounts(auctionIds, options);
  }

  /**
   * Optimized trade data fetching
   */
  async getTradesData(userId, groupId, options = {}) {
    if (!this.isEnabled) {
      return this.fallbackGetTrades(userId, groupId, options);
    }

    this.metrics.optimizedRequests++;
    return consolidatedQueryService.getTradesConsolidated(userId, groupId, options);
  }

  /**
   * Optimized leaderboard data fetching
   */
  async getLeaderboardData(groupId, options = {}) {
    if (!this.isEnabled) {
      return this.fallbackGetLeaderboard(groupId, options);
    }

    this.metrics.optimizedRequests++;
    return consolidatedQueryService.getLeaderboardData(groupId, options);
  }

  /**
   * Optimized cards for trade creation
   */
  async getCardsForTrade(userId, groupId, options = {}) {
    if (!this.isEnabled) {
      return this.fallbackGetCardsForTrade(userId, groupId, options);
    }

    this.metrics.optimizedRequests++;
    return consolidatedQueryService.getCardsForTradeCreation(userId, groupId, options);
  }

  /**
   * Smart document fetching with deduplication
   */
  async getDocument(collectionName, documentId, options = {}) {
    if (!this.isEnabled) {
      return CacheService.getDocument(collectionName, documentId, options);
    }

    // Special handling for users
    if (collectionName === 'users') {
      return this.getUser(documentId, options);
    }

    this.metrics.optimizedRequests++;
    return smartQueryDeduplication.getDocumentDeduplicated(collectionName, documentId, options);
  }

  /**
   * Smart batch document fetching
   */
  async getDocuments(collectionName, documentIds, options = {}) {
    if (!this.isEnabled || !documentIds || documentIds.length === 0) {
      return CacheService.getDocuments(collectionName, documentIds, options);
    }

    this.metrics.optimizedRequests++;
    this.metrics.savedReads += Math.max(0, documentIds.length - 1); // Estimate reads saved
    return smartQueryDeduplication.getDocumentsBatch(collectionName, documentIds, options);
  }

  /**
   * Preload data for screen navigation using optimized services
   */
  async preloadScreenData(screenName, context = {}, options = {}) {
    if (!this.isEnabled) {
      return;
    }

    console.log(`Preloading optimized data for ${screenName}`);
    
    // Use screen-specific optimizers for better performance
    const { userId, groupId } = context;
    
    switch (screenName) {
      case 'Collection':
        return collectionOptimizer.preloadUserCards([userId], groupId, options);
      
      case 'Profile':
        return profileOptimizer.prefetchProfileData(userId, groupId, options);
      
      case 'Store':
        return storeOptimizer.prefetchStoreScreenData(userId, groupId, options);
      
      default:
        return smartQueryDeduplication.preloadScreenData(screenName, context, options);
    }
  }

  /**
   * Optimized collection screen data loading
   */
  async getCollectionData(userId, groupId, options = {}) {
    if (!this.isEnabled) {
      return [];
    }

    this.metrics.optimizedRequests++;
    return collectionOptimizer.preloadUserCards([userId], groupId, options);
  }

  /**
   * Optimized profile screen data loading
   */
  async getProfileData(userId, groupId, options = {}) {
    if (!this.isEnabled) {
      return null;
    }

    this.metrics.optimizedRequests++;
    return profileOptimizer.getConsolidatedProfileData(userId, groupId, options);
  }

  /**
   * Optimized store screen data loading
   */
  async getStoreData(userId, groupId, options = {}) {
    if (!this.isEnabled) {
      return null;
    }

    this.metrics.optimizedRequests++;
    return storeOptimizer.getStoreUserData(userId, options);
  }

  /**
   * Smart navigation prefetching
   */
  async prefetchForNavigation(fromScreen, toScreen, userId, groupId, options = {}) {
    if (!this.isEnabled) {
      return;
    }

    // Record navigation pattern
    navigationPrefetcher.recordNavigation(fromScreen, toScreen, userId, groupId);
    
    // Prefetch data for target screen
    return navigationPrefetcher.prefetchForScreen(toScreen, userId, groupId, options);
  }

  /**
   * Smart auction data consolidation
   */
  async getAuctionDataConsolidated(auctionIds, options = {}) {
    if (!this.isEnabled) {
      return { auctions: [], users: {}, bidCounts: {} };
    }

    this.metrics.optimizedRequests++;
    return consolidatedQueryService.getAuctionDataConsolidated(auctionIds, options);
  }

  /**
   * Update bidder count cache when new bid is placed
   */
  async updateBidderCountCache(auctionId, newCount) {
    if (!this.isEnabled) {
      return;
    }

    return smartBidderCountService.updateBidderCountCache(auctionId, newCount);
  }

  /**
   * Preload bidder counts for performance
   */
  async preloadBidderCounts(auctionIds, options = {}) {
    if (!this.isEnabled) {
      return;
    }

    return smartBidderCountService.preloadBidderCounts(auctionIds, options);
  }

  /**
   * Get optimization metrics
   */
  getMetrics() {
    const deduplicationStats = smartQueryDeduplication.getDeduplicationStats();
    
    return {
      ...this.metrics,
      deduplication: deduplicationStats,
      isEnabled: this.isEnabled,
      estimatedReadReduction: this.metrics.savedReads,
      totalOptimizedRequests: this.metrics.optimizedRequests
    };
  }

  /**
   * Enable/disable optimizations
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    console.log(`Read optimizations ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      optimizedRequests: 0,
      savedReads: 0,
      deduplicatedRequests: 0
    };
  }

  // Fallback methods for when optimizations are disabled
  async fallbackGetBidderCount(auctionId, options = {}) {
    // Original implementation fallback
    const { getOptimizedUniqueBidderCount } = await import('./dbOptimizer');
    return getOptimizedUniqueBidderCount(auctionId, options);
  }

  async fallbackGetTrades(userId, groupId, options = {}) {
    // Original implementation using separate queries
    const { getCachedQuery } = await import('./firestoreUtils');
    return getCachedQuery('trades', [['groupId', '==', groupId]], options);
  }

  async fallbackGetLeaderboard(groupId, options = {}) {
    // Original implementation using separate card and user queries
    const { getCachedQuery } = await import('./firestoreUtils');
    const [cards, users] = await Promise.all([
      getCachedQuery('cards', [['groupId', '==', groupId]], options),
      getCachedQuery('users', [['groupId', '==', groupId]], options)
    ]);
    return { cards, users };
  }

  async fallbackGetCardsForTrade(userId, groupId, options = {}) {
    // Original dual query implementation
    const { getCachedQuery } = await import('./firestoreUtils');
    const [ownerCards, userCards] = await Promise.all([
      getCachedQuery('cards', [['ownerId', '==', userId], ['groupId', '==', groupId]], options),
      getCachedQuery('cards', [['userId', '==', userId], ['groupId', '==', groupId]], options)
    ]);
    
    // Deduplicate
    const cardMap = new Map();
    [...ownerCards, ...userCards].forEach(card => {
      cardMap.set(card.id, card);
    });
    
    return Array.from(cardMap.values());
  }
}

// Create singleton instance
const coordinator = new ReadOptimizationCoordinator();

/**
 * High-level API for common optimization patterns
 */
export const optimizeAuctionScreen = async (groupId, userId, options = {}) => {
  // Preload all data needed for auction screen
  const [auctionsData, userData] = await Promise.all([
    coordinator.getDocument('groups', groupId, options),
    coordinator.getUser(userId, options),
    coordinator.preloadScreenData('AuctionScreen', { userId, groupId }, options)
  ]);

  return { auctionsData, userData };
};

export const optimizeTradeScreen = async (userId, groupId, options = {}) => {
  const [tradesData, userData] = await Promise.all([
    coordinator.getTradesData(userId, groupId, options),
    coordinator.getUser(userId, options)
  ]);

  return { tradesData, userData };
};

export const optimizeLeaderboardScreen = async (groupId, options = {}) => {
  return coordinator.getLeaderboardData(groupId, options);
};

/**
 * Migration helper for existing code
 * Provides a compatibility layer for transitioning to optimized calls
 */
export const createOptimizedService = (originalService) => {
  return new Proxy(originalService, {
    get(target, prop, receiver) {
      // Intercept specific methods we want to optimize
      if (prop === 'getDocument') {
        return (...args) => coordinator.getDocument(...args);
      }
      if (prop === 'getDocuments') {
        return (...args) => coordinator.getDocuments(...args);
      }
      
      // For all other methods, use original implementation
      return Reflect.get(target, prop, receiver);
    }
  });
};

export {
    coordinator as ReadOptimizationCoordinator
};

export default coordinator; 