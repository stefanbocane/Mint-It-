/**
 * Consolidated Query Service
 * Reduces reads by batching similar queries and smart result sharing
 */

import { collection, query, where } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import CacheService from '../services/caching/CacheService';
import { getDocs } from '../services/ReadTracking/TrackedFirestore';

/**
 * Consolidated card fetching for CreateTradeScreen patterns
 * Replaces the dual ownerQuery + userIdQuery pattern
 */
export const getCardsForTradeCreation = async (userId, groupId, options = {}) => {
  const cacheKey = `trade_cards_${userId}_${groupId}`;
  
  return CacheService.getOrSet(cacheKey, async () => {
    // Single query that covers both owner and user cases
    const cardsQuery = query(
      collection(db, 'cards'),
      where('groupId', '==', groupId),
      where('ownerId', '==', userId) // This covers the main case
    );
    
    const snapshot = await getDocs(cardsQuery);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }, {
    ttl: 2 * 60 * 1000, // 2 minute cache
    ...options
  });
};

/**
 * Consolidated leaderboard data fetching
 * Combines card and user queries into a single optimized flow
 */
export const getLeaderboardData = async (groupId, options = {}) => {
  const cacheKey = `leaderboard_${groupId}`;
  
  return CacheService.getOrSet(cacheKey, async () => {
    // First get cards for the group
    const cardsQuery = query(
      collection(db, 'cards'),
      where('groupId', '==', groupId)
    );
    
    const cardsSnapshot = await getDocs(cardsQuery);
    const cards = cardsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Extract unique user IDs from cards
    const userIds = [...new Set(cards.map(card => card.ownerId).filter(Boolean))];
    
    // Batch fetch user data using CacheService
    const users = await CacheService.getDocuments('users', userIds, {
      ttl: 5 * 60 * 1000 // 5 minute cache for users
    });
    
    // Create user map for easy lookup
    const userMap = new Map(users.map(user => [user.id, user]));
    
    // Combine data
    const leaderboardData = cards.map(card => ({
      ...card,
      ownerData: userMap.get(card.ownerId)
    })).filter(item => item.ownerData); // Only include cards with valid owners
    
    return {
      cards,
      users,
      leaderboardData,
      userMap: Object.fromEntries(userMap)
    };
  }, {
    ttl: 3 * 60 * 1000, // 3 minute cache for leaderboard
    ...options
  });
};

/**
 * Consolidated trade queries
 * Replaces multiple separate trade fetches with intelligent batching
 */
export const getTradesConsolidated = async (userId, groupId, options = {}) => {
  const cacheKey = `trades_${userId}_${groupId}`;
  
  return CacheService.getOrSet(cacheKey, async () => {
    // Single query that gets all relevant trades for the user
    const tradesQuery = query(
      collection(db, 'trades'),
      where('groupId', '==', groupId)
      // Note: We'll filter client-side since Firestore doesn't support OR queries easily
    );
    
    const snapshot = await getDocs(tradesQuery);
    const allTrades = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Filter for user's trades (sent or received)
    const userTrades = allTrades.filter(trade => 
      trade.senderId === userId || trade.receiverId === userId
    );
    
    // Extract all user IDs and card IDs for batch fetching
    const userIds = new Set();
    const cardIds = new Set();
    
    userTrades.forEach(trade => {
      if (trade.senderId) userIds.add(trade.senderId);
      if (trade.receiverId) userIds.add(trade.receiverId);
      if (trade.offeredCards) trade.offeredCards.forEach(id => cardIds.add(id));
      if (trade.requestedCards) trade.requestedCards.forEach(id => cardIds.add(id));
    });
    
    // Batch fetch related data
    const [users, cards] = await Promise.all([
      CacheService.getDocuments('users', Array.from(userIds), { ttl: 2 * 60 * 1000 }),
      CacheService.getDocuments('cards', Array.from(cardIds), { ttl: 2 * 60 * 1000 })
    ]);
    
    // Create lookup maps
    const userMap = new Map(users.map(user => [user.id, user]));
    const cardMap = new Map(cards.map(card => [card.id, card]));
    
    // Enrich trades with related data
    const enrichedTrades = userTrades.map(trade => ({
      ...trade,
      senderData: userMap.get(trade.senderId),
      receiverData: userMap.get(trade.receiverId),
      offeredCardsData: (trade.offeredCards || []).map(id => cardMap.get(id)).filter(Boolean),
      requestedCardsData: (trade.requestedCards || []).map(id => cardMap.get(id)).filter(Boolean)
    }));
    
    return {
      trades: enrichedTrades,
      allUsers: Object.fromEntries(userMap),
      allCards: Object.fromEntries(cardMap)
    };
  }, {
    ttl: 90 * 1000, // 90 second cache for trades
    ...options
  });
};

/**
 * Smart auction data consolidation
 * Combines auction, bid, and user data fetching
 */
export const getAuctionDataConsolidated = async (auctionIds, options = {}) => {
  if (!auctionIds || auctionIds.length === 0) return { auctions: [], users: {}, bidCounts: {} };
  
  const cacheKey = `auction_batch_${auctionIds.slice(0, 5).join('_')}_${auctionIds.length}`;
  
  return CacheService.getOrSet(cacheKey, async () => {
    // Batch fetch auctions
    const auctions = await CacheService.getDocuments('auctions', auctionIds, {
      ttl: 30 * 1000 // 30 second cache
    });
    
    // Extract user IDs and get bid counts in parallel
    const userIds = new Set();
    auctions.forEach(auction => {
      if (auction.sellerId) userIds.add(auction.sellerId);
      if (auction.currentBidder) userIds.add(auction.currentBidder);
    });
    
    // Fetch bid counts for all auctions in a single query
    const bidsQuery = query(
      collection(db, 'auctionBids'),
      where('auctionId', 'in', auctionIds)
    );
    
    const [users, bidsSnapshot] = await Promise.all([
      CacheService.getDocuments('users', Array.from(userIds), { ttl: 2 * 60 * 1000 }),
      getDocs(bidsQuery)
    ]);
    
    // Process bid counts
    const bidCounts = {};
    const bidderSets = {};
    
    auctionIds.forEach(id => {
      bidCounts[id] = 0;
      bidderSets[id] = new Set();
    });
    
    bidsSnapshot.docs.forEach(doc => {
      const bid = doc.data();
      if (bid.auctionId && bid.bidderId) {
        bidderSets[bid.auctionId].add(bid.bidderId);
      }
    });
    
    // Calculate unique bidder counts
    Object.keys(bidderSets).forEach(auctionId => {
      bidCounts[auctionId] = bidderSets[auctionId].size;
    });
    
    return {
      auctions,
      users: Object.fromEntries(users.map(user => [user.id, user])),
      bidCounts
    };
  }, {
    ttl: 45 * 1000, // 45 second cache
    ...options
  });
};

export default {
  getCardsForTradeCreation,
  getLeaderboardData,
  getTradesConsolidated,
  getAuctionDataConsolidated
}; 