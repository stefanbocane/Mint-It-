/**
 * ConsolidatedRarityService - Central rarity calculation and management
 * 
 * This service eliminates redundant rarity calculations by:
 * - Centralizing all rarity logic in one place
 * - Caching calculation results with smart TTL
 * - Providing optimistic updates for UI responsiveness
 * - Batch processing rarity updates
 * - Preventing duplicate calculations
 */

import { calculateLiveRarity, determineAuctionFinalRarity } from '../utils/auctionRarity';
import BidderManagementService from './auctions/BidderManagementService';
import CacheService from './caching/CacheService';

class ConsolidatedRarityService {
  constructor() {
    this.cache = new Map();
    this.cacheTimestamps = new Map();
    this.pendingCalculations = new Map();
    
    // Configuration
    this.CACHE_TTL = {
      LIVE_RARITY: 30 * 1000,      // 30 seconds for live auction rarity
      FINAL_RARITY: 15 * 60 * 1000, // 15 minutes for final rarity
      STABLE_RARITY: 5 * 60 * 1000  // 5 minutes for stable auctions
    };
    
    this.RARITY_THRESHOLDS = {
      COMMON: { minBidders: 0, minBid: 0 },
      UNCOMMON: { minBidders: 2, minBid: 20 },
      RARE: { minBidders: 5, minBid: 100 },
      EPIC: { minBidders: 10, minBid: 200 },
      LEGENDARY: { minBidders: 15, minBid: 300 }
    };
  }

  /**
   * Get smart TTL based on auction state
   */
  getSmartTTL(auction) {
    if (!auction?.endTime) return this.CACHE_TTL.LIVE_RARITY;
    
    const endTime = auction.endTime?.toDate?.() || new Date(auction.endTime?.seconds * 1000);
    const timeRemaining = endTime.getTime() - Date.now();
    
    if (auction.status === 'completed' || auction.status === 'cancelled') {
      return this.CACHE_TTL.FINAL_RARITY;
    }
    
    if (timeRemaining < 30 * 60 * 1000) { // Less than 30 minutes
      return this.CACHE_TTL.LIVE_RARITY;
    }
    
    return this.CACHE_TTL.STABLE_RARITY;
  }

