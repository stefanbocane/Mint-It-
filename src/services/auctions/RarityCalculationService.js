/**
 * Rarity Calculation Service
 * 
 * Handles all rarity-related calculations and updates for auctions and cards.
 * Provides efficient, cached rarity calculations with optimistic updates.
 */

import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { calculateLiveRarity } from '../../utils/auctionRarity';
import CacheService from '../caching/CacheService';
import ErrorHandlingService from '../ErrorHandlingService';

class RarityCalculationService {
  static CACHE_TTL = {
    RARITY_DATA: 60 * 1000, // 1 minute
    CARD_DATA: 5 * 60 * 1000 // 5 minutes
  };

  /**
   * Calculate and update auction rarity
   */
  static async calculateAndUpdateAuctionRarity(auctionData, bidderCount, currentBid) {
    try {
      const updatedAuction = {
        ...auctionData,
        currentBid: currentBid,
        uniqueBidderCount: bidderCount
      };

      const newRarity = calculateLiveRarity(updatedAuction, bidderCount);
      const currentRarity = auctionData.currentRarity || auctionData.cardRarity || 'common';
      
      // CRITICAL FIX: Properly detect changes by comparing actual rarities
      const rarityChanged = newRarity !== currentRarity;
      
      console.log(`🏆 Calculating rarity for auction ${auctionData.id}: '${currentRarity}' vs '${newRarity}' (changed: ${rarityChanged})`);

      return { 
        changed: rarityChanged, 
        rarity: newRarity, 
        previousRarity: currentRarity 
      };

    } catch (error) {
      ErrorHandlingService.handleError(error, {
        context: 'RarityCalculationService',
        operation: 'calculateAndUpdateAuctionRarity'
      });
      return { changed: false, rarity: auctionData.currentRarity || 'common' };
    }
  }

  /**
   * Update auction rarity in database
   */
  static async updateAuctionRarityInDatabase(auctionId, newRarity, bidderCount) {
    try {
      await updateDoc(doc(db, 'auctions', auctionId), {
        currentRarity: newRarity,
        uniqueBidderCount: bidderCount,
        lastRarityUpdate: serverTimestamp()
      });

      console.log(`✅ Updated auction ${auctionId} rarity to ${newRarity} in database`);
      return true;

    } catch (error) {
      ErrorHandlingService.handleError(error, {
        context: 'RarityCalculationService',
        operation: 'updateAuctionRarityInDatabase',
        metadata: { auctionId, newRarity, bidderCount }
      });
      return false;
    }
  }

  /**
   * Update card rarity based on auction performance
   */
  static async updateCardRarity(cardId, newRarity, bidderCount, minimumBidders = 1) {
    try {
      // Update threshold - allow updates with even 1 bidder for responsiveness
      if (bidderCount < minimumBidders) {
        console.log(`⏭️ Skipping card rarity update for ${cardId} - insufficient bidders (${bidderCount} < ${minimumBidders})`);
        return false;
      }

      await updateDoc(doc(db, 'cards', cardId), {
        rarity: newRarity,
        lastRarityUpdate: serverTimestamp(),
        lastAuctionBidderCount: bidderCount
      });

      // Invalidate card cache
      await CacheService.invalidateDocument('cards', cardId);

      console.log(`✅ Updated card ${cardId} rarity to ${newRarity} based on auction performance`);
      return true;

    } catch (error) {
      ErrorHandlingService.handleError(error, {
        context: 'RarityCalculationService',
        operation: 'updateCardRarity',
        metadata: { cardId, newRarity, bidderCount }
      });
      return false;
    }
  }

  /**
   * Get cached rarity data for an auction
   */
  static async getCachedRarityData(auctionId) {
    try {
      const cacheKey = `rarity:${auctionId}`;
      return await CacheService.getValue(cacheKey);
    } catch (error) {
      console.error('Error getting cached rarity data:', error);
      return null;
    }
  }

  /**
   * Cache rarity data for an auction
   */
  static async cacheRarityData(auctionId, rarityData) {
    try {
      const cacheKey = `rarity:${auctionId}`;
      await CacheService.setValue(cacheKey, {
        ...rarityData,
        timestamp: Date.now()
      }, { ttl: this.CACHE_TTL.RARITY_DATA });

      return true;
    } catch (error) {
      console.error('Error caching rarity data:', error);
      return false;
    }
  }

  /**
   * Batch update rarities for multiple auctions
   */
  static async batchUpdateRarities(updates) {
    const results = [];

    for (const update of updates) {
      try {
        const result = await this.calculateAndUpdateAuctionRarity(
          update.auctionData,
          update.bidderCount,
          update.currentBid
        );

        if (result.changed) {
          const dbSuccess = await this.updateAuctionRarityInDatabase(
            update.auctionData.id,
            result.rarity,
            update.bidderCount
          );

          // Update card rarity if applicable
          if (update.auctionData.cardId && dbSuccess) {
            await this.updateCardRarity(
              update.auctionData.cardId,
              result.rarity,
              update.bidderCount
            );
          }
        }

        results.push({
          auctionId: update.auctionData.id,
          success: true,
          changed: result.changed,
          rarity: result.rarity
        });

      } catch (error) {
        console.error(`Failed to process rarity update for auction ${update.auctionData.id}:`, error);
        results.push({
          auctionId: update.auctionData.id,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Get rarity statistics for monitoring
   */
  static async getRarityStats() {
    try {
      // This would typically aggregate from your database
      // For now, returning a placeholder structure
      return {
        totalAuctions: 0,
        rarityDistribution: {
          common: 0,
          uncommon: 0,
          rare: 0,
          epic: 0,
          legendary: 0
        },
        averageBiddersPerRarity: {},
        lastUpdated: new Date()
      };
    } catch (error) {
      console.error('Error getting rarity stats:', error);
      return null;
    }
  }
}

export default RarityCalculationService; 