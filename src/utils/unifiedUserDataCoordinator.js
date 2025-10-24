/**
 * Unified User Data Coordinator
 * 
 * Consolidates all user data access across context providers to eliminate
 * redundant database reads and provide optimized data sharing.
 */

import { doc } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import CacheService from '../services/caching/CacheService';
import { onSnapshot } from '../services/ReadTracking/TrackedFirestore';

class UnifiedUserDataCoordinator {
  constructor() {
    this.activeListeners = new Map();
    this.subscribers = new Map();
    this.userData = new Map();
    this.metrics = {
      consolidatedReads: 0,
      savedReads: 0,
      cacheHits: 0,
      listenerShares: 0
    };
  }

  /**
   * Subscribe to user data with automatic listener consolidation
   * Multiple contexts subscribe to same user = single shared listener
   */
  subscribeToUserData(userId, contextName, onUpdate, options = {}) {
    if (!userId || !contextName) {
      console.error('Invalid subscription parameters');
      return () => {};
    }

    // Track subscriber
    const subscriberKey = `${userId}_${contextName}`;
    if (!this.subscribers.has(userId)) {
      this.subscribers.set(userId, new Map());
    }
    
    this.subscribers.get(userId).set(contextName, {
      callback: onUpdate,
      fields: options.fields || [],
      lastUpdate: Date.now()
    });

    // Create or share existing listener
    this.ensureUserListener(userId);

    // Provide immediate cached data if available
    this.provideCachedUserData(userId, contextName);

    // Return unsubscribe function
    return () => {
      this.unsubscribeFromUserData(userId, contextName);
    };
  }

  /**
   * Ensure single listener exists for user
   */
  async ensureUserListener(userId) {
    if (this.activeListeners.has(userId)) {
      this.metrics.listenerShares++;
      return; // Listener already exists
    }

    try {
      // Check cache first for immediate data
      const cachedData = await CacheService.getValue(`unified_user_${userId}`);
      if (cachedData) {
        this.userData.set(userId, cachedData);
        this.distributeUserData(userId, cachedData, 'cache');
        this.metrics.cacheHits++;
      }

      // Set up single consolidated listener
      const userRef = doc(db, 'users', userId);
      const unsubscribe = onSnapshot(userRef, 
        (doc) => {
          if (!doc.exists()) {
            this.handleUserNotFound(userId);
            return;
          }

          const userData = { id: doc.id, ...doc.data() };
          this.userData.set(userId, userData);
          
          // Update cache with extended TTL since this is consolidated data
          CacheService.setValue(`unified_user_${userId}`, userData, { 
            ttl: 10 * 60 * 1000 // 10 minutes
          });

          // Distribute to all subscribers
          this.distributeUserData(userId, userData, 'realtime');
          this.metrics.consolidatedReads++;
        },
        (error) => {
          console.error(`User listener error for ${userId}:`, error);
          this.handleListenerError(userId, error);
        }
      );

      this.activeListeners.set(userId, unsubscribe);
      console.log(`Created unified listener for user ${userId}`);

    } catch (error) {
      console.error(`Error setting up user listener for ${userId}:`, error);
    }
  }

  /**
   * Distribute user data to all context subscribers
   */
  distributeUserData(userId, userData, source) {
    const userSubscribers = this.subscribers.get(userId);
    if (!userSubscribers) return;

    userSubscribers.forEach((subscriber, contextName) => {
      try {
        // Filter data based on context needs
        const filteredData = this.filterDataForContext(userData, subscriber.fields);
        
        // Call context callback with filtered data
        subscriber.callback(filteredData);
        subscriber.lastUpdate = Date.now();
        
      } catch (error) {
        console.error(`Error distributing data to ${contextName}:`, error);
      }
    });

    // Track metrics
    if (userSubscribers.size > 1) {
      this.metrics.savedReads += userSubscribers.size - 1;
    }
  }

