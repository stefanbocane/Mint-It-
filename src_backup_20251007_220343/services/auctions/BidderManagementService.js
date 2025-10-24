/**
 * Bidder Management Service
 * 
 * Handles efficient bidder tracking and counting for auctions.
 * Provides optimized database reads with pagination and advanced caching.
 */

import { collection, getDocs, limit, query, startAfter, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import CacheService from '../caching/CacheService';
import ErrorHandlingService from '../ErrorHandlingService';
import BatchBidderService from './BatchBidderService';

class BidderManagementService {
  static CONFIG = {
    CACHE_TTL: {
      BIDDER_LIST: 30 * 1000, // 30 seconds
      BIDDER_COUNT: 60 * 1000, // 1 minute
      RECENT_BIDDERS: 15 * 1000 // 15 seconds for recent activity
    },
    PAGINATION: {
      BIDS_PER_PAGE: 50,
      MAX_TOTAL_BIDS: 1000
    }
  };

  static _metrics = {
    cacheHits: 0,
    cacheMisses: 0,
    dbReads: 0,
    paginatedQueries: 0
  };

  constructor() {
    this.bidderCache = new Map();
    this.cacheTimestamps = new Map();
    this.CACHE_TTL = 10 * 60 * 1000; // 10 minutes for legacy cache
  }

  /**
   * Get unique bidder count - now optimized with BatchBidderService
   * @param {string} auctionId - The auction ID
   * @param {string} sellerId - The seller ID to exclude
   * @param {Object} auction - Optional auction object for smart TTL
   * @returns {Promise<number>} - Number of unique bidders
   */
  static async getUniqueBidderCount(auctionId, sellerId, auction = null) {
    try {
      // Use the new BatchBidderService for optimized counting
      return await BatchBidderService.getBidderCount(auctionId, sellerId, auction);
    } catch (error) {
      console.error('❌ BidderManagementService: Error getting bidder count, falling back to legacy method:', error);
      
      // Fallback to legacy method if batch service fails
      const service = new BidderManagementService();
      return await service.getLegacyBidderCount(auctionId, sellerId);
    }
  }

  /**
   * Legacy bidder count method (kept as fallback)
   */
  async getLegacyBidderCount(auctionId, sellerId) {
    const cacheKey = `${auctionId}_${sellerId}`;
    
    // Check legacy cache
    const cached = this.getCachedCount(cacheKey);
    if (cached !== null) {
      return cached;
    }

    try {
      const bidsQuery = query(
        collection(db, 'auctionBids'),
        where('auctionId', '==', auctionId)
      );
      const bidsSnapshot = await getDocs(bidsQuery);
      
      const uniqueBidders = new Set();
      bidsSnapshot.docs.forEach(doc => {
        const bidData = doc.data();
        if (bidData.bidderId && bidData.bidderId !== sellerId) {
          uniqueBidders.add(bidData.bidderId);
        }
      });
      
      const count = uniqueBidders.size;
      this.setCachedCount(cacheKey, count);
      return count;
    } catch (error) {
      console.error('❌ BidderManagementService: Error in legacy bidder count:', error);
      return 0; // Safe fallback
    }
  }

  /**
   * Get list of unique bidders for an auction
   */
  static async getUniqueBidders(auctionId, newBidderId = null) {
    try {
      const cacheKey = `bidders:list:${auctionId}`;
      let cachedBidders = await CacheService.getValue(cacheKey);
      
      if (!cachedBidders) {
        this._metrics.cacheMisses++;
        // Fetch from database with pagination
        const uniqueBidders = await this._fetchBiddersWithPagination(auctionId);
        cachedBidders = Array.from(uniqueBidders);
        
        // Cache the bidder list
        await CacheService.setValue(cacheKey, cachedBidders, { 
          ttl: this.CONFIG.CACHE_TTL.BIDDER_LIST 
        });
      } else {
        this._metrics.cacheHits++;
      }

      // Add new bidder if provided and not already included
      if (newBidderId) {
        const biddersSet = new Set(cachedBidders);
        const wasNewBidder = !biddersSet.has(newBidderId);
        
        if (wasNewBidder) {
          biddersSet.add(newBidderId);
          const updatedBidders = Array.from(biddersSet);
          
          // Update cache with new bidder
          await CacheService.setValue(cacheKey, updatedBidders, { 
            ttl: this.CONFIG.CACHE_TTL.BIDDER_LIST 
          });
          
          // Also invalidate the count cache
          await CacheService.invalidate(`bidders:count:${auctionId}`);
          
          return updatedBidders;
        }
      }
      
      return cachedBidders;

    } catch (error) {
      ErrorHandlingService.handleError(error, {
        context: 'BidderManagementService',
        operation: 'getUniqueBidders'
      });
      return newBidderId ? [newBidderId] : [];
    }
  }

  /**
   * Fetch bidders with pagination to handle large auction volumes efficiently
   */
  static async _fetchBiddersWithPagination(auctionId) {
    const uniqueBidders = new Set();
    let lastDoc = null;
    let totalFetched = 0;

    try {
      while (totalFetched < this.CONFIG.PAGINATION.MAX_TOTAL_BIDS) {
        // Simplified query without orderBy to avoid composite index requirement
        let bidsQuery = query(
          collection(db, 'auctionBids'),
          where('auctionId', '==', auctionId),
          limit(this.CONFIG.PAGINATION.BIDS_PER_PAGE)
        );

        if (lastDoc) {
          bidsQuery = query(bidsQuery, startAfter(lastDoc));
        }

        const bidsSnapshot = await getDocs(bidsQuery);
        this._metrics.dbReads++;
        this._metrics.paginatedQueries++;
        
        if (bidsSnapshot.empty) break;

        bidsSnapshot.docs.forEach(doc => {
          const bidData = doc.data();
          if (bidData.bidderId) {
            uniqueBidders.add(bidData.bidderId);
          }
        });

        totalFetched += bidsSnapshot.docs.length;
        lastDoc = bidsSnapshot.docs[bidsSnapshot.docs.length - 1];

        // Stop if we got less than the page size (no more data)
        if (bidsSnapshot.docs.length < this.CONFIG.PAGINATION.BIDS_PER_PAGE) break;
      }

      console.log(`📊 Fetched ${totalFetched} bids, found ${uniqueBidders.size} unique bidders for auction ${auctionId}`);
      return uniqueBidders;

    } catch (error) {
      console.error('Error fetching bidders with pagination:', error);
      return new Set();
    }
  }

  /**
   * Get recent bidder activity for an auction (last N bidders)
   */
  static async getRecentBidders(auctionId, limit = 10) {
    try {
      const cacheKey = `bidders:recent:${auctionId}:${limit}`;
      let cachedRecent = await CacheService.getValue(cacheKey);
      
      if (cachedRecent) {
        this._metrics.cacheHits++;
        return cachedRecent;
      }

      this._metrics.cacheMisses++;

      // Simplified query without orderBy to avoid composite index requirement
      const bidsQuery = query(
        collection(db, 'auctionBids'),
        where('auctionId', '==', auctionId),
        limit(limit * 2) // Get more to account for duplicates
      );

      const bidsSnapshot = await getDocs(bidsQuery);
      this._metrics.dbReads++;

      const recentBidders = [];
      const seenBidders = new Set();

      // Sort by timestamp in JavaScript since we can't use orderBy in Firestore
      const sortedDocs = bidsSnapshot.docs.sort((a, b) => {
        const aTime = a.data().timestamp?.toMillis() || 0;
        const bTime = b.data().timestamp?.toMillis() || 0;
        return bTime - aTime; // Descending order (most recent first)
      });

      for (const doc of sortedDocs) {
        const bidData = doc.data();
        if (bidData.bidderId && !seenBidders.has(bidData.bidderId)) {
          recentBidders.push({
            bidderId: bidData.bidderId,
            bidAmount: bidData.bidAmount,
            timestamp: bidData.timestamp
          });
          seenBidders.add(bidData.bidderId);
          
          if (recentBidders.length >= limit) break;
        }
      }

      // Cache recent bidders for short time
      await CacheService.setValue(cacheKey, recentBidders, { 
        ttl: this.CONFIG.CACHE_TTL.RECENT_BIDDERS 
      });

      return recentBidders;

    } catch (error) {
      ErrorHandlingService.handleError(error, {
        context: 'BidderManagementService',
        operation: 'getRecentBidders'
      });
      return [];
    }
  }

  /**
   * Invalidate all cached data for an auction
   */
  static async invalidateAuctionCache(auctionId) {
    try {
      const keys = [
        `bidders:list:${auctionId}`,
        `bidders:count:${auctionId}`,
        `bidders:recent:${auctionId}:10`, // Common limit
        `bidders:recent:${auctionId}:5`,
        `bidders:recent:${auctionId}:20`
      ];

      await Promise.all(keys.map(key => CacheService.invalidate(key)));
      console.log(`🗑️ Invalidated bidder cache for auction ${auctionId}`);

    } catch (error) {
      console.error('Error invalidating auction cache:', error);
    }
  }

  /**
   * Pre-warm cache for active auctions
   */
  static async preWarmCache(auctionIds) {
    console.log(`🔥 Pre-warming bidder cache for ${auctionIds.length} auctions`);
    
    const promises = auctionIds.map(async (auctionId) => {
      try {
        await this.getUniqueBidders(auctionId);
        await this.getRecentBidders(auctionId);
      } catch (error) {
        console.error(`Failed to pre-warm cache for auction ${auctionId}:`, error);
      }
    });

    await Promise.allSettled(promises);
    console.log('✅ Cache pre-warming complete');
  }

  /**
   * Get bidder engagement statistics
   */
  static async getBidderEngagementStats(auctionId) {
    try {
      const bidders = await this.getUniqueBidders(auctionId);
      const recentBidders = await this.getRecentBidders(auctionId, 20);

      return {
        totalUniqueBidders: bidders.length,
        recentActivity: recentBidders.length,
        engagementRatio: recentBidders.length / Math.max(bidders.length, 1),
        lastActivity: recentBidders[0]?.timestamp || null
      };

    } catch (error) {
      console.error('Error getting bidder engagement stats:', error);
      return {
        totalUniqueBidders: 0,
        recentActivity: 0,
        engagementRatio: 0,
        lastActivity: null
      };
    }
  }

  /**
   * Batch process bidder counts for multiple auctions
   * @param {Array} auctions - Array of auction objects
   * @returns {Promise<Object>} - Object mapping auctionId to bidder count
   */
  async getBidderCountsBatch(auctions) {
    try {
      // Use BatchBidderService for optimal performance
      const auctionInfos = auctions.map(auction => ({
        auctionId: auction.id,
        sellerId: auction.sellerId,
        auction
      }));
      
      return await BatchBidderService.getBidderCountsBatch(auctionInfos);
    } catch (error) {
      console.error('❌ BidderManagementService: Batch processing failed:', error);
      
      // Fallback to individual legacy calls
      const results = {};
      for (const auction of auctions) {
        try {
          results[auction.id] = await this.getLegacyBidderCount(auction.id, auction.sellerId);
        } catch (err) {
          console.error(`❌ Failed to get count for auction ${auction.id}:`, err);
          results[auction.id] = 0;
        }
      }
      return results;
    }
  }

  /**
   * Pre-load bidder counts for active auctions
   */
  async preloadBidderCounts(auctions) {
    return await BatchBidderService.preloadBidderCounts(auctions);
  }

  /**
   * Legacy cache methods (maintained for fallback)
   */
  setCachedCount(key, count) {
    this.bidderCache.set(key, count);
    this.cacheTimestamps.set(key, Date.now() + this.CACHE_TTL);
  }

  getCachedCount(key) {
    const timestamp = this.cacheTimestamps.get(key);
    if (!timestamp || Date.now() > timestamp) {
      this.bidderCache.delete(key);
      this.cacheTimestamps.delete(key);
      return null;
    }
    return this.bidderCache.get(key);
  }

  /**
   * Invalidate bidder counts for auction
   */
  invalidateBidderCount(auctionId) {
    // Invalidate in both services
    BatchBidderService.invalidateAuction(auctionId);
    
    // Invalidate legacy cache
    for (const [key] of this.bidderCache.entries()) {
      if (key.startsWith(auctionId)) {
        this.bidderCache.delete(key);
        this.cacheTimestamps.delete(key);
      }
    }
  }

  /**
   * Get comprehensive metrics
   */
  getMetrics() {
    const batchMetrics = BatchBidderService.getMetrics();
    return {
      batchService: batchMetrics,
      legacyCache: {
        size: this.bidderCache.size,
        hitRate: 'Legacy fallback available'
      }
    };
  }

  /**
   * Clear all caches
   */
  clearCache() {
    BatchBidderService.clearCache();
    this.bidderCache.clear();
    this.cacheTimestamps.clear();
  }

  /**
   * 🚀 NEW: Batch get bidder counts for multiple auctions efficiently
   * This reduces database reads by batching operations instead of individual queries
   */
  static async batchGetBidderCounts(auctionSpecs = []) {
    if (!auctionSpecs?.length) {
      console.log('🔄 BidderManagementService: No auctions provided for batch bidder count');
      return {};
    }

    console.log(`🚀 BidderManagementService: Batch getting bidder counts for ${auctionSpecs.length} auctions`);

    try {
      // Check cache first for all auctions
      const results = {};
      const auctionsNeedingFetch = [];

      for (const spec of auctionSpecs) {
        const cacheKey = `bidder_count_${spec.id}`;
        const cached = this._cacheGet(cacheKey);
        
        if (cached !== null) {
          results[spec.id] = cached;
        } else {
          auctionsNeedingFetch.push(spec);
        }
      }

      if (auctionsNeedingFetch.length === 0) {
        console.log('✅ All bidder counts found in cache');
        return results;
      }

      console.log(`📊 Need to fetch bidder counts for ${auctionsNeedingFetch.length} auctions`);

      // Batch fetch bids for all auctions that need fresh data
      const batchPromises = auctionsNeedingFetch.map(async (spec) => {
        try {
          const bidderCount = await this.getUniqueBidderCount(spec.id, spec.sellerId);
          
          // Cache the result
          const cacheKey = `bidder_count_${spec.id}`;
          this._cacheSet(cacheKey, bidderCount, 2 * 60 * 1000); // 2 minute cache
          
          return { auctionId: spec.id, bidderCount };
        } catch (error) {
          console.error(`❌ Error getting bidder count for auction ${spec.id}:`, error);
          return { auctionId: spec.id, bidderCount: 0 };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      
      // Merge batch results with cached results
      batchResults.forEach(({ auctionId, bidderCount }) => {
        results[auctionId] = bidderCount;
      });

      console.log(`✅ BidderManagementService: Batch operation complete for ${Object.keys(results).length} auctions`);
      return results;

    } catch (error) {
      console.error('❌ BidderManagementService: Error in batch bidder count operation:', error);
      // Return empty counts for all auctions on error
      return auctionSpecs.reduce((acc, spec) => {
        acc[spec.id] = 0;
        return acc;
      }, {});
    }
  }

  /**
   * Simple in-memory cache for bidder counts
   */
  static _cache = new Map();
  static _cacheTimestamps = new Map();

  static _cacheSet(key, value, ttl = 5 * 60 * 1000) {
    this._cache.set(key, value);
    this._cacheTimestamps.set(key, Date.now() + ttl);
  }

  static _cacheGet(key) {
    const timestamp = this._cacheTimestamps.get(key);
    if (!timestamp || Date.now() > timestamp) {
      this._cache.delete(key);
      this._cacheTimestamps.delete(key);
      return null;
    }
    return this._cache.get(key);
  }
}

// Export both the class for static methods and instance for instance methods
export default BidderManagementService;
export const bidderManagementService = new BidderManagementService(); 