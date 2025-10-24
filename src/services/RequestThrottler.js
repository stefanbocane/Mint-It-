/**
 * Request Throttler Service
 * 
 * PURPOSE: Prevent rapid successive Firestore requests
 * GOAL: Reduce unnecessary reads from rapid user actions
 * 
 * Features:
 * - Throttles requests by key
 * - Configurable throttle duration
 * - Returns cached result during throttle period
 * - Automatic cleanup of old throttles
 * 
 * @version 1.0.0
 */

class RequestThrottler {
  constructor() {
    // Store last request time and result: key -> { timestamp, result, promise }
    this.throttles = new Map();
    
    // Default throttle duration: 2 seconds
    this.defaultThrottleDuration = 2000;
    
    // Cleanup interval: 5 minutes
    this.cleanupInterval = 5 * 60 * 1000;
    
    // Start periodic cleanup
    this.startCleanup();
    
    if (__DEV__) {
      console.log('⏱️ RequestThrottler initialized');
    }
  }
  
  /**
   * Throttle a request
   * @param {string} key - Unique key for this request type
   * @param {Function} requestFn - Function that performs the request
   * @param {number} duration - Throttle duration in ms (default: 2000)
   * @returns {Promise} Result of request (cached or fresh)
   */
  async throttle(key, requestFn, duration = this.defaultThrottleDuration) {
    const now = Date.now();
    
    // Check if we have a recent request
    if (this.throttles.has(key)) {
      const throttle = this.throttles.get(key);
      const timeSinceLastRequest = now - throttle.timestamp;
      
      // If within throttle period, return cached result
      if (timeSinceLastRequest < duration) {
        if (__DEV__) {
          const remaining = Math.ceil((duration - timeSinceLastRequest) / 1000);
          console.log(`⏱️ [RequestThrottler] Request throttled: ${key} (${remaining}s remaining)`);
        }
        
        // If there's a pending promise, return it
        if (throttle.promise) {
          return throttle.promise;
        }
        
        // Otherwise return cached result
        return throttle.result;
      }
    }
    
    // Execute request
    if (__DEV__) {
      console.log(`✅ [RequestThrottler] Executing request: ${key}`);
    }
    
    try {
      // Create promise and store it
      const promise = requestFn();
      
      this.throttles.set(key, {
        timestamp: now,
        result: null,
        promise
      });
      
      // Wait for result
      const result = await promise;
      
      // Update with result
      this.throttles.set(key, {
        timestamp: now,
        result,
        promise: null
      });
      
      return result;
    } catch (error) {
      // Remove failed request from throttle
      this.throttles.delete(key);
      throw error;
    }
  }
  
  /**
   * Clear throttle for a specific key
   * @param {string} key - Key to clear
   */
  clear(key) {
    if (this.throttles.has(key)) {
      this.throttles.delete(key);
      if (__DEV__) {
        console.log(`🗑️ [RequestThrottler] Cleared throttle: ${key}`);
      }
    }
  }
  
  /**
   * Clear all throttles
   */
  clearAll() {
    this.throttles.clear();
    if (__DEV__) {
      console.log('🗑️ [RequestThrottler] Cleared all throttles');
    }
  }
  
  /**
   * Start periodic cleanup of old throttles
   */
  startCleanup() {
    setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }
  
  /**
   * Clean up old throttles (older than 10 minutes)
   */
  cleanup() {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes
    let cleaned = 0;
    
    for (const [key, throttle] of this.throttles.entries()) {
      if (now - throttle.timestamp > maxAge) {
        this.throttles.delete(key);
        cleaned++;
      }
    }
    
    if (__DEV__ && cleaned > 0) {
      console.log(`🧹 [RequestThrottler] Cleaned up ${cleaned} old throttles`);
    }
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      activeThrottles: this.throttles.size,
      throttles: Array.from(this.throttles.entries()).map(([key, throttle]) => ({
        key,
        age: Date.now() - throttle.timestamp,
        hasCachedResult: throttle.result !== null,
        isPending: throttle.promise !== null
      }))
    };
  }
}

// Export singleton instance
export default new RequestThrottler();
