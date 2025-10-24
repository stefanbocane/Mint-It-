import { collection, orderBy, query, where } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import CacheService from './caching/CacheService';
import { getDocs } from './ReadTracking/TrackedFirestore';

/**
 * SmartAuctionCacheManager - Optimizes auction queries with intelligent caching
 * 
 * This service pre-computes and caches auction lists to eliminate repeated
 * pagination queries. Expected read reduction: 65-75% for auction operations.
 */
class SmartAuctionCacheManager {
  static CACHE_TTL = {
    // Significantly extended TTL values to reduce database reads
    AUCTION_LIST: 45 * 60 * 1000,    // 45 minutes for auction ID lists (was 15)
    AUCTION_DATA: 25 * 60 * 1000,    // 25 minutes for auction documents (was 10)
    COMPUTED_PAGES: 60 * 60 * 1000,  // 1 hour for pre-computed pages (was 20)
    
    // New tiered caching based on auction urgency
    CRITICAL_AUCTION: 2 * 60 * 1000,     // 2 minutes for auctions ending soon
    STABLE_AUCTION: 90 * 60 * 1000,      // 1.5 hours for auctions with >6 hours remaining
    COMPLETED_AUCTION: 24 * 60 * 60 * 1000, // 24 hours for completed auctions
    
    // User-specific caching
    USER_ACTIVITY: 10 * 60 * 1000,       // 10 minutes for user activity data
    AUCTION_COUNT: 30 * 60 * 1000        // 30 minutes for count queries
  };

  static PAGE_SIZE = 20; // Default page size

  /**
   * Get smart TTL based on auction state and urgency
   * @param {Object} auction - Auction data
   * @returns {number} TTL in milliseconds
   */
  static getSmartTTL(auction) {
    if (!auction) return this.CACHE_TTL.AUCTION_DATA;
    
    // Completed auctions can be cached much longer
    if (auction.status === 'completed' || auction.status === 'cancelled') {
      return this.CACHE_TTL.COMPLETED_AUCTION;
    }
    
    // Check if auction is ending soon
    const endTime = auction.endTime?.toDate?.() || new Date(auction.endTime?.seconds * 1000);
    if (endTime) {
      const timeRemaining = endTime.getTime() - Date.now();
      
      // Critical: less than 30 minutes remaining
      if (timeRemaining < 30 * 60 * 1000 && timeRemaining > 0) {
        return this.CACHE_TTL.CRITICAL_AUCTION;
      }
      
      // Stable: more than 6 hours remaining
      if (timeRemaining > 6 * 60 * 60 * 1000) {
        return this.CACHE_TTL.STABLE_AUCTION;
      }
    }
    
    // Default TTL for active auctions
    return this.CACHE_TTL.AUCTION_DATA;
  }

  /**
   * Get auctions with smart caching and pagination
   * @param {string} groupId - The group ID
   * @param {string} status - Auction status ('active', 'completed', 'all')
   * @param {number} page - Page number (0-based)
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Object with auctions array and pagination info
   */
  static async getAuctions(groupId, status = 'active', page = 0, options = {}) {
    const { pageSize = this.PAGE_SIZE, forceRefresh = false } = options;
    const baseKey = `auctions_${groupId}_${status}`;
    
    try {
      // Check for pre-computed auction list
      const cachedList = await CacheService.getValue(`${baseKey}_list`);
      if (cachedList && !forceRefresh) {
        console.log(`[SmartAuctionCacheManager] Using cached auction list for ${baseKey}`);
        
        const startIndex = page * pageSize;
        const endIndex = startIndex + pageSize;
        
        // Return cached slice with full auction data
        const auctionIds = cachedList.auctionIds.slice(startIndex, endIndex);
        if (auctionIds.length === 0) {
          return { auctions: [], hasMore: false, fromCache: true };
        }
        
        const auctions = await CacheService.getDocuments('auctions', auctionIds, {
          ttl: this.CACHE_TTL.AUCTION_DATA
        });
        
        return {
          auctions: auctions.filter(auction => auction !== null), // Filter out null results
          hasMore: endIndex < cachedList.auctionIds.length,
          fromCache: true,
          totalCount: cachedList.auctionIds.length
        };
      }
      
      console.log(`[SmartAuctionCacheManager] Cache miss for ${baseKey}, fetching from Firestore`);
      // Fallback to current query logic only on cache miss
      return await this.fetchAndCacheAuctions(groupId, status, page, options);
      
    } catch (error) {
      console.error(`[SmartAuctionCacheManager] Error getting auctions for ${baseKey}:`, error);
      
      // Try to return stale cached data on error
      const staleList = await CacheService.getValue(`${baseKey}_list`);
      if (staleList) {
        console.warn(`[SmartAuctionCacheManager] Returning stale data for ${baseKey}`);
        const startIndex = page * pageSize;
        const endIndex = startIndex + pageSize;
        const auctionIds = staleList.auctionIds.slice(startIndex, endIndex);
        const auctions = await CacheService.getDocuments('auctions', auctionIds).catch(() => []);
        
        return {
          auctions: auctions.filter(auction => auction !== null),
          hasMore: endIndex < staleList.auctionIds.length,
          fromCache: true,
          error: 'Using stale data'
        };
      }
      
      throw error;
    }
  }

