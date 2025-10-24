/**
 * Coin Award Service
 * 
 * Handles coin awarding when auctions are completed and cards are sold.
 * Ensures sellers receive appropriate compensation with proper transaction logging.
 */

import { addDoc, collection, doc, increment, serverTimestamp, updateDoc } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../../config/firebase';
import CacheService from '../caching/CacheService';
import ErrorHandlingService from '../ErrorHandlingService';
import { getDoc } from '../ReadTracking/TrackedFirestore';

class CoinAwardService {
  static CONFIG = {
    PLATFORM_FEE_PERCENTAGE: 5, // 5% platform fee
    MIN_COIN_AWARD: 1,
    MAX_COIN_AWARD: 10000,
    CACHE_TTL: {
      USER_BALANCE: 2 * 60 * 1000, // 2 minutes
      TRANSACTION_HISTORY: 5 * 60 * 1000 // 5 minutes
    }
  };

  static _metrics = {
    totalCoinsAwarded: 0,
    totalTransactions: 0,
    failedTransactions: 0,
    totalPlatformFees: 0
  };

  /**
   * Award coins to seller when auction completes
   */
  static async awardCoinsForAuctionSale(auctionData, finalBidAmount, winnerId) {
    try {
      if (!auctionData || !auctionData.sellerId || !finalBidAmount) {
        console.warn('⚠️ Invalid auction data for coin award');
        return { success: false, reason: 'Invalid auction data' };
      }

      // Calculate platform fee and seller earnings
      const platformFee = Math.floor(finalBidAmount * (this.CONFIG.PLATFORM_FEE_PERCENTAGE / 100));
      const sellerEarnings = finalBidAmount - platformFee;

      // Validate earnings
      if (sellerEarnings < this.CONFIG.MIN_COIN_AWARD) {
        console.warn(`⚠️ Seller earnings too low: ${sellerEarnings}`);
        return { success: false, reason: 'Earnings below minimum threshold' };
      }

      if (sellerEarnings > this.CONFIG.MAX_COIN_AWARD) {
        console.warn(`⚠️ Seller earnings too high: ${sellerEarnings}`);
        return { success: false, reason: 'Earnings above maximum threshold' };
      }

      console.log(`💰 Awarding ${sellerEarnings} coins to seller ${auctionData.sellerId} (Platform fee: ${platformFee})`);

      // Start transaction record
      const transactionId = await this._createTransactionRecord({
        type: 'auction_sale',
        sellerId: auctionData.sellerId,
        winnerId: winnerId,
        auctionId: auctionData.id,
        cardId: auctionData.cardId,
        grossAmount: finalBidAmount,
        platformFee: platformFee,
        netAmount: sellerEarnings,
        status: 'processing'
      });

      try {
        // Award coins to seller
        await this._updateUserBalance(auctionData.sellerId, sellerEarnings);

        // Update transaction as completed
        await this._updateTransactionStatus(transactionId, 'completed');

        // Update auction with transaction details
        await updateDoc(doc(db, 'auctions', auctionData.id), {
          sellerEarnings: sellerEarnings,
          platformFee: platformFee,
          transactionId: transactionId,
          coinsAwarded: true,
          coinsAwardedAt: serverTimestamp()
        });

        // Invalidate user balance cache
        await CacheService.invalidate(`user:balance:${auctionData.sellerId}`);

        // Update metrics
        this._metrics.totalCoinsAwarded += sellerEarnings;
        this._metrics.totalPlatformFees += platformFee;
        this._metrics.totalTransactions++;

        console.log(`✅ Successfully awarded ${sellerEarnings} coins to seller ${auctionData.sellerId}`);

        return {
          success: true,
          sellerEarnings,
          platformFee,
          transactionId
        };

      } catch (error) {
        // Update transaction as failed
        await this._updateTransactionStatus(transactionId, 'failed', error.message);
        throw error;
      }

    } catch (error) {
      ErrorHandlingService.handleError(error, {
        context: 'CoinAwardService',
        operation: 'awardCoinsForAuctionSale',
        metadata: { auctionId: auctionData?.id, sellerId: auctionData?.sellerId }
      });

      this._metrics.failedTransactions++;
      return { success: false, error: error.message };
    }
  }

