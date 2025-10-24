/**
 * Global Listener Coordinator
 * 
 * Consolidates all Firestore real-time listeners across the entire application
 * to eliminate duplicate database connections and dramatically reduce reads.
 * 
 * Target: 70-80% reduction in real-time listener reads
 */

import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { AppState } from 'react-native';
import { db } from '../config/firebase';
import CacheService from '../services/caching/CacheService';

// Hard-disable real-time listeners to stay under single-digit reads.
// All screens now rely on overview / cache docs and RefreshCoordinator.
let REALTIME_LISTENERS_ENABLED = false;

// Keep the flag in sync with app lifecycle
AppState.addEventListener('change', (state) => {
  REALTIME_LISTENERS_ENABLED = state === 'active';
  console.log(`�� Realtime listeners ${REALTIME_LISTENERS_ENABLED ? 'ENABLED' : 'DISABLED'} (AppState=${state})`);
});

class GlobalListenerCoordinator {
  constructor() {
    this.activeListeners = new Map();
    this.subscriptions = new Map(); // Track who is subscribed to what data
    this.dataCache = new Map(); // In-memory cache for fast distribution
    this.lastUpdateTimes = new Map(); // Track last update times
    this.throttleTimers = new Map(); // Throttle timers for each listener
    
    // Metrics for monitoring
    this.metrics = {
      consolidatedListeners: 0,
      totalSubscriptions: 0,
      savedConnections: 0,
      dataDistributions: 0,
      readsEliminated: 0
    };

    // Configuration
    this.config = {
      maxSubscriptionsPerListener: 50, // Prevent memory issues
      defaultThrottleMs: 30000, // 30 seconds default throttle
      criticalThrottleMs: 5000, // 5 seconds for critical data
      cacheExpiryMs: 5 * 60 * 1000, // 5 minutes cache expiry
      inactiveCleanupMs: 10 * 60 * 1000 // Cleanup inactive listeners after 10 minutes
    };
  }

  /**
   * Subscribe to group data with consolidated listener
   */
  subscribeToGroupData(groupId, subscriberId, callback, options = {}) {
    const listenerKey = `group_${groupId}`;
    const subscriptionKey = `${listenerKey}_${subscriberId}`;

    // Add subscription
    this.addSubscription(subscriptionKey, listenerKey, callback);

    // Ensure listener exists
    this.ensureGroupListener(groupId, listenerKey, options);

    // Return unsubscribe function
    return () => this.unsubscribe(subscriptionKey, listenerKey);
  }

  /**
   * Subscribe to user cards with consolidated listener
   */
  subscribeToUserCards(userId, groupId, subscriberId, callback, options = {}) {
    const listenerKey = `user_cards_${userId}_${groupId}`;
    const subscriptionKey = `${listenerKey}_${subscriberId}`;

    this.addSubscription(subscriptionKey, listenerKey, callback);
    this.ensureUserCardsListener(userId, groupId, listenerKey, options);

    return () => this.unsubscribe(subscriptionKey, listenerKey);
  }

  /**
   * Subscribe to group auctions with consolidated listener
   */
  subscribeToGroupAuctions(groupId, subscriberId, callback, options = {}) {
    const listenerKey = `group_auctions_${groupId}`;
    const subscriptionKey = `${listenerKey}_${subscriberId}`;

    this.addSubscription(subscriptionKey, listenerKey, callback);
    this.ensureGroupAuctionsListener(groupId, listenerKey, options);

    return () => this.unsubscribe(subscriptionKey, listenerKey);
  }

  /**
   * Subscribe to group trades with consolidated listener
   */
  subscribeToGroupTrades(groupId, subscriberId, callback, options = {}) {
    const listenerKey = `group_trades_${groupId}`;
    const subscriptionKey = `${listenerKey}_${subscriberId}`;

    this.addSubscription(subscriptionKey, listenerKey, callback);
    this.ensureGroupTradesListener(groupId, listenerKey, options);

    return () => this.unsubscribe(subscriptionKey, listenerKey);
  }

  /**
   * Subscribe to user balance with consolidated listener
   */
  subscribeToUserBalance(userId, subscriberId, callback, options = {}) {
    const listenerKey = `user_balance_${userId}`;
    const subscriptionKey = `${listenerKey}_${subscriberId}`;

    this.addSubscription(subscriptionKey, listenerKey, callback);
    this.ensureUserBalanceListener(userId, listenerKey, options);

    return () => this.unsubscribe(subscriptionKey, listenerKey);
  }

