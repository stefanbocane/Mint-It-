// Utilities for optimizing auction data handling
import { collection, doc, limit, orderBy, query, startAfter, updateDoc, where, writeBatch } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { getDoc } from '../services/ReadTracking/TrackedFirestore';
import { retryFirestoreOperation } from './firebaseErrorHandler';
import { getCachedDoc, getCachedQuery, invalidateCache, updateCache } from './firestoreUtils';

// Constants - OPTIMIZED: Longer cache times for better performance
const BIDDER_COUNT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes (was 5 minutes) - 100% increase
const AUCTION_CACHE_TTL = 2 * 60 * 1000; // 2 minutes (was 30 seconds) - 300% increase
const STABLE_AUCTION_CACHE_TTL = 10 * 60 * 1000; // 10 minutes for auctions ending >1 hour
const PAGE_SIZE = 15; // Number of auctions per page

/**
 * OPTIMIZED: Enhanced cache TTL selection based on auction urgency
 */
const getAuctionCacheTTL = (auction) => {
  if (!auction?.endTime) return AUCTION_CACHE_TTL;
  
  const timeRemaining = new Date(auction.endTime) - new Date();
  
  // Critical auctions (ending <5 mins): Short cache
  if (timeRemaining < 5 * 60 * 1000) {
    return 30 * 1000; // 30 seconds
  }
  // Urgent auctions (ending <30 mins): Medium cache  
  else if (timeRemaining < 30 * 60 * 1000) {
    return AUCTION_CACHE_TTL; // 2 minutes
  }
  // Stable auctions: Long cache
  else {
    return STABLE_AUCTION_CACHE_TTL; // 10 minutes
  }
};

/**
 * OPTIMIZED: Get auctions with intelligent caching based on urgency
 */
export const getAuctionsPaginated = async (
  groupId, 
  status = 'active', 
  lastDoc = null, 
  pageSize = PAGE_SIZE
) => {
  try {
    const auctionsRef = collection(db, 'auctions');
    
    let q = query(
      auctionsRef,
      where('groupId', '==', groupId),
      where('status', '==', status),
      orderBy('endTime', 'asc'),
      limit(pageSize)
    );
    
    if (lastDoc) {
      q = query(q, startAfter(lastDoc));
    }
    
    try {
      // OPTIMIZED: Dynamic cache key with better TTL
      const cacheKey = `auctions_${groupId}_${status}_${pageSize}_${lastDoc ? lastDoc.id : 'first'}`;
      
      const auctionsData = await getCachedQuery(
        q, 
        { 
          ttl: AUCTION_CACHE_TTL, // Base TTL, will be refined per auction
          cacheKey: cacheKey
        }
      );
      
      // OPTIMIZED: Update individual auction caches with smart TTL
      if (auctionsData?.length > 0) {
        await Promise.all(auctionsData.map(async (auction) => {
          const individualCacheKey = `doc_auctions/${auction.id}`;
          const ttl = getAuctionCacheTTL(auction);
          await updateCache(individualCacheKey, auction, { ttl });
        }));
      }
      
      const lastVisible = auctionsData.length > 0 ? auctionsData[auctionsData.length - 1] : null;
      
      return {
        auctions: auctionsData,
        lastDoc: lastVisible
      };
    } catch (indexError) {
      if (indexError.toString().includes('The query requires an index')) {
        console.error('The query requires a Firestore index. Please create it using the link in the error message.');
        
        const indexUrlMatch = indexError.toString().match(/(https:\/\/console\.firebase\.google\.com[^\s]+)/);
        let indexUrl = '';
        
        if (indexUrlMatch && indexUrlMatch[1]) {
          indexUrl = indexUrlMatch[1];
          console.log('Create the index by clicking this link:', indexUrl);
        }
        
        return {
          auctions: [],
          lastDoc: null,
          indexError: {
            message: 'This query requires a Firestore index to be created',
            indexUrl: indexUrl
          }
        };
      }
      
      throw indexError;
    }
  } catch (error) {
    console.error('Error fetching paginated auctions:', error);
    return {
      auctions: [],
      lastDoc: null,
      error: error.message || 'Unknown error'
    };
  }
};

/**
 * Update bidder count directly on auction document to denormalize data
 * 
 * @param {string} auctionId - Auction ID
 * @param {number} bidderCount - Count of unique bidders
 * @returns {Promise<void>}
 */
