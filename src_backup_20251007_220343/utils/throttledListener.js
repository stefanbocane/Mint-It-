/**
 * Utilities for throttling real-time listeners to reduce updates and database reads
 */

// Maintain a Map of throttled listener functions
const listenerThrottles = new Map();

// Track last update times globally to enforce global rate limiting
const lastUpdateTimes = new Map();
const GLOBAL_MIN_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes global minimum between updates

/**
 * Create a throttled callback function
 * 
 * @param {Function} callback - Original callback function
 * @param {number} throttleMs - Throttle period in milliseconds
 * @param {boolean} leading - Whether to call on the leading edge (first event)
 * @param {boolean} trailing - Whether to call on the trailing edge (after throttle)
 * @returns {Function} - Throttled function
 */
export const throttle = (callback, throttleMs = 5000, leading = true, trailing = true) => {
  let lastCallTime = 0;
  let lastArgs = null;
  let leadingCallDone = false;
  let timeoutId = null;
  
  const callbackWrapper = (...args) => {
    lastArgs = args;
    callback(...args);
  };
  
  return function throttled(...args) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;
    
    // Clear any existing timeout on new call
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
    // Store current args for potential trailing call
    lastArgs = args;
    
    if (timeSinceLastCall >= throttleMs) {
      // Enough time has passed since last call
      lastCallTime = now;
      leadingCallDone = true;
      
      if (leading) {
        callbackWrapper(...args);
      }
    } else if (!leadingCallDone && leading) {
      // First call (leading edge) and not enough time passed
      lastCallTime = now;
      leadingCallDone = true;
      callbackWrapper(...args);
    }
    
    // Set up trailing call
    if (trailing) {
      timeoutId = setTimeout(() => {
        lastCallTime = Date.now();
        timeoutId = null;
        callbackWrapper(...lastArgs);
      }, throttleMs - timeSinceLastCall);
    }
  };
};

/**
 * Check if an update should be throttled based on global rate limiting
 * 
 * @param {string} listenerId - Unique ID for this listener
 * @returns {boolean} - Whether the update should be throttled
 */
const shouldThrottleGlobally = (listenerId) => {
  const now = Date.now();
  const lastUpdate = lastUpdateTimes.get(listenerId) || 0;
  
  // Check if we should throttle based on global minimum interval
  if (now - lastUpdate < GLOBAL_MIN_UPDATE_INTERVAL) {
    console.log(`Global throttling for ${listenerId}: too soon (${Math.round((now - lastUpdate) / 1000)}s < ${GLOBAL_MIN_UPDATE_INTERVAL / 1000}s)`);
    return true;
  }
  
  // Update the last update time
  lastUpdateTimes.set(listenerId, now);
  return false;
};

/**
 * Create a throttled listener for Firestore updates
 * 
 * @param {string} listenerId - Unique ID for this listener
 * @param {Function} callback - Original callback to receive updates
 * @param {number} throttleMs - Throttle period in milliseconds (default: 5 minutes)
 * @returns {Function} - Throttled callback
 */
export const getThrottledListener = (listenerId, callback, throttleMs = 300000) => {
  // Check if we already have a throttled listener for this ID
  if (listenerThrottles.has(listenerId)) {
    return listenerThrottles.get(listenerId);
  }
  
  // Ensure minimum throttle time to prevent excessive updates
  const actualThrottleMs = Math.max(throttleMs, 120000); // At least 2 minutes
  
  // Create a new throttled callback with global throttling
  const throttledCallback = function(...args) {
    // Check global throttling first
    if (shouldThrottleGlobally(listenerId)) {
      return;
    }
    
    // Use the standard throttle mechanism
    const throttled = throttle(callback, actualThrottleMs, true, true);
    throttled(...args);
  };
  
  // Store it for future use
  listenerThrottles.set(listenerId, throttledCallback);
  
  return throttledCallback;
};

/**
 * Clear a throttled listener
 * 
 * @param {string} listenerId - Listener ID to clear
 */
export const clearThrottledListener = (listenerId) => {
  if (listenerThrottles.has(listenerId)) {
    listenerThrottles.delete(listenerId);
  }
  
  // Also clear from lastUpdateTimes
  if (lastUpdateTimes.has(listenerId)) {
    lastUpdateTimes.delete(listenerId);
  }
};

/**
 * Clear all throttled listeners
 */
export const clearAllThrottledListeners = () => {
  listenerThrottles.clear();
  lastUpdateTimes.clear();
}; 