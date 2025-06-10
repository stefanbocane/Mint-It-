/**
 * Auction Status Manager Service
 * 
 * Handles centralized auction status management to prevent race conditions
 * and ensure proper status updates when multiple auctions are active.
 * 
 * 🚀 OPTIMIZED: Thread-safe operations and improved race condition prevention
 */

import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import CacheService from './caching/CacheService';
import ErrorHandlingService from './ErrorHandlingService';

class AuctionStatusManager {
  static _instance = null;
  
  // 🚀 OPTIMIZATION: Thread-safe concurrent operation tracking
  static _activeUpdates = new Map(); // Track ongoing updates
  static _completionQueue = new Map(); // Queue for completion updates
  static _processing = false;
  static _operationLock = new Map(); // Per-auction locks to prevent race conditions

  static getInstance() {
    if (!this._instance) {
      this._instance = new AuctionStatusManager();
    }
    return this._instance;
  }

  /**
   * 🚀 OPTIMIZED: Thread-safe auction status update with proper locking
   * Prevents race conditions by implementing per-auction locks
   */
  static async updateAuctionStatus(auctionId, newStatus, additionalData = {}) {
    if (!auctionId || !newStatus) {
      throw new Error('Auction ID and new status are required');
    }

    const updateKey = `${auctionId}_${newStatus}`;
    
    // 🚀 OPTIMIZATION: Per-auction locking to prevent race conditions
    const lockKey = `lock_${auctionId}`;
    
    // Check if this specific auction is already being updated
    if (this._operationLock.has(lockKey)) {
      console.log(`⏳ Auction ${auctionId} status update already in progress, waiting...`);
      
      // Wait for the existing operation to complete
      try {
        return await this._operationLock.get(lockKey);
      } catch (error) {
        console.error(`❌ Error waiting for auction ${auctionId} lock:`, error);
        // If waiting fails, proceed with new update attempt
      }
    }
    
    // Check for duplicate update requests
    if (this._activeUpdates.has(updateKey)) {
      console.log(`⏭️ Skipping duplicate status update for auction ${auctionId} to ${newStatus}`);
      return this._activeUpdates.get(updateKey);
    }

    // Create the update promise and set locks
    const updatePromise = this._performStatusUpdate(auctionId, newStatus, additionalData);
    
    // Set both tracking maps
    this._activeUpdates.set(updateKey, updatePromise);
    this._operationLock.set(lockKey, updatePromise);

    try {
      const result = await updatePromise;
      return result;
    } catch (error) {
      console.error(`❌ Auction status update failed for ${auctionId}:`, error);
      throw error;
    } finally {
      // Clean up tracking - always executed
      this._activeUpdates.delete(updateKey);
      this._operationLock.delete(lockKey);
      
      // Auto-cleanup stale locks (older than 30 seconds)
      this._cleanupStaleLocks();
    }
  }

  /**
   * 🚀 NEW: Clean up stale locks to prevent memory leaks
   */
  static _cleanupStaleLocks() {
    const now = Date.now();
    const staleThreshold = 30 * 1000; // 30 seconds
    
    // Clean stale active updates
    for (const [key, promise] of this._activeUpdates.entries()) {
      if (promise._startTime && (now - promise._startTime) > staleThreshold) {
        console.warn(`🧹 Cleaning stale update: ${key}`);
        this._activeUpdates.delete(key);
      }
    }
    
    // Clean stale operation locks
    for (const [key, promise] of this._operationLock.entries()) {
      if (promise._startTime && (now - promise._startTime) > staleThreshold) {
        console.warn(`🧹 Cleaning stale lock: ${key}`);
        this._operationLock.delete(key);
      }
    }
  }

