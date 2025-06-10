/**
 * Shared Listener Pool
 * 
 * Consolidates real-time listeners across multiple screens and components
 * to eliminate duplicate database connections and reduce reads.
 */

import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import CacheService from '../services/caching/CacheService';

class SharedListenerPool {
  constructor() {
    this.activeListeners = new Map();
    this.subscribers = new Map();
    this.listenerData = new Map();
    this.metrics = {
      sharedListeners: 0,
      totalSubscribers: 0,
      savedConnections: 0,
      dataDistributions: 0
    };
  }

  /**
   * Subscribe to group data with shared listener
   * Multiple components requesting same group = single listener
   */
  subscribeToGroupData(groupId, componentId, onUpdate, options = {}) {
    if (!groupId || !componentId) {
      console.error('Invalid subscription parameters for group data');
      return () => {};
    }

    const listenerKey = `group_${groupId}`;
    const subscriberKey = `${componentId}_${groupId}`;

    // Track subscriber
    if (!this.subscribers.has(listenerKey)) {
      this.subscribers.set(listenerKey, new Map());
    }

    this.subscribers.get(listenerKey).set(subscriberKey, {
      callback: onUpdate,
      filters: options.filters || {},
      fields: options.fields || [],
      componentId,
      subscribedAt: Date.now()
    });

    // Create or reuse shared listener
    this.ensureGroupListener(groupId, listenerKey);

    // Provide immediate cached data
    this.provideCachedData(listenerKey, subscriberKey);

    // Track metrics
    this.metrics.totalSubscribers++;

    return () => {
      this.unsubscribeFromGroupData(listenerKey, subscriberKey);
    };
  }

  /**
   * Subscribe to user cards across multiple screens
   */
  subscribeToUserCards(userId, groupId, componentId, onUpdate, options = {}) {
    if (!userId || !groupId || !componentId) {
      console.error('Invalid subscription parameters for user cards');
      return () => {};
    }

    const listenerKey = `user_cards_${userId}_${groupId}`;
    const subscriberKey = `${componentId}_${userId}`;

    // Track subscriber with specific needs
    if (!this.subscribers.has(listenerKey)) {
      this.subscribers.set(listenerKey, new Map());
    }

    this.subscribers.get(listenerKey).set(subscriberKey, {
      callback: onUpdate,
      filters: options.filters || {},
      sortBy: options.sortBy || 'name',
      limit: options.limit || null,
      componentId,
      subscribedAt: Date.now()
    });

    // Create or reuse shared listener
    this.ensureUserCardsListener(userId, groupId, listenerKey);

    // Provide immediate cached data
    this.provideCachedData(listenerKey, subscriberKey);

    this.metrics.totalSubscribers++;

    return () => {
      this.unsubscribeFromGroupData(listenerKey, subscriberKey);
    };
  }

  /**
   * Subscribe to group trades with filtering
   */
  subscribeToGroupTrades(groupId, componentId, onUpdate, options = {}) {
    if (!groupId || !componentId) {
      console.error('Invalid subscription parameters for group trades');
      return () => {};
    }

    const listenerKey = `group_trades_${groupId}`;
    const subscriberKey = `${componentId}_${groupId}`;

    // Track subscriber
    if (!this.subscribers.has(listenerKey)) {
      this.subscribers.set(listenerKey, new Map());
    }

    this.subscribers.get(listenerKey).set(subscriberKey, {
      callback: onUpdate,
      userFilter: options.userId || null, // Filter for specific user
      statusFilter: options.status || null,
      limit: options.limit || 50,
      componentId,
      subscribedAt: Date.now()
    });

    // Create or reuse shared listener
    this.ensureGroupTradesListener(groupId, listenerKey);

    // Provide immediate cached data
    this.provideCachedData(listenerKey, subscriberKey);

    this.metrics.totalSubscribers++;

    return () => {
      this.unsubscribeFromGroupData(listenerKey, subscriberKey);
    };
  }