  /**
   * Filter user data based on context requirements
   */
  filterDataForContext(userData, requiredFields) {
    if (!requiredFields || requiredFields.length === 0) {
      return userData; // Return all data if no filtering specified
    }

    // Create filtered object with only required fields
    const filtered = { id: userData.id };
    requiredFields.forEach(field => {
      if (userData.hasOwnProperty(field)) {
        filtered[field] = userData[field];
      }
    });

    return filtered;
  }

  /**
   * Provide immediate cached data for new subscribers
   */
  provideCachedUserData(userId, contextName) {
    const userData = this.userData.get(userId);
    if (!userData) return;

    const subscriber = this.subscribers.get(userId)?.get(contextName);
    if (!subscriber) return;

    try {
      const filteredData = this.filterDataForContext(userData, subscriber.fields);
      subscriber.callback(filteredData);
    } catch (error) {
      console.error(`Error providing cached data to ${contextName}:`, error);
    }
  }

  /**
   * Unsubscribe from user data
   */
  unsubscribeFromUserData(userId, contextName) {
    const userSubscribers = this.subscribers.get(userId);
    if (!userSubscribers) return;

    userSubscribers.delete(contextName);

    // Clean up if no more subscribers
    if (userSubscribers.size === 0) {
      this.cleanupUserListener(userId);
    }
  }

  /**
   * Clean up user listener when no more subscribers
   */
  cleanupUserListener(userId) {
    const unsubscribe = this.activeListeners.get(userId);
    if (unsubscribe) {
      unsubscribe();
      this.activeListeners.delete(userId);
    }

    this.subscribers.delete(userId);
    this.userData.delete(userId);
    console.log(`Cleaned up unified listener for user ${userId}`);
  }

  /**
   * Handle user not found scenario
   */
  handleUserNotFound(userId) {
    console.warn(`User ${userId} not found`);
    this.distributeUserData(userId, null, 'error');
  }

  /**
   * Handle listener errors
   */
  handleListenerError(userId, error) {
    const userSubscribers = this.subscribers.get(userId);
    if (!userSubscribers) return;

    userSubscribers.forEach((subscriber, contextName) => {
      try {
        // Notify contexts of error with cached data fallback
        const cachedData = this.userData.get(userId);
        if (cachedData) {
          subscriber.callback(cachedData);
        }
      } catch (callbackError) {
        console.error(`Error in error handler for ${contextName}:`, callbackError);
      }
    });
  }

  /**
   * Get optimization metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeListeners: this.activeListeners.size,
      totalSubscribers: Array.from(this.subscribers.values())
        .reduce((total, contextMap) => total + contextMap.size, 0),
      estimatedSavings: this.metrics.savedReads * 100 // Assume avg 100ms per read
    };
  }

  /**
   * Prefetch user data for multiple users
   */
  async prefetchUsers(userIds, priority = 'normal') {
    const prefetchPromises = userIds.map(async (userId) => {
      try {
        // Check if already cached or listening
        if (this.userData.has(userId) || this.activeListeners.has(userId)) {
          return;
        }

        // Fetch and cache user data
        const userData = await CacheService.getDocument('users', userId, {
          ttl: priority === 'high' ? 15 * 60 * 1000 : 5 * 60 * 1000
        });

        if (userData) {
          await CacheService.setValue(`unified_user_${userId}`, userData, {
            ttl: 8 * 60 * 1000
          });
        }

      } catch (error) {
        console.error(`Error prefetching user ${userId}:`, error);
      }
    });

    await Promise.allSettled(prefetchPromises);
  }

  /**
   * Force refresh user data
   */
  async refreshUserData(userId) {
    try {
      // Invalidate cache
      await CacheService.invalidate(`unified_user_${userId}`);
      
      // Force fresh fetch
      const userData = await CacheService.getDocument('users', userId, {
        forceRefresh: true
      });

      if (userData) {
        this.userData.set(userId, userData);
        this.distributeUserData(userId, userData, 'refresh');
      }

    } catch (error) {
      console.error(`Error refreshing user data for ${userId}:`, error);
    }
  }
}

// Create singleton instance
const unifiedUserDataCoordinator = new UnifiedUserDataCoordinator();

export default unifiedUserDataCoordinator;
export { UnifiedUserDataCoordinator };
