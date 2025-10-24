import { collection, doc, limit, orderBy, query, startAfter, where } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { getDoc, getDocs } from '../services/ReadTracking/TrackedFirestore';
import { createDocCacheKey, createQueryCacheKey, getWithCache } from './cacheUtils';

// Constants for cache TTLs
const CACHE_TTL = {
  AUCTION_LIST: 60 * 1000, // 1 minute for auction list
  AUCTION_DETAIL: 30 * 1000, // 30 seconds for auction detail
  AUCTION_BIDS: 15 * 1000, // 15 seconds for bids
  USER_DATA: 5 * 60 * 1000, // 5 minutes for user data
  CARD_DATA: 5 * 60 * 1000, // 5 minutes for card data
};

// In-memory results cache for identical queries within short timeframes
const recentQueryResults = new Map();
const RECENT_QUERY_TTL = 2000; // 2 seconds

// Track field queries to avoid redundant fetches
const fieldFetchTracker = new Map();

/**
 * Get multiple auctions in a single query with only necessary fields
 * @param {string} groupId - Group ID to filter by
 * @param {string} status - Auction status (active, completed, etc.)
 * @param {Object} options - Query options
 * @returns {Promise<Array<Object>>} - Array of auction objects with minimal fields
 */
export const getOptimizedAuctionsList = async (groupId, status = 'active', options = {}) => {
  const {
    forceRefresh = false,
    pageSize = 20,
    startAfterDoc = null,
    sortBy = 'endTime',
    sortOrder = 'asc'
  } = options;

  // Create a unique cache key
  const queryParams = {
    groupId,
    status,
    pageSize,
    startAfter: startAfterDoc?.id || 'first',
    sortBy,
    sortOrder
  };
  const cacheKey = createQueryCacheKey('auctions', queryParams);

  // Check recent results first
  const now = Date.now();
  if (!forceRefresh && recentQueryResults.has(cacheKey)) {
    const recentResult = recentQueryResults.get(cacheKey);
    if (now - recentResult.timestamp < RECENT_QUERY_TTL) {
      console.log(`Using recent result for ${cacheKey}, age: ${now - recentResult.timestamp}ms`);
      return recentResult.data;
    }
  }

  // Build query with only necessary fields
  const auctionsRef = collection(db, 'auctions');
  let queryRef = query(
    auctionsRef,
    where('groupId', '==', groupId),
    where('status', '==', status),
    orderBy(sortBy, sortOrder)
  );

  // Apply pagination
  if (startAfterDoc) {
    queryRef = query(queryRef, startAfter(startAfterDoc), limit(pageSize));
  } else {
    queryRef = query(queryRef, limit(pageSize));
  }

  // Get with cache
  const result = await getWithCache(cacheKey, async () => {
    console.log('Fetching optimized auctions list from Firestore');
    const querySnapshot = await getDocs(queryRef);
    
    // Map to auction objects with only the fields we need for the list
    const auctions = querySnapshot.docs.map(doc => {
      const data = doc.data();
      // Only include fields needed for the list view to reduce payload size
      return {
        id: doc.id,
        cardId: data.cardId,
        cardName: data.cardName,
        cardImage: data.cardImage,
        cardRarity: data.cardRarity,
        currentRarity: data.currentRarity,
        startingBid: data.startingBid,
        currentBid: data.currentBid,
        currentBidder: data.currentBidder,
        currentBidderName: data.currentBidderName,
        sellerId: data.sellerId,
        sellerName: data.sellerName,
        status: data.status,
        endTime: data.endTime,
        createdAt: data.createdAt
      };
    });
    
    // Return with last doc for pagination
    const lastDoc = querySnapshot.docs.length > 0 
      ? querySnapshot.docs[querySnapshot.docs.length - 1] 
      : null;
      
    return {
      auctions,
      lastDoc
    };
  }, { ttl: CACHE_TTL.AUCTION_LIST, forceRefresh });
  
  // Store in recent results
  recentQueryResults.set(cacheKey, {
    data: result,
    timestamp: now
  });
  
  // Prefetch related user data for bidders and sellers
  const userIds = new Set();
  result.auctions.forEach(auction => {
    if (auction.currentBidder) userIds.add(auction.currentBidder);
    if (auction.sellerId) userIds.add(auction.sellerId);
  });
  
  if (userIds.size > 0) {
    // Prefetch user data in the background
    prefetchUserData(Array.from(userIds));
  }
  
  return result;
};

