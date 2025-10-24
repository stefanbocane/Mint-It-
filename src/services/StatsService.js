import { doc, increment, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { runTransaction } from './ReadTracking/TrackedFirestore';
// 🚀 TRACKED: Automatic read monitoring (reads handled via CacheService)
import { db } from '../config/firebase';
import CacheService from './caching/CacheService';

class StatsService {
  static async recordTradeComplete(userId, tradeData) {
    try {
      const statsRef = doc(db, 'userStats', userId);
      
      // First, get the current document to check if it exists (using cache for better performance)
      const statsData = await CacheService.getDocument('userStats', userId, { ttl: 30 * 1000 }); // 30 second cache for stats
      
      // Prepare the trade record
      const tradeRecord = {
        cardId: tradeData.cardId,
        rarity: tradeData.rarity,
        timestamp: new Date().toISOString(), // Use ISO string instead of serverTimestamp for arrays
        type: 'trade',
        partnerId: tradeData.partnerId,
        receivedCardId: tradeData.receivedCardId,
        receivedRarity: tradeData.receivedRarity
      };

      // If the document doesn't exist, create it with initial values
      if (!statsData) {
        const initialData = {
          tradesCompleted: 1,
          lastUpdated: serverTimestamp(),
          recentTrades: [tradeRecord],
          auctionsByRarity: {},
          auctionsWon: 0,
          recentAuctions: [],
          rarityTraded: {}
        };

        // Only add rarity tracking if rarity is valid
        if (tradeData.rarity && typeof tradeData.rarity === 'string') {
          initialData.rarityTraded[tradeData.rarity] = 1;
        }

        await setDoc(statsRef, initialData);
      } else {
        // Document exists, update it with the new trade
        const currentData = statsData;
        const recentTrades = Array.isArray(currentData.recentTrades) 
          ? [...currentData.recentTrades, tradeRecord].slice(-50) // Keep only last 50
          : [tradeRecord];
          
        const updatePayload = {
          tradesCompleted: increment(1),
          lastUpdated: serverTimestamp(),
          recentTrades: recentTrades,
        };

        if (tradeData.rarity && typeof tradeData.rarity === 'string') {
          const rarityKey = `rarityTraded.${tradeData.rarity}`;
          updatePayload[rarityKey] = increment(1);
        } else {
          // Handle cases where rarity might be missing or not a string
          // Optionally, log this or assign a default rarity
          console.warn(`Trade ${tradeData.cardId} has no rarity or invalid rarity type: ${tradeData.rarity}`);
        }
        
        await updateDoc(statsRef, updatePayload);
        
        // Invalidate cache after update
        await CacheService.invalidate(`userStats:${userId}`);
      }
      
      return true;
    } catch (error) {
      console.error('Error recording trade completion:', error);
      return false;
    }
  }

  static async recordAuctionWin(userId, auctionData) {
    try {
      const statsRef = doc(db, 'userStats', userId);
      
      // Use a transaction to ensure data consistency
      await runTransaction(db, async (transaction) => {
        // STEP 1: Get all document references that will be needed
        const statsDoc = await transaction.get(statsRef);
        
        // STEP 2: Prepare data based on the reads
        // Prepare the auction record with client-side timestamp
        const auctionRecord = {
          cardId: auctionData.cardId,
          rarity: auctionData.rarity,
          timestamp: new Date().toISOString(), // Will be updated after transaction
          type: 'win',
          winningBid: auctionData.winningBid,
          auctionId: auctionData.auctionId,
          bidderCount: auctionData.bidderCount || 1
        };

        // STEP 3: Now perform all writes after all reads are complete
        if (!statsDoc.exists()) {
          // If the document doesn't exist, create it with initial values
          const initialData = {
            auctionsWon: 1,
            lastUpdated: new Date().toISOString(),
            recentAuctions: [auctionRecord],
            auctionsByRarity: {
              [auctionData.rarity]: {
                won: 1,
                completed: 0,
                totalEarned: 0
              }
            },
            tradesCompleted: 0,
            recentTrades: [],
            rarityTraded: {}
          };
          
          transaction.set(statsRef, initialData);
        } else {
          // Document exists, update it with the new auction
          const currentData = statsDoc.data();
          
          // Prepare the recent auctions array with the new record
          const recentAuctions = Array.isArray(currentData.recentAuctions) 
            ? [auctionRecord, ...currentData.recentAuctions].slice(0, 50) // Keep only first 50
            : [auctionRecord];
          
          // Initialize rarity data if it doesn't exist
          const auctionsByRarity = currentData.auctionsByRarity || {};
          const currentRarityStats = auctionsByRarity[auctionData.rarity] || {
            won: 0,
            completed: 0,
            totalEarned: 0
          };
          
          // Update the document with all changes in a single transaction
          transaction.update(statsRef, {
            auctionsWon: increment(1),
            lastUpdated: new Date().toISOString(),
            recentAuctions: recentAuctions,
            [`auctionsByRarity.${auctionData.rarity}`]: {
              won: currentRarityStats.won + 1,
              completed: currentRarityStats.completed,
              totalEarned: currentRarityStats.totalEarned
            }
          });
        }
      });
      
      // After transaction completes, update the timestamp with server timestamp
      // This is a best-effort update and won't block the transaction
      try {
        const currentData = await CacheService.getDocument('userStats', userId, { ttl: 10 * 1000 }); // Short cache for post-transaction update
        if (currentData) {
          const recentAuctions = Array.isArray(currentData.recentAuctions) ? [...currentData.recentAuctions] : [];
          
          // Find and update the auction record with server timestamp
          const auctionIndex = recentAuctions.findIndex(a => a.auctionId === auctionData.auctionId);
          if (auctionIndex >= 0) {
            // recentAuctions[auctionIndex] = {  // DO NOT set serverTimestamp in array item
            //   ...recentAuctions[auctionIndex],
            //   timestamp: serverTimestamp()
            // };
            
            await updateDoc(statsRef, {
              // recentAuctions: recentAuctions, // DO NOT write the array back if only timestamp was intended for one item
              lastUpdated: serverTimestamp() // Only update lastUpdated for the document
            });
          }
        }
      } catch (updateError) {
        console.error('Error updating auction timestamp:', updateError);
        // Non-critical error, continue
      }
      
      return true;
    } catch (error) {
      console.error('Error recording auction win:', error);
      return false;
    }
  }

  static async recordAuctionRarity(userId, auctionData) {
    try {
      const statsRef = doc(db, 'userStats', userId);
      
      // First, get the current document to check if it exists (using cache for better performance)
      const statsData = await CacheService.getDocument('userStats', userId, { ttl: 30 * 1000 }); // 30 second cache for stats
      
      // If the document doesn't exist, create it with initial values
      if (!statsData) {
        const initialData = {
          tradesCompleted: 0,
          recentTrades: [],
          auctionsWon: 0,
          recentAuctions: [],
          auctionsByRarity: {
            [auctionData.rarity]: {
              completed: 1,
              won: auctionData.wasWinner ? 1 : 0,
              totalEarned: (auctionData.wasWinner && auctionData.finalPrice) ? auctionData.finalPrice : 0
            }
          },
          rarityTraded: {},
          lastUpdated: serverTimestamp()
        };
        
        await setDoc(statsRef, initialData);
        return true;
      }
      
      // Document exists, prepare the update
      const currentData = statsData;
      const currentAuctionsByRarity = currentData.auctionsByRarity || {};
      const currentRarityStats = currentAuctionsByRarity[auctionData.rarity] || {
        completed: 0,
        won: 0,
        totalEarned: 0
      };
      
      // Prepare the update
      const updateData = {
        lastUpdated: serverTimestamp(),
        [`auctionsByRarity.${auctionData.rarity}.completed`]: currentRarityStats.completed + 1
      };
      
      // If this was a winning bid, update the won count and total earned
      if (auctionData.wasWinner) {
        updateData[`auctionsByRarity.${auctionData.rarity}.won`] = currentRarityStats.won + 1;
        updateData[`auctionsByRarity.${auctionData.rarity}.totalEarned`] = 
          (currentRarityStats.totalEarned || 0) + (auctionData.finalPrice || 0);
        
        // Update the total auctions won counter
        updateData.auctionsWon = (currentData.auctionsWon || 0) + 1;
      }
      
      // Update the document
      await updateDoc(statsRef, updateData);
      
      // Invalidate cache after update
      await CacheService.invalidate(`userStats:${userId}`);
      return true;
      
    } catch (error) {
      console.error('Error recording auction rarity:', error);
      return false;
    }
  }

  static async getUserStats(userId) {
    try {
      // Use CacheService to get user stats with caching
      const userStats = await CacheService.getDocument('userStats', userId, {
        ttl: CacheService.CACHE_TTL.MEDIUM // Or a more appropriate TTL
      });

      if (userStats) {
        return userStats;
      }

      // Return default stats if document does not exist in cache or Firestore
      return {
        tradesCompleted: 0,
        auctionsWon: 0,
        auctionsByRarity: {},
        rarityTraded: {},
        recentTrades: [],
        recentAuctions: []
      };
    } catch (error) {
      console.error('Error getting user stats with caching:', error);
      // Fallback to direct read if caching fails (optional, but good for resilience)
      try {
        const statsRef = doc(db, 'userStats', userId);
        const fallbackData = await CacheService.getDocument('userStats', userId, { forceRefresh: true }); // Force refresh on fallback

        if (fallbackData) {
          return fallbackData;
        }
         return {
          tradesCompleted: 0,
          auctionsWon: 0,
          auctionsByRarity: {},
          rarityTraded: {},
          recentTrades: [],
          recentAuctions: []
        };
      } catch (fallbackError) {
         console.error('Error getting user stats with fallback:', fallbackError);
         throw fallbackError; // Re-throw the original error if fallback also fails
      }
    }
  }

  static async getCachedStats(userId, groupId, options = {}) {
    try {
      const { 
        forceRefresh = false, 
        ttl = CacheService.CACHE_TTL?.MEDIUM || 5 * 60 * 1000, // 5 minutes default
        includeMetrics = []
      } = options;

      // Create cache key that includes groupId for group-specific stats
      const cacheKey = `user_stats_${userId}_${groupId || 'default'}`;

      // Check cache first unless force refresh is requested
      if (!forceRefresh) {
        const cachedStats = await CacheService.getValue(cacheKey);
        if (cachedStats) {
          return cachedStats;
        }
      }

      // Get base user stats
      const baseStats = await this.getUserStats(userId);

      // Get additional user data for enhanced stats
      const userData = await CacheService.getDocument('users', userId, {
        ttl: ttl,
        forceRefresh: forceRefresh
      });

      // Build enhanced stats object
      const enhancedStats = {
        ...baseStats,
        // Add user-level stats from user document
        totalCards: userData?.totalCards || 0,
        gemsEarned: userData?.gemsEarned || 0,
        level: userData?.level || 1,
        experience: userData?.experience || 0,
        totalValue: userData?.totalValue || 0,
        rareCards: userData?.rareCards || 0,
        lastActive: userData?.lastActive || null,
        joinedAt: userData?.createdAt || null
      };

      // Add group-specific data if groupId is provided
      if (groupId && userData?.groups?.[groupId]) {
        enhancedStats.groupData = {
          joinedAt: userData.groups[groupId].joinedAt,
          role: userData.groups[groupId].role || 'member',
          groupId: groupId
        };
      }

      // Add recent activity if requested
      if (includeMetrics.includes('recentActivity')) {
        enhancedStats.recentActivity = [
          ...(baseStats.recentTrades || []).map(trade => ({
            ...trade,
            type: 'trade'
          })),
          ...(baseStats.recentAuctions || []).map(auction => ({
            ...auction,
            type: 'auction'
          }))
        ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 10);
      }

      // Calculate derived metrics
      const totalAuctionsParticipated = Object.values(baseStats.auctionsByRarity || {})
        .reduce((sum, rarity) => sum + (rarity.completed || 0), 0);
      
      enhancedStats.derived = {
        totalAuctionsParticipated,
        auctionWinRate: totalAuctionsParticipated > 0 ? 
          ((baseStats.auctionsWon || 0) / totalAuctionsParticipated * 100).toFixed(1) : '0.0',
        totalEarningsFromAuctions: Object.values(baseStats.auctionsByRarity || {})
          .reduce((sum, rarity) => sum + (rarity.totalEarned || 0), 0),
        mostTradedRarity: this.getMostTradedRarity(baseStats.rarityTraded || {}),
        activityScore: this.calculateActivityScore(enhancedStats)
      };

      // Cache the enhanced stats
      await CacheService.setValue(cacheKey, enhancedStats, { ttl });

      return enhancedStats;

    } catch (error) {
      console.error('Error getting cached stats:', error);
      
      // Return basic stats as fallback
      try {
        return await this.getUserStats(userId);
      } catch (fallbackError) {
        console.error('Error getting fallback stats:', fallbackError);
        return {
          tradesCompleted: 0,
          auctionsWon: 0,
          auctionsByRarity: {},
          rarityTraded: {},
          recentTrades: [],
          recentAuctions: [],
          totalCards: 0,
          gemsEarned: 0,
          level: 1,
          experience: 0,
          error: 'Failed to load stats'
        };
      }
    }
  }

  static getMostTradedRarity(rarityTraded) {
    if (!rarityTraded || Object.keys(rarityTraded).length === 0) {
      return 'None';
    }
    
    return Object.entries(rarityTraded)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || 'None';
  }

  static calculateActivityScore(stats) {
    // Simple activity score calculation
    const tradesWeight = (stats.tradesCompleted || 0) * 2;
    const auctionsWeight = (stats.auctionsWon || 0) * 3;
    const cardsWeight = Math.min((stats.totalCards || 0) * 0.1, 50); // Cap at 50 points
    const recentActivityWeight = (stats.recentActivity?.length || 0) * 5;
    
    return Math.round(tradesWeight + auctionsWeight + cardsWeight + recentActivityWeight);
  }
}

export default StatsService;
