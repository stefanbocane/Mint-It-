import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import CacheService from '../services/caching/CacheService';

/**
 * Enhanced Smart listener manager that optimizes Firestore real-time listeners
 * by implementing activity-aware throttling, intelligent refresh rates, and automatic
 * cleanup to significantly reduce database reads.
 */

// Global state to track all active listeners
const listeners = new Map();

// Track activity levels for adaptive throttling
const activityTracker = new Map();

// User activity monitoring
let userActivityLevel = 'medium'; // 'low', 'medium', 'high'
let lastUserInteraction = Date.now();
let activityCheckInterval = null;

// Enhanced default options for listeners
const DEFAULT_OPTIONS = {
  initialThrottleMs: 1000,         // Start with 1 second throttle
  maxThrottleMs: 15 * 60 * 1000,   // 15 minutes max between updates for inactive
  minThrottleMs: 500,              // Minimum throttle time (for very active data)
  minActivityThreshold: 3,         // Min updates to consider "active"
  activityTimeWindow: 60000,       // 1 minute window to measure activity
  maxIdleTime: 10 * 60 * 1000,     // Auto-cleanup after 10 minutes of no updates
  localCacheTime: 5 * 60 * 1000,   // Keep data in memory for 5 minutes
  enableActivityBasedThrottling: true
};

/**
 * Track user activity for intelligent throttling
 */
const trackUserActivity = () => {
  lastUserInteraction = Date.now();
  
  // Don't update activity level too frequently
  if (Date.now() - (trackUserActivity.lastUpdate || 0) < 5000) {
    return userActivityLevel;
  }
  
  trackUserActivity.lastUpdate = Date.now();
  
  // Determine activity level based on recent interactions
  const timeSinceLastActivity = Date.now() - lastUserInteraction;
  
  if (timeSinceLastActivity < 30000) { // 30 seconds
    userActivityLevel = 'high';
  } else if (timeSinceLastActivity < 2 * 60 * 1000) { // 2 minutes
    userActivityLevel = 'medium';
  } else {
    userActivityLevel = 'low';
  }
  
  return userActivityLevel;
};

/**
 * Get adaptive throttle time based on activity level and data type
 */
const getAdaptiveThrottleMs = (options, dataType = 'general') => {
  if (!options.enableActivityBasedThrottling) {
    return options.initialThrottleMs;
  }
  
  const activity = trackUserActivity();
  
  // Base throttle times by activity level
  const baseThrottles = {
    high: {
      userCards: 1000,      // 1 second for active card viewing
      auctions: 2000,       // 2 seconds for active auction bidding
      trades: 3000,         // 3 seconds for active trading
      general: 2000         // 2 seconds for other data
    },
    medium: {
      userCards: 5000,      // 5 seconds for casual browsing
      auctions: 10000,      // 10 seconds for casual auction viewing
      trades: 15000,        // 15 seconds for casual trade checking
      general: 8000         // 8 seconds for other data
    },
    low: {
      userCards: 2 * 60 * 1000,   // 2 minutes for background
      auctions: 5 * 60 * 1000,    // 5 minutes for background auctions
      trades: 10 * 60 * 1000,     // 10 minutes for background trades
      general: 3 * 60 * 1000      // 3 minutes for other data
    }
  };
  
  const throttleMs = baseThrottles[activity][dataType] || baseThrottles[activity].general;
  
  // Ensure within bounds
  return Math.max(
    options.minThrottleMs,
    Math.min(options.maxThrottleMs, throttleMs)
  );
};

/**
 * Start monitoring user activity
 */
const startActivityMonitoring = () => {
  if (activityCheckInterval) return;
  
  // Check activity level every 30 seconds
  activityCheckInterval = setInterval(() => {
    const newActivity = trackUserActivity();
    
    // Update throttle times for all active listeners if activity changed
    if (newActivity !== userActivityLevel) {
      console.log(`📊 User activity changed: ${userActivityLevel} → ${newActivity}`);
      updateAllListenerThrottles();
    }
  }, 30000);
  
  console.log('📊 Started user activity monitoring');
};

/**
 * Stop monitoring user activity
 */
const stopActivityMonitoring = () => {
  if (activityCheckInterval) {
    clearInterval(activityCheckInterval);
    activityCheckInterval = null;
    console.log('📊 Stopped user activity monitoring');
  }
};

/**
 * Update throttle times for all active listeners
 */
const updateAllListenerThrottles = () => {
  listeners.forEach((listener, listenerKey) => {
    if (listener.active && listener.options?.enableActivityBasedThrottling) {
      const newThrottleMs = getAdaptiveThrottleMs(listener.options, listener.dataType);
      listener.currentThrottleMs = newThrottleMs;
      
      console.log(`⚡ Updated throttle for ${listenerKey}: ${newThrottleMs}ms`);
    }
  });
};