  /**
   * Subscribe to group auctions with shared listener
   * Multiple components requesting same group auctions = single listener
   */
  subscribeToGroupAuctions(groupId, componentId, onUpdate, options = {}) {
    if (!groupId || !componentId) {
      console.error('Invalid subscription parameters for group auctions');
      return () => {};
    }

    const listenerKey = `group_auctions_${groupId}`;
    const subscriberKey = `${componentId}_${groupId}`;

    // Track subscriber
    if (!this.subscribers.has(listenerKey)) {
      this.subscribers.set(listenerKey, new Map());
    }

    this.subscribers.get(listenerKey).set(subscriberKey, {
      callback: onUpdate,
      filters: options.filters || {},
      fields: options.fields || [],
      componentId,
      subscribedAt: Date.now()
    });

    // Create or reuse shared listener
    this.ensureGroupAuctionsListener(groupId, listenerKey, options);

    // Provide immediate cached data
    this.provideCachedData(listenerKey, subscriberKey);

    // Track metrics
    this.metrics.totalSubscribers++;

    return () => {
      this.unsubscribeFromGroupData(listenerKey, subscriberKey);
    };
  }

  /**
   * Ensure group listener exists
   */
  async ensureGroupListener(groupId, listenerKey) {
    if (this.activeListeners.has(listenerKey)) {
      this.metrics.savedConnections++;
      return; // Listener already exists
    }

    try {
      // Check cache first
      const cacheKey = `shared_group_${groupId}`;
      const cachedData = await CacheService.getValue(cacheKey);
      
      if (cachedData) {
        this.listenerData.set(listenerKey, cachedData);
        this.distributeData(listenerKey, cachedData, 'cache');
      }

      // Set up shared listener
      const groupRef = doc(db, 'groups', groupId);
      const unsubscribe = onSnapshot(groupRef, 
        (doc) => {
          if (!doc.exists()) {
            this.handleDataNotFound(listenerKey);
            return;
          }

          const groupData = { id: doc.id, ...doc.data() };
          this.listenerData.set(listenerKey, groupData);

          // Update cache
          CacheService.setValue(cacheKey, groupData, { 
            ttl: 15 * 60 * 1000 // 15 minutes for group data
          });

          // Distribute to all subscribers
          this.distributeData(listenerKey, groupData, 'realtime');
        },
        (error) => {
          console.error(`Group listener error for ${groupId}:`, error);
          this.handleListenerError(listenerKey, error);
        }
      );

      this.activeListeners.set(listenerKey, unsubscribe);
      this.metrics.sharedListeners++;
      console.log(`Created shared group listener for ${groupId}`);

    } catch (error) {
      console.error(`Error setting up group listener for ${groupId}:`, error);
    }
  }