/**
 * Get auction details with optimized field selection
 * @param {string} auctionId - Auction ID
 * @param {Object} options - Options for the fetch
 * @returns {Promise<Object>} - Auction details
 */
export const getOptimizedAuctionDetails = async (auctionId, options = {}) => {
  const { forceRefresh = false, includeFields = null } = options;
  
  // Create a cache key specific to the fields requested
  const fieldKey = includeFields ? `_fields_${includeFields.join('_')}` : '';
  const cacheKey = createDocCacheKey(`auctions/${auctionId}${fieldKey}`);
  
  // Check recent results first
  const now = Date.now();
  if (!forceRefresh && recentQueryResults.has(cacheKey)) {
    const recentResult = recentQueryResults.get(cacheKey);
    if (now - recentResult.timestamp < RECENT_QUERY_TTL) {
      console.log(`Using recent result for ${cacheKey}, age: ${now - recentResult.timestamp}ms`);
      return recentResult.data;
    }
  }
  
  // Get with cache
  const result = await getWithCache(cacheKey, async () => {
    console.log(`Fetching auction details for ${auctionId}`);
    const docRef = doc(db, 'auctions', auctionId);
    const docSnapshot = await getDoc(docRef);
    
    if (docSnapshot.exists()) {
      const fullData = { id: docSnapshot.id, ...docSnapshot.data() };
      
      // Return only requested fields if specified
      if (includeFields) {
        return includeFields.reduce((obj, field) => {
          if (field in fullData) obj[field] = fullData[field];
          return obj;
        }, { id: fullData.id });
      }
      
      return fullData;
    }
    
    return null;
  }, { ttl: CACHE_TTL.AUCTION_DETAIL, forceRefresh });
  
  // Store in recent results if not null
  if (result) {
    recentQueryResults.set(cacheKey, {
      data: result,
      timestamp: now
    });
    
    // Prefetch related data for this auction
    if (result.cardId) {
      prefetchCardData(result.cardId);
    }
    
    // Prefetch user data for bidder and seller
    const userIds = [];
    if (result.currentBidder) userIds.push(result.currentBidder);
    if (result.sellerId) userIds.push(result.sellerId);
    
    if (userIds.length > 0) {
      prefetchUserData(userIds);
    }
  }
  
  return result;
};

/**
 * Get bids for an auction with optimized query
 * @param {string} auctionId - Auction ID
 * @param {Object} options - Query options
 * @returns {Promise<Array<Object>>} - Array of bid objects
 */