  /**
   * Add a subscription
   */
  addSubscription(subscriptionKey, listenerKey, callback) {
    if (!this.subscriptions.has(listenerKey)) {
      this.subscriptions.set(listenerKey, new Map());
    }
    
    this.subscriptions.get(listenerKey).set(subscriptionKey, callback);
    this.metrics.totalSubscriptions++;

    // Serve cached data immediately if available
    const cachedData = this.dataCache.get(listenerKey);
    if (cachedData && cachedData.timestamp > Date.now() - this.config.cacheExpiryMs) {
      try {
        callback(cachedData.data);
      } catch (error) {
        console.error(`Error serving cached data for ${subscriptionKey}:`, error);
      }
    }
  }

  /**
   * Remove a subscription
   */
  unsubscribe(subscriptionKey, listenerKey) {
    const subscriptions = this.subscriptions.get(listenerKey);
    if (subscriptions) {
      subscriptions.delete(subscriptionKey);
      this.metrics.totalSubscriptions--;

      // Clean up listener if no more subscriptions
      if (subscriptions.size === 0) {
        this.cleanupListener(listenerKey);
      }
    }
  }

  /**
   * Ensure group listener exists
   */
  async ensureGroupListener(groupId, listenerKey, options = {}) {
    if (this.activeListeners.has(listenerKey)) {
      this.metrics.savedConnections++;
      return;
    }

    try {
      // QUICK EXIT if real-time listeners disabled
      if (!REALTIME_LISTENERS_ENABLED) {
        const cacheKey = `global_group_${groupId}`;
        const cachedData = await CacheService.getValue(cacheKey);
        if (cachedData) {
          this.cacheAndDistribute(listenerKey, cachedData, 'cache');
        }
        // set a no-op unsubscribe
        this.activeListeners.set(listenerKey, () => {});
        return;
      }

      // Check cache first
      const cacheKey = `global_group_${groupId}`;
      const cachedData = await CacheService.getValue(cacheKey);
      
      if (cachedData) {
        this.cacheAndDistribute(listenerKey, cachedData, 'cache');
      }

      // Create throttled callback
      const throttledCallback = this.createThrottledCallback(listenerKey, options);

      // Set up listener
      const groupRef = doc(db, 'groups', groupId);
      const unsubscribe = onSnapshot(groupRef, 
        (doc) => {
          if (!doc.exists()) {
            this.handleDataNotFound(listenerKey);
            return;
          }

          const groupData = { id: doc.id, ...doc.data() };
          throttledCallback(groupData);
        },
        (error) => {
          console.error(`Global group listener error for ${groupId}:`, error);
          this.handleListenerError(listenerKey, error);
        }
      );

      this.activeListeners.set(listenerKey, unsubscribe);
      this.metrics.consolidatedListeners++;
      console.log(`🔗 Created consolidated group listener for ${groupId}`);

    } catch (error) {
      console.error(`Error setting up group listener for ${groupId}:`, error);
    }
  }

  /**
   * Ensure user cards listener exists
   */
  async ensureUserCardsListener(userId, groupId, listenerKey, options = {}) {
    if (this.activeListeners.has(listenerKey)) {
      this.metrics.savedConnections++;
      return;
    }

    try {
      if (!REALTIME_LISTENERS_ENABLED) {
        const cacheKey = `global_user_cards_${userId}_${groupId}`;
        const cachedData = await CacheService.getValue(cacheKey);
        if (cachedData) {
          this.cacheAndDistribute(listenerKey, cachedData, 'cache');
        }
        this.activeListeners.set(listenerKey, () => {});
        return;
      }

      const cacheKey = `global_user_cards_${userId}_${groupId}`;
      const cachedData = await CacheService.getValue(cacheKey);
      
      if (cachedData) {
        this.cacheAndDistribute(listenerKey, cachedData, 'cache');
      }

      const throttledCallback = this.createThrottledCallback(listenerKey, options);

      const cardsRef = collection(db, 'cards');
      const cardsQuery = query(
        cardsRef,
        where('ownerId', '==', userId),
        where('groupId', '==', groupId)
      );

      const unsubscribe = onSnapshot(cardsQuery, 
        (snapshot) => {
          const cards = [];
          
          snapshot.forEach((doc) => {
            cards.push({ id: doc.id, ...doc.data() });
          });

          throttledCallback(cards);
        },
        (error) => {
          console.error(`Global user cards listener error for ${userId}/${groupId}:`, error);
          this.handleListenerError(listenerKey, error);
        }
      );

      this.activeListeners.set(listenerKey, unsubscribe);
      this.metrics.consolidatedListeners++;
      console.log(`🔗 Created consolidated user cards listener for ${userId}/${groupId}`);

    } catch (error) {
      console.error(`Error setting up user cards listener for ${userId}/${groupId}:`, error);
    }
  }

