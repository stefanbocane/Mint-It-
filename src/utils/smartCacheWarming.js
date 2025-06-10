import CacheService from '../services/caching/CacheService';
import GroupMembersLookupService from '../services/GroupMembersLookupService';
import SmartAuctionCacheManager from '../services/SmartAuctionCacheManager';
import performanceMonitor from './performanceMonitor';

/**
 * Smart Cache Warming Utility
 * Intelligently preloads commonly accessed data to minimize database reads
 */

/**
 * Warm user-related caches with essential data
 * @param {string} userId - User ID
 * @param {string} groupId - Current group ID (optional)
 * @returns {Promise<Object>} Warming results
 */
export const warmUserCaches = async (userId, groupId = null) => {
  if (!userId) return { success: false, message: 'No user ID provided' };

  const warmingTasks = [];
  const results = { successful: 0, failed: 0, details: [] };

  try {
    // 1. Warm user document cache
    warmingTasks.push(
      CacheService.getDocument('users', userId, { ttl: 2 * 60 * 1000 })
        .then(data => {
          if (data) {
            results.successful++;
            results.details.push({ type: 'user', status: 'success', data: 'User data cached' });
            performanceMonitor.recordCacheHit(`users:${userId}`, 'cache_warming');
          }
        })
        .catch(err => {
          results.failed++;
          results.details.push({ type: 'user', status: 'failed', error: err.message });
        })
    );

    // 2. If we have a group, warm group-related data
    if (groupId) {
      // Warm group document
      warmingTasks.push(
        CacheService.getDocument('groups', groupId, { ttl: 5 * 60 * 1000 })
          .then(data => {
            if (data) {
              results.successful++;
              results.details.push({ type: 'group', status: 'success', data: 'Group data cached' });
              performanceMonitor.recordCacheHit(`groups:${groupId}`, 'cache_warming');
            }
          })
          .catch(err => {
            results.failed++;
            results.details.push({ type: 'group', status: 'failed', error: err.message });
          })
      );

      // Warm user stats for this group context
      warmingTasks.push(
        CacheService.getDocument('userStats', userId, { ttl: 2 * 60 * 1000 })
          .then(data => {
            if (data) {
              results.successful++;
              results.details.push({ type: 'stats', status: 'success', data: 'User stats cached' });
              performanceMonitor.recordCacheHit(`userStats:${userId}`, 'cache_warming');
            }
          })
          .catch(err => {
            results.failed++;
            results.details.push({ type: 'stats', status: 'failed', error: err.message });
          })
      );
    }

    // Execute all warming tasks in parallel
    await Promise.allSettled(warmingTasks);

    performanceMonitor.recordQueryOptimization('cache_warming', results.successful, {
      userId,
      groupId,
      warmedCaches: results.successful
    });

    return {
      success: true,
      ...results,
      message: `Successfully warmed ${results.successful} caches, ${results.failed} failed`
    };

  } catch (error) {
    console.error('Error in warmUserCaches:', error);
    return {
      success: false,
      message: `Cache warming failed: ${error.message}`,
      ...results
    };
  }
};

/**
 * Warm collection-related caches
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 * @param {number} preloadCount - Number of cards to preload
 * @returns {Promise<Object>} Warming results
 */
export const warmCollectionCaches = async (userId, groupId, preloadCount = 10) => {
  if (!userId || !groupId) {
    return { success: false, message: 'Missing user ID or group ID' };
  }

  try {
    // This would typically use the optimized query functions we created
    const { fetchUserCardsOptimized } = await import('./queryOptimizer');
    
    const cardsResult = await fetchUserCardsOptimized({
      userId,
      groupId,
      pageSize: preloadCount,
      orderField: 'createdAt',
      orderDirection: 'desc'
    });

    if (cardsResult.cards && cardsResult.cards.length > 0) {
      performanceMonitor.recordQueryOptimization('collection_cache_warming', 1, {
        cardsPreloaded: cardsResult.cards.length,
        userId,
        groupId
      });

      return {
        success: true,
        cardsPreloaded: cardsResult.cards.length,
        message: `Preloaded ${cardsResult.cards.length} cards into cache`
      };
    }

    return {
      success: true,
      cardsPreloaded: 0,
      message: 'No cards found to preload'
    };

  } catch (error) {
    console.error('Error in warmCollectionCaches:', error);
    return {
      success: false,
      message: `Collection cache warming failed: ${error.message}`
    };
  }
};

