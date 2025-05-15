import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../config/firebase';
// Import named exports to avoid default import issues
import { createBatch } from '../services/BatchService';
import {
  getValue,
  invalidate,
  setValue,
  setValueSync
} from '../services/caching/CacheService';
import { handleError, withErrorHandling } from '../services/ErrorHandlingService';

// For debug logging
const RARITY_LOG = 'RARITY SYSTEM:';

// Define rarity types for determination after auction
// IMPORTANT: MYSTERY rarity has been completely removed to avoid issues
export const RARITY_TYPES = {
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary',
  MYTHIC: 'mythic'
};

/**
 * Comprehensive rarity calculation function that NEVER returns 'mystery'
 * Always returns a valid rarity string (defaults to 'common')
 * 
 * @param {Object} auction - The auction object with current bid and bidder data
 * @param {number} uniqueBidderCount - Count of unique bidders (excluding seller)
 * @returns {string} - Returns a valid rarity string, never 'mystery'
 */
export const calculateLiveRarity = (auction, uniqueBidderCount) => {
  try {
    if (!auction) {
      console.log('RARITY SYSTEM: No auction provided, defaulting to COMMON');
      return RARITY_TYPES.COMMON;
    }
    
    // For cards with a valid fixed rarity, respect that rarity
    // This applies to previously minted cards with established rarity
    // IMPORTANT: We'll only use cardRarity IF there's no bidding activity yet
    // If there are bids, we calculate based on current bidding
    if ((!auction.currentBid || auction.currentBid <= 0) && // Only use fixed rarity if no bids yet
        auction.cardRarity && 
        auction.cardRarity !== 'mystery' && // String comparison instead of enum since MYSTERY was removed
        auction.cardRarity !== 'unknown' && 
        auction.cardRarity !== '' &&
        RARITY_TYPES[auction.cardRarity.toUpperCase()]) {
      console.log(`${RARITY_LOG} Using fixed card rarity for auction ${auction.id}: ${auction.cardRarity}`);
      return auction.cardRarity;
    }
    
    // For newly coined/created cards, calculate based on bid engagement
    // Get bid amount with safeguards for all possible data types
    let bidAmount = 0;
    if (typeof auction.currentBid === 'number') {
      bidAmount = auction.currentBid;
    } else if (auction.currentBid && !isNaN(parseInt(auction.currentBid))) {
      bidAmount = parseInt(auction.currentBid);
    } else if (auction.finalBid && !isNaN(parseInt(auction.finalBid))) {
      bidAmount = parseInt(auction.finalBid);
    }
    
    // Calculate bidder count with multiple fallbacks
    let bidderCount = 0;
    
    // Option 1: Use provided uniqueBidderCount parameter if it's valid
    if (typeof uniqueBidderCount === 'number' && uniqueBidderCount > 0) {
      bidderCount = uniqueBidderCount;
    }
    // Option 2: Use auction.uniqueBidderCount if it exists and is valid
    else if (typeof auction.uniqueBidderCount === 'number' && auction.uniqueBidderCount > 0) {
      bidderCount = auction.uniqueBidderCount;
    }
    // Option 3: Use auction.bidCount as a fallback with capping
    else if (typeof auction.bidCount === 'number' && auction.bidCount > 0) {
      // Cap at 5 to avoid over-inflation if the same bidder bids multiple times
      bidderCount = Math.min(auction.bidCount, 5);
    }
    
    // Check if there's anything special about this auction we should know
    const auctionIdentifier = auction.id ? `auction ${auction.id}` : 'unnamed auction';
    console.log(`${RARITY_LOG} Calculating rarity for ${auctionIdentifier}`);
    console.log(`${RARITY_LOG} Bid amount: ${bidAmount}, Bidder count: ${bidderCount}`);
    
    // Full debug log for all attributes that could affect rarity
    console.log(`RARITY DEBUG: ${auctionIdentifier} - ` + 
               `bid=${bidAmount}, ` +
               `bidders=${bidderCount}, ` +
               `status=${auction.status || 'unknown'}, ` +
               `currentRarity=${auction.currentRarity || 'none'}, ` +
               `cardRarity=${auction.cardRarity || 'none'}`);
    
    // RARITY DETERMINATION LOGIC - MADE EASIER TO GET RARE CARDS
    // Lowered thresholds for all rarity tiers to make cards rarer with fewer bids
    // Each tier has clear criteria based on bid amount OR bidder count
    
    // LEGENDARY: High engagement (high bid OR many bidders)
    if (bidAmount >= 100 || bidderCount >= 4) {
      console.log(`${RARITY_LOG} Calculated LEGENDARY for ${auctionIdentifier}`);
      return RARITY_TYPES.LEGENDARY;
    }
    // EPIC: Strong engagement (moderately high bid OR several bidders)
    else if (bidAmount >= 75 || bidderCount >= 3) {
      console.log(`${RARITY_LOG} Calculated EPIC for ${auctionIdentifier}`);
      return RARITY_TYPES.EPIC;
    }
    // RARE: Good engagement (medium bid OR multiple bidders)
    else if (bidAmount >= 50 || bidderCount >= 2) {
      console.log(`${RARITY_LOG} Calculated RARE for ${auctionIdentifier}`);
      return RARITY_TYPES.RARE;
    }
    // UNCOMMON: Some engagement (low bid OR at least 1 bidder)
    else if (bidAmount >= 10 || bidderCount >= 1) {
      console.log(`${RARITY_LOG} Calculated UNCOMMON for ${auctionIdentifier}`);
      return RARITY_TYPES.UNCOMMON;
    }
    // COMMON: Minimal engagement (default fallback) - NEVER MYSTERY
    else {
      console.log(`${RARITY_LOG} Calculated COMMON for ${auctionIdentifier}`);
      return RARITY_TYPES.COMMON;
    }
  } catch (error) {
    console.error('RARITY SYSTEM ERROR:', error);
    // Always fall back to common as the safety default
    return RARITY_TYPES.COMMON;
  }
};

