/**
 * Auction Completion Service
 * 
 * Handles automatic rarity updates and collection synchronization when auctions complete.
 * Provides real-time updates without requiring manual refresh.
 * 
 * 🚀 OPTIMIZED: Fixed memory leaks and improved listener management
 */

import { collection, doc, limit, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import CacheService from './caching/CacheService';
import ErrorHandlingService from './ErrorHandlingService';

class AuctionCompletionService {
  static _instance = null;
  
  // 🚀 OPTIMIZATION: Safer listener management to prevent memory leaks
  static _listeners = new Map(); // Store listeners with proper cleanup tracking
  static _listenerMetadata = new WeakMap(); // Track metadata without preventing GC
  static _isInitialized = false;
  static _cleanupTimer = null; // Timer for periodic cleanup

  // FLAG: If true we rely on Cloud-Function + FCM push and skip Firestore listeners entirely
  static USE_PUSH_COMPLETIONS = true;

  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!this._instance) {
      this._instance = new AuctionCompletionService();
    }
    return this._instance;
  }

  /**
   * 🚀 OPTIMIZED: Initialize with proper cleanup and error handling
   */
  static async initialize(userId, groupId) {
    if (!userId || !groupId) {
      console.warn('AuctionCompletionService: Cannot initialize without userId and groupId');
      return;
    }

    // If push-based completions are enabled, skip creating Firestore listeners to save reads
    if (this.USE_PUSH_COMPLETIONS) {
      console.log('🎯 AuctionCompletionService: Using push-based completion updates – listener disabled');
      this._isInitialized = true;
      return;
    }

    // Ensure listeners map is always properly initialized
    if (!this._listeners || typeof this._listeners.clear !== 'function') {
      console.warn('🔧 AuctionCompletionService: Reinitializing corrupted listeners map');
      this._listeners = new Map();
    }

    try {
      const instance = this.getInstance();

      // Only set up Firestore listener if push completions are NOT in use
      if (!this.USE_PUSH_COMPLETIONS) {
        await instance._setupAuctionCompletionListener(userId, groupId);
      }
      this._isInitialized = true;
      
      // Set up periodic cleanup to prevent memory leaks
      this._setupPeriodicCleanup();
      
      console.log('🎯 AuctionCompletionService initialized for user', userId, 'in group', groupId);
    } catch (error) {
      console.error('❌ Failed to initialize AuctionCompletionService:', error);
      ErrorHandlingService.handleError(error, {
        context: 'AuctionCompletionService',
        operation: 'initialize',
        metadata: { userId, groupId }
      });
    }
  }

  /**
   * 🚀 NEW: Set up periodic cleanup to prevent memory leaks
   */
  static _setupPeriodicCleanup() {
    // Clear any existing cleanup timer
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
    }

    // Set up periodic cleanup every 5 minutes
    this._cleanupTimer = setInterval(() => {
      this._performPeriodicCleanup();
    }, 5 * 60 * 1000);

    console.log('🧹 AuctionCompletionService: Periodic cleanup timer established');
  }

  /**
   * 🚀 NEW: Perform periodic cleanup of stale listeners
   */
  static _performPeriodicCleanup() {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    let cleanedCount = 0;

    // Check for stale listeners
    for (const [key, listenerData] of this._listeners.entries()) {
      if (listenerData.createdAt && (now - listenerData.createdAt) > maxAge) {
        console.warn(`🧹 Cleaning up stale listener: ${key}`);
        try {
          if (typeof listenerData.unsubscribe === 'function') {
            listenerData.unsubscribe();
          }
          this._listeners.delete(key);
          cleanedCount++;
        } catch (error) {
          console.error(`❌ Error cleaning up stale listener ${key}:`, error);
        }
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 AuctionCompletionService: Cleaned up ${cleanedCount} stale listeners`);
    }
  }

  /**
   * 🚀 OPTIMIZED: Enhanced cleanup with proper memory management
   */
  static cleanup() {
    console.log('🧹 AuctionCompletionService: Starting cleanup...');
    
    // Clear periodic cleanup timer
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }

    // Ensure listeners map exists and is iterable
    if (this._listeners && typeof this._listeners.forEach === 'function') {
      let cleanupCount = 0;
      let errorCount = 0;

      this._listeners.forEach((listenerData, key) => {
        try {
          if (listenerData && typeof listenerData.unsubscribe === 'function') {
            listenerData.unsubscribe();
            cleanupCount++;
          } else if (typeof listenerData === 'function') {
            // Handle legacy function-only listeners
            listenerData();
            cleanupCount++;
          }
        } catch (error) {
          console.error(`❌ Error cleaning up listener ${key}:`, error);
          errorCount++;
        }
      });

      this._listeners.clear();
      console.log(`🧹 AuctionCompletionService: Cleaned up ${cleanupCount} listeners (${errorCount} errors)`);
    } else {
      // Reinitialize if corrupted
      console.warn('🔧 AuctionCompletionService: Reinitializing corrupted listeners map during cleanup');
      this._listeners = new Map();
    }

    // Clear WeakMap (though it should GC automatically)
    if (this._listenerMetadata) {
      // WeakMap doesn't have a clear method, but setting to new WeakMap helps GC
      this._listenerMetadata = new WeakMap();
    }

    this._isInitialized = false;
    console.log('🧹 AuctionCompletionService: Cleanup completed');
  }

  /**
   * 🚀 OPTIMIZED: Enhanced listener setup with better error handling and tracking
   */
  async _setupAuctionCompletionListener(userId, groupId) {
    if (!userId || !groupId) {
      console.warn('AuctionCompletionService: Missing userId or groupId for listener setup');
      return;
    }

    // Use shared listener pool to prevent duplicate listeners
    const listenerKey = `auction_completion_${groupId}`;
    
    if (this.constructor._listeners.has(listenerKey)) {
      console.log(`🎯 AuctionCompletionService: Reusing existing listener for group ${groupId}`);
      return;
    }

    try {
      // Set up query for auctions in this group (simplified to avoid index requirement)
      const completionQuery = query(
        collection(db, 'auctions'),
        where('groupId', '==', groupId),
        where('status', 'in', ['completed', 'canceled']),
        limit(20) // Limit without orderBy to avoid index requirement
      );

      // Create throttled callback to reduce update frequency
      const throttleMs = 5000; // 5 seconds
      let lastUpdate = 0;
      let pendingUpdate = null;
      let updateTimeout = null;

      const throttledCallback = (snapshot) => {
        const now = Date.now();
        
        if (now - lastUpdate < throttleMs) {
          // Too soon, schedule for later
          pendingUpdate = snapshot;
          
          if (!updateTimeout) {
            updateTimeout = setTimeout(() => {
              if (pendingUpdate) {
                processSnapshot(pendingUpdate);
                pendingUpdate = null;
              }
              updateTimeout = null;
              lastUpdate = Date.now();
            }, throttleMs - (now - lastUpdate));
          }
          return;
        }
        
        // Process immediately
        processSnapshot(snapshot);
        lastUpdate = now;
      };

      const processSnapshot = async (snapshot) => {
        if (snapshot.empty) return;

        try {
          // Process completed auctions
          const recentCompletions = [];
          const processedIds = new Set();

          snapshot.docChanges().forEach((change) => {
            if (change.type === 'modified' || change.type === 'added') {
              const auctionData = { id: change.doc.id, ...change.doc.data() };
              
              // Skip if already processed
              if (processedIds.has(auctionData.id)) return;
              processedIds.add(auctionData.id);

              // Only process if this auction was completed recently (within last 5 minutes)
              const completedAt = auctionData.completedAt?.toDate?.() || auctionData.canceledAt?.toDate?.();
              if (completedAt) {
                const timeSinceCompletion = Date.now() - completedAt.getTime();
                if (timeSinceCompletion < 5 * 60 * 1000) { // 5 minutes
                  recentCompletions.push(auctionData);
                }
              }
            }
          });

          if (recentCompletions.length > 0) {
            console.log(`🎯 AuctionCompletionService: Processing ${recentCompletions.length} recent completions`);
            
            // Batch process completions
            await this._processAuctionCompletions(userId, groupId, recentCompletions);
            
            // Update cache with processed completions
            const cacheKey = `recent_completions_${groupId}`;
            await CacheService.setValue(cacheKey, recentCompletions, { ttl: 5 * 60 * 1000 }); // 5 minutes TTL
          }
        } catch (processingError) {
          console.error('❌ Error processing auction completions:', processingError);
          ErrorHandlingService.handleError(processingError, {
            context: 'AuctionCompletionService',
            operation: '_setupAuctionCompletionListener_callback'
          });
        }
      };

      const unsubscribe = onSnapshot(completionQuery, throttledCallback, (error) => {
        console.error('❌ Error in auction completion listener:', error);
        ErrorHandlingService.handleError(error, {
          context: 'AuctionCompletionService',
          operation: '_setupAuctionCompletionListener'
        });
      });

      this.constructor._listeners.set(listenerKey, unsubscribe);
      console.log(`🎯 AuctionCompletionService: Set up listener for group ${groupId}`);

    } catch (error) {
      console.error('❌ Error setting up auction completion listener:', error);
      ErrorHandlingService.handleError(error, {
        context: 'AuctionCompletionService',
        operation: '_setupAuctionCompletionListener'
      });
    }
  }

  /**
   * Process completed auctions and update affected cards
   */
  async _processAuctionCompletions(userId, groupId, completedAuctions) {
    try {
      // Validate input parameters
      if (!completedAuctions || !Array.isArray(completedAuctions)) {
        console.warn('🎯 AuctionCompletionService: completedAuctions is not an array:', completedAuctions);
        return;
      }

      if (completedAuctions.length === 0) {
        console.log('🎯 AuctionCompletionService: No completed auctions to process');
        return;
      }

      // Get user's current collection to check for affected cards
      const userCards = await CacheService.getDocument('userCards', `${userId}_${groupId}`, {
        forceRefresh: true
      });

      if (!userCards || !Array.isArray(userCards)) {
        console.log('🎯 AuctionCompletionService: No user cards found or invalid format');
        return;
      }

      const cardsToUpdate = [];
      const cacheInvalidations = [];

      // Process each completed auction
      for (const auction of completedAuctions) {
        try {
          if (!auction || !auction.id) {
            console.warn('🎯 AuctionCompletionService: Invalid auction data:', auction);
            continue;
          }

          await this._processSingleAuctionCompletion(
            userId, 
            groupId, 
            auction, 
            userCards, 
            cardsToUpdate,
            cacheInvalidations
          );
        } catch (error) {
          console.error(`❌ Error processing auction ${auction?.id || 'unknown'}:`, error);
        }
      }

      // Apply all card updates
      if (cardsToUpdate.length > 0) {
        await this._batchUpdateCards(cardsToUpdate);
        console.log(`✅ AuctionCompletionService: Updated ${cardsToUpdate.length} cards`);
      }

      // Invalidate relevant caches
      if (cacheInvalidations.length > 0) {
        await Promise.all(cacheInvalidations);
        console.log(`🔄 AuctionCompletionService: Invalidated ${cacheInvalidations.length} caches`);
      }

    } catch (error) {
      ErrorHandlingService.handleError(error, {
        context: 'AuctionCompletionService',
        operation: '_processAuctionCompletions'
      });
    }
  }

  /**
   * Process a single auction completion
   */
  async _processSingleAuctionCompletion(userId, groupId, auction, userCards, cardsToUpdate, cacheInvalidations) {
    // Check if this auction affects the user's collection
    const affectedCard = this._findAffectedCard(auction, userCards, userId);
    
    if (!affectedCard) {
      return; // This auction doesn't affect user's collection
    }

    console.log(`🎯 AuctionCompletionService: Processing auction ${auction.id} for card ${affectedCard.id}`);

    // Determine if card rarity needs updating
    const shouldUpdateRarity = this._shouldUpdateCardRarity(auction, affectedCard);
    
    if (shouldUpdateRarity) {
      const finalRarity = auction.finalRarity || auction.currentRarity || 'common';
      
      cardsToUpdate.push({
        cardId: affectedCard.id,
        updates: {
          rarity: finalRarity,
          lastRarityUpdate: serverTimestamp(),
          lastAuctionId: auction.id
        }
      });

      // Add cache invalidations
      cacheInvalidations.push(
        CacheService.invalidateDocument('cards', affectedCard.id),
        CacheService.invalidate(`user_cards_${userId}_${groupId}`),
        CacheService.invalidate(`shared_user_cards_${userId}_${groupId}`)
      );

      console.log(`🔄 AuctionCompletionService: Will update card ${affectedCard.id} rarity to ${finalRarity}`);
    }
  }

  /**
   * Find if an auction affects any card in user's collection
   */
  _findAffectedCard(auction, userCards, userId) {
    // Case 1: User won this auction
    if (auction.status === 'completed' && auction.winnerUserId === userId && auction.cardId) {
      return userCards.find(card => card.id === auction.cardId);
    }

    // Case 2: User owns a card that was in this auction (should have updated rarity)
    if (auction.cardId) {
      return userCards.find(card => card.id === auction.cardId && card.ownerId === userId);
    }

    // Case 3: Match by card characteristics if cardId is missing
    if (auction.cardName || auction.cardImage) {
      return userCards.find(card => {
        const nameMatch = auction.cardName && card.name === auction.cardName;
        const imageMatch = auction.cardImage && card.image === auction.cardImage;
        return nameMatch || imageMatch;
      });
    }

    return null;
  }

  /**
   * Determine if card rarity should be updated
   */
  _shouldUpdateCardRarity(auction, card) {
    // If no final rarity is set, don't update
    if (!auction.finalRarity && !auction.currentRarity) {
      return false;
    }

    const auctionRarity = auction.finalRarity || auction.currentRarity;
    
    // If rarities already match, no update needed
    if (card.rarity === auctionRarity) {
      return false;
    }

    // Check timing - only update if auction completed after card's last rarity update
    const auctionCompleted = auction.completedAt?.toDate?.() || auction.canceledAt?.toDate?.();
    const cardLastUpdate = card.lastRarityUpdate?.toDate?.();
    
    if (auctionCompleted && cardLastUpdate) {
      return auctionCompleted > cardLastUpdate;
    }

    // If no timing info available but auction is completed, update anyway
    return auction.status === 'completed' || (auction.status === 'canceled' && auction.finalRarity);
  }

  /**
   * Batch update multiple cards
   */
  async _batchUpdateCards(cardsToUpdate) {
    const updatePromises = cardsToUpdate.map(async ({ cardId, updates }) => {
      try {
        const cardRef = doc(db, 'cards', cardId);
        await updateDoc(cardRef, updates);
        console.log(`✅ Updated card ${cardId} with rarity ${updates.rarity}`);
      } catch (error) {
        console.error(`❌ Failed to update card ${cardId}:`, error);
      }
    });

    await Promise.allSettled(updatePromises);
  }

  /**
   * Clean up existing listener
   */
  _cleanupExistingListener(listenerKey) {
    // Ensure _listeners exists and has forEach method
    if (this.constructor._listeners && typeof this.constructor._listeners.forEach === 'function') {
      this.constructor._listeners.forEach(unsubscribe => {
        try {
          if (typeof unsubscribe === 'function') {
            unsubscribe();
          }
        } catch (error) {
          console.error('Error cleaning up existing listener:', error);
        }
      });
      this.constructor._listeners.clear();
    } else {
      // Reinitialize if corrupted
      this.constructor._listeners = new Map();
    }
  }

  /**
   * Check if service is initialized
   */
  static isInitialized() {
    return this._isInitialized;
  }

  /**
   * Force refresh collection after auction completion
   */
  static async forceCollectionRefresh(userId, groupId) {
    try {
      // Invalidate collection caches to force refresh
      await Promise.all([
        CacheService.invalidate(`user_cards_${userId}_${groupId}`),
        CacheService.invalidate(`shared_user_cards_${userId}_${groupId}`),
        CacheService.invalidate(`collection_${userId}_${groupId}`)
      ]);
      
      console.log(`🔄 AuctionCompletionService: Forced collection refresh for user ${userId}`);
    } catch (error) {
      console.error('❌ Error forcing collection refresh:', error);
    }
  }
}

export default AuctionCompletionService; 