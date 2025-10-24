import { collection, doc, query, Timestamp, where, writeBatch } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { getDoc, getDocs } from '../services/ReadTracking/TrackedFirestore';

/**
 * Archive auctions that have been completed or cancelled for a long time
 * to reduce the main collection size
 * 
 * @param {number} daysOld - How many days old auctions must be to be archived
 * @returns {Promise<number>} - Number of archived auctions
 */
export const archiveOldAuctions = async (daysOld = 30) => {
  try {
    // Get completed/cancelled auctions older than specified days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const auctionsRef = collection(db, 'auctions');
    const q = query(
      auctionsRef,
      where('status', 'in', ['completed', 'cancelled', 'expired']),
      where('completedAt', '<', Timestamp.fromDate(cutoffDate))
    );
    
    const snapshot = await getDocs(q);
    if (snapshot.empty) return 0;
    
    // Create an "archives" collection to store historical data
    let batch = writeBatch(db);
    let count = 0;
    let batchCount = 0;
    
    for (const docSnapshot of snapshot.docs) {
      const auctionData = docSnapshot.data();
      // Add to archives collection with minimal data
      const archiveRef = doc(db, 'auctionArchives', docSnapshot.id);
      batch.set(archiveRef, {
        cardId: auctionData.cardId,
        cardName: auctionData.cardName,
        sellerId: auctionData.sellerId,
        sellerName: auctionData.sellerName,
        winnerId: auctionData.winnerId || null,
        winningBid: auctionData.winningBid || 0,
        status: auctionData.status,
        completedAt: auctionData.completedAt,
        archived: true,
        archivedAt: Timestamp.now()
      });
      
      // Delete from main collection
      batch.delete(docSnapshot.ref);
      count++;
      batchCount++;
      
      // Commit in batches of 500
      if (batchCount >= 500) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
    
    // Commit any remaining
    if (batchCount > 0) {
      await batch.commit();
    }
    
    console.log(`Archived ${count} old auctions`);
    return count;
  } catch (error) {
    console.error('Error archiving old auctions:', error);
    return 0;
  }
};

/**
 * Archive trades that have been completed/declined/cancelled for a long time
 * 
 * @param {number} daysOld - How many days old trades must be to be archived
 * @returns {Promise<number>} - Number of archived trades
 */
export const archiveOldTrades = async (daysOld = 30) => {
  try {
    // Get completed/declined trades older than specified days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const tradesRef = collection(db, 'trades');
    const q = query(
      tradesRef,
      where('status', 'in', ['completed', 'declined', 'cancelled']),
      where('completedAt', '<', Timestamp.fromDate(cutoffDate))
    );
    
    const snapshot = await getDocs(q);
    if (snapshot.empty) return 0;
    
    let batch = writeBatch(db);
    let count = 0;
    let batchCount = 0;
    
    for (const docSnapshot of snapshot.docs) {
      const tradeData = docSnapshot.data();
      // Add to archives with minimal data
      const archiveRef = doc(db, 'tradeArchives', docSnapshot.id);
      batch.set(archiveRef, {
        senderId: tradeData.senderId,
        receiverId: tradeData.receiverId,
        senderName: tradeData.senderName || 'Unknown',
        receiverName: tradeData.receiverName || 'Unknown',
        offeredCards: tradeData.offeredCards || [],
        requestedCards: tradeData.requestedCards || [],
        status: tradeData.status,
        completedAt: tradeData.completedAt,
        archived: true,
        archivedAt: Timestamp.now()
      });
      
      // Delete from main collection
      batch.delete(docSnapshot.ref);
      count++;
      batchCount++;
      
      // Commit in batches of 500
      if (batchCount >= 500) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
    
    // Commit any remaining
    if (batchCount > 0) {
      await batch.commit();
    }
    
    console.log(`Archived ${count} old trades`);
    return count;
  } catch (error) {
    console.error('Error archiving old trades:', error);
    return 0;
  }
};

/**
 * Clean up bids for auctions that no longer exist
 * 
 * @returns {Promise<number>} - Number of cleaned bids
 */
export const cleanupAbandonedBids = async () => {
  try {
    const bidsRef = collection(db, 'auctionBids');
    const bidsSnapshot = await getDocs(bidsRef);
    
    if (bidsSnapshot.empty) return 0;
    
    let batch = writeBatch(db);
    let count = 0;
    let batchCount = 0;
    
    for (const bidDoc of bidsSnapshot.docs) {
      const bid = bidDoc.data();
      
      // Skip if no auction ID (shouldn't happen, but just in case)
      if (!bid.auctionId) {
        batch.delete(bidDoc.ref);
        count++;
        batchCount++;
        continue;
      }
      
      // Check if the auction still exists
      const auctionRef = doc(db, 'auctions', bid.auctionId);
      const auctionDoc = await getDoc(auctionRef);
      
      if (!auctionDoc.exists()) {
        // Auction doesn't exist anymore, remove the bid
        batch.delete(bidDoc.ref);
        count++;
        batchCount++;
      }
      
      // Commit in batches
      if (batchCount >= 500) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
    
    // Commit any remaining
    if (batchCount > 0) {
      await batch.commit();
    }
    
    console.log(`Cleaned up ${count} abandoned bids`);
    return count;
  } catch (error) {
    console.error('Error cleaning up abandoned bids:', error);
    return 0;
  }
};

/**
 * Fix inconsistencies between cards marked as in auction/trade and actual auctions/trades
 * 
 * @returns {Promise<number>} - Number of fixed inconsistencies
 */
export const cleanupDenormalizedData = async () => {
  try {
    let fixCount = 0;
    
    // 1. First check cards marked as in auction
    const inAuctionCardsRef = collection(db, 'cards');
    const inAuctionQuery = query(inAuctionCardsRef, where('inAuction', '==', true));
    const inAuctionSnapshot = await getDocs(inAuctionQuery);
    
    let batch = writeBatch(db);
    let batchCount = 0;
    
    for (const cardDoc of inAuctionSnapshot.docs) {
      const card = cardDoc.data();
      if (!card.auctionId) {
        // Card marked as in auction but has no auction ID
        batch.update(cardDoc.ref, { inAuction: false });
        fixCount++;
        batchCount++;
        continue;
      }
      
      // Check if the auction still exists and is active
      const auctionRef = doc(db, 'auctions', card.auctionId);
      const auctionDoc = await getDoc(auctionRef);
      
      if (!auctionDoc.exists() || auctionDoc.data().status !== 'active') {
        // Auction doesn't exist or isn't active anymore
        batch.update(cardDoc.ref, { 
          inAuction: false,
          auctionId: null
        });
        fixCount++;
        batchCount++;
      }
      
      // Commit in batches
      if (batchCount >= 500) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
    
    // 2. Now check cards marked as in trade
    const inTradeCardsRef = collection(db, 'cards');
    const inTradeQuery = query(inTradeCardsRef, where('inTrade', '==', true));
    const inTradeSnapshot = await getDocs(inTradeQuery);
    
    for (const cardDoc of inTradeSnapshot.docs) {
      const card = cardDoc.data();
      if (!card.tradeId) {
        // Card marked as in trade but has no trade ID
        batch.update(cardDoc.ref, { inTrade: false });
        fixCount++;
        batchCount++;
        continue;
      }
      
      // Check if the trade still exists and is active or offered
      const tradeRef = doc(db, 'trades', card.tradeId);
      const tradeDoc = await getDoc(tradeRef);
      
      if (!tradeDoc.exists() || !['active', 'offered'].includes(tradeDoc.data().status)) {
        // Trade doesn't exist or isn't active/offered anymore
        batch.update(cardDoc.ref, { 
          inTrade: false,
          tradeId: null
        });
        fixCount++;
        batchCount++;
      }
      
      // Commit in batches
      if (batchCount >= 500) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
    
    // Commit any remaining
    if (batchCount > 0) {
      await batch.commit();
    }
    
    console.log(`Fixed ${fixCount} denormalized data inconsistencies`);
    return fixCount;
  } catch (error) {
    console.error('Error fixing denormalized data:', error);
    return 0;
  }
};

/**
 * Clean up transaction flags that might have been left behind
 * 
 * @returns {Promise<number>} - Number of fixed flags
 */
export const cleanupTransactionFlags = async () => {
  try {
    let fixCount = 0;
    
    // Check for conflicting flags
    const cardsRef = collection(db, 'cards');
    const conflictQuery = query(
      cardsRef, 
      where('inAuction', '==', true),
      where('inTrade', '==', true)
    );
    
    const conflictSnapshot = await getDocs(conflictQuery);
    
    let batch = writeBatch(db);
    let batchCount = 0;
    
    // Fix cards with both inAuction and inTrade = true (should be impossible)
    for (const cardDoc of conflictSnapshot.docs) {
      const card = cardDoc.data();
      
      // Determine which flag is valid by checking if the referenced transaction exists
      let keepAuction = false;
      let keepTrade = false;
      
      if (card.auctionId) {
        const auctionRef = doc(db, 'auctions', card.auctionId);
        const auctionDoc = await getDoc(auctionRef);
        keepAuction = auctionDoc.exists() && auctionDoc.data().status === 'active';
      }
      
      if (card.tradeId) {
        const tradeRef = doc(db, 'trades', card.tradeId);
        const tradeDoc = await getDoc(tradeRef);
        keepTrade = tradeDoc.exists() && ['active', 'offered'].includes(tradeDoc.data().status);
      }
      
      // Card can't be in both at once, so prioritize auction
      if (keepAuction) {
        batch.update(cardDoc.ref, { inTrade: false, tradeId: null });
      } else if (keepTrade) {
        batch.update(cardDoc.ref, { inAuction: false, auctionId: null });
      } else {
        // Neither transaction exists, clear both flags
        batch.update(cardDoc.ref, { 
          inAuction: false, 
          auctionId: null, 
          inTrade: false, 
          tradeId: null 
        });
      }
      
      fixCount++;
      batchCount++;
      
      // Commit in batches
      if (batchCount >= 500) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
    
    // Commit any remaining
    if (batchCount > 0) {
      await batch.commit();
    }
    
    console.log(`Fixed ${fixCount} transaction flag conflicts`);
    return fixCount;
  } catch (error) {
    console.error('Error cleaning up transaction flags:', error);
    return 0;
  }
};

/**
 * Run all database maintenance operations
 * 
 * @returns {Promise<Object>} - Results of all operations
 */
export const performDatabaseMaintenance = async () => {
  try {
    console.log('Starting database maintenance...');

    // 1. Archive old auctions
    const archivedAuctions = await archiveOldAuctions();
    
    // 2. Archive old trades
    const archivedTrades = await archiveOldTrades();
    
    // 3. Remove abandoned auction bids
    const cleanedBids = await cleanupAbandonedBids();
    
    // 4. Fix denormalized data inconsistencies
    const fixedData = await cleanupDenormalizedData();
    
    // 5. Remove transaction flags conflicts
    const fixedFlags = await cleanupTransactionFlags();
    
    const results = {
      archivedAuctions,
      archivedTrades,
      cleanedBids,
      fixedData,
      fixedFlags,
      totalChanges: archivedAuctions + archivedTrades + cleanedBids + fixedData + fixedFlags,
      timestamp: new Date().toISOString()
    };
    
    console.log('Database maintenance completed:', results);
    return results;
  } catch (error) {
    console.error('Error during database maintenance:', error);
    return {
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

export default {
  archiveOldAuctions,
  archiveOldTrades,
  cleanupAbandonedBids,
  cleanupDenormalizedData,
  cleanupTransactionFlags,
  performDatabaseMaintenance
}; 