  /**
   * Update user's coin balance
   */
  static async _updateUserBalance(userId, coinAmount) {
    try {
      const userDocRef = doc(db, 'users', userId);
      
      await updateDoc(userDocRef, {
        coins: increment(coinAmount),
        lastCoinUpdate: serverTimestamp(),
        totalEarnings: increment(coinAmount)
      });

      console.log(`💰 Added ${coinAmount} coins to user ${userId}`);
      return true;

    } catch (error) {
      console.error(`Failed to update balance for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Create transaction record for audit trail
   */
  static async _createTransactionRecord(transactionData) {
    try {
      const transactionRef = await addDoc(collection(db, 'transactions'), {
        ...transactionData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      console.log(`📝 Created transaction record: ${transactionRef.id}`);
      return transactionRef.id;

    } catch (error) {
      console.error('Failed to create transaction record:', error);
      throw error;
    }
  }

  /**
   * Update transaction status
   */
  static async _updateTransactionStatus(transactionId, status, errorMessage = null) {
    try {
      const updateData = {
        status,
        updatedAt: serverTimestamp()
      };

      if (errorMessage) {
        updateData.errorMessage = errorMessage;
      }

      await updateDoc(doc(db, 'transactions', transactionId), updateData);
      console.log(`📝 Updated transaction ${transactionId} status to: ${status}`);

    } catch (error) {
      console.error(`Failed to update transaction ${transactionId}:`, error);
    }
  }

  /**
   * Get user's current coin balance (with caching)
   */
  static async getUserBalance(userId) {
    try {
      const cacheKey = `user:balance:${userId}`;
      let cachedBalance = await CacheService.getValue(cacheKey);

      if (cachedBalance !== null) {
        return cachedBalance;
      }

      // Fetch from database
      const userDoc = await getDoc(doc(db, 'users', userId, 'sessions', 'main'));
      
      if (!userDoc.exists()) {
        console.warn(`User ${userId} not found`);
        return 0;
      }

      const userData = userDoc.data();
      const balance = userData.coins || 0;

      // Cache the balance
      await CacheService.setValue(cacheKey, balance, {
        ttl: this.CONFIG.CACHE_TTL.USER_BALANCE
      });

      return balance;

    } catch (error) {
      console.error(`Error getting balance for user ${userId}:`, error);
      return 0;
    }
  }

  /**
   * Process refund for cancelled auction
   */
  static async processAuctionRefund(auctionData, reason = 'auction_cancelled') {
    try {
      if (!auctionData.coinsAwarded) {
        console.log('No coins were awarded, no refund needed');
        return { success: true, reason: 'No refund needed' };
      }

      const refundAmount = auctionData.sellerEarnings || 0;
      
      if (refundAmount <= 0) {
        console.log('No refund amount specified');
        return { success: true, reason: 'No refund amount' };
      }

      console.log(`🔄 Processing refund of ${refundAmount} coins for auction ${auctionData.id}`);

      // Create refund transaction record
      const transactionId = await this._createTransactionRecord({
        type: 'auction_refund',
        sellerId: auctionData.sellerId,
        auctionId: auctionData.id,
        cardId: auctionData.cardId,
        refundAmount: refundAmount,
        reason: reason,
        status: 'processing'
      });

      try {
        // Deduct coins from seller (negative increment)
        await this._updateUserBalance(auctionData.sellerId, -refundAmount);

        // Update transaction as completed
        await this._updateTransactionStatus(transactionId, 'completed');

        // Update auction
        await updateDoc(doc(db, 'auctions', auctionData.id), {
          refundProcessed: true,
          refundAmount: refundAmount,
          refundTransactionId: transactionId,
          refundedAt: serverTimestamp()
        });

        // Invalidate user balance cache
        await CacheService.invalidate(`user:balance:${auctionData.sellerId}`);

        console.log(`✅ Successfully processed refund of ${refundAmount} coins`);

        return {
          success: true,
          refundAmount,
          transactionId
        };

      } catch (error) {
        await this._updateTransactionStatus(transactionId, 'failed', error.message);
        throw error;
      }

    } catch (error) {
      ErrorHandlingService.handleError(error, {
        context: 'CoinAwardService',
        operation: 'processAuctionRefund',
        metadata: { auctionId: auctionData?.id }
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Get transaction history for a user
   */
  static async getUserTransactionHistory(userId, limit = 20) {
    try {
      const cacheKey = `user:transactions:${userId}:${limit}`;
      let cachedHistory = await CacheService.getValue(cacheKey);

      if (cachedHistory) {
        return cachedHistory;
      }

      // This would typically query the transactions collection
      // For now, returning a placeholder
      const history = [];

      // Cache the history
      await CacheService.setValue(cacheKey, history, {
        ttl: this.CONFIG.CACHE_TTL.TRANSACTION_HISTORY
      });

      return history;

    } catch (error) {
      console.error(`Error getting transaction history for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Calculate platform fee for a given amount
   */
  static calculatePlatformFee(amount) {
    return Math.floor(amount * (this.CONFIG.PLATFORM_FEE_PERCENTAGE / 100));
  }

  /**
   * Calculate seller earnings after platform fee
   */
  static calculateSellerEarnings(grossAmount) {
    const platformFee = this.calculatePlatformFee(grossAmount);
    return grossAmount - platformFee;
  }

  /**
   * Get service metrics
   */
  static getMetrics() {
    return {
      ...this._metrics,
      averageTransactionAmount: this._metrics.totalCoinsAwarded / Math.max(this._metrics.totalTransactions, 1),
      successRate: (this._metrics.totalTransactions - this._metrics.failedTransactions) / Math.max(this._metrics.totalTransactions, 1),
      platformFeePercentage: this.CONFIG.PLATFORM_FEE_PERCENTAGE
    };
  }

  /**
   * Reset metrics
   */
  static resetMetrics() {
    this._metrics = {
      totalCoinsAwarded: 0,
      totalTransactions: 0,
      failedTransactions: 0,
      totalPlatformFees: 0
    };
  }
}

export default CoinAwardService; 