/**
 * Get unique bidder count for an auction from the database
 * Returns a reliable count of unique bidders for rarity calculation
 * 
 * @param {string} auctionId - The ID of the auction to count bidders for
 * @param {string} sellerId - Optional seller ID to exclude from count
 * @returns {Promise<number>} - Returns a promise that resolves to the bidder count
 */
export const getUniqueBidderCount = withErrorHandling(async (auctionId, sellerId = null) => {
  if (!auctionId) return 0;
  
  try {
    // Create cache key for this specific bidder count query
    const cacheKey = `bidderCount_${auctionId}_${sellerId || 'noSeller'}`;
    
    // Try to get from cache first
    let cachedCount;
    try {
      cachedCount = await getValue(cacheKey);
      if (cachedCount !== null && cachedCount !== undefined) {
        console.log(`${RARITY_LOG} Using cached bidder count for ${auctionId}: ${cachedCount}`);
        return parseInt(cachedCount);
      }
    } catch (cacheError) {
      console.log(`${RARITY_LOG} Cache lookup failed for bidder count: ${cacheError.message}`);
      // Continue to fetch from database
    }
    
    // If not in cache, query all bids for this auction
    const bidsQuery = query(
      collection(db, 'auctionBids'),
      where('auctionId', '==', auctionId)
    );
    
    // Fetch documents directly from Firestore since we're having cache issues
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
    
    // Store in cache for future use
    try {
      await setValue(cacheKey, count, { ttl: 5 * 60 }); // 5 minute cache
    } catch (cacheError) {
      console.log(`${RARITY_LOG} Failed to cache bidder count: ${cacheError.message}`);
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
 * @returns {Promise<string>} - Returns a promise that resolves to the new rarity
 */
export const updateAuctionRarity = withErrorHandling(async (auctionId) => {
  if (!auctionId) {
    handleError(new Error('Cannot update rarity for undefined auction ID'), {
      context: 'Rarity System',
      operation: 'updateAuctionRarity',
      errorType: 'validation'
    });
    return RARITY_TYPES.COMMON;
  }
  
  console.log(`${RARITY_LOG} Force updating rarity for auction ${auctionId}`);
  
  // Step 1: Get the auction data directly from the database due to cache issues
  const auctionRef = doc(db, 'auctions', auctionId);
  let auctionData;
  try {
    // Try to use direct Firestore call as it's more reliable for critical operations
    console.log(`${RARITY_LOG} Using direct Firestore for auction ${auctionId}`);
    const auctionSnapshot = await getDoc(auctionRef);
    if (auctionSnapshot.exists()) {
      auctionData = {
        id: auctionId,
        ...auctionSnapshot.data()
      };
    }
  } catch (firestoreError) {
    console.log(`${RARITY_LOG} Firestore error: ${firestoreError.message}`);
    // Log but don't retry since we're already using the direct method
    throw firestoreError; // Let the error handler take care of this
  }
  
  if (!auctionData) {
    handleError(new Error(`Auction ${auctionId} not found`), {
      context: 'Rarity System',
      operation: 'updateAuctionRarity',
      errorType: 'not_found'
    });
    return RARITY_TYPES.COMMON;
  }
  
  // Add ID to the auction data
  auctionData.id = auctionId;
  
  // IMPORTANT: For newly created/coined cards that have MYSTERY rarity,
  // we'll convert them to COMMON as baseline but ONLY if they don't have valid bids yet
  // If they have bids, we MUST calculate based on bid activity
  const hasBidActivity = auctionData.currentBid > 0 || (auctionData.uniqueBidderCount && auctionData.uniqueBidderCount > 0);
  
  // Initialize a batch operation for related updates
  const batch = createBatch();
  
  if (!hasBidActivity && (auctionData.cardRarity === 'mystery' || !auctionData.cardRarity || auctionData.cardRarity === 'unknown')) {
    console.log(`${RARITY_LOG} Converting mystery/unknown to COMMON for auction ${auctionId} (no bids yet)`);
    auctionData.cardRarity = RARITY_TYPES.COMMON;
    
    // Also update the card itself to ensure it's COMMON instead of MYSTERY
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
  
  // IMPORTANT: If current rarity is still mystery but we have bid activity, force an update
  if (hasBidActivity && (auctionData.currentRarity === 'mystery' || !auctionData.currentRarity)) {
    console.log(`${RARITY_LOG} Found 'mystery' currentRarity with bid activity for auction ${auctionId} - will force recalculation`);
  }
  
  // Don't update completed/canceled auctions
  if (auctionData.status !== 'active') {
    console.log(`${RARITY_LOG} Skipping inactive auction ${auctionId} (${auctionData.status})`);
    return auctionData.currentRarity || RARITY_TYPES.COMMON;
  }
  
  // Step 2: Get unique bidder count using the optimized getUniqueBidderCount function
  const bidderCount = await getUniqueBidderCount(auctionId, auctionData.sellerId);
  
  // Step 3: Calculate new rarity based on bid activity
  const newRarity = calculateLiveRarity(auctionData, bidderCount);
  console.log(`${RARITY_LOG} Calculated new rarity ${newRarity} for auction ${auctionId}`);
  
  // Step 4: Update the auction in the database with the new rarity
  // CRITICAL: For auctions with bids, we ALWAYS use the calculated rarity
  // and we make sure to update BOTH currentRarity AND cardRarity to the same value
  // This ensures consistency and prevents the rarity from reverting
  batch.update(auctionRef, {
    currentRarity: newRarity,
    uniqueBidderCount: bidderCount,
    lastRarityUpdate: serverTimestamp(),
    // IMPORTANT: If there's bid activity, update cardRarity to match currentRarity
    // This ensures the rarity calculation won't revert back due to cardRarity
    cardRarity: hasBidActivity ? newRarity : (auctionData.cardRarity === 'mystery' ? RARITY_TYPES.COMMON : auctionData.cardRarity)
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
      await updateDoc(auctionRef, {
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
    cachedRarity = await getValue(cacheKey);
    
    if (cachedRarity && 
        cachedRarity !== 'mystery' && 
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
      auction.currentRarity !== 'mystery' && // String comparison instead of enum
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
    bidderCount = await getUniqueBidderCount(auction.id, auction.sellerId);
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