  /**
   * Fetch and cache auctions from Firestore
   * @param {string} groupId - The group ID
   * @param {string} status - Auction status
   * @param {number} page - Page number
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Auction results
   */
  static async fetchAndCacheAuctions(groupId, status, page, options = {}) {
    const { pageSize = this.PAGE_SIZE } = options;
    
    try {
      // Build Firestore query
      const auctionsRef = collection(db, 'auctions');
      let firestoreQuery;

      if (status === 'all') {
        firestoreQuery = query(
          auctionsRef,
          where('groupId', '==', groupId),
          orderBy('endTime', 'desc')
        );
      } else {
        firestoreQuery = query(
          auctionsRef,
          where('groupId', '==', groupId),
          where('status', '==', status),
          orderBy('endTime', 'desc')
        );
      }

      // Execute query
      const snapshot = await getDocs(firestoreQuery);
      const allAuctions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      console.log(`[SmartAuctionCacheManager] Fetched ${allAuctions.length} auctions for ${groupId}/${status}`);
      
      // Cache the complete auction list
      await this.cacheAuctionList(groupId, status, allAuctions);
      
      // Return requested page
      const startIndex = page * pageSize;
      const endIndex = startIndex + pageSize;
      const pageAuctions = allAuctions.slice(startIndex, endIndex);
      
      return {
        auctions: pageAuctions,
        hasMore: endIndex < allAuctions.length,
        fromCache: false,
        totalCount: allAuctions.length
      };
      
    } catch (error) {
      console.error(`[SmartAuctionCacheManager] Error fetching auctions from Firestore:`, error);
      throw error;
    }
  }

  /**
   * Cache the auction list for future pagination with smart TTL
   * @param {string} groupId - The group ID
   * @param {string} status - Auction status
   * @param {Array} auctions - Array of auction documents
   */
  static async cacheAuctionList(groupId, status, auctions) {
    try {
      const baseKey = `auctions_${groupId}_${status}`;
      const auctionIds = auctions.map(auction => auction.id);
      
      // Determine appropriate TTL based on auction states
      let listTTL = this.CACHE_TTL.AUCTION_LIST;
      
      if (status === 'completed') {
        listTTL = this.CACHE_TTL.COMPLETED_AUCTION;
      } else if (status === 'active') {
        // Check if any auctions are ending soon
        const hasCriticalAuctions = auctions.some(auction => {
          const endTime = auction.endTime?.toDate?.() || new Date(auction.endTime?.seconds * 1000);
          const timeRemaining = endTime ? endTime.getTime() - Date.now() : Infinity;
          return timeRemaining < 30 * 60 * 1000 && timeRemaining > 0;
        });
        
        if (hasCriticalAuctions) {
          listTTL = this.CACHE_TTL.CRITICAL_AUCTION;
          console.log(`[SmartAuctionCacheManager] Using critical TTL for ${baseKey} due to ending auctions`);
        }
      }
      
      // Cache the ID list for pagination
      await CacheService.setValue(`${baseKey}_list`, {
        auctionIds,
        lastUpdated: Date.now(),
        totalCount: auctions.length,
        cacheLevel: status === 'completed' ? 'stable' : hasCriticalAuctions ? 'critical' : 'normal'
      }, { ttl: listTTL });
      
      // Cache individual auction documents with smart TTL
      const cachePromises = auctions.map(auction => {
        const smartTTL = this.getSmartTTL(auction);
        return CacheService.setValue(`auctions:${auction.id}`, auction, {
          ttl: smartTTL
        }).catch(err => {
          console.warn(`Failed to cache auction ${auction.id}:`, err);
        });
      });
      
      await Promise.allSettled(cachePromises);
      
      // Log cache strategy for monitoring
      const ttlBreakdown = auctions.reduce((acc, auction) => {
        const ttl = this.getSmartTTL(auction);
        const level = ttl === this.CACHE_TTL.CRITICAL_AUCTION ? 'critical' :
                     ttl === this.CACHE_TTL.STABLE_AUCTION ? 'stable' :
                     ttl === this.CACHE_TTL.COMPLETED_AUCTION ? 'completed' : 'normal';
        acc[level] = (acc[level] || 0) + 1;
        return acc;
      }, {});
      
      console.log(`[SmartAuctionCacheManager] Cached ${auctions.length} auctions for ${baseKey}:`, ttlBreakdown);
      
    } catch (error) {
      console.error(`[SmartAuctionCacheManager] Error caching auction list:`, error);
    }
  }

