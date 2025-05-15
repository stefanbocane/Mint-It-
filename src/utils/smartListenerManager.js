import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Smart listener manager that optimizes Firestore real-time listeners
 * by implementing throttling, activity-based refresh rates, and automatic
 * cleanup to reduce database reads.
 */

// Global state to track all active listeners
const listeners = new Map();

// Track activity levels for adaptive throttling
const activityTracker = new Map();

// Default options for listeners
const DEFAULT_OPTIONS = {
  initialThrottleMs: 500,          // Start with this throttle time
  maxThrottleMs: 60000,            // 1 minute max between updates
  minThrottleMs: 200,              // Minimum throttle time (for very active data)
  minActivityThreshold: 3,         // Min updates to consider "active"
  activityTimeWindow: 60000,       // 1 minute window to measure activity
  maxIdleTime: 5 * 60 * 1000,      // Auto-cleanup after 5 minutes of no updates
  localCacheTime: 2 * 60 * 1000    // Keep data in memory for 2 minutes even if listener stops
};

/**
 * Create a smart listener for a Firestore query or document
 * 
 * @param {string} listenerKey - Unique key to identify this listener
 * @param {object} queryOrRef - Firestore query or document reference
 * @param {function} callback - Function to call with the updated data
 * @param {object} options - Listener options
 * @returns {function} - Function to remove the listener
 */
export const createSmartListener = (listenerKey, queryOrRef, callback, options = {}) => {
  // Merge default options with provided options
  const config = { ...DEFAULT_OPTIONS, ...options };
  
  // Initialize activity tracking
  if (!activityTracker.has(listenerKey)) {
    activityTracker.set(listenerKey, {
      updateCount: 0,
      lastUpdateTime: Date.now(),
      lastDataTime: Date.now(),
      firstUpdateTime: Date.now(),
      currentThrottleMs: config.initialThrottleMs
    });
  }
  
  // Initialize or get the activity tracking info
  const activity = activityTracker.get(listenerKey);
  
  // Store the latest data for caching
  let latestData = null;
  
  // Throttling variables
  let throttleTimeout = null;
  let pendingSnapshot = null;
  let idleTimeout = null;
  
  // Reset idle timeout to prevent auto-cleanup
  const resetIdleTimeout = () => {
    if (idleTimeout) {
      clearTimeout(idleTimeout);
    }
    
    idleTimeout = setTimeout(() => {
      console.log(`Listener ${listenerKey} idle for ${config.maxIdleTime}ms, auto-cleaning up`);
      cleanupListener();
    }, config.maxIdleTime);
  };
  
  // Function to clean up the listener
  const cleanupListener = () => {
    if (throttleTimeout) {
      clearTimeout(throttleTimeout);
      throttleTimeout = null;
    }
    
    if (idleTimeout) {
      clearTimeout(idleTimeout);
      idleTimeout = null;
    }
    
    // If there's an active Firestore listener, unsubscribe
    if (listeners.has(listenerKey)) {
      const unsub = listeners.get(listenerKey).unsubscribe;
      if (typeof unsub === 'function') {
        unsub();
      }
      
      // Keep the data in the map for local caching, but mark as inactive
      listeners.set(listenerKey, {
        ...listeners.get(listenerKey),
        active: false,
        data: latestData,
        deactivatedAt: Date.now()
      });
      
      // Schedule complete removal after local cache time
      setTimeout(() => {
        if (listeners.has(listenerKey) && !listeners.get(listenerKey).active) {
          listeners.delete(listenerKey);
          activityTracker.delete(listenerKey);
          console.log(`Listener ${listenerKey} completely removed from memory`);
        }
      }, config.localCacheTime);
    }
  };
  
  // Create the throttled callback function
  const throttledCallback = (snapshot) => {
    // Track activity
    activity.updateCount++;
    activity.lastUpdateTime = Date.now();
    
    // Keep the latest snapshot
    pendingSnapshot = snapshot;
    
    // Clear existing timeout
    if (throttleTimeout) {
      clearTimeout(throttleTimeout);
    }
    
    // Calculate activity level
    const timeSpan = (Date.now() - activity.firstUpdateTime) / 1000; // in seconds
    const updatesPerSecond = activity.updateCount / Math.max(1, timeSpan);
    
    // Adjust throttle time based on activity
    if (updatesPerSecond > config.minActivityThreshold) {
      // High activity - increase throttle to reduce updates
      activity.currentThrottleMs = Math.min(
        activity.currentThrottleMs * 1.5, 
        config.maxThrottleMs
      );
      console.log(`High activity for ${listenerKey}, throttle increased to ${activity.currentThrottleMs}ms`);
    } else {
      // Low activity - decrease throttle for more responsiveness
      activity.currentThrottleMs = Math.max(
        config.minThrottleMs,
        activity.currentThrottleMs / 1.2
      );
    }
    
    // Reset idle timeout since we got an update
    resetIdleTimeout();
    
    // Schedule the callback with the throttle time
    throttleTimeout = setTimeout(() => {
      if (pendingSnapshot) {
        // Process the data if it's a query
        if (pendingSnapshot.docs) {
          // Add null check to ensure docs is not undefined
          if (!Array.isArray(pendingSnapshot.docs)) {
            console.error('Invalid snapshot.docs - not an array');
            return;
          }
          
          const data = pendingSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          
          // Save the latest data for caching
          latestData = data;
          
          // Update the stored data in listeners map
          if (listeners.has(listenerKey)) {
            listeners.set(listenerKey, {
              ...listeners.get(listenerKey),
              data: latestData,
              lastUpdateTime: Date.now()
            });
          }
          
          // Call the user's callback
          callback(data);
        } else {
          // It's a document snapshot
          const data = pendingSnapshot.exists() ? 
            { id: pendingSnapshot.id, ...pendingSnapshot.data() } : 
            null;
          
          // Save the latest data for caching
          latestData = data;
          
          // Update the stored data in listeners map
          if (listeners.has(listenerKey)) {
            listeners.set(listenerKey, {
              ...listeners.get(listenerKey),
              data: latestData,
              lastUpdateTime: Date.now()
            });
          }
          
          // Call the user's callback
          callback(data);
        }
        
        pendingSnapshot = null;
      }
    }, activity.currentThrottleMs);
  };
  
  // If we already have a listener with this key, clean it up first
  if (listeners.has(listenerKey)) {
    const existingListener = listeners.get(listenerKey);
    
    // If there's cached data and the listener is marked as inactive, use that data immediately
    if (existingListener.data && !existingListener.active) {
      // The setTimeout ensures this happens asynchronously like a real Firestore response
      setTimeout(() => {
        callback(existingListener.data);
      }, 0);
    }
    
    // Clean up the existing listener
    if (existingListener.unsubscribe && typeof existingListener.unsubscribe === 'function') {
      existingListener.unsubscribe();
    }
  }
  
  // Create the actual Firestore listener
  const unsubscribe = onSnapshot(queryOrRef, throttledCallback, error => {
    console.error(`Error in smart listener ${listenerKey}:`, error);
    
    // Make a fallback request if there's an error
    // This could be expanded to automatically retry or handle specific error types
    if (listeners.has(listenerKey)) {
      listeners.set(listenerKey, {
        ...listeners.get(listenerKey),
        error: error.message,
        lastErrorTime: Date.now()
      });
    }
    
    // Don't clean up on error, just let the user know
    callback(null, error);
  });
  
  // Start the idle timeout
  resetIdleTimeout();
  
  // Save the listener
  listeners.set(listenerKey, {
    unsubscribe,
    active: true,
    createdAt: Date.now(),
    lastUpdateTime: Date.now(),
    data: null
  });
  
  // Return function to remove the listener
  return () => {
    cleanupListener();
    return true;
  };
};

