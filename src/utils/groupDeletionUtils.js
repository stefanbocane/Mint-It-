/**
 * Group Deletion Utilities
 * 
 * Handles deletion of user data when leaving a group:
 * - Cards deletion
 * - Auctions deletion
 * - Trades deletion
 * - Cache invalidation
 * 
 * Extracted from SocialScreen for better maintainability
 */

import { collection, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';
import CacheService from '../services/caching/CacheService';
import { getDocs } from '../services/ReadTracking/TrackedFirestore';

/**
 * Delete all user's cards in a specific group
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 */
export const deleteUserCardsInGroup = async (userId, groupId) => {
  try {
    // OPTIMIZATION: Check cache first to avoid unnecessary DB calls
    const userCardsKey = `user_cards_${userId}_${groupId}`;
    const cachedCards = await CacheService.getValue(userCardsKey);
    
    if (cachedCards && Array.isArray(cachedCards) && cachedCards.length === 0) {
      console.log('✅ Cache indicates no cards to delete');
      return;
    }
    
    // Use both userId and ownerId for comprehensive deletion
    const cardsQuery = query(
      collection(db, 'cards'),
      where('groupId', '==', groupId)
    );
    
    const cardsSnapshot = await getDocs(cardsQuery);
    const userCards = cardsSnapshot.docs.filter(doc => {
      const data = doc.data();
      return data.ownerId === userId || data.userId === userId;
    });
    
    if (userCards.length === 0) {
      console.log('ℹ️ No cards found to delete');
      // Update cache to reflect empty state
      await CacheService.setValue(userCardsKey, [], { ttl: 60000 });
      return;
    }
    
    // Delete cards in batches (Firestore batch limit is 500 operations)
    const batch = writeBatch(db);
    let deleteCount = 0;
    
    userCards.forEach(cardDoc => {
      batch.delete(cardDoc.ref);
      deleteCount++;
    });
    
    await batch.commit();
    console.log(`✅ Deleted ${deleteCount} cards for user ${userId} in group ${groupId}`);
    
    // Invalidate related caches
    await Promise.allSettled([
      CacheService.invalidate(userCardsKey),
      CacheService.invalidate(`leaderboard_precomputed_${groupId}`),
      CacheService.invalidate(`user_leaderboard_stats_${userId}_${groupId}`),
      // Invalidate CollectionScreen cache
      CacheService.invalidate(`ultra_collection_all_cards_${userId}_${groupId}`),
      CacheService.invalidate(`ultra_collection_user_profile_${userId}`),
      CacheService.invalidate(`ultra_collection_group_info_${groupId}`),
      // Invalidate any other collection-related caches
      CacheService.invalidate(`collection_cards_${userId}_${groupId}`),
      CacheService.invalidate(`user_cards_${userId}_${groupId}`)
    ]);
    
  } catch (error) {
    console.error('❌ Error deleting user cards:', error);
    throw error;
  }
};

/**
 * Delete all user's auctions in a specific group
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 */
export const deleteUserAuctionsInGroup = async (userId, groupId) => {
  try {
    // OPTIMIZATION: Check cache first to avoid unnecessary DB calls
    const userAuctionsKey = `user_auctions_${userId}_${groupId}`;
    const cachedAuctions = await CacheService.getValue(userAuctionsKey);
    
    if (cachedAuctions && Array.isArray(cachedAuctions) && cachedAuctions.length === 0) {
      console.log('✅ Cache indicates no auctions to delete');
      return;
    }
    
    // Use comprehensive query to catch all auction fields
    const auctionsQuery = query(
      collection(db, 'auctions'),
      where('groupId', '==', groupId)
    );
    
    const auctionsSnapshot = await getDocs(auctionsQuery);
    const userAuctions = auctionsSnapshot.docs.filter(doc => {
      const data = doc.data();
      return data.ownerId === userId || data.sellerId === userId || data.currentBidder === userId;
    });
    
    if (userAuctions.length === 0) {
      console.log('ℹ️ No auctions found to delete');
      // Update cache to reflect empty state
      await CacheService.setValue(userAuctionsKey, [], { ttl: 60000 });
      return;
    }
    
    const batch = writeBatch(db);
    let deleteCount = 0;
    
    userAuctions.forEach(auctionDoc => {
      batch.delete(auctionDoc.ref);
      deleteCount++;
    });
    
    await batch.commit();
    console.log(`✅ Deleted ${deleteCount} auctions for user ${userId} in group ${groupId}`);
    
    // Invalidate related caches
    await Promise.allSettled([
      CacheService.invalidate(userAuctionsKey),
      CacheService.invalidate(`group_auctions_${groupId}`),
      CacheService.invalidate(`user_active_auctions_${userId}`)
    ]);
    
  } catch (error) {
    console.error('❌ Error deleting user auctions:', error);
    throw error;
  }
};

/**
 * Delete all user's trades in a specific group
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 */
export const deleteUserTradesInGroup = async (userId, groupId) => {
  try {
    // OPTIMIZATION: Check cache first to avoid unnecessary DB calls
    const userTradesKey = `user_trades_${userId}_${groupId}`;
    const cachedTrades = await CacheService.getValue(userTradesKey);
    
    if (cachedTrades && Array.isArray(cachedTrades) && cachedTrades.length === 0) {
      console.log('✅ Cache indicates no trades to delete');
      return;
    }
    
    // OPTIMIZATION: Single query instead of two parallel queries
    const allTradesQuery = query(
      collection(db, 'trades'),
      where('groupId', '==', groupId)
    );
    
    const allTradesSnapshot = await getDocs(allTradesQuery);
    const userTrades = allTradesSnapshot.docs.filter(doc => {
      const data = doc.data();
      return data.senderId === userId || data.receiverId === userId;
    });
    
    if (userTrades.length === 0) {
      console.log('ℹ️ No trades found to delete');
      // Update cache to reflect empty state
      await CacheService.setValue(userTradesKey, [], { ttl: 60000 });
      return;
    }
    
    const batch = writeBatch(db);
    let deleteCount = 0;
    
    userTrades.forEach(tradeDoc => {
      batch.delete(tradeDoc.ref);
      deleteCount++;
    });
    
    await batch.commit();
    console.log(`✅ Deleted ${deleteCount} trades for user ${userId} in group ${groupId}`);
    
    // Invalidate related caches
    await Promise.allSettled([
      CacheService.invalidate(userTradesKey),
      CacheService.invalidate(`group_trades_${groupId}`),
      CacheService.invalidate(`user_active_trades_${userId}`)
    ]);
    
  } catch (error) {
    console.error('❌ Error deleting user trades:', error);
    throw error;
  }
};

/**
 * Delete all user data in a group (cards, auctions, trades)
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 */
export const deleteAllUserDataInGroup = async (userId, groupId) => {
  console.log('🗑️ Deleting all user data in group...');
  
  await Promise.allSettled([
    deleteUserCardsInGroup(userId, groupId),
    deleteUserAuctionsInGroup(userId, groupId),
    deleteUserTradesInGroup(userId, groupId)
  ]);
  
  console.log('✅ User data cleanup completed');
};

export default {
  deleteUserCardsInGroup,
  deleteUserAuctionsInGroup,
  deleteUserTradesInGroup,
  deleteAllUserDataInGroup
};