/**
 * Enhanced create smart listener with activity-aware throttling
 * 
 * @param {string} listenerKey - Unique identifier for this listener
 * @param {object} queryOrRef - Firestore query or document reference  
 * @param {function} callback - Callback function to execute with results
 * @param {object} options - Configuration options
 * @returns {function} - Function to remove the listener
 */
export const createSmartListener = (listenerKey, queryOrRef, callback, options = {}) => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dataType = options.dataType || 'general';
  
  // Start activity monitoring if not already started
  startActivityMonitoring();
  
  // Track user interaction (listener creation indicates activity)
  trackUserActivity();
  
  // Initialize activity tracking for this query
  if (!activityTracker.has(listenerKey)) {
    activityTracker.set(listenerKey, {
      updateCount: 0,
      lastUpdate: Date.now(),
      currentThrottleMs: getAdaptiveThrottleMs(opts, dataType),
      consecutiveEmptyResults: 0
    });
  }
  
  const activity = activityTracker.get(listenerKey);
  let latestData = null;
  let pendingSnapshot = null;
  let throttleTimeout = null;
  let idleTimeout = null;
  
  // Enhanced throttled callback with activity awareness
  const throttledCallback = (snapshot) => {
    pendingSnapshot = snapshot;
    
    // Clear existing timeout
    if (throttleTimeout) {
      clearTimeout(throttleTimeout);
    }
    
    // Get current adaptive throttle time
    const currentThrottleMs = getAdaptiveThrottleMs(opts, dataType);
    activity.currentThrottleMs = currentThrottleMs;
    
    // Handle immediate updates for high-priority scenarios
    const isHighPriority = userActivityLevel === 'high' && dataType === 'auctions';
    const shouldUpdateImmediately = isHighPriority && activity.consecutiveEmptyResults === 0;
    
    if (shouldUpdateImmediately && currentThrottleMs > 1000) {
      console.log(`🚀 Immediate update for high-priority ${dataType} data`);
      processSnapshot();
      return;
    }
    
    // Schedule the callback with adaptive throttle time
    throttleTimeout = setTimeout(processSnapshot, currentThrottleMs);
  };
  
  const processSnapshot = () => {
    if (!pendingSnapshot) return;
    
    try {
      // Process the data based on snapshot type
      let data;
      let isEmpty = false;
      
      if (pendingSnapshot.docs !== undefined) {
        // Collection snapshot
        data = pendingSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        isEmpty = data.length === 0;
      } else {
        // Document snapshot
        data = pendingSnapshot.exists() ? 
          { id: pendingSnapshot.id, ...pendingSnapshot.data() } : 
          null;
        isEmpty = data === null;
      }
      
      // Track empty results for adaptive behavior
      if (isEmpty) {
        activity.consecutiveEmptyResults++;
      } else {
        activity.consecutiveEmptyResults = 0;
      }
      
      // Update activity tracking
      activity.updateCount++;
      activity.lastUpdate = Date.now();
      
      // Store in cache with TTL based on activity
      const cacheKey = `smart_listener_${listenerKey}`;
      const cacheTTL = userActivityLevel === 'high' ? 2 * 60 * 1000 : // 2 minutes
                      userActivityLevel === 'medium' ? 5 * 60 * 1000 : // 5 minutes  
                      10 * 60 * 1000; // 10 minutes for low activity
      
      CacheService.setValue(cacheKey, data, { ttl: cacheTTL });
      
      // Save the latest data for caching
      latestData = data;
      
      // Update the stored data in listeners map
      if (listeners.has(listenerKey)) {
        listeners.set(listenerKey, {
          ...listeners.get(listenerKey),
          data: latestData,
          lastUpdateTime: Date.now(),
          currentThrottleMs: activity.currentThrottleMs
        });
      }
      
      // Call the user's callback
      callback(data);
      
      console.log(`📡 ${listenerKey} updated (${userActivityLevel} activity, ${activity.currentThrottleMs}ms throttle)`);
      
    } catch (error) {
      console.error(`Error processing snapshot for ${listenerKey}:`, error);
      callback(null, error);
    } finally {
      pendingSnapshot = null;
      resetIdleTimeout();
    }
  };
  
  // Reset idle timeout
  const resetIdleTimeout = () => {
    if (idleTimeout) {
      clearTimeout(idleTimeout);
    }
    
    idleTimeout = setTimeout(() => {
      console.log(`⏰ Listener ${listenerKey} idle timeout - cleaning up`);
      cleanupListener();
    }, opts.maxIdleTime);
  };
  
  // Cleanup function
  const cleanupListener = () => {
    if (throttleTimeout) {
      clearTimeout(throttleTimeout);
      throttleTimeout = null;
    }
    
    if (idleTimeout) {
      clearTimeout(idleTimeout);
      idleTimeout = null;
    }
    
    if (listeners.has(listenerKey)) {
      const listener = listeners.get(listenerKey);
      if (listener.unsubscribe && typeof listener.unsubscribe === 'function') {
        listener.unsubscribe();
      }
      listeners.delete(listenerKey);
    }
    
    console.log(`🧹 Cleaned up listener: ${listenerKey}`);
  };
  
  // Check for existing listener and use cached data if available
  if (listeners.has(listenerKey)) {
    const existingListener = listeners.get(listenerKey);
    
    // If there's cached data, provide it immediately
    if (existingListener.data && !existingListener.active) {
      setTimeout(() => {
        callback(existingListener.data);
      }, 0);
    }
    
    // Clean up the existing listener
    if (existingListener.unsubscribe && typeof existingListener.unsubscribe === 'function') {
      existingListener.unsubscribe();
    }
  }
  
  // Try to get cached data first for immediate response
  const cacheKey = `smart_listener_${listenerKey}`;
  CacheService.getValue(cacheKey).then(cachedData => {
    if (cachedData && cachedData !== null) {
      console.log(`💾 Using cached data for ${listenerKey}`);
      callback(cachedData);
    }
  }).catch(err => {
    console.warn(`Cache read failed for ${listenerKey}:`, err);
  });
  
  // Create the actual Firestore listener
  const unsubscribe = onSnapshot(queryOrRef, throttledCallback, error => {
    console.error(`Error in smart listener ${listenerKey}:`, error);
    
    // Update error tracking
    if (listeners.has(listenerKey)) {
      listeners.set(listenerKey, {
        ...listeners.get(listenerKey),
        error: error.message,
        lastErrorTime: Date.now()
      });
    }
    
    // Don't clean up on error, provide error to callback
    callback(null, error);
  });
  
  // Start the idle timeout
  resetIdleTimeout();
  
  // Save the listener with enhanced metadata
  listeners.set(listenerKey, {
    unsubscribe,
    active: true,
    createdAt: Date.now(),
    lastUpdateTime: Date.now(),
    data: null,
    options: opts,
    dataType,
    currentThrottleMs: activity.currentThrottleMs
  });
  
  console.log(`🎯 Created smart listener: ${listenerKey} (${dataType}, ${activity.currentThrottleMs}ms throttle)`);
  
  // Return function to remove the listener
  return () => {
    cleanupListener();
    return true;
  };
};