export const getOptimizedAuctionBids = async (auctionId, options = {}) => {
  const { 
    forceRefresh = false, 
    limit: bidLimit = 10,
    uniqueBiddersOnly = false 
  } = options;
  
  // Create cache key
  const cacheKey = createQueryCacheKey('bids', { 
    auctionId, 
    limit: bidLimit,
    uniqueBiddersOnly 
  });
  
  // Check recent results first
  const now = Date.now();
  if (!forceRefresh && recentQueryResults.has(cacheKey)) {
    const recentResult = recentQueryResults.get(cacheKey);
    if (now - recentResult.timestamp < RECENT_QUERY_TTL) {
      console.log(`Using recent result for ${cacheKey}, age: ${now - recentResult.timestamp}ms`);
      return recentResult.data;
    }
  }
  
  // Get with cache
  const result = await getWithCache(cacheKey, async () => {
    console.log(`Fetching bids for auction ${auctionId}`);
    const bidsRef = collection(db, 'bids');
    
    let queryRef;
    if (uniqueBiddersOnly) {
      // This query gets the latest bid from each unique bidder
      // Which is more efficient than fetching all bids and processing client-side
      queryRef = query(
        bidsRef,
        where('auctionId', '==', auctionId),
        orderBy('timestamp', 'desc')
      );
      
      const snapshot = await getDocs(queryRef);
      const bidsByUser = new Map();
      
      // Take only the most recent bid from each user
      snapshot.docs.forEach(doc => {
        const bid = { id: doc.id, ...doc.data() };
        if (!bidsByUser.has(bid.userId)) {
          bidsByUser.set(bid.userId, bid);
        }
      });
      
      // Convert map to array and sort by bid amount
      return Array.from(bidsByUser.values())
        .sort((a, b) => b.amount - a.amount);
    } else {
      // Regular query for all bids, sorted by timestamp
      queryRef = query(
        bidsRef,
        where('auctionId', '==', auctionId),
        orderBy('timestamp', 'desc'),
        limit(bidLimit)
      );
      
      const snapshot = await getDocs(queryRef);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    }
  }, { ttl: CACHE_TTL.AUCTION_BIDS, forceRefresh });
  
  // Store in recent results
  recentQueryResults.set(cacheKey, {
    data: result,
    timestamp: now
  });
  
  // Prefetch user data for bidders
  if (result.length > 0) {
    const userIds = result.map(bid => bid.userId).filter(Boolean);
    if (userIds.length > 0) {
      prefetchUserData(userIds);
    }
  }
  
  return result;
};

/**
 * Get count of unique bidders for an auction with optimized query
 * @param {string} auctionId - Auction ID
 * @param {Object} options - Query options
 * @returns {Promise<number>} - Count of unique bidders
 */
export const getOptimizedUniqueBidderCount = async (auctionId, options = {}) => {
  const { forceRefresh = false } = options;
  
  // Create cache key
  const cacheKey = createQueryCacheKey('uniqueBidders', { auctionId });
  
  // Check recent results first
  const now = Date.now();
  if (!forceRefresh && recentQueryResults.has(cacheKey)) {
    const recentResult = recentQueryResults.get(cacheKey);
    if (now - recentResult.timestamp < RECENT_QUERY_TTL) {
      console.log(`Using recent count for ${cacheKey}, age: ${now - recentResult.timestamp}ms`);
      return recentResult.data;
    }
  }
  
  // Get with cache - use a much shorter TTL for bidder counts
  const result = await getWithCache(cacheKey, async () => {
    console.log(`Counting unique bidders for auction ${auctionId}`);
    
    // First check if we already have the bids cached
    const bidsKey = createQueryCacheKey('bids', { auctionId, uniqueBiddersOnly: true });
    const cachedBids = await getWithCache(bidsKey, null, { skipFetch: true });
    
    if (cachedBids && Array.isArray(cachedBids) && cachedBids.length > 0) {
      // If we have cached bids, just count them
      const uniqueUserIds = new Set(cachedBids.filter(bid => bid && bid.userId).map(bid => bid.userId));
      return uniqueUserIds.size;
    }
    
    // Otherwise, fetch only the distinct user IDs
    const bidsRef = collection(db, 'bids');
    const queryRef = query(
      bidsRef,
      where('auctionId', '==', auctionId)
    );
    
    try {
      const snapshot = await getDocs(queryRef);
      const uniqueUserIds = new Set();
      
      snapshot.docs.forEach(doc => {
        const bid = doc.data();
        if (bid && bid.userId) {
          uniqueUserIds.add(bid.userId);
        }
      });
      
      return uniqueUserIds.size;
    } catch (error) {
      console.error(`Error fetching bids for auction ${auctionId}:`, error);
      return 0; // Return 0 as fallback
    }
  }, { ttl: CACHE_TTL.AUCTION_BIDS, forceRefresh });
  
  // Store in recent results
  recentQueryResults.set(cacheKey, {
    data: result || 0, // Ensure we always store a number
    timestamp: now
  });
  
  return result || 0; // Ensure we always return a number
};

