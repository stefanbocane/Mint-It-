// Utilities for optimizing auction data handling
import { collection, doc, getDoc, limit, orderBy, query, startAfter, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';
import { retryFirestoreOperation } from './firebaseErrorHandler';
import { getCachedDoc, getCachedQuery, invalidateCache, updateCache } from './firestoreUtils';

// Constants
const BIDDER_COUNT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const AUCTION_CACHE_TTL = 30 * 1000; // 30 seconds
const PAGE_SIZE = 15; // Number of auctions per page

/**
 * Get auctions with pagination
 * 
 * @param {string} groupId - Group ID
 * @param {string} status - Auction status (active, completed, etc)
 * @param {Object} lastDoc - Last document for pagination (null for first page)
 * @param {number} pageSize - Number of items per page
 * @returns {Promise<{auctions: Array, lastDoc: Object}>} - Auctions and last document for pagination
 */
export const getAuctionsPaginated = async (
  groupId, 
  status = 'active', 
  lastDoc = null, 
  pageSize = PAGE_SIZE
) => {
  try {
    const auctionsRef = collection(db, 'auctions');
    
    // NOTE: This query requires a composite index on Firestore
    // Fields: groupId (asc), status (asc), endTime (asc), __name__ (asc)
    // You can create it by visiting the link in the error message
    // or by going to Firebase Console -> Firestore -> Indexes -> Composite
    let q = query(
      auctionsRef,
      where('groupId', '==', groupId),
      where('status', '==', status),
      orderBy('endTime', 'asc'),
      limit(pageSize)
    );
    
    // Apply pagination if lastDoc is provided
    if (lastDoc) {
      q = query(q, startAfter(lastDoc));
    }
    
    try {
      // Get auctions with caching
      const auctionsData = await getCachedQuery(
        q, 
        { 
          ttl: AUCTION_CACHE_TTL,
          cacheKey: `auctions_${groupId}_${status}_page_${lastDoc ? lastDoc.id : 'first'}`
        }
      );
      
      const lastVisible = auctionsData.length > 0 ? auctionsData[auctionsData.length - 1] : null;
      
      return {
        auctions: auctionsData,
        lastDoc: lastVisible
      };
    } catch (indexError) {
      // Check if the error is related to missing index
      if (indexError.toString().includes('The query requires an index')) {
        console.error('The query requires a Firestore index. Please create it using the link in the error message.');
        
        // Create a more friendly error object with instructions
        const indexUrlMatch = indexError.toString().match(/(https:\/\/console\.firebase\.google\.com[^\s]+)/);
        let indexUrl = '';
        
        if (indexUrlMatch && indexUrlMatch[1]) {
          indexUrl = indexUrlMatch[1];
          console.log('Create the index by clicking this link:', indexUrl);
        }
        
        // Return empty results for now
        return {
          auctions: [],
          lastDoc: null,
          indexError: {
            message: 'This query requires a Firestore index to be created',
            indexUrl: indexUrl
          }
        };
      }
      
      // If it's a different error, re-throw it
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
 * Get bidder count for an auction with caching
 * Uses the denormalized value if available and recent
 * Otherwise, counts from bids collection
 * 
 * @param {Object} auction - The auction object
 * @returns {Promise<number>} - The bidder count
 */
export const getBidderCount = async (auction) => {
  try {
    // First check if the auction already has a recent bidder count
    if (
      auction.bidderCount !== undefined && 
      auction.lastBidderCountUpdate &&
      (new Date() - new Date(auction.lastBidderCountUpdate)) < BIDDER_COUNT_CACHE_TTL
    ) {
      return auction.bidderCount;
    }
    
    // Otherwise, count from bids
    const cacheKey = `bidders_count_${auction.id}`;
    
    return getCachedQuery(
      query(
        collection(db, 'bids'),
        where('auctionId', '==', auction.id)
      ),
      {
        ttl: BIDDER_COUNT_CACHE_TTL,
        cacheKey: cacheKey
      }
    ).then(bids => {
      // Count unique bidders
      const uniqueBidders = new Set(bids.map(bid => bid.userId));
      const count = uniqueBidders.size;
      
      // Update the denormalized value
      updateAuctionBidderCount(auction.id, count);
      
      return count;
    });
  } catch (error) {
    console.error(`Error getting bidder count for auction ${auction.id}:`, error);
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