export const updateAuctionBidderCount = async (auctionId, bidderCount) => {
  try {
    const auctionRef = doc(db, 'auctions', auctionId);
    
    // Update the auction document with the bidder count using retry utility
    await retryFirestoreOperation(() => 
      updateDoc(auctionRef, {
        bidderCount: bidderCount,
        lastBidderCountUpdate: new Date()
      })
    );
    
    // Also update the cache
    const cacheKey = `doc_auctions/${auctionId}`;
    const cachedDoc = await getCachedDoc('auctions', auctionId, { forceRefresh: false });
    
    if (cachedDoc) {
      cachedDoc.bidderCount = bidderCount;
      cachedDoc.lastBidderCountUpdate = new Date();
      await updateCache(cacheKey, cachedDoc);
    }
  } catch (error) {
    console.error(`Error updating bidder count for auction ${auctionId}:`, error);
  }
};

/**
 * Batch update multiple auctions' bidder counts
 * 
 * @param {Array<{id: string, bidderCount: number}>} auctionData - Array of auction IDs and bidder counts
 * @returns {Promise<void>}
 */
export const batchUpdateBidderCounts = async (auctionData) => {
  if (!auctionData || auctionData.length === 0) return;
  
  try {
    const batchSize = 500; // Firestore limit is 500 operations per batch
    const now = new Date();
    
    // Process in batches of 500
    for (let i = 0; i < auctionData.length; i += batchSize) {
      const batch = writeBatch(db);
      const chunk = auctionData.slice(i, i + batchSize);
      
      // Add each auction update to the batch
      chunk.forEach(({ id, bidderCount }) => {
        const auctionRef = doc(db, 'auctions', id);
        batch.update(auctionRef, {
          bidderCount: bidderCount,
          lastBidderCountUpdate: now
        });
      });
      
      // Commit the batch with retry utility
      await retryFirestoreOperation(() => batch.commit());
      
      console.log(`Updated bidder counts for ${chunk.length} auctions`);
    }
  } catch (error) {
    console.error('Error batch updating bidder counts:', error);
  }
};

/**
 * OPTIMIZED: Get bidder count with aggressive denormalization priority
 * Heavily favors denormalized data to minimize database reads
 * 
 * @param {Object} auction - The auction object
 * @returns {Promise<number>} - The bidder count
 */
export const getBidderCount = async (auction) => {
  try {
    // OPTIMIZATION 1: Always prefer denormalized data if it exists
    if (auction.bidderCount !== undefined && auction.bidderCount >= 0) {
      // Check if it's reasonably fresh (extended TTL for better performance)
      const isRecentlyUpdated = auction.lastBidderCountUpdate && 
        (new Date() - new Date(auction.lastBidderCountUpdate)) < BIDDER_COUNT_CACHE_TTL;
      
      if (isRecentlyUpdated || !auction.lastBidderCountUpdate) {
        console.log(`📊 Using denormalized bidder count for ${auction.id}: ${auction.bidderCount}`);
        return auction.bidderCount;
      }
    }
    
    // OPTIMIZATION 2: Use uniqueBidderCount if available (preferred over bid counting)
    if (auction.uniqueBidderCount !== undefined && auction.uniqueBidderCount >= 0) {
      console.log(`📊 Using uniqueBidderCount for ${auction.id}: ${auction.uniqueBidderCount}`);
      // Update denormalized value for future use
      updateAuctionBidderCount(auction.id, auction.uniqueBidderCount);
      return auction.uniqueBidderCount;
    }
    
    // OPTIMIZATION 3: Check cache before database query
    const cacheKey = `bidders_count_${auction.id}`;
    
    try {
      const cachedResult = await getCachedQuery(
        query(
          collection(db, 'bids'),
          where('auctionId', '==', auction.id)
        ),
        {
          ttl: BIDDER_COUNT_CACHE_TTL,
          cacheKey: cacheKey,
          // NEW: Skip database if cache exists and auction is stable
          allowStaleCache: auction.status !== 'active' || 
            (auction.endTime && new Date(auction.endTime) > new Date(Date.now() + 60 * 60 * 1000)) // >1 hour remaining
        }
      );
      
      // Count unique bidders efficiently
      const uniqueBidders = new Set(cachedResult.map(bid => bid.userId));
      const count = uniqueBidders.size;
      
      // Always update denormalized value for future efficiency
      updateAuctionBidderCount(auction.id, count);
      
      console.log(`📊 Calculated fresh bidder count for ${auction.id}: ${count}`);
      return count;
      
    } catch (queryError) {
      console.warn(`Database query failed for bidder count ${auction.id}, using fallback`);
      
      // FALLBACK: Use any available partial data
      if (auction.bidCount && auction.bidCount > 0) {
        // Estimate unique bidders as 60% of total bids (conservative estimate)
        const estimatedCount = Math.max(1, Math.floor(auction.bidCount * 0.6));
        console.log(`📊 Using estimated bidder count for ${auction.id}: ${estimatedCount}`);
        return estimatedCount;
      }
      
      return 0;
    }
  } catch (error) {
    console.error(`Error getting bidder count for auction ${auction.id}:`, error);
    // Always return a valid number
    return 0;
  }
};