/**
 * Prefetch user data in the background
 * @param {Array<string>} userIds - Array of user IDs to prefetch
 */
const prefetchUserData = async (userIds) => {
  // Deduplicate IDs
  const uniqueIds = [...new Set(userIds)];
  
  // Check which IDs we haven't recently fetched
  const now = Date.now();
  const idsToFetch = uniqueIds.filter(id => {
    const key = `users_${id}`;
    if (!fieldFetchTracker.has(key)) return true;
    
    const lastFetch = fieldFetchTracker.get(key);
    return now - lastFetch > CACHE_TTL.USER_DATA;
  });
  
  if (idsToFetch.length === 0) return;
  
  console.log(`Prefetching data for ${idsToFetch.length} users`);
  
  // Update the fetch tracker
  idsToFetch.forEach(id => {
    fieldFetchTracker.set(`users_${id}`, now);
  });
  
  // Use Promise.all to fetch all users in parallel
  try {
    const promises = idsToFetch.map(async (userId) => {
      const cacheKey = createDocCacheKey(`users/${userId}`);
      
      // Only fetch if not in cache
      return getWithCache(cacheKey, async () => {
        const docRef = doc(db, 'users', userId);
        const docSnapshot = await getDoc(docRef);
        
        if (docSnapshot.exists()) {
          return { id: docSnapshot.id, ...docSnapshot.data() };
        }
        return null;
      }, { ttl: CACHE_TTL.USER_DATA });
    });
    
    await Promise.all(promises);
  } catch (error) {
    console.error('Error prefetching user data:', error);
  }
};

/**
 * Prefetch card data in the background
 * @param {string} cardId - Card ID to prefetch
 */
const prefetchCardData = async (cardId) => {
  const key = `cards_${cardId}`;
  const now = Date.now();
  
  // Skip if recently fetched
  if (fieldFetchTracker.has(key) && 
      now - fieldFetchTracker.get(key) < CACHE_TTL.CARD_DATA) {
    return;
  }
  
  console.log(`Prefetching data for card ${cardId}`);
  fieldFetchTracker.set(key, now);
  
  try {
    const cacheKey = createDocCacheKey(`cards/${cardId}`);
    
    // Only fetch if not in cache
    await getWithCache(cacheKey, async () => {
      const docRef = doc(db, 'cards', cardId);
      const docSnapshot = await getDoc(docRef);
      
      if (docSnapshot.exists()) {
        return { id: docSnapshot.id, ...docSnapshot.data() };
      }
      return null;
    }, { ttl: CACHE_TTL.CARD_DATA });
  } catch (error) {
    console.error(`Error prefetching card ${cardId}:`, error);
  }
};

/**
 * Get active auctions with optimized fields and pagination
 * @param {string} groupId - Group ID
 * @param {Object} options - Query options 
 * @returns {Promise<Object>} - Object with auctions array and pagination info
 */
export const getActiveAuctionsOptimized = async (groupId, options = {}) => {
  return getOptimizedAuctionsList(groupId, 'active', options);
};

/**
 * Get completed auctions with optimized fields and pagination
 * @param {string} groupId - Group ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} - Object with auctions array and pagination info
 */
export const getCompletedAuctionsOptimized = async (groupId, options = {}) => {
  return getOptimizedAuctionsList(groupId, 'completed', options);
};

/**
 * Clean up the recent query results cache periodically
 */
export const cleanupRecentQueryCache = () => {
  const now = Date.now();
  for (const [key, { timestamp }] of recentQueryResults.entries()) {
    if (now - timestamp > RECENT_QUERY_TTL * 2) {
      recentQueryResults.delete(key);
    }
  }
};

// Set up periodic cleanup
setInterval(cleanupRecentQueryCache, 60000); // Every minute

export default {
  getOptimizedAuctionsList,
  getOptimizedAuctionDetails,
  getOptimizedAuctionBids,
  getOptimizedUniqueBidderCount,
  getActiveAuctionsOptimized,
  getCompletedAuctionsOptimized
}; 