/**
 * Get the cached data for a listener if available
 * 
 * @param {string} listenerKey - Listener key to get data for
 * @returns {any} - Cached data or null if not available
 */
export const getCachedListenerData = (listenerKey) => {
  if (listeners.has(listenerKey)) {
    return listeners.get(listenerKey).data;
  }
  return null;
};

/**
 * Check if a listener is active
 * 
 * @param {string} listenerKey - Listener key to check
 * @returns {boolean} - True if listener is active
 */
export const isListenerActive = (listenerKey) => {
  if (listeners.has(listenerKey)) {
    return listeners.get(listenerKey).active === true;
  }
  return false;
};

/**
 * Clean up all listeners
 */
export const cleanupAllListeners = () => {
  for (const [key, listener] of listeners.entries()) {
    if (listener.unsubscribe && typeof listener.unsubscribe === 'function') {
      listener.unsubscribe();
    }
    listeners.delete(key);
  }
  
  activityTracker.clear();
  
  console.log('All smart listeners cleaned up');
};

/**
 * Get stats about all active listeners
 * 
 * @returns {Object} - Stats about active listeners
 */
export const getListenerStats = () => {
  const activeListeners = [];
  const inactiveListeners = [];
  
  for (const [key, listener] of listeners.entries()) {
    const listenerInfo = {
      key,
      createdAt: listener.createdAt,
      lastUpdateTime: listener.lastUpdateTime,
      active: !!listener.active,
    };
    
    if (listener.active) {
      activeListeners.push(listenerInfo);
    } else {
      inactiveListeners.push(listenerInfo);
    }
  }
  
  return {
    activeCount: activeListeners.length,
    inactiveCount: inactiveListeners.length,
    totalCount: listeners.size,
    activeListeners,
    inactiveListeners
  };
};

/**
 * Create a smart document listener (simplified helper function)
 * 
 * @param {string} collectionPath - Collection path
 * @param {string} docId - Document ID
 * @param {function} callback - Callback function
 * @param {object} options - Listener options
 * @returns {function} - Function to remove the listener
 */
export const listenToDocumentSmartly = (collectionPath, docId, callback, options = {}) => {
  const docRef = doc(db, collectionPath, docId);
  const listenerKey = `${collectionPath}/${docId}`;
  
  return createSmartListener(listenerKey, docRef, callback, options);
};

/**
 * Create a smart collection listener (simplified helper function)
 * 
 * @param {string} collectionPath - Collection path
 * @param {function} callback - Callback function
 * @param {object} options - Listener options
 * @returns {function} - Function to remove the listener
 */
export const listenToCollectionSmartly = (collectionPath, callback, options = {}) => {
  const colRef = collection(db, collectionPath);
  const listenerKey = `collection/${collectionPath}`;
  
  return createSmartListener(listenerKey, colRef, callback, options);
};

/**
 * Create a smart query listener (simplified helper function)
 * 
 * @param {string} listenerKey - Unique key for this listener
 * @param {object} firestoreQuery - Firestore query
 * @param {function} callback - Callback function
 * @param {object} options - Listener options
 * @returns {function} - Function to remove the listener
 */
export const listenToQuerySmartly = (listenerKey, firestoreQuery, callback, options = {}) => {
  return createSmartListener(listenerKey, firestoreQuery, callback, options);
};

export default {
  createSmartListener,
  listenToDocumentSmartly,
  listenToCollectionSmartly,
  listenToQuerySmartly,
  getCachedListenerData,
  isListenerActive,
  cleanupAllListeners,
  getListenerStats
}; 