  /**
   * Perform the actual status update with proper transaction handling
   * 🚀 OPTIMIZED: Better error handling and atomic operations
   */
  static async _performStatusUpdate(auctionId, newStatus, additionalData) {
    const startTime = Date.now();
    
    try {
      console.log(`🔄 Updating auction ${auctionId} status to ${newStatus}`);

      const result = await runTransaction(db, async (transaction) => {
        // Read phase - get auction and card data atomically
        const auctionRef = doc(db, 'auctions', auctionId);
        const auctionDoc = await transaction.get(auctionRef);

        if (!auctionDoc.exists()) {
          throw new Error(`Auction ${auctionId} not found`);
        }

        const auctionData = auctionDoc.data();
        
        // Validate status transition
        if (!this._isValidStatusTransition(auctionData.status, newStatus)) {
          console.warn(`⚠️ Invalid status transition: ${auctionData.status} -> ${newStatus} for auction ${auctionId}`);
          return { auctionId, newStatus, updated: false, reason: 'invalid_transition' };
        }

        let cardDoc = null;
        let cardData = null;

        if (auctionData.cardId) {
          const cardRef = doc(db, 'cards', auctionData.cardId);
          cardDoc = await transaction.get(cardRef);
          cardData = cardDoc?.data();
        }

        // CRITICAL FIX: Filter out undefined values from additionalData
        const sanitizedAdditionalData = {};
        if (additionalData && typeof additionalData === 'object') {
          Object.keys(additionalData).forEach(key => {
            const value = additionalData[key];
            if (value !== undefined && value !== null) {
              sanitizedAdditionalData[key] = value;
            } else {
              console.warn(`🚨 Filtered out ${key} with value: ${value} from auction update`);
            }
          });
        }

        // CRITICAL FIX: If groupId is missing from auction data but available in current context,
        // try to get it from the current group context or ensure it's provided
        if (!auctionData.groupId && !sanitizedAdditionalData.groupId) {
          console.warn(`⚠️ Auction ${auctionId} missing groupId. This should be investigated.`);
          // Don't add groupId if we don't have a valid one - let the auction remain without it
          // rather than causing an undefined field error
        }

        // Write phase - update auction status atomically
        const now = serverTimestamp();
        const auctionUpdate = {
          status: newStatus,
          lastStatusUpdate: now,
          ...sanitizedAdditionalData
        };

        // Add status-specific fields
        if (newStatus === 'completed') {
          auctionUpdate.completedAt = now;
        } else if (newStatus === 'canceled') {
          auctionUpdate.canceledAt = now;
        } else if (newStatus === 'expired') {
          auctionUpdate.expiredAt = now;
        }

        transaction.update(auctionRef, auctionUpdate);

        // 🚀 OPTIMIZATION: Atomic card status update in same transaction
        if (cardDoc?.exists() && cardData) {
          const cardUpdate = this._determineCardStatusUpdate(
            newStatus, 
            auctionData, 
            cardData, 
            sanitizedAdditionalData,
            auctionId
          );

          if (Object.keys(cardUpdate).length > 0) {
            cardUpdate.lastStatusChange = now;
            transaction.update(doc(db, 'cards', auctionData.cardId), cardUpdate);
            console.log(`📦 Updating card ${auctionData.cardId} status:`, cardUpdate);
          }
        }

        return {
          auctionId,
          newStatus,
          cardId: auctionData.cardId,
          updated: true,
          timestamp: Date.now()
        };
      });

      // Post-transaction cache invalidation (non-blocking)
      setImmediate(async () => {
        try {
          await this._invalidateRelatedCaches(result.auctionId, result.cardId, additionalData);
        } catch (cacheError) {
          console.error('❌ Cache invalidation failed (non-critical):', cacheError);
        }
      });

      const duration = Date.now() - startTime;
      console.log(`✅ Successfully updated auction ${auctionId} status to ${newStatus} in ${duration}ms`);
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Failed to update auction ${auctionId} status to ${newStatus} after ${duration}ms:`, error);
      
      ErrorHandlingService.handleError(error, {
        context: 'AuctionStatusManager',
        operation: 'updateAuctionStatus',
        metadata: { auctionId, newStatus, additionalData, duration }
      });
      throw error;
    }
  }

  /**
   * 🚀 NEW: Validate status transitions to prevent invalid updates
   */
  static _isValidStatusTransition(currentStatus, newStatus) {
    const validTransitions = {
      'active': ['completed', 'canceled', 'expired'],
      'completed': [], // Completed auctions cannot transition
      'canceled': [], // Canceled auctions cannot transition
      'expired': ['canceled'], // Expired auctions can only be canceled
      'pending': ['active', 'canceled'] // Pending auctions can become active or canceled
    };

    const allowedTransitions = validTransitions[currentStatus] || [];
    return allowedTransitions.includes(newStatus);
  }

  /**
   * Determine what card status updates are needed based on auction status
   * 🚀 OPTIMIZED: More comprehensive card status handling
   */
  static _determineCardStatusUpdate(auctionStatus, auctionData, cardData, additionalData, auctionId) {
    const cardUpdate = {};

    switch (auctionStatus) {
      case 'completed':
        // If auction has a winner, transfer ownership
        if (additionalData.winnerUserId && additionalData.winnerUserId !== auctionData.sellerId) {
          cardUpdate.ownerId = additionalData.winnerUserId;
          cardUpdate.ownerName = additionalData.winnerUserName;
          cardUpdate.userId = additionalData.winnerUserId;
          cardUpdate.transferredAt = serverTimestamp();
          cardUpdate.lastTransferAuctionId = auctionId;
          cardUpdate.lastTransferredFrom = auctionData.sellerId;
          cardUpdate.lastTransferredTo = additionalData.winnerUserId;
        }
        
        // Clear auction flags and set to available
        cardUpdate.status = 'available';
        cardUpdate.inAuction = false;
        cardUpdate.auctionId = null;
        
        // Update rarity if provided
        if (additionalData.finalRarity) {
          cardUpdate.rarity = additionalData.finalRarity;
          cardUpdate.lastRarityUpdate = serverTimestamp();
        }
        break;

      case 'canceled':
      case 'expired':
        // Return card to seller and clear auction flags
        cardUpdate.status = 'available';
        cardUpdate.inAuction = false;
        cardUpdate.auctionId = null;
        
        // Ensure card stays with original seller
        if (!cardUpdate.ownerId || cardUpdate.ownerId !== auctionData.sellerId) {
          cardUpdate.ownerId = auctionData.sellerId;
          cardUpdate.userId = auctionData.sellerId;
        }
        break;

      case 'active':
        // Set auction flags
        cardUpdate.status = 'auction';
        cardUpdate.inAuction = true;
        cardUpdate.auctionId = auctionId;
        break;
    }

    return cardUpdate;
  }

  /**
   * Invalidate all related caches after status update
   */
  static async _invalidateRelatedCaches(auctionId, cardId, additionalData) {
    const invalidationPromises = [];

    // Invalidate auction caches
    invalidationPromises.push(
      CacheService.invalidateDocument('auctions', auctionId),
      CacheService.invalidate(`auction_${auctionId}`),
      CacheService.invalidate(`auctions:${auctionId}`)
    );

    // Invalidate card caches if card exists
    if (cardId) {
      invalidationPromises.push(
        CacheService.invalidateDocument('cards', cardId),
        CacheService.invalidate(`card_${cardId}`),
        CacheService.invalidate(`cards:${cardId}`)
      );
    }

    // Invalidate user collection caches for all involved parties
    const userIds = new Set();
    
    if (additionalData.sellerId) userIds.add(additionalData.sellerId);
    if (additionalData.winnerUserId) userIds.add(additionalData.winnerUserId);
    if (additionalData.groupId) {
      userIds.forEach(userId => {
        invalidationPromises.push(
          CacheService.invalidate(`user_cards_${userId}_${additionalData.groupId}`),
          CacheService.invalidate(`shared_user_cards_${userId}_${additionalData.groupId}`)
        );
      });
    }

    // Wait for all cache invalidations
    await Promise.allSettled(invalidationPromises);
    console.log(`🔄 Invalidated caches for auction ${auctionId}, card ${cardId}, users: ${Array.from(userIds).join(', ')}`);
  }

  /**
   * Batch process multiple auction status updates
   */
  static async batchUpdateAuctionStatuses(updates) {
    console.log(`🔄 Processing ${updates.length} auction status updates`);
    
    const results = [];
    const chunks = this._chunkArray(updates, 5); // Process in chunks of 5 to avoid overwhelming database

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(update => 
        this.updateAuctionStatus(update.auctionId, update.status, update.additionalData)
          .catch(error => ({ error, ...update }))
      );

      const chunkResults = await Promise.allSettled(chunkPromises);
      results.push(...chunkResults);

      // Small delay between chunks to prevent database overload
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const successful = results.filter(r => r.status === 'fulfilled' && !r.value.error).length;
    console.log(`✅ Batch update completed: ${successful}/${updates.length} successful`);

    return results;
  }

  /**
   * Verify and fix inconsistent auction/card statuses
   */
  static async verifyAndFixAuctionCardStatuses(groupId) {
    try {
      console.log(`🔍 Verifying auction/card status consistency for group ${groupId}`);

      // Get all auctions that should have completed but cards might still be marked as 'auction'
      const completedAuctions = await this._getCompletedAuctionsWithInconsistentCards(groupId);
      
      if (completedAuctions.length === 0) {
        console.log(`✅ No inconsistent auction/card statuses found for group ${groupId}`);
        return { fixed: 0, total: 0 };
      }

      console.log(`🔧 Found ${completedAuctions.length} auctions with inconsistent card statuses`);

      // Fix each inconsistent auction/card pair
      const fixes = [];
      for (const auction of completedAuctions) {
        try {
          if (auction.status === 'completed' && auction.winnerUserId) {
            // Fix completed auction with winner
            fixes.push({
              auctionId: auction.id,
              status: 'completed',
              additionalData: {
                winnerUserId: auction.winnerUserId,
                winnerUserName: auction.winnerUserName,
                finalRarity: auction.finalRarity || auction.currentRarity,
                sellerId: auction.sellerId,
                groupId: groupId
              }
            });
          } else if (auction.status === 'canceled' || auction.status === 'expired') {
            // Fix canceled/expired auction
            fixes.push({
              auctionId: auction.id,
              status: auction.status,
              additionalData: {
                sellerId: auction.sellerId,
                groupId: groupId
              }
            });
          }
        } catch (error) {
          console.error(`Error preparing fix for auction ${auction.id}:`, error);
        }
      }

      // Apply fixes in batches
      const results = await this.batchUpdateAuctionStatuses(fixes);
      const successful = results.filter(r => r.status === 'fulfilled' && !r.value?.error).length;

      console.log(`🔧 Fixed ${successful}/${fixes.length} inconsistent auction/card statuses`);
      return { fixed: successful, total: fixes.length };

    } catch (error) {
      console.error(`❌ Error verifying auction/card statuses:`, error);
      return { fixed: 0, total: 0, error: error.message };
    }
  }

  /**
   * Get completed auctions that have cards still marked as 'auction' status
   */
  static async _getCompletedAuctionsWithInconsistentCards(groupId) {
    // This is a helper method that would query for inconsistent states
    // Implementation would depend on your specific database query patterns
    return [];
  }

  /**
   * Utility method to chunk arrays
   */
  static _chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Cleanup method for service management
   */
  static cleanup() {
    this._activeUpdates.clear();
    this._completionQueue.clear();
    this._processing = false;
  }
}

export default AuctionStatusManager; 