  /**
   * Ensure group auctions listener exists
   */
  async ensureGroupAuctionsListener(groupId, listenerKey, options = {}) {
    if (this.activeListeners.has(listenerKey)) {
      this.metrics.savedConnections++;
      return;
    }

    try {
      if (!REALTIME_LISTENERS_ENABLED) {
        const cacheKey = `global_group_auctions_${groupId}`;
        const cachedData = await CacheService.getValue(cacheKey);
        if (cachedData) {
          this.cacheAndDistribute(listenerKey, cachedData, 'cache');
        }
        this.activeListeners.set(listenerKey, () => {});
        return;
      }

      const cacheKey = `global_group_auctions_${groupId}`;
      const cachedData = await CacheService.getValue(cacheKey);
      
      if (cachedData) {
        this.cacheAndDistribute(listenerKey, cachedData, 'cache');
      }

      const throttledCallback = this.createThrottledCallback(listenerKey, options);

      const auctionsRef = collection(db, 'auctions');
      const auctionsQuery = query(
        auctionsRef,
        where('groupId', '==', groupId),
        where('status', '==', 'active')
      );

      const unsubscribe = onSnapshot(auctionsQuery, 
        (snapshot) => {
          const auctions = [];
          
          snapshot.forEach((doc) => {
            auctions.push({ id: doc.id, ...doc.data() });
          });

          throttledCallback(auctions);
        },
        (error) => {
          console.error(`Global group auctions listener error for ${groupId}:`, error);
          this.handleListenerError(listenerKey, error);
        }
      );

      this.activeListeners.set(listenerKey, unsubscribe);
      this.metrics.consolidatedListeners++;
      console.log(`🔗 Created consolidated group auctions listener for ${groupId}`);

    } catch (error) {
      console.error(`Error setting up group auctions listener for ${groupId}:`, error);
    }
  }

  /**
   * Ensure group trades listener exists
   */
  async ensureGroupTradesListener(groupId, listenerKey, options = {}) {
    if (this.activeListeners.has(listenerKey)) {
      this.metrics.savedConnections++;
      return;
    }

    try {
      if (!REALTIME_LISTENERS_ENABLED) {
        const cacheKey = `global_group_trades_${groupId}`;
        const cachedData = await CacheService.getValue(cacheKey);
        if (cachedData) {
          this.cacheAndDistribute(listenerKey, cachedData, 'cache');
        }
        this.activeListeners.set(listenerKey, () => {});
        return;
      }

      const cacheKey = `global_group_trades_${groupId}`;
      const cachedData = await CacheService.getValue(cacheKey);
      
      if (cachedData) {
        this.cacheAndDistribute(listenerKey, cachedData, 'cache');
      }

      const throttledCallback = this.createThrottledCallback(listenerKey, options);

      const tradesRef = collection(db, 'trades');
      const tradesQuery = query(
        tradesRef,
        where('groupId', '==', groupId)
      );

      const unsubscribe = onSnapshot(tradesQuery, 
        (snapshot) => {
          const trades = [];
          
          snapshot.forEach((doc) => {
            trades.push({ id: doc.id, ...doc.data() });
          });

          throttledCallback(trades);
        },
        (error) => {
          console.error(`Global group trades listener error for ${groupId}:`, error);
          this.handleListenerError(listenerKey, error);
        }
      );

      this.activeListeners.set(listenerKey, unsubscribe);
      this.metrics.consolidatedListeners++;
      console.log(`🔗 Created consolidated group trades listener for ${groupId}`);

    } catch (error) {
      console.error(`Error setting up group trades listener for ${groupId}:`, error);
    }
  }

  /**
   * Ensure user balance listener exists
   */
  async ensureUserBalanceListener(userId, listenerKey, options = {}) {
    if (this.activeListeners.has(listenerKey)) {
      this.metrics.savedConnections++;
      return;
    }

    try {
      const cacheKey = `global_user_balance_${userId}`;
      const cachedData = await CacheService.getValue(cacheKey);
      
      if (cachedData) {
        this.cacheAndDistribute(listenerKey, cachedData, 'cache');
      }

      if (!REALTIME_LISTENERS_ENABLED) {
        this.activeListeners.set(listenerKey, () => {});
        return;
      }

      const throttledCallback = this.createThrottledCallback(listenerKey, options);

      const userRef = doc(db, 'users', userId);
      const unsubscribe = onSnapshot(userRef, 
        (doc) => {
          if (!doc.exists()) {
            this.handleDataNotFound(listenerKey);
            return;
          }

          const userData = { id: doc.id, ...doc.data() };
          throttledCallback(userData);
        },
        (error) => {
          console.error(`Global user balance listener error for ${userId}:`, error);
          this.handleListenerError(listenerKey, error);
        }
      );

      this.activeListeners.set(listenerKey, unsubscribe);
      this.metrics.consolidatedListeners++;
      console.log(`🔗 Created consolidated user balance listener for ${userId}`);

    } catch (error) {
      console.error(`Error setting up user balance listener for ${userId}:`, error);
    }
  }