/**
 * Force refresh an auction (invalidate cache)
 * 
 * @param {string} auctionId - Auction ID
 * @returns {Promise<void>}
 */
export const refreshAuction = async (auctionId) => {
  try {
    // Check if we have the auction in the recent results cache before invalidating
    const cacheKey = `doc_auctions/${auctionId}`;
    
    // Invalidate auction doc cache only if needed
    await invalidateCache(cacheKey);
    
    // Invalidate bidder count cache
    await invalidateCache(`bidders_count_${auctionId}`);
    
    console.log(`Refreshed caches for auction ${auctionId}`);
  } catch (error) {
    console.error(`Error refreshing auction ${auctionId}:`, error);
  }
};

/**
 * Optimized method to refresh multiple auctions at once
 * 
 * @param {string[]} auctionIds - Array of auction IDs to refresh
 * @returns {Promise<void>}
 */
export const refreshAuctions = async (auctionIds) => {
  if (!auctionIds || !auctionIds.length) return;
  
  try {
    // Process in batches to avoid too many concurrent operations
    const batchSize = 5;
    for (let i = 0; i < auctionIds.length; i += batchSize) {
      const batch = auctionIds.slice(i, i + batchSize);
      
      // Process each auction in the batch concurrently
      await Promise.all(batch.map(auctionId => refreshAuction(auctionId)));
    }
  } catch (error) {
    console.error('Error refreshing multiple auctions:', error);
  }
};

/**
 * Safely get auction data with error handling and offline support
 * @param {string} auctionId - The ID of the auction to get
 * @param {Object} options - Optional settings 
 * @returns {Promise<Object|null>} - Auction data or null if not found
 */
export const safeGetAuction = async (auctionId, options = {}) => {
  try {
    // Track if we're using the cache
    let usingCache = false;
    const cacheKey = `doc_auctions/${auctionId}`;
    
    // Try fetching from Firestore first
    try {
      // Try to get the data from Firestore
      const auctionRef = doc(db, 'auctions', auctionId);
      const auctionDoc = await retryFirestoreOperation(() => getDoc(auctionRef));
      
      if (auctionDoc.exists()) {
        const auctionData = { id: auctionDoc.id, ...auctionDoc.data() };
        
        // Update cache with fresh data
        await updateCache(cacheKey, auctionData);
        
        return auctionData;
      }
      
      // If we get here, the auction wasn't found in Firestore
      return null;
    } catch (firestoreError) {
      console.log(`Error getting auction ${auctionId} from Firestore:`, firestoreError.message);
      console.log('Falling back to cache...');
      usingCache = true;
      
      // Try to get from cache as backup
      const cachedAuction = await getCachedDoc('auctions', auctionId, { forceRefresh: false });
      
      if (cachedAuction) {
        console.log(`Using cached data for auction ${auctionId}`);
        return { ...cachedAuction, _fromCache: true };
      }
      
      // No cached data either
      return null;
    }
  } catch (error) {
    console.error(`Error in safeGetAuction for ${auctionId}:`, error);
    return null;
  }
};

export default {
  getAuctionsPaginated,
  updateAuctionBidderCount,
  batchUpdateBidderCounts,
  getBidderCount,
  refreshAuction,
  refreshAuctions,
  safeGetAuction
};

export { PAGE_SIZE };