  /**
   * Ensure user cards listener exists
   */
  async ensureUserCardsListener(userId, groupId, listenerKey) {
    if (this.activeListeners.has(listenerKey)) {
      this.metrics.savedConnections++;
      return;
    }

    try {
      // Check cache first
      const cacheKey = `shared_user_cards_${userId}_${groupId}`;
      const cachedData = await CacheService.getValue(cacheKey);
      
      if (cachedData && cachedData.cards && cachedData.cards.length > 0) {
        this.listenerData.set(listenerKey, cachedData);
        this.distributeData(listenerKey, cachedData, 'cache');
      }

      // CRITICAL FIX: Set up TWO listeners - one for ownerId and one for userId
      // This ensures we capture all cards regardless of how they're stored
      const cardsRef = collection(db, 'cards');
      
      // Create compound listener for both ownerId and userId
      const ownerCardsQuery = query(
        cardsRef,
        where('ownerId', '==', userId),
        where('groupId', '==', groupId)
      );

      const userCardsQuery = query(
        cardsRef,
        where('userId', '==', userId),
        where('groupId', '==', groupId)
      );

      // Set up combined listener that merges results from both queries
      let ownerCards = [];
      let userCards = [];
      let ownerInitialized = false;
      let userInitialized = false;

      const mergeAndDistribute = () => {
        // FIXED: Distribute data immediately when either query updates
        // This ensures won auction cards appear immediately in the collection
        
        // Combine and deduplicate cards from both queries
        const cardMap = new Map();
        
        [...ownerCards, ...userCards].forEach(card => {
          cardMap.set(card.id, card);
        });

        const allCards = Array.from(cardMap.values());
        
        const dataToDistribute = { 
          cards: allCards, 
          changes: { added: [], modified: [], removed: [] } 
        };

        this.listenerData.set(listenerKey, dataToDistribute);

        // Update cache with merged results
        CacheService.setValue(cacheKey, dataToDistribute, { 
          ttl: 8 * 60 * 1000 // 8 minutes for user cards
        });

        // FIXED: Always distribute when we have data, regardless of initialization state
        // This ensures auction wins are reflected immediately
        console.log(`Distributing ${allCards.length} cards (Owner: ${ownerCards.length}, User: ${userCards.length})`);
        this.distributeData(listenerKey, dataToDistribute, 'realtime');
      };

      // Set up owner cards listener
      const unsubscribeOwner = onSnapshot(ownerCardsQuery, 
        (snapshot) => {
          ownerCards = [];
          snapshot.forEach((doc) => {
            ownerCards.push({ id: doc.id, ...doc.data() });
          });
          
          ownerInitialized = true;
          console.log(`Owner cards loaded: ${ownerCards.length} cards`);
          mergeAndDistribute(); // FIXED: Always call, don't wait for both
        },
        (error) => {
          console.error(`Owner cards listener error for ${userId}:`, error);
          this.handleListenerError(listenerKey, error);
        }
      );

      // Set up user cards listener
      const unsubscribeUser = onSnapshot(userCardsQuery, 
        (snapshot) => {
          userCards = [];
          snapshot.forEach((doc) => {
            userCards.push({ id: doc.id, ...doc.data() });
          });
          
          userInitialized = true;
          console.log(`User cards loaded: ${userCards.length} cards`);
          mergeAndDistribute(); // FIXED: Always call, don't wait for both
        },
        (error) => {
          console.error(`User cards listener error for ${userId}:`, error);
        }
      );

      // Store combined unsubscribe function
      const combinedUnsubscribe = () => {
        unsubscribeOwner();
        unsubscribeUser();
      };

      this.activeListeners.set(listenerKey, combinedUnsubscribe);
      this.metrics.sharedListeners++;
      console.log(`Created combined shared user cards listener for ${userId} in ${groupId}`);

    } catch (error) {
      console.error(`Error setting up user cards listener:`, error);
    }
  }

  /**
   * Ensure group trades listener exists
   */
  async ensureGroupTradesListener(groupId, listenerKey) {
    if (this.activeListeners.has(listenerKey)) {
      this.metrics.savedConnections++;
      return;
    }

    try {
      // Check cache first
      const cacheKey = `shared_group_trades_${groupId}`;
      const cachedData = await CacheService.getValue(cacheKey);
      
      if (cachedData) {
        this.listenerData.set(listenerKey, cachedData);
        this.distributeData(listenerKey, cachedData, 'cache');
      }

      // Set up shared listener for group trades
      const tradesRef = collection(db, 'trades');
      const groupTradesQuery = query(
        tradesRef,
        where('groupId', '==', groupId)
      );

      const unsubscribe = onSnapshot(groupTradesQuery, 
        (snapshot) => {
          const trades = [];
          const changes = {
            added: [],
            modified: [],
            removed: []
          };

          snapshot.docChanges().forEach((change) => {
            const tradeData = { id: change.doc.id, ...change.doc.data() };
            
            if (change.type === 'added') {
              changes.added.push(tradeData);
            } else if (change.type === 'modified') {
              changes.modified.push(tradeData);
            } else if (change.type === 'removed') {
              changes.removed.push(tradeData.id);
            }
          });

          snapshot.forEach((doc) => {
            trades.push({ id: doc.id, ...doc.data() });
          });

          this.listenerData.set(listenerKey, { trades, changes });

          // Update cache
          CacheService.setValue(cacheKey, { trades, changes }, { 
            ttl: 3 * 60 * 1000 // 3 minutes for trades
          });

          // Distribute to all subscribers with filtering
          this.distributeData(listenerKey, { trades, changes }, 'realtime');
        },
        (error) => {
          console.error(`Group trades listener error for ${groupId}:`, error);
          this.handleListenerError(listenerKey, error);
        }
      );

      this.activeListeners.set(listenerKey, unsubscribe);
      this.metrics.sharedListeners++;
      console.log(`Created shared group trades listener for ${groupId}`);

    } catch (error) {
      console.error(`Error setting up group trades listener:`, error);
    }
  }