  /**
   * Create throttled callback for a listener
   */
  createThrottledCallback(listenerKey, options = {}) {
    // For initial data loading, disable throttling to show data immediately
    const isInitialLoad = !this.dataCache.has(listenerKey);
    const enableThrottling = options.enableThrottling !== false && !isInitialLoad;
    
    const throttleMs = options.critical ? 
      this.config.criticalThrottleMs : 
      this.config.defaultThrottleMs;

    return (data) => {
      // For initial load or when throttling is disabled, distribute immediately
      if (!enableThrottling) {
        this.cacheAndDistribute(listenerKey, data, 'realtime');
        return;
      }

      // Clear existing timer
      if (this.throttleTimers.has(listenerKey)) {
        clearTimeout(this.throttleTimers.get(listenerKey));
      }

      // Set new timer for subsequent updates
      const timer = setTimeout(() => {
        this.cacheAndDistribute(listenerKey, data, 'realtime');
        this.throttleTimers.delete(listenerKey);
      }, throttleMs);

    };
  }

  /**
   * Cache data and distribute to all subscribers
   */
  cacheAndDistribute(listenerKey, data, source) {
    // Update cache
    this.dataCache.set(listenerKey, {
      data,
      timestamp: Date.now(),
      source
    });

    // Update persistent cache in background (non-blocking)
    const cacheKey = `global_${listenerKey}`;
    setTimeout(() => {
      CacheService.setValue(cacheKey, data, { 
        ttl: this.config.cacheExpiryMs 
      }).catch(err => console.warn(`Cache update failed for ${cacheKey}:`, err));
    }, 0);

    // Distribute to all subscribers
    const subscriptions = this.subscriptions.get(listenerKey);
    if (subscriptions) {
      subscriptions.forEach((callback, subscriptionKey) => {
        try {
          callback(data);
          this.metrics.dataDistributions++;
        } catch (error) {
          console.error(`Error distributing data to ${subscriptionKey}:`, error);
        }
      });
    }

    this.lastUpdateTimes.set(listenerKey, Date.now());
  }

  /**
   * Handle data not found
   */
  handleDataNotFound(listenerKey) {
    this.cacheAndDistribute(listenerKey, null, 'not_found');
  }

  /**
   * Handle listener error
   */
  handleListenerError(listenerKey, error) {
    console.error(`Listener error for ${listenerKey}:`, error);
    
    // Try to serve cached data
    const cachedData = this.dataCache.get(listenerKey);
    if (cachedData) {
      this.cacheAndDistribute(listenerKey, cachedData.data, 'cache_fallback');
    }
  }

  /**
   * Cleanup listener
   */
  cleanupListener(listenerKey) {
    const unsubscribe = this.activeListeners.get(listenerKey);
    if (unsubscribe) {
      try {
        unsubscribe();
        this.activeListeners.delete(listenerKey);
        this.metrics.consolidatedListeners--;
        console.log(`🧹 Cleaned up listener: ${listenerKey}`);
      } catch (error) {
        console.error(`Error cleaning up listener ${listenerKey}:`, error);
      }
    }

    // Clear throttle timer
    if (this.throttleTimers.has(listenerKey)) {
      clearTimeout(this.throttleTimers.get(listenerKey));
      this.throttleTimers.delete(listenerKey);
    }

    // Clear cached data
    this.dataCache.delete(listenerKey);
    this.lastUpdateTimes.delete(listenerKey);
    this.subscriptions.delete(listenerKey);
  }

  /**
   * Get metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeListeners: this.activeListeners.size,
      totalDataCached: this.dataCache.size,
      readsEliminated: this.metrics.savedConnections + this.metrics.dataDistributions
    };
  }

  /**
   * Cleanup all listeners (for app shutdown)
   */
  cleanup() {
    this.activeListeners.forEach((unsubscribe, key) => {
      try {
        unsubscribe();
      } catch (error) {
        console.error(`Error cleaning up listener ${key}:`, error);
      }
    });

    this.throttleTimers.forEach((timer) => {
      clearTimeout(timer);
    });

    this.activeListeners.clear();
    this.subscriptions.clear();
    this.dataCache.clear();
    this.lastUpdateTimes.clear();
    this.throttleTimers.clear();

    console.log('🧹 Global listener coordinator cleaned up');
  }
}

// Export singleton instance
export default new GlobalListenerCoordinator(); 