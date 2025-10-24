import { and, collection, doc, query, where, writeBatch } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring (reads handled via other utils)
import { db } from '../config/firebase';
import CacheService from '../services/caching/CacheService';

/**
 * Batch verification utilities for common read optimization patterns
 */

/**
 * Verify card statuses in batch and fix inconsistencies
 * @param {Array} cards - Array of card objects
 * @param {Array} statusFixedCards - Array to collect IDs of fixed cards
 * @returns {Promise<void>}
 */
export const batchVerifyCardStatuses = async (cards, statusFixedCards = []) => {
  if (!cards || cards.length === 0) return;
  
  const cardsArray = Array.isArray(cards) ? cards : Array.from(cards);
  
  // Collect all trade and auction IDs to verify
  const tradeIds = [];
  const auctionIds = [];
  
  cardsArray.forEach(card => {
    if (card.inTrade && card.tradeId) {
      tradeIds.push(card.tradeId);
    }
    if (card.inAuction && card.auctionId) {
      auctionIds.push(card.auctionId);
    }
  });

  // Batch fetch trades and auctions
  const [tradesMap, auctionsMap] = await Promise.all([
    tradeIds.length > 0 
      ? CacheService.getDocuments('trades', tradeIds).then(trades => 
          new Map(trades.map(trade => [trade.id, trade]))
        )
      : Promise.resolve(new Map()),
    auctionIds.length > 0
      ? CacheService.getDocuments('auctions', auctionIds).then(auctions => 
          new Map(auctions.map(auction => [auction.id, auction]))
        )
      : Promise.resolve(new Map())
  ]);

  // Prepare batch updates for cards that need status fixes
  const cardUpdates = [];
  
  cardsArray.forEach(card => {
    let needsStatusFix = false;
    const updateData = {};
    
    // Check trade status
    if (card.inTrade === true) {
      if (card.tradeId) {
        const trade = tradesMap.get(card.tradeId);
        if (!trade || !['active', 'offered', 'pending'].includes(trade.status)) {
          card.inTrade = false;
          card.tradeId = null;
          updateData.inTrade = false;
          updateData.tradeId = null;
          needsStatusFix = true;
        }
      } else {
        card.inTrade = false;
        updateData.inTrade = false;
        needsStatusFix = true;
      }
    }
    
    // Check auction status
    if (card.inAuction === true) {
      if (card.auctionId) {
        const auction = auctionsMap.get(card.auctionId);
        if (!auction || auction.status !== 'active') {
          card.inAuction = false;
          card.auctionId = null;
          updateData.inAuction = false;
          updateData.auctionId = null;
          needsStatusFix = true;
        }
      } else {
        card.inAuction = false;
        updateData.inAuction = false;
        needsStatusFix = true;
      }
    }
    
    // Queue card for batch update if needed
    if (needsStatusFix && Object.keys(updateData).length > 0) {
      cardUpdates.push({
        collection: 'cards',
        id: card.id,
        data: updateData
      });
      statusFixedCards.push(card.id);
    }
  });

  // Perform batch updates if needed
  if (cardUpdates.length > 0) {
    try {
      await batchUpdateDocuments(cardUpdates);
      console.log(`[ReadOptimizer] Batch fixed status for ${cardUpdates.length} cards`);
    } catch (error) {
      console.error('[ReadOptimizer] Error in batch card status update:', error);
    }
  }
};

/**
 * Batch update multiple documents with optimized performance
 * @param {Array} updates - Array of {collection, id, data} objects
 * @returns {Promise<boolean>}
 */
export const batchUpdateDocuments = async (updates) => {
  if (!updates || updates.length === 0) return true;
  
  try {
    const batch = writeBatch(db);
    
    updates.forEach(({ collection: collectionName, id, data }) => {
      const docRef = doc(db, collectionName, id);
      batch.update(docRef, data);
    });
    
    await batch.commit();
    
    // Invalidate cache for updated documents
    await Promise.all(
      updates.map(({ collection: collectionName, id }) => 
        CacheService.invalidateDocument(collectionName, id)
      )
    );
    
    return true;
  } catch (error) {
    console.error('[ReadOptimizer] Error in batch update:', error);
    return false;
  }
};