/**
 * Create a smart document listener with activity awareness
 */
export const listenToDocumentSmartly = (collectionPath, docId, callback, options = {}) => {
  const docRef = doc(db, collectionPath, docId);
  const listenerKey = `${collectionPath}/${docId}`;
  
  return createSmartListener(listenerKey, docRef, callback, {
    ...options,
    dataType: options.dataType || collectionPath
  });
};

/**
 * Create a smart collection listener with activity awareness
 */
export const listenToCollectionSmartly = (collectionPath, callback, options = {}) => {
  const colRef = collection(db, collectionPath);
  const listenerKey = `collection/${collectionPath}`;
  
  return createSmartListener(listenerKey, colRef, callback, {
    ...options,
    dataType: options.dataType || collectionPath
  });
};

/**
 * Get current listener statistics
 */
export const getListenerStats = () => {
  return {
    activeListeners: listeners.size,
    userActivityLevel,
    lastUserInteraction,
    listeners: Array.from(listeners.entries()).map(([key, listener]) => ({
      key,
      active: listener.active,
      dataType: listener.dataType,
      currentThrottleMs: listener.currentThrottleMs,
      lastUpdate: listener.lastUpdateTime
    }))
  };
};

/**
 * Manually update user activity (for external activity tracking)
 */
export const updateUserActivity = () => {
  trackUserActivity();
};

/**
 * Clean up all listeners and stop monitoring
 */
export const cleanupAllListeners = () => {
  listeners.forEach((listener, key) => {
    if (listener.unsubscribe && typeof listener.unsubscribe === 'function') {
      listener.unsubscribe();
    }
  });
  
  listeners.clear();
  activityTracker.clear();
  stopActivityMonitoring();
  
  console.log('🧹 Cleaned up all smart listeners');
};

// Export the main function as default
export default {
  createSmartListener,
  listenToDocumentSmartly,
  listenToCollectionSmartly,
  getListenerStats,
  updateUserActivity,
  cleanupAllListeners,
  trackUserActivity
}; 