  /**
   * Calculate live rarity with caching and deduplication
   */
  async calculateLiveRarity(auction, providedBidderCount = null) {
    if (!auction?.id) {
      console.warn('ConsolidatedRarityService: Invalid auction provided');
      return 'common';
    }

    const cacheKey = `live_${auction.id}`;
    
    // Check cache first
    const cached = this.getCachedRarity(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Check if calculation is already pending to prevent duplicates
    if (this.pendingCalculations.has(cacheKey)) {
      return await this.pendingCalculations.get(cacheKey);
    }

    // Start new calculation
    const calculationPromise = this.performLiveRarityCalculation(auction, providedBidderCount);
    this.pendingCalculations.set(cacheKey, calculationPromise);

    try {
      const result = await calculationPromise;
      
      // Cache the result
      const ttl = this.getSmartTTL(auction);
      this.setCachedRarity(cacheKey, result, ttl);
      
      return result;
    } finally {
      this.pendingCalculations.delete(cacheKey);
    }
  }

  /**
   * Perform the actual live rarity calculation
   */
  async performLiveRarityCalculation(auction, providedBidderCount) {
    try {
      // Get bidder count if not provided
      let bidderCount = providedBidderCount;
      if (bidderCount === null || bidderCount === undefined) {
        bidderCount = await BidderManagementService.getUniqueBidderCount(auction.id, auction.sellerId, auction);
      }

      // Use existing rarity calculation logic
      const rarity = calculateLiveRarity(auction, bidderCount);
      
      console.log(`🎯 ConsolidatedRarityService: Calculated live rarity for ${auction.id}: ${rarity} (${bidderCount} bidders)`);
      return rarity;
    } catch (error) {
      console.error(`❌ ConsolidatedRarityService: Error calculating live rarity for ${auction.id}:`, error);
      return auction.currentRarity || auction.cardRarity || 'common';
    }
  }

  /**
   * Calculate final rarity with caching
   */
  async calculateFinalRarity(auction, providedBidderCount = null) {
    if (!auction?.id) {
      console.warn('ConsolidatedRarityService: Invalid auction provided for final rarity');
      return 'common';
    }

    const cacheKey = `final_${auction.id}`;
    
    // Check cache first
    const cached = this.getCachedRarity(cacheKey);
    if (cached !== null) {
      return cached;
    }

    try {
      // Use existing final rarity calculation logic
      const rarity = await determineAuctionFinalRarity(auction, providedBidderCount);
      
      // Cache with long TTL since final rarity doesn't change
      this.setCachedRarity(cacheKey, rarity, this.CACHE_TTL.FINAL_RARITY);
      
      console.log(`🏆 ConsolidatedRarityService: Calculated final rarity for ${auction.id}: ${rarity}`);
      return rarity;
    } catch (error) {
      console.error(`❌ ConsolidatedRarityService: Error calculating final rarity for ${auction.id}:`, error);
      return auction.currentRarity || auction.cardRarity || 'common';
    }
  }

  /**
   * Batch calculate rarities for multiple auctions
   */
  async batchCalculateRarities(auctions, type = 'live') {
    if (!auctions?.length) return {};

    console.log(`🚀 ConsolidatedRarityService: Batch calculating ${type} rarities for ${auctions.length} auctions`);

    const results = {};
    const calculations = auctions.map(async (auction) => {
      try {
        const rarity = type === 'live' 
          ? await this.calculateLiveRarity(auction)
          : await this.calculateFinalRarity(auction);
        
        results[auction.id] = rarity;
      } catch (error) {
        console.error(`❌ Error calculating ${type} rarity for auction ${auction.id}:`, error);
        results[auction.id] = auction.currentRarity || auction.cardRarity || 'common';
      }
    });

    await Promise.all(calculations);
    
    console.log(`✅ ConsolidatedRarityService: Batch calculation complete for ${Object.keys(results).length} auctions`);
    return results;
  }

  /**
   * Get optimistic rarity update (for UI responsiveness)
   */
  getOptimisticRarity(auction, newBidAmount, newBidderCount) {
    try {
      const updatedAuction = {
        ...auction,
        currentBid: newBidAmount,
        uniqueBidderCount: newBidderCount
      };

      return calculateLiveRarity(updatedAuction, newBidderCount);
    } catch (error) {
      console.error('❌ ConsolidatedRarityService: Error calculating optimistic rarity:', error);
      return auction.currentRarity || auction.cardRarity || 'common';
    }
  }

  /**
   * 🚀 NEW: Preload rarities for a group of auctions to reduce on-demand calculations
   */
  async preloadRarities(auctions = [], groupId = null) {
    if (!auctions?.length) {
      console.log('🔄 ConsolidatedRarityService: No auctions to preload');
      return {};
    }

    console.log(`🚀 ConsolidatedRarityService: Preloading rarities for ${auctions.length} auctions`);

    try {
      // Filter auctions that need rarity calculations
      const auctionsNeedingCalculation = auctions.filter(auction => {
        const cacheKey = `live_${auction.id}`;
        return this.getCachedRarity(cacheKey) === null;
      });

      if (auctionsNeedingCalculation.length === 0) {
        console.log('✅ All auction rarities already cached');
        return {};
      }

      console.log(`📊 Need to calculate rarities for ${auctionsNeedingCalculation.length} auctions`);

      // Batch get bidder counts for all auctions that need them
      let bidderCounts = {};
      try {
        // 🚀 FIX: Add safety check for function availability
        if (typeof BidderManagementService.batchGetBidderCounts === 'function') {
          bidderCounts = await BidderManagementService.batchGetBidderCounts(
            auctionsNeedingCalculation.map(a => ({ id: a.id, sellerId: a.sellerId }))
          );
        } else {
          console.warn('⚠️ BidderManagementService.batchGetBidderCounts not available, using fallback');
                     // Fallback: get bidder counts individually using static method
           for (const auction of auctionsNeedingCalculation) {
             try {
               bidderCounts[auction.id] = await BidderManagementService.getUniqueBidderCount(auction.id, auction.sellerId, auction) || 0;
             } catch (err) {
               console.error(`❌ Error getting bidder count for ${auction.id}:`, err);
               bidderCounts[auction.id] = 0;
             }
           }
        }
      } catch (batchError) {
        console.error('❌ Batch bidder count failed, using individual calls:', batchError);
                 // Fallback to individual calls using static method
         for (const auction of auctionsNeedingCalculation) {
           try {
             bidderCounts[auction.id] = await BidderManagementService.getUniqueBidderCount(auction.id, auction.sellerId, auction) || 0;
           } catch (err) {
             console.error(`❌ Error getting bidder count for ${auction.id}:`, err);
             bidderCounts[auction.id] = 0;
           }
         }
      }

      // Calculate rarities with the pre-fetched bidder counts
      const rarityPromises = auctionsNeedingCalculation.map(async (auction) => {
        const bidderCount = bidderCounts[auction.id] || 0;
        const rarity = calculateLiveRarity(auction, bidderCount);
        
        // Cache the result
        const ttl = this.getSmartTTL(auction);
        this.setCachedRarity(`live_${auction.id}`, rarity, ttl);
        
        return { auctionId: auction.id, rarity, bidderCount };
      });

      const results = await Promise.all(rarityPromises);
      
      console.log(`✅ ConsolidatedRarityService: Preloaded ${results.length} rarities successfully`);
      
      // Return results as a map for easy lookup
      return results.reduce((acc, { auctionId, rarity, bidderCount }) => {
        acc[auctionId] = { rarity, bidderCount };
        return acc;
      }, {});

    } catch (error) {
      console.error('❌ ConsolidatedRarityService: Error preloading rarities:', error);
      return {};
    }
  }

  /**
   * 🚀 NEW: Smart cache warming for frequently accessed auctions
   */
  async warmCache(auctions = [], priority = 'normal') {
    if (!auctions?.length) return;

    const cachingStrategy = priority === 'high' ? 'immediate' : 'background';
    console.log(`🔥 ConsolidatedRarityService: Warming cache for ${auctions.length} auctions (${priority} priority)`);

    if (cachingStrategy === 'immediate') {
      // High priority: calculate immediately
      return await this.preloadRarities(auctions);
    } else {
      // Background: defer calculation to not block UI
      setTimeout(async () => {
        try {
          await this.preloadRarities(auctions);
        } catch (error) {
          console.error('❌ Background cache warming failed:', error);
        }
      }, 1000);
      return {};
    }
  }

  /**
   * Invalidate rarity cache for a specific auction
   */
  invalidateCache(auctionId) {
    const liveKey = `live_${auctionId}`;
    const finalKey = `final_${auctionId}`;
    
    if (this.cache.has(liveKey)) {
      this.cache.delete(liveKey);
      this.cacheTimestamps.delete(liveKey);
    }
    
    if (this.cache.has(finalKey)) {
      this.cache.delete(finalKey);
      this.cacheTimestamps.delete(finalKey);
    }
    
    console.log(`🔄 ConsolidatedRarityService: Invalidated rarity cache for auction ${auctionId}`);
  }

  /**
   * Clear all rarity cache
   */
  clearCache() {
    this.cache.clear();
    this.cacheTimestamps.clear();
    this.pendingCalculations.clear();
    console.log(`🔄 ConsolidatedRarityService: Cleared all rarity cache`);
  }

  /**
   * Force update rarity for an auction (bypasses cache)
   */
  async forceUpdateRarity(auctionId, auction = null, bidderCount = null) {
    try {
      // Remove from cache to force fresh calculation
      this.invalidateCache(auctionId);
      
      // Get fresh auction data if not provided
      let auctionData = auction;
      if (!auctionData) {
        auctionData = await CacheService.getDocument('auctions', auctionId, { forceRefresh: true });
      }
      
      if (!auctionData) {
        console.error(`❌ ConsolidatedRarityService: Auction ${auctionId} not found for force update`);
        return null;
      }
      
      // Calculate new rarity
      const newRarity = await this.performLiveRarityCalculation(auctionData, bidderCount);
      
      // Cache the result
      this.setCachedRarity(`live_${auctionId}`, newRarity, this.CACHE_TTL.LIVE_RARITY);
      
      console.log(`🔄 ConsolidatedRarityService: Force updated rarity for auction ${auctionId}: ${newRarity}`);
      return newRarity;
    } catch (error) {
      console.error(`❌ ConsolidatedRarityService: Error force updating rarity for ${auctionId}:`, error);
      return auction?.currentRarity || auction?.cardRarity || 'common';
    }
  }

  /**
   * Cache management
   */
  setCachedRarity(key, rarity, ttl) {
    this.cache.set(key, rarity);
    this.cacheTimestamps.set(key, Date.now() + ttl);
  }

  getCachedRarity(key) {
    const timestamp = this.cacheTimestamps.get(key);
    if (!timestamp || Date.now() > timestamp) {
      this.cache.delete(key);
      this.cacheTimestamps.delete(key);
      return null;
    }
    return this.cache.get(key);
  }

  /**
   * Get comprehensive metrics
   */
  getMetrics() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;
    
    for (const [key, timestamp] of this.cacheTimestamps.entries()) {
      if (now > timestamp) {
        expiredEntries++;
      } else {
        validEntries++;
      }
    }
    
    return {
      cacheSize: this.cache.size,
      validEntries,
      expiredEntries,
      pendingCalculations: this.pendingCalculations.size,
      hitRate: validEntries > 0 ? 'Available' : 'No cached data'
    };
  }
}

// Export singleton instance
export default new ConsolidatedRarityService(); 