/**
 * Get trade details with all related data in optimized batches
 * @param {string} tradeId - Trade ID
 * @returns {Promise<Object|null>}
 */
export const getOptimizedTradeDetails = async (tradeId) => {
  try {
    // First get the trade document
    const trade = await CacheService.getDocument('trades', tradeId);
    if (!trade) return null;
    
    // Collect all document IDs we need to fetch
    const userIds = [trade.senderId, trade.receiverId].filter(Boolean);
    const cardIds = [...(trade.offeredCards || []), ...(trade.requestedCards || [])];
    
    // Batch fetch users and cards
    const [usersMap, cardsMap] = await Promise.all([
      userIds.length > 0 
        ? CacheService.getDocuments('users', userIds).then(users => 
            new Map(users.map(user => [user.id, user]))
          )
        : Promise.resolve(new Map()),
      cardIds.length > 0
        ? CacheService.getDocuments('cards', cardIds).then(cards => 
            new Map(cards.map(card => [card.id, card]))
          )
        : Promise.resolve(new Map())
    ]);

    // Build offered and requested cards arrays
    const offeredCards = (trade.offeredCards || [])
      .map(cardId => cardsMap.get(cardId))
      .filter(Boolean);
      
    const requestedCards = (trade.requestedCards || [])
      .map(cardId => cardsMap.get(cardId))
      .filter(Boolean);

    return {
      ...trade,
      senderName: usersMap.get(trade.senderId)?.username || 'Unknown User',
      receiverName: usersMap.get(trade.receiverId)?.username || 'Unknown User',
      offeredCardsDetails: offeredCards,
      requestedCardsDetails: requestedCards
    };
  } catch (error) {
    console.error('[ReadOptimizer] Error getting optimized trade details:', error);
    return null;
  }
};

/**
 * Get auction details with all related data in optimized batches
 * @param {string} auctionId - Auction ID
 * @returns {Promise<Object|null>}
 */
export const getOptimizedAuctionDetails = async (auctionId) => {
  try {
    // First get the auction document
    const auction = await CacheService.getDocument('auctions', auctionId);
    if (!auction) return null;
    
    // Collect all document IDs we need to fetch
    const userIds = [auction.sellerId, auction.currentBidder].filter(Boolean);
    const cardIds = auction.cardId ? [auction.cardId] : [];
    
    // Batch fetch users and cards
    const [usersMap, cardsMap] = await Promise.all([
      userIds.length > 0 
        ? CacheService.getDocuments('users', userIds).then(users => 
            new Map(users.map(user => [user.id, user]))
          )
        : Promise.resolve(new Map()),
      cardIds.length > 0
        ? CacheService.getDocuments('cards', cardIds).then(cards => 
            new Map(cards.map(card => [card.id, card]))
          )
        : Promise.resolve(new Map())
    ]);

    return {
      ...auction,
      sellerName: usersMap.get(auction.sellerId)?.username || 'Unknown User',
      currentBidderName: usersMap.get(auction.currentBidder)?.username || null,
      cardDetails: auction.cardId ? cardsMap.get(auction.cardId) : null
    };
  } catch (error) {
    console.error('[ReadOptimizer] Error getting optimized auction details:', error);
    return null;
  }
};

/**
 * Batch verify auction statuses for cards
 * @param {Array} cards - Array of card objects with auctionId
 * @returns {Promise<Map>} - Map of auctionId to auction status
 */
export const batchVerifyAuctionStatuses = async (cards) => {
  const auctionIds = cards
    .filter(card => card.auctionId)
    .map(card => card.auctionId);
    
  if (auctionIds.length === 0) return new Map();
  
  try {
    const auctions = await CacheService.getDocuments('auctions', auctionIds);
    return new Map(auctions.map(auction => [auction.id, auction.status]));
  } catch (error) {
    console.error('[ReadOptimizer] Error batch verifying auction statuses:', error);
    return new Map();
  }
};

