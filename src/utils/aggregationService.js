import { collection, doc, query, where, writeBatch } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { getDocs } from '../services/ReadTracking/TrackedFirestore';
import { createDocCacheKey, invalidateCache } from './cacheUtils';

/**
 * Pre-calculate and store bidder counts for active auctions
 * to avoid repeated counting queries
 * 
 * @returns {Promise<number>} - Number of auctions updated
 */
export const updateAuctionBidderCounts = async () => {
  try {
    console.log('Starting auction bidder count aggregation...');
    
    // Get active auctions
    const auctionsRef = collection(db, 'auctions');
    const q = query(auctionsRef, where('status', '==', 'active'));
    const auctionSnapshot = await getDocs(q);
    
    if (auctionSnapshot.empty) {
      console.log('No active auctions found');
      return 0;
    }
    
    let updateCount = 0;
    let batch = writeBatch(db);
    let batchCount = 0;
    
    for (const auctionDoc of auctionSnapshot.docs) {
      const auction = auctionDoc.data();
      
      // Get all bids for this auction
      const bidsRef = collection(db, 'auctionBids');
      const bidsQuery = query(bidsRef, where('auctionId', '==', auctionDoc.id));
      const bidsSnapshot = await getDocs(bidsQuery);
      
      // Count unique bidders
      const uniqueBidders = new Set();
      bidsSnapshot.docs.forEach(bidDoc => {
        const bidData = bidDoc.data();
        if (bidData.bidderId && bidData.bidderId !== auction.sellerId) {
          uniqueBidders.add(bidData.bidderId);
        }
      });
      
      // Update the bidder count if it's different
      const bidderCount = uniqueBidders.size;
      if (auction.bidderCount !== bidderCount) {
        batch.update(auctionDoc.ref, { 
          bidderCount,
          lastBidderCountUpdate: new Date()
        });
        
        // Invalidate cache for this auction
        const cacheKey = createDocCacheKey(`auctions/${auctionDoc.id}`);
        await invalidateCache(cacheKey);
        
        updateCount++;
        batchCount++;
      }
      
      // Commit in batches to avoid exceeding limits
      if (batchCount >= 200) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
    
    // Commit any remaining updates
    if (batchCount > 0) {
      await batch.commit();
    }
    
    console.log(`Updated bidder counts for ${updateCount} auctions`);
    return updateCount;
  } catch (error) {
    console.error('Error updating auction bidder counts:', error);
    return 0;
  }
};

/**
 * Pre-calculate user collection statistics to avoid
 * expensive queries when displaying user profiles
 * 
 * @param {string} userId - User ID to update stats for (all users if null)
 * @returns {Promise<number>} - Number of users updated
 */
export const updateUserCollectionStats = async (userId = null) => {
  try {
    console.log('Starting user collection stats aggregation...');
    
    let usersToProcess = [];
    
    // If userId is provided, just process that user
    if (userId) {
      usersToProcess = [userId];
    } else {
      // Otherwise get all users
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      usersToProcess = usersSnapshot.docs.map(doc => doc.id);
    }
    
    let updateCount = 0;
    let batch = writeBatch(db);
    let batchCount = 0;
    
    for (const uid of usersToProcess) {
      // Get all cards owned by this user
      const cardsRef = collection(db, 'cards');
      const cardsQuery = query(cardsRef, where('ownerId', '==', uid));
      const cardsSnapshot = await getDocs(cardsQuery);
      
      // Count cards by rarity
      const rarityCount = {};
      cardsSnapshot.docs.forEach(cardDoc => {
        const card = cardDoc.data();
        const rarity = card.rarity || 'unknown';
        rarityCount[rarity] = (rarityCount[rarity] || 0) + 1;
      });
      
      // Calculate total cards
      const totalCards = cardsSnapshot.size;
      
      // Update user document with stats
      const userRef = doc(db, 'users', uid);
      batch.update(userRef, {
        collectionStats: {
          totalCards,
          rarityCount,
          lastUpdated: new Date()
        }
      });
      
      // Invalidate cache for this user
      const cacheKey = createDocCacheKey(`users/${uid}`);
      await invalidateCache(cacheKey);
      
      updateCount++;
      batchCount++;
      
      // Commit in batches to avoid exceeding limits
      if (batchCount >= 200) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
    
    // Commit any remaining updates
    if (batchCount > 0) {
      await batch.commit();
    }
    
    console.log(`Updated collection stats for ${updateCount} users`);
    return updateCount;
  } catch (error) {
    console.error('Error updating user collection stats:', error);
    return 0;
  }
};

/**
 * Update group statistics for active groups
 * 
 * @param {string} groupId - Group ID to update stats for (all groups if null)
 * @returns {Promise<number>} - Number of groups updated
 */
export const updateGroupStats = async (groupId = null) => {
  try {
    console.log('Starting group stats aggregation...');
    
    let groupsToProcess = [];
    
    // If groupId is provided, just process that group
    if (groupId) {
      groupsToProcess = [groupId];
    } else {
      // Otherwise get all groups
      const groupsRef = collection(db, 'groups');
      const groupsSnapshot = await getDocs(groupsRef);
      groupsToProcess = groupsSnapshot.docs.map(doc => doc.id);
    }
    
    let updateCount = 0;
    let batch = writeBatch(db);
    let batchCount = 0;
    
    for (const gid of groupsToProcess) {
      // Count members in this group
      const usersRef = collection(db, 'users');
      const membersQuery = query(usersRef, where('groups', 'array-contains', gid));
      const membersSnapshot = await getDocs(membersQuery);
      const memberCount = membersSnapshot.size;
      
      // Count cards in this group
      const cardsRef = collection(db, 'cards');
      const cardsQuery = query(cardsRef, where('groupId', '==', gid));
      const cardsSnapshot = await getDocs(cardsQuery);
      const cardCount = cardsSnapshot.size;
      
      // Count active auctions
      const auctionsRef = collection(db, 'auctions');
      const auctionsQuery = query(auctionsRef, 
        where('groupId', '==', gid), 
        where('status', '==', 'active')
      );
      const auctionsSnapshot = await getDocs(auctionsQuery);
      const auctionCount = auctionsSnapshot.size;
      
      // Update group document with stats
      const groupRef = doc(db, 'groups', gid);
      batch.update(groupRef, {
        stats: {
          memberCount,
          cardCount,
          auctionCount,
          lastUpdated: new Date()
        }
      });
      
      // Invalidate cache for this group
      const cacheKey = createDocCacheKey(`groups/${gid}`);
      await invalidateCache(cacheKey);
      
      updateCount++;
      batchCount++;
      
      // Commit in batches to avoid exceeding limits
      if (batchCount >= 200) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
    
    // Commit any remaining updates
    if (batchCount > 0) {
      await batch.commit();
    }
    
    console.log(`Updated stats for ${updateCount} groups`);
    return updateCount;
  } catch (error) {
    console.error('Error updating group stats:', error);
    return 0;
  }
};

/**
 * Run all aggregation jobs
 * 
 * @returns {Promise<Object>} - Results of all operations
 */
export const runAllAggregations = async () => {
  try {
    console.log('Starting all aggregation jobs...');
    
    // 1. Update auction bidder counts
    const updatedAuctions = await updateAuctionBidderCounts();
    
    // 2. Update user collection stats
    const updatedUsers = await updateUserCollectionStats();
    
    // 3. Update group stats
    const updatedGroups = await updateGroupStats();
    
    const results = {
      updatedAuctions,
      updatedUsers,
      updatedGroups,
      totalUpdates: updatedAuctions + updatedUsers + updatedGroups,
      timestamp: new Date().toISOString()
    };
    
    console.log('All aggregation jobs completed:', results);
    return results;
  } catch (error) {
    console.error('Error running aggregation jobs:', error);
    return {
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

export default {
  updateAuctionBidderCounts,
  updateUserCollectionStats,
  updateGroupStats,
  runAllAggregations
}; 