  /**
   * Ensure group auctions listener exists
   */
  async ensureGroupAuctionsListener(groupId, listenerKey, options = {}) {
    if (this.activeListeners.has(listenerKey)) {
      this.metrics.savedConnections++;
      return; // Listener already exists
    }

    try {
      // Check cache first
      const cacheKey = `shared_group_auctions_${groupId}`;
      const cachedData = await CacheService.getValue(cacheKey);
      
      if (cachedData) {
        this.listenerData.set(listenerKey, cachedData);
        this.distributeData(listenerKey, cachedData, 'cache');
      }

      // Set up shared listener
      const auctionsRef = collection(db, 'auctions');
      const q = query(
        auctionsRef,
        where('groupId', '==', groupId),
        where('status', '==', 'active')
      );
      
      // Create throttled callback to reduce updates
      const throttleMs = options.throttleMs || 5000; // Default 5 seconds
      const throttledCallback = this.createThrottledCallback(
        listenerKey,
        (snapshot) => {
          const auctions = [];
          const changes = {
            added: [],
            modified: [],
            removed: []
          };

          snapshot.docChanges().forEach((change) => {
            const auctionData = { id: change.doc.id, ...change.doc.data() };
            
            // Filter fields if specified
            if (options.fields && options.fields.length > 0) {
              const filteredData = {};
              options.fields.forEach(field => {
                if (auctionData[field] !== undefined) {
                  filteredData[field] = auctionData[field];
                }
              });
              auctionData = { id: auctionData.id, ...filteredData };
            }
            
            if (change.type === 'added') {
              changes.added.push(auctionData);
            } else if (change.type === 'modified') {
              changes.modified.push(auctionData);
            } else if (change.type === 'removed') {
              changes.removed.push(auctionData.id);
            }
          });

          snapshot.forEach((doc) => {
            const auctionData = { id: doc.id, ...doc.data() };
            
            // Filter fields if specified
            if (options.fields && options.fields.length > 0) {
              const filteredData = {};
              options.fields.forEach(field => {
                if (auctionData[field] !== undefined) {
                  filteredData[field] = auctionData[field];
                }
              });
              auctionData = { id: auctionData.id, ...filteredData };
            }
            
            auctions.push(auctionData);
          });

          this.listenerData.set(listenerKey, { auctions, changes });

          // Update cache
          CacheService.setValue(cacheKey, { auctions, changes }, { 
            ttl: 5 * 60 * 1000 // 5 minutes for auctions
          });

          // Distribute to all subscribers
          this.distributeData(listenerKey, { auctions, changes }, 'realtime');
        },
        throttleMs
      );

      const unsubscribe = onSnapshot(q, throttledCallback, (error) => {
        console.error(`Group auctions listener error for ${groupId}:`, error);
        this.handleListenerError(listenerKey, error);
      });

      this.activeListeners.set(listenerKey, unsubscribe);
      this.metrics.sharedListeners++;
      console.log(`Created shared group auctions listener for ${groupId}`);

    } catch (error) {
      console.error(`Error setting up group auctions listener for ${groupId}:`, error);
    }
  }

