import { collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../config/firebase';
// Import named exports to avoid default import issues
import BidderManagementService from '../services/auctions/BidderManagementService';
import { createBatch } from '../services/BatchService';
import {
    getDocument,
    getValue,
    invalidate,
    setValue,
    setValueSync
} from '../services/caching/CacheService';
import { handleError, withErrorHandling } from '../services/ErrorHandlingService';

// For debug logging
const RARITY_LOG = 'RARITY SYSTEM:';

// Define rarity types for determination after auction
// IMPORTANT: All rarity calculations default to COMMON to avoid issues
export const RARITY_TYPES = {
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary',
  MYTHIC: 'mythic'
};

/**
 * OPTIMIZED: Streamlined rarity calculation with aggressive caching
 * Reduces computation overhead and provides consistent results
 * 
 * @param {Object} auction - The auction object with current bid and bidder data
 * @param {number} uniqueBidderCount - Count of unique bidders (excluding seller)
 * @returns {string} - Returns a valid rarity string, defaults to 'common'
 */
export const calculateLiveRarity = (auction, uniqueBidderCount) => {
  try {
    if (!auction) {
      return RARITY_TYPES.COMMON;
    }
    
    // OPTIMIZATION 1: Use cached rarity for non-active auctions
    if (auction.status !== 'active') {
      return auction.finalRarity || auction.currentRarity || auction.cardRarity || RARITY_TYPES.COMMON;
    }
    
    // OPTIMIZATION 2: Fast path for auctions with no bids
    if (!auction.currentBid && !auction.finalBid && !uniqueBidderCount && !auction.uniqueBidderCount) {
      return auction.cardRarity || RARITY_TYPES.COMMON;
    }
    
    // OPTIMIZATION 3: Simplified data extraction
    const currentRarity = auction.currentRarity || auction.cardRarity || RARITY_TYPES.COMMON;
    const bidAmount = Math.max(
      parseInt(auction.currentBid) || 0,
      parseInt(auction.finalBid) || 0
    );
    
    const bidderCount = Math.max(
      uniqueBidderCount || 0,
      auction.uniqueBidderCount || 0,
      Math.min(auction.bidCount || 0, 3) // Cap to avoid inflation
    );
    
    // OPTIMIZATION 4: Lookup-based rarity calculation (much faster than if-else chains)
    const rarityMatrix = [
      // [minBid, minBidders, rarity]
      [50, 3, RARITY_TYPES.LEGENDARY],
      [30, 2, RARITY_TYPES.EPIC],
      [20, 2, RARITY_TYPES.RARE],
      [10, 0, RARITY_TYPES.UNCOMMON],
      [0, 2, RARITY_TYPES.UNCOMMON],
    ];
    
    let calculatedRarity = RARITY_TYPES.COMMON;
    for (const [minBid, minBidders, rarity] of rarityMatrix) {
      if (bidAmount >= minBid && bidderCount >= minBidders) {
        calculatedRarity = rarity;
        break;
      }
    }
    
    // OPTIMIZATION 5: Quick hierarchy check using numeric levels
    const rarityLevels = {
      [RARITY_TYPES.COMMON]: 1,
      [RARITY_TYPES.UNCOMMON]: 2, 
      [RARITY_TYPES.RARE]: 3,
      [RARITY_TYPES.EPIC]: 4,
      [RARITY_TYPES.LEGENDARY]: 5,
      [RARITY_TYPES.MYTHIC]: 6
    };
    
    // Only upgrade rarity, never downgrade
    const currentLevel = rarityLevels[currentRarity] || 1;
    const calculatedLevel = rarityLevels[calculatedRarity] || 1;
    
    return calculatedLevel > currentLevel ? calculatedRarity : currentRarity;
    
  } catch (error) {
    console.error('RARITY SYSTEM ERROR:', error);
    return RARITY_TYPES.COMMON;
  }
};

/**
 * Get unique bidder count for an auction from the database
 * Returns a reliable count of unique bidders for rarity calculation
 * 
 * @param {string} auctionId - The ID of the auction to count bidders for
 * @param {string} sellerId - Optional seller ID to exclude from count
 * @param {object} [providedAuctionData] - Optional pre-fetched auction data
 * @returns {Promise<number>} - Returns a promise that resolves to the bidder count
 */
export const getUniqueBidderCount = withErrorHandling(async (auctionId, sellerId = null, providedAuctionData = null) => {
  if (!auctionId) return 0;
  
  try {
    const cacheKey = `bidderCount_${auctionId}_${sellerId || 'noSeller'}`;
    
    let cachedCount = await getValue(cacheKey);
    if (cachedCount !== null && cachedCount !== undefined) {
      console.log(`${RARITY_LOG} Using cached bidder count for ${auctionId}: ${cachedCount}`);
      return parseInt(cachedCount);
    }

    // If auctionData is provided and has uniqueBidderCount, use it
    if (providedAuctionData && typeof providedAuctionData.uniqueBidderCount === 'number' && providedAuctionData.uniqueBidderCount >= 0) {
      console.log(`${RARITY_LOG} Using uniqueBidderCount from providedAuctionData for ${auctionId}: ${providedAuctionData.uniqueBidderCount}`);
      await setValue(cacheKey, providedAuctionData.uniqueBidderCount, { ttl: 5 * 60 });
      return providedAuctionData.uniqueBidderCount;
    }
    
    // Fallback to CacheService.getDocument if not provided or no count on provided data
    const auctionDocData = await getDocument('auctions', auctionId);
    if (auctionDocData && typeof auctionDocData.uniqueBidderCount === 'number' && auctionDocData.uniqueBidderCount >= 0) {
      console.log(`${RARITY_LOG} Using uniqueBidderCount from auction document for ${auctionId}: ${auctionDocData.uniqueBidderCount}`);
      await setValue(cacheKey, auctionDocData.uniqueBidderCount, { ttl: 5 * 60 });
      return auctionDocData.uniqueBidderCount;
    }

    // If not in cache and not available on the auction document, query all bids for this auction as a fallback
    console.log(`${RARITY_LOG} Unique bidder count not cached or on auction document. Querying auctionBids for ${auctionId}.`);
    const bidsQuery = query(
      collection(db, 'auctionBids'),
      where('auctionId', '==', auctionId)
    );
    
    // Fetch documents directly from Firestore since we're in the fallback path
    // If query result caching (Suggestion 3) is implemented, this would use CacheService.getQuery
    const bidsSnapshot = await getDocs(bidsQuery);
    
    // Count unique bidders, excluding the seller
    const uniqueBidders = new Set();
    bidsSnapshot.docs.forEach(doc => {
      const bidData = doc.data();
      if (bidData.bidderId && 
          (!sellerId || bidData.bidderId !== sellerId)) {
        uniqueBidders.add(bidData.bidderId);
      }
    });
    
    const count = uniqueBidders.size;
    
    // Store the calculated count in cache for future use
    try {
      // Using setValue from CacheService
      await setValue(cacheKey, count, { ttl: 5 * 60 }); // 5 minute cache
    } catch (cacheError) {
      console.log(`${RARITY_LOG} Failed to cache calculated bidder count: ${cacheError.message}`);
      // Continue without caching
    }
    
    return count;
  } catch (error) {
    // Use ErrorHandlingService instead of console.error
    handleError(error, {
      context: 'Rarity System',
      operation: 'Getting unique bidder count',
      additionalData: { auctionId }
    });
    return 0;
  }
}, {
  context: 'Rarity System',
  operation: 'getUniqueBidderCount'
});

/**
 * Update an auction's rarity directly in the database
 * This is a standalone function that can be called to force an immediate rarity update
 * 
 * @param {string} auctionId - The ID of the auction to update rarity for
 * @param {object} [options] - Optional parameters
 * @param {object} [options.providedAuctionData] - Optional pre-fetched auction data
 * @param {number} [options.providedBidderCount] - Optional pre-fetched bidder count
 * @returns {Promise<string>} - Returns a promise that resolves to the new rarity
 */
export const updateAuctionRarity = withErrorHandling(async (auctionId, { providedAuctionData = null, providedBidderCount = null } = {}) => {
  if (!auctionId) {
    handleError(new Error('Cannot update rarity for undefined auction ID'), {
      context: 'Rarity System',
      operation: 'updateAuctionRarity',
      errorType: 'validation'
    });
    return RARITY_TYPES.COMMON;
  }
  
  console.log(`${RARITY_LOG} Force updating rarity for auction ${auctionId}`);
  
  // Step 1: Get the auction data
  let auctionData = providedAuctionData;

  if (!auctionData) {
    console.log(`${RARITY_LOG} No providedAuctionData, using CacheService.getDocument to fetch auction ${auctionId}`);
    try {
      auctionData = await getDocument('auctions', auctionId, { forceRefresh: true }); 
    } catch (fetchError) {
      console.error(`${RARITY_LOG} Error fetching auction ${auctionId} using CacheService: ${fetchError.message}`);
      throw fetchError;
    }
  } else {
    console.log(`${RARITY_LOG} Using providedAuctionData for auction ${auctionId}`);
    // Ensure the provided data has an ID, consistent with getDocument
    if (!auctionData.id && auctionId) {
        auctionData.id = auctionId;
    }
  }
  
  if (!auctionData) {
    handleError(new Error(`Auction ${auctionId} not found via CacheService`), {
      context: 'Rarity System',
      operation: 'updateAuctionRarity',
      errorType: 'not_found'
    });
    return RARITY_TYPES.COMMON;
  }
  
  // Add ID to the auction data if not already present (getDocument should add it)
  if (!auctionData.id) {
      auctionData.id = auctionId;
  }
  
  // IMPORTANT: For newly created/coined cards that have unknown rarity,
  // we'll convert them to COMMON as baseline but ONLY if they don't have valid bids yet
  // If they have bids, we MUST calculate based on bid activity
  const hasBidActivity = auctionData.currentBid > 0 || (auctionData.uniqueBidderCount && auctionData.uniqueBidderCount > 0);
  
  // Initialize a batch operation for related updates
  const batch = createBatch();
  
  if (!hasBidActivity && (!auctionData.cardRarity || auctionData.cardRarity === 'unknown')) {
    console.log(`${RARITY_LOG} Converting unknown to COMMON for auction ${auctionId} (no bids yet)`);
    auctionData.cardRarity = RARITY_TYPES.COMMON;
    
    // Also update the card itself to ensure it's COMMON instead of unknown
    if (auctionData.cardId) {
      const cardRef = doc(db, 'cards', auctionData.cardId);
      batch.update(cardRef, {
        rarity: RARITY_TYPES.COMMON,
        lastRarityUpdate: serverTimestamp()
      });
      
      // We'll do thorough cache invalidation after the batch commits
      // instead of here to ensure atomicity and prevent partial updates
      console.log(`${RARITY_LOG} Batched card ${auctionData.cardId} rarity update to COMMON`);
    }
  }
  
  // IMPORTANT: If current rarity is still unknown but we have bid activity, force an update
  if (hasBidActivity && !auctionData.currentRarity) {
    console.log(`${RARITY_LOG} Found missing currentRarity with bid activity for auction ${auctionId} - will force recalculation`);
  }
  
  // Don't update completed/canceled auctions
  if (auctionData.status !== 'active') {
    console.log(`${RARITY_LOG} Skipping inactive auction ${auctionId} (${auctionData.status})`);
    return auctionData.currentRarity || RARITY_TYPES.COMMON;
  }
  
  // Step 2: Get unique bidder count using the optimized BidderManagementService
  let bidderCount;
  if (providedBidderCount !== null && providedBidderCount !== undefined) {
    console.log(`${RARITY_LOG} Using provided bidder count ${providedBidderCount} for auction ${auctionId}`);
    bidderCount = providedBidderCount;
  } else {
    console.log(`${RARITY_LOG} Fetching bidder count for auction ${auctionId} in updateAuctionRarity`);
    bidderCount = await BidderManagementService.getUniqueBidderCount(auctionId, auctionData.sellerId);
  }
  
  // Step 3: Calculate new rarity based on bid activity
  const newRarity = calculateLiveRarity(auctionData, bidderCount);
  console.log(`${RARITY_LOG} Calculated new rarity ${newRarity} for auction ${auctionId}`);
  
  // Step 4: Update the auction in the database with the new rarity
  // CRITICAL: For auctions with bids, we ALWAYS use the calculated rarity
  // and we make sure to update BOTH currentRarity AND cardRarity to the same value
  // This ensures consistency and prevents the rarity from reverting
  batch.update(doc(db, 'auctions', auctionId), {
    currentRarity: newRarity,
    uniqueBidderCount: bidderCount,
    lastRarityUpdate: serverTimestamp(),
    // IMPORTANT: If there's bid activity, update cardRarity to match currentRarity
    // This ensures the rarity calculation won't revert back due to cardRarity
    cardRarity: hasBidActivity ? newRarity : (auctionData.cardRarity || RARITY_TYPES.COMMON)
  });
  
  // Also update the card document if it exists and there's bid activity
  if (hasBidActivity && auctionData.cardId) {
    const cardRef = doc(db, 'cards', auctionData.cardId);
    batch.update(cardRef, {
      rarity: newRarity,  // Set card rarity to match the auction
      lastRarityUpdate: serverTimestamp()
    });
    
    // We'll do thorough cache invalidation after the batch commits
    // to ensure atomicity and prevent partial updates
    console.log(`${RARITY_LOG} Batched card ${auctionData.cardId} rarity update to ${newRarity} to match auction`);
  }
  
  // Commit all the updates in a single batch
  try {
    // Directly commit the Firestore batch
    await batch.commit();
    
    // CRITICAL: After successful commit, perform thorough cache invalidation
    // for both auction and card to prevent race conditions
    const invalidationPromises = [];
    
    // Invalidate auction cache with multiple approaches to ensure consistency
    invalidationPromises.push(invalidate(`auctions/${auctionId}`));
    // Also invalidate the auction document directly
    invalidationPromises.push(invalidate(`doc:auctions/${auctionId}`));
    // Clear any in-memory syncronous cache references
    setValueSync(`auction_${auctionId}`, null);
    
    // If we updated a card, invalidate its cache too
    if (auctionData.cardId) {
      invalidationPromises.push(invalidate(`cards/${auctionData.cardId}`));
      invalidationPromises.push(invalidate(`doc:cards/${auctionData.cardId}`));
      // Clear any in-memory synchronous cache references
      setValueSync(`card_${auctionData.cardId}`, null);
    }
    
    // Wait for all invalidations to complete
    try {
      await Promise.all(invalidationPromises);
      console.log(`${RARITY_LOG} Successfully invalidated all caches for auction ${auctionId} and card ${auctionData.cardId || 'none'}`);
    } catch (cacheError) {
      console.log(`${RARITY_LOG} Some cache invalidations failed: ${cacheError.message}`);
      // Continue even if some invalidations fail
    }
    
    console.log(`${RARITY_LOG} Successfully updated auction ${auctionId} rarity to ${newRarity}`);
    
    return newRarity;
  } catch (batchError) {
    console.error(`RARITY SYSTEM: Batch update failed: ${batchError.message}`);
    // Manually update the auction as fallback
    try {
      await updateDoc(doc(db, 'auctions', auctionId), {
        currentRarity: newRarity,
        uniqueBidderCount: bidderCount,
        lastRarityUpdate: serverTimestamp()
      });
      console.log(`${RARITY_LOG} Fallback update succeeded for auction ${auctionId}`);
    } catch (fallbackError) {
      console.error(`RARITY SYSTEM: Fallback update also failed: ${fallbackError.message}`);
      throw fallbackError; // Re-throw so the error is properly handled
    }
  }
  
  return newRarity;
}, {
  context: 'Rarity System',
  operation: 'updateAuctionRarity'
});

/**
 * Comprehensive function to determine final rarity for an auction
 * This uses provided or fetches bidder counts to calculate the final rarity
 * 
 * @param {Object} auction - The auction object containing bid information
 * @param {number} [providedBidderCount] - Optional pre-fetched bidder count
 * @returns {Promise<string>} - Returns a promise that resolves to the final rarity
 */
export const determineAuctionFinalRarity = withErrorHandling(async (auction, providedBidderCount = null) => {
  if (!auction || !auction.id) {
    handleError(new Error('Cannot determine final rarity for undefined auction'), {
      context: 'Rarity System',
      operation: 'determineAuctionFinalRarity',
      errorType: 'validation'
    });
    return RARITY_TYPES.COMMON;
  }
  
  console.log(`${RARITY_LOG} Determining final rarity for auction ${auction.id}`);
  
  // Check for cached final rarity result
  const cacheKey = `finalRarity_${auction.id}`;
  let cachedRarity;
  try {
    // Using getValue from CacheService
    cachedRarity = await getValue(cacheKey);
    
    if (cachedRarity && 
        cachedRarity !== 'unknown' && 
        RARITY_TYPES[cachedRarity.toUpperCase()]) {
      console.log(`${RARITY_LOG} Using cached final rarity ${cachedRarity} for auction ${auction.id}`);
      return cachedRarity;
    }
  } catch (cacheError) {
    console.log(`${RARITY_LOG} Cache lookup failed for rarity: ${cacheError.message}`);
    // Continue to other rarity determination methods
  }
  
  // Start by checking if the auction has a valid current rarity
  if (auction.currentRarity && 
      auction.currentRarity !== 'unknown' &&
      RARITY_TYPES[auction.currentRarity.toUpperCase()]) {
    console.log(`${RARITY_LOG} Using existing currentRarity ${auction.currentRarity} for auction ${auction.id}`);
    
    // Cache this result for future calls
    try {
      await setValue(cacheKey, auction.currentRarity, { ttl: 15 * 60 }); // 15 minute cache
    } catch (cacheError) {
      console.log(`${RARITY_LOG} Failed to cache current rarity: ${cacheError.message}`);
      // Continue without caching
    }
    
    return auction.currentRarity;
  }
  
  // Use provided bidder count or fetch fresh count
  let bidderCount = providedBidderCount;
  if (bidderCount === null || bidderCount === undefined) {
    bidderCount = await BidderManagementService.getUniqueBidderCount(auction.id, auction.sellerId);
    console.log(`${RARITY_LOG} Fetched bidder count for auction ${auction.id}: ${bidderCount}`);
  } else {
    console.log(`${RARITY_LOG} Using provided bidder count for auction ${auction.id}: ${bidderCount}`);
  }
  
  const finalRarity = calculateLiveRarity(auction, bidderCount);
  
  // Cache the final result
  try {
    await setValue(cacheKey, finalRarity, { ttl: 15 * 60 }); // 15 minute cache
  } catch (cacheError) {
    console.log(`${RARITY_LOG} Failed to cache final rarity: ${cacheError.message}`);
    // Continue without caching
  }
  
  console.log(`${RARITY_LOG} Determined final rarity for auction ${auction.id}: ${finalRarity}`);
  return finalRarity;
}, {
  context: 'Rarity System',
  operation: 'determineAuctionFinalRarity'
});