  /**
   * Pre-compute auction lists for multiple statuses (background job)
   * @param {string} groupId - The group ID
   */
  static async preComputeAuctionLists(groupId) {
    console.log(`[SmartAuctionCacheManager] Pre-computing auction lists for group ${groupId}`);
    
    const statuses = ['active', 'completed', 'all'];
    const computePromises = statuses.map(async (status) => {
      try {
        await this.fetchAndCacheAuctions(groupId, status, 0);
        console.log(`[SmartAuctionCacheManager] Pre-computed ${status} auctions for group ${groupId}`);
      } catch (error) {
        console.warn(`[SmartAuctionCacheManager] Failed to pre-compute ${status} auctions:`, error);
      }
    });
    
    await Promise.allSettled(computePromises);
  }

  /**
   * Invalidate auction caches when auctions are modified
   * @param {string} groupId - The group ID
   * @param {string} auctionId - Specific auction ID (optional)
   */
  static async invalidateAuctionCaches(groupId, auctionId = null) {
    try {
      const statuses = ['active', 'completed', 'all'];
      
      // Clear auction list caches
      const listPromises = statuses.map(status =>
        CacheService.invalidate(`auctions_${groupId}_${status}_list`)
      );
      
      // Clear specific auction cache if provided
      if (auctionId) {
        listPromises.push(CacheService.invalidate(`auctions:${auctionId}`));
      }
      
      await Promise.allSettled(listPromises);
      
      console.log(`[SmartAuctionCacheManager] Invalidated auction caches for group ${groupId}${auctionId ? `, auction ${auctionId}` : ''}`);
      
    } catch (error) {
      console.error(`[SmartAuctionCacheManager] Error invalidating auction caches:`, error);
    }
  }

  /**
   * Get auction count with caching
   * @param {string} groupId - The group ID
   * @param {string} status - Auction status
   * @param {Object} options - Query options
   * @returns {Promise<number>} Number of auctions
   */
  static async getAuctionCount(groupId, status = 'active', options = {}) {
    const cacheKey = `auction_count_${groupId}_${status}`;
    
    return await CacheService.getOrSet(cacheKey, async () => {
      const result = await this.getAuctions(groupId, status, 0, { pageSize: 1, ...options });
      return result.totalCount || 0;
    }, { ttl: this.CACHE_TTL.AUCTION_LIST, ...options });
  }

  /**
   * Warm up caches for frequently accessed auction queries
   * @param {Array} groupIds - Array of group IDs to warm up
   */
  static async warmUpAuctionCaches(groupIds) {
    console.log(`[SmartAuctionCacheManager] Warming up auction caches for ${groupIds.length} groups`);
    
    const warmupPromises = groupIds.map(async (groupId) => {
      try {
        await this.preComputeAuctionLists(groupId);
        console.log(`[SmartAuctionCacheManager] Cache warmed for group ${groupId}`);
      } catch (error) {
        console.warn(`[SmartAuctionCacheManager] Failed to warm cache for group ${groupId}:`, error);
      }
    });
    
    await Promise.allSettled(warmupPromises);
  }

  /**
   * Get optimization metrics for monitoring
   * @returns {Object} Metrics object
   */
  static getMetrics() {
    return {
      serviceName: 'SmartAuctionCacheManager',
      optimizationTarget: 'Heavy auction pagination queries',
      expectedReadReduction: '65-75%',
      cacheKeys: [
        'auctions_*_list',
        'auctions:*',
        'auction_count_*'
      ],
      activeOptimizations: [
        'Pre-computed auction lists',
        'Smart pagination caching',
        'Individual auction document caching',
        'Background list maintenance'
      ]
    };
  }
}

export default SmartAuctionCacheManager; 