  /**
   * Create a throttled callback to reduce update frequency
   */
  createThrottledCallback(key, callback, throttleMs) {
    let lastCall = 0;
    let timeout = null;
    let pendingData = null;

    return (data) => {
      const now = Date.now();
      
      if (now - lastCall < throttleMs) {
        // Too soon, schedule for later
        pendingData = data;
        
        if (!timeout) {
          timeout = setTimeout(() => {
            if (pendingData) {
              callback(pendingData);
              pendingData = null;
            }
            timeout = null;
            lastCall = Date.now();
          }, throttleMs - (now - lastCall));
        }
        
        return;
      }
      
      // Call immediately
      callback(data);
      lastCall = now;
    };
  }

  /**
   * Distribute data to all subscribers with filtering
   */
  distributeData(listenerKey, data, source) {
    const subscribers = this.subscribers.get(listenerKey);
    if (!subscribers) return;

    // SIMPLIFIED FIX: Remove the problematic delayed distribution
    // The delay was causing cards to appear then disappear after 500ms
    // Only skip empty cache data if we have active real-time listeners
    if (source === 'cache' && (!data || (data.cards && data.cards.length === 0))) {
      if (this.activeListeners.has(listenerKey)) {
        console.log(`Skipping empty cache data distribution for ${listenerKey}, waiting for real-time data`);
        return;
      }
    }

    // Distribute data immediately - no delays that cause flashing
    this.distributeDataImmediate(listenerKey, data, source);
  }

  distributeDataImmediate(listenerKey, data, source) {
    const subscribers = this.subscribers.get(listenerKey);
    if (!subscribers) return;

    subscribers.forEach((subscriber, subscriberKey) => {
      try {
        // Apply subscriber-specific filtering
        const filteredData = this.filterDataForSubscriber(data, subscriber);
        
        // ADDITIONAL FIX: Only call callback if we have valid data or if it's a real-time update
        // This prevents temporary "no cards found" states during refresh operations
        if (filteredData && (source === 'realtime' || (filteredData.cards && filteredData.cards.length > 0))) {
          subscriber.callback(filteredData);
          this.metrics.dataDistributions++;
        } else if (source === 'realtime') {
          // Always distribute real-time updates, even if empty (user might have no cards)
          subscriber.callback(filteredData || { cards: [], changes: { added: [], modified: [], removed: [] } });
          this.metrics.dataDistributions++;
        }
        
      } catch (error) {
        console.error(`Error distributing data to ${subscriberKey}:`, error);
      }
    });

    // Track saved connections
    if (subscribers.size > 1) {
      this.metrics.savedConnections += subscribers.size - 1;
    }
  }

  /**
   * Filter data based on subscriber requirements
   */
  filterDataForSubscriber(data, subscriber) {
    if (!data) return data;

    // Handle different data types
    if (data.cards) {
      // User cards data
      let filteredCards = [...data.cards];

      // Apply filters
      if (subscriber.filters) {
        Object.entries(subscriber.filters).forEach(([field, value]) => {
          filteredCards = filteredCards.filter(card => card[field] === value);
        });
      }

      // Apply sorting
      if (subscriber.sortBy) {
        filteredCards.sort((a, b) => {
          if (a[subscriber.sortBy] < b[subscriber.sortBy]) return -1;
          if (a[subscriber.sortBy] > b[subscriber.sortBy]) return 1;
          return 0;
        });
      }

      // Apply limit
      if (subscriber.limit) {
        filteredCards = filteredCards.slice(0, subscriber.limit);
      }

      return { cards: filteredCards, changes: data.changes };

    } else if (data.trades) {
      // Group trades data
      let filteredTrades = [...data.trades];

      // Apply user filter
      if (subscriber.userFilter) {
        filteredTrades = filteredTrades.filter(trade => 
          trade.requesterId === subscriber.userFilter || 
          trade.targetId === subscriber.userFilter
        );
      }

      // Apply status filter
      if (subscriber.statusFilter) {
        filteredTrades = filteredTrades.filter(trade => 
          trade.status === subscriber.statusFilter
        );
      }

      // Apply limit
      if (subscriber.limit) {
        filteredTrades = filteredTrades.slice(0, subscriber.limit);
      }

      return { trades: filteredTrades, changes: data.changes };

    } else {
      // Simple data (like group data)
      return data;
    }
  }