/**
 * Batch verify trade statuses for cards
 * @param {Array} cards - Array of card objects with tradeId
 * @returns {Promise<Map>} - Map of tradeId to trade status
 */
export const batchVerifyTradeStatuses = async (cards) => {
  const tradeIds = cards
    .filter(card => card.tradeId)
    .map(card => card.tradeId);
    
  if (tradeIds.length === 0) return new Map();
  
  try {
    const trades = await CacheService.getDocuments('trades', tradeIds);
    return new Map(trades.map(trade => [trade.id, trade.status]));
  } catch (error) {
    console.error('[ReadOptimizer] Error batch verifying trade statuses:', error);
    return new Map();
  }
};

/**
 * Get user cards with optimized queries and status verification
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 * @param {Object} options - Options for filtering
 * @returns {Promise<Array>} - Array of verified cards
 */
export const getOptimizedUserCards = async (userId, groupId, options = {}) => {
  const { includeInTrade = false, includeInAuction = false, maxCards = 1000 } = options;
  
  try {
    // Get cards using both ownerId and userId queries
    const [ownerCards, userCards] = await Promise.all([
      CacheService.getDocuments('cards', [], {
        query: query(
          collection(db, 'cards'),
          and(
            where('ownerId', '==', userId),
            where('groupId', '==', groupId)
          )
        )
      }),
      CacheService.getDocuments('cards', [], {
        query: query(
          collection(db, 'cards'),
          and(
            where('userId', '==', userId),
            where('groupId', '==', groupId)
          )
        )
      })
    ]);
    
    // Combine and deduplicate
    const cardMap = new Map();
    [...ownerCards, ...userCards].forEach(card => {
      cardMap.set(card.id, card);
    });
    
    const allCards = Array.from(cardMap.values()).slice(0, maxCards);
    
    // Batch verify card statuses
    const statusFixedCards = [];
    await batchVerifyCardStatuses(allCards, statusFixedCards);
    
    // Filter based on options
    let filteredCards = allCards.filter(card => 
      card.name && card.imageUrl && card.rarity
    );
    
    if (!includeInTrade) {
      filteredCards = filteredCards.filter(card => !card.inTrade);
    }
    
    if (!includeInAuction) {
      filteredCards = filteredCards.filter(card => !card.inAuction);
    }
    
    return filteredCards;
  } catch (error) {
    console.error('[ReadOptimizer] Error getting optimized user cards:', error);
    return [];
  }
};

/**
 * Prefetch related data for improved perceived performance
 * @param {string} collection - Collection name
 * @param {Array} documents - Array of documents to prefetch related data for
 */
export const prefetchRelatedData = async (collection, documents) => {
  if (!documents || documents.length === 0) return;
  
  try {
    switch (collection) {
      case 'auctions':
        // Prefetch seller and bidder user data
        const userIds = documents
          .flatMap(auction => [auction.sellerId, auction.currentBidder])
          .filter(Boolean);
        if (userIds.length > 0) {
          CacheService.getDocuments('users', userIds).catch(() => {});
        }
        break;
        
      case 'trades':
        // Prefetch sender and receiver user data
        const tradeUserIds = documents
          .flatMap(trade => [trade.senderId, trade.receiverId])
          .filter(Boolean);
        if (tradeUserIds.length > 0) {
          CacheService.getDocuments('users', tradeUserIds).catch(() => {});
        }
        break;
        
      case 'cards':
        // Prefetch owner user data
        const ownerIds = documents
          .map(card => card.ownerId || card.userId)
          .filter(Boolean);
        if (ownerIds.length > 0) {
          CacheService.getDocuments('users', ownerIds).catch(() => {});
        }
        break;
    }
  } catch (error) {
    // Prefetching is non-critical, just log and continue
    console.log('[ReadOptimizer] Error prefetching related data:', error.message);
  }
};

export default {
  batchVerifyCardStatuses,
  batchUpdateDocuments,
  getOptimizedTradeDetails,
  getOptimizedAuctionDetails,
  batchVerifyAuctionStatuses,
  batchVerifyTradeStatuses,
  getOptimizedUserCards,
  prefetchRelatedData
}; 