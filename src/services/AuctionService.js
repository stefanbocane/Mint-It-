/**
 * Auction Service - Core auction operations
 * 
 * Provides basic auction functionality.
 * This is a minimal implementation for compatibility.
 */

import { addDoc, collection, doc, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { getDocs } from './ReadTracking/TrackedFirestore';

class AuctionService {
  /**
   * Get active auctions for a group
   * @param {string} groupId - Group ID
   * @returns {Promise<Array>} - Array of active auctions
   */
  static async getActiveAuctions(groupId) {
    try {
      if (!groupId) {
        console.warn('getActiveAuctions called without groupId');
        return [];
      }

      const now = new Date();
      const q = query(
        collection(db, 'auctions'),
        where('groupId', '==', groupId),
        where('status', '==', 'active'),
        where('endTime', '>', now),
        orderBy('endTime', 'asc')
      );

      const snapshot = await getDocs(q);
      const auctions = [];
      
      snapshot.forEach(doc => {
        auctions.push({ id: doc.id, ...doc.data() });
      });

      return auctions;
    } catch (error) {
      console.error('Error in getActiveAuctions:', error);
      return [];
    }
  }

  /**
   * Place a bid on an auction
   * ATOMIC TRANSACTION: Validates bid, updates auction, deducts coins, and refunds previous bidder
   * All operations happen in a single Firestore transaction to ensure consistency
   * 
   * @param {string} auctionId - Auction ID
   * @param {number} bidAmount - Bid amount (NOT including tax)
   * @param {string} userId - User ID
   * @param {string} displayName - User display name
   * @param {string} groupId - Group ID
   * @returns {Promise<{success: boolean, error?: string, rarity?: string}>} - Result object
   */
  static async placeBid(auctionId, bidAmount, userId, displayName, groupId) {
    try {
      if (!auctionId || !userId || !bidAmount || !groupId) {
        return { success: false, error: 'Missing required parameters' };
      }

      const auctionRef = doc(db, 'auctions', auctionId);
      const bidderSessionRef = doc(db, 'users', userId, 'sessions', 'main');
      
      // Import required functions
      const { runTransaction, increment } = await import('firebase/firestore');
      const { calculateLiveRarity } = await import('../utils/auctionRarity');

      // ATOMIC TRANSACTION: All operations in ONE transaction
      const result = await runTransaction(db, async (transaction) => {
        // ========== READ PHASE ==========
        // Read auction state
        const auctionSnap = await transaction.get(auctionRef);
        if (!auctionSnap.exists()) {
          throw new Error('Auction not found');
        }
        const auctionData = auctionSnap.data();

        // Read bidder's balance
        const bidderSessionSnap = await transaction.get(bidderSessionRef);
        if (!bidderSessionSnap.exists()) {
          throw new Error('User session not found');
        }
        const bidderData = bidderSessionSnap.data();
        const bidderBalance = bidderData.groupBalances?.[groupId] || 0;

        // ========== VALIDATION PHASE ==========
        // Calculate total cost (bid + 1 coin tax)
        const TAX = 1;
        const totalCost = bidAmount + TAX;

        // Validate sufficient balance
        if (bidderBalance < totalCost) {
          throw new Error(`Insufficient balance: ${bidderBalance} < ${totalCost} (bid: ${bidAmount} + tax: ${TAX})`);
        }

        // Validate bid is higher than current bid
        const currentBid = auctionData.currentBid || 0;
        if (bidAmount <= currentBid) {
          throw new Error(`Bid must be higher than current bid of ${currentBid} coins`);
        }

        // Validate auction is still active
        if (auctionData.status !== 'active') {
          throw new Error('Auction is no longer active');
        }

        // Check if auction has ended
        const endTime = auctionData.endTime?.toDate?.() || new Date(auctionData.endTime);
        if (endTime && endTime <= new Date()) {
          throw new Error('Auction has ended');
        }

        // Calculate unique bidder count
        const previousBidder = auctionData.currentBidder;
        const previousBid = currentBid;
        const isNewBidder = previousBidder !== userId;
        const uniqueBidderCount = isNewBidder
          ? (auctionData.uniqueBidderCount || 0) + 1
          : (auctionData.uniqueBidderCount || 0);

        // Calculate live rarity
        const updatedAuctionData = {
          ...auctionData,
          currentBid: bidAmount,
          uniqueBidderCount: uniqueBidderCount
        };
        const newRarity = calculateLiveRarity(updatedAuctionData, uniqueBidderCount);

        console.log(`🎯 [BidTransaction] Auction ${auctionId}: ${newRarity} (${uniqueBidderCount} bidders, ${bidAmount} coins)`);

        // ========== WRITE PHASE ==========
        // 1. Update auction
        transaction.update(auctionRef, {
          currentBid: bidAmount,
          currentBidder: userId,
          currentBidderName: displayName,
          uniqueBidderCount: uniqueBidderCount,
          currentRarity: newRarity,
          lastBidTime: serverTimestamp(),
          lastRarityUpdate: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        // 2. Deduct coins from bidder (bid + tax)
        transaction.update(bidderSessionRef, {
          [`groupBalances.${groupId}`]: increment(-totalCost),
          lastUpdated: serverTimestamp()
        });
        console.log(`💰 [BidTransaction] Deducting ${totalCost} coins from ${userId} (bid: ${bidAmount} + tax: ${TAX})`);

        // 3. Refund previous bidder (if different user and not seller)
        if (isNewBidder && previousBidder && previousBidder !== auctionData.sellerId && previousBid > 0) {
          const previousBidderSessionRef = doc(db, 'users', previousBidder, 'sessions', 'main');
          transaction.update(previousBidderSessionRef, {
            [`groupBalances.${groupId}`]: increment(previousBid),
            lastUpdated: serverTimestamp()
          });
          console.log(`💸 [BidTransaction] Refunding ${previousBid} coins to previous bidder ${previousBidder}`);
        }

        return { 
          rarity: newRarity, 
          uniqueBidderCount,
          totalCost,
          previousBidder: isNewBidder ? previousBidder : null,
          refundedAmount: (isNewBidder && previousBidder) ? previousBid : 0
        };
      });

      console.log(`✅ [BidTransaction] Complete: ${bidAmount} on auction ${auctionId} by ${displayName} - Rarity: ${result.rarity}`);
      if (result.previousBidder) {
        console.log(`✅ [BidTransaction] Refunded ${result.refundedAmount} coins to ${result.previousBidder}`);
      }
      
      return { 
        success: true, 
        rarity: result.rarity,
        totalCost: result.totalCost,
        refunded: result.refundedAmount
      };
      
    } catch (error) {
      console.error('❌ [BidTransaction] Failed:', error);
      
      // Provide user-friendly error messages
      const errorMessage = error.message || 'Failed to place bid';
      
      return { 
        success: false, 
        error: errorMessage,
        needsRefresh: errorMessage.includes('higher than current bid') // Signal UI to refresh
      };
    }
  }

  /**
   * Create a new auction
   * @param {Object} auctionData - Auction data
   * @returns {Promise<string|null>} - Auction ID or null
   */
  static async createAuction(auctionData) {
    try {
      const docRef = await addDoc(collection(db, 'auctions'), {
        ...auctionData,
        status: 'active',
        currentBid: auctionData.startingBid || 0,
        bidCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      return docRef.id;
    } catch (error) {
      console.error('Error creating auction:', error);
      return null;
    }
  }

  /**
   * Complete an auction
   * @param {string} auctionId - Auction ID
   * @returns {Promise<boolean>} - Success status
   */
  static async completeAuction(auctionId) {
    try {
      const auctionRef = doc(db, 'auctions', auctionId);
      
      await updateDoc(auctionRef, {
        status: 'completed',
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      return true;
    } catch (error) {
      console.error('Error completing auction:', error);
      return false;
    }
  }

  /**
   * Cancel an auction
   * @param {string} auctionId - Auction ID
   * @returns {Promise<boolean>} - Success status
   */
  static async cancelAuction(auctionId) {
    try {
      const auctionRef = doc(db, 'auctions', auctionId);
      
      await updateDoc(auctionRef, {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      return true;
    } catch (error) {
      console.error('Error cancelling auction:', error);
      return false;
    }
  }
}

// Helper function for increment (compatibility)
const increment = (value) => {
  return value; // Simplified - in real implementation would use FieldValue.increment
};

export default AuctionService;