  /**
   * Provide immediate cached data to new subscribers
   */
  provideCachedData(listenerKey, subscriberKey) {
    const data = this.listenerData.get(listenerKey);
    if (!data) return;

    const subscriber = this.subscribers.get(listenerKey)?.get(subscriberKey);
    if (!subscriber) return;

    try {
      const filteredData = this.filterDataForSubscriber(data, subscriber);
      subscriber.callback(filteredData);
    } catch (error) {
      console.error(`Error providing cached data to ${subscriberKey}:`, error);
    }
  }

  /**
   * Unsubscribe from shared listener
   */
  unsubscribeFromGroupData(listenerKey, subscriberKey) {
    const subscribers = this.subscribers.get(listenerKey);
    if (!subscribers) return;

    subscribers.delete(subscriberKey);
    this.metrics.totalSubscribers--;

    // Clean up if no more subscribers
    if (subscribers.size === 0) {
      this.cleanupListener(listenerKey);
    }
  }

  /**
   * Clean up listener when no more subscribers
   */
  cleanupListener(listenerKey) {
    const unsubscribe = this.activeListeners.get(listenerKey);
    if (unsubscribe) {
      unsubscribe();
      this.activeListeners.delete(listenerKey);
      this.metrics.sharedListeners--;
    }

    this.subscribers.delete(listenerKey);
    this.listenerData.delete(listenerKey);
    console.log(`Cleaned up shared listener: ${listenerKey}`);
  }

  /**
   * Handle data not found scenarios
   */
  handleDataNotFound(listenerKey) {
    console.warn(`Data not found for listener: ${listenerKey}`);
    this.distributeData(listenerKey, null, 'error');
  }

  /**
   * Handle listener errors
   */
  handleListenerError(listenerKey, error) {
    const subscribers = this.subscribers.get(listenerKey);
    if (!subscribers) return;

    subscribers.forEach((subscriber, subscriberKey) => {
      try {
        // Provide cached data as fallback
        const cachedData = this.listenerData.get(listenerKey);
        if (cachedData) {
          const filteredData = this.filterDataForSubscriber(cachedData, subscriber);
          subscriber.callback(filteredData);
        }
      } catch (callbackError) {
        console.error(`Error in error handler for ${subscriberKey}:`, callbackError);
      }
    });
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeListeners: this.activeListeners.size,
      listenersWithMultipleSubscribers: Array.from(this.subscribers.values())
        .filter(subscriberMap => subscriberMap.size > 1).length,
      averageSubscribersPerListener: this.subscribers.size > 0 
        ? this.metrics.totalSubscribers / this.subscribers.size 
        : 0
    };
  }

  /**
   * Force cleanup of all listeners (for app shutdown)
   */
  cleanup() {
    this.activeListeners.forEach((unsubscribe, key) => {
      try {
        unsubscribe();
      } catch (error) {
        console.error(`Error cleaning up listener ${key}:`, error);
      }
    });

    this.activeListeners.clear();
    this.subscribers.clear();
    this.listenerData.clear();
    
    console.log('SharedListenerPool: All listeners cleaned up');
  }
}

// Create singleton instance
const sharedListenerPool = new SharedListenerPool();

export default sharedListenerPool;
export { SharedListenerPool };