/**
 * Intelligent cache warming based on user behavior patterns
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 * @param {Object} userContext - User context information
 * @returns {Promise<Object>} Warming results
 */
export const smartCacheWarm = async (userId, groupId, userContext = {}) => {
  const {
    lastVisitedScreen = null,
    frequentlyAccessedData = [],
    timeOfDay = null
  } = userContext;

  const warmingStrategy = determineWarmingStrategy(lastVisitedScreen, timeOfDay);
  const warmingTasks = [];

  try {
    // Always warm essential user data
    warmingTasks.push(warmUserCaches(userId, groupId));

    // Screen-specific warming
    switch (warmingStrategy.primaryFocus) {
      case 'collection':
        warmingTasks.push(warmCollectionCaches(userId, groupId, 15));
        break;
      
      case 'trading':
        // Warm recent trades and trade-related data
        warmingTasks.push(
          CacheService.getDocuments('trades', [`active_trades_${userId}`], { ttl: 2 * 60 * 1000 })
        );
        break;
      
      case 'store':
        // Warm store and border data
        warmingTasks.push(
          CacheService.getDocument('store', 'borders', { ttl: 10 * 60 * 1000 })
        );
        break;
    }

    // Execute warming strategy
    const results = await Promise.allSettled(warmingTasks);
    const successfulWarms = results.filter(r => r.status === 'fulfilled').length;

    performanceMonitor.recordQueryOptimization('smart_cache_warming', successfulWarms, {
      strategy: warmingStrategy.primaryFocus,
      userId,
      groupId
    });

    return {
      success: true,
      strategy: warmingStrategy.primaryFocus,
      tasksCompleted: successfulWarms,
      totalTasks: warmingTasks.length,
      message: `Smart warming completed: ${successfulWarms}/${warmingTasks.length} tasks successful`
    };

  } catch (error) {
    console.error('Error in smartCacheWarm:', error);
    return {
      success: false,
      message: `Smart cache warming failed: ${error.message}`
    };
  }
};

/**
 * Determine optimal warming strategy based on user context
 * @param {string} lastScreen - Last visited screen
 * @param {string} timeOfDay - Current time of day
 * @returns {Object} Warming strategy
 */
const determineWarmingStrategy = (lastScreen, timeOfDay) => {
  // Default strategy
  let strategy = { primaryFocus: 'collection', secondaryFocus: null };

  // Screen-based logic
  if (lastScreen === 'Collection' || lastScreen === 'CollectionScreen') {
    strategy.primaryFocus = 'collection';
  } else if (lastScreen?.includes('Trade')) {
    strategy.primaryFocus = 'trading';
  } else if (lastScreen === 'Store' || lastScreen === 'StoreScreen') {
    strategy.primaryFocus = 'store';
  }

  // Time-based adjustments (users might have different patterns at different times)
  if (timeOfDay === 'morning') {
    strategy.secondaryFocus = 'collection'; // Users often check collections in the morning
  } else if (timeOfDay === 'evening') {
    strategy.secondaryFocus = 'trading'; // More trading activity in the evening
  }

  return strategy;
};

/**
 * Background cache maintenance and warming
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 * @returns {Promise<void>}
 */
export const backgroundCacheMaintenance = async (userId, groupId) => {
  if (!userId || !groupId) return;

  try {
    // Perform low-priority cache warming in the background
    setTimeout(async () => {
      await warmUserCaches(userId, groupId);
    }, 2000); // Delay to not interfere with immediate user interactions

    // Schedule periodic maintenance
    setTimeout(async () => {
      await CacheService.performMaintenance?.();
      
      // OPTIMIZATION: Warm up advanced optimization caches
      try {
        await GroupMembersLookupService.warmUpGroupCaches([groupId]);
        await SmartAuctionCacheManager.warmUpAuctionCaches([groupId]);
      } catch (error) {
        console.warn('Error warming advanced optimization caches:', error);
      }
    }, 30000); // 30 seconds delay

  } catch (error) {
    console.error('Background cache maintenance error:', error);
  }
};

export default {
  warmUserCaches,
  warmCollectionCaches,
  smartCacheWarm,
  backgroundCacheMaintenance
}; 