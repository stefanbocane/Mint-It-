/**
 * Global Request Deduplicator
 * 
 * PURPOSE: Prevent duplicate concurrent requests across the entire application
 * 
 * PROBLEM: Multiple components/hooks requesting the same data simultaneously
 * causes duplicate Firestore reads even with caching
 * 
 * SOLUTION: Single source of truth for in-flight requests with extended retention
 * 
 * Features:
 * - Truly global deduplication (singleton pattern)
 * - Extended promise retention (100ms) to catch rapid successive calls
 * - Automatic cleanup
 * - Debug logging in development
 * 
 * @version 1.0.0
 */

class GlobalRequestDeduplicator {
  constructor() {
    this.pending = new Map();
    this.stats = {
      totalRequests: 0,
      deduplicatedRequests: 0,
      uniqueKeys: new Set()
    };
    
    if (__DEV__) {
      console.log('♻️ GlobalRequestDeduplicator initialized');
    }
  }
  
  /**
   * Deduplicate a request
   * @param {string} key - Unique key for the request
   * @param {Function} fetchFn - Function that performs the actual fetch
   * @returns {Promise} Result of the fetch
   */
  async deduplicate(key, fetchFn) {
    this.stats.totalRequests++;
    this.stats.uniqueKeys.add(key);
    
    // Check if request is already in flight
    if (this.pending.has(key)) {
      this.stats.deduplicatedRequests++;
      
      if (__DEV__) {
        console.log(`♻️ [Deduplicator] REUSING in-flight request: ${key}`);
        console.log(`   📊 Dedup rate: ${(this.stats.deduplicatedRequests / this.stats.totalRequests * 100).toFixed(1)}%`);
      }
      
      return this.pending.get(key);
    }
    
    // Start new request
    if (__DEV__) {
      console.log(`🆕 [Deduplicator] NEW request: ${key}`);
    }
    
    const promise = fetchFn();
    this.pending.set(key, promise);
    
    try {
      const result = await promise;
      
      // Keep promise in map for 100ms to catch rapid successive calls
      // This is critical for React's concurrent rendering
      setTimeout(() => {
        if (this.pending.get(key) === promise) {
          this.pending.delete(key);
          if (__DEV__) {
            console.log(`🧹 [Deduplicator] Cleaned up: ${key}`);
          }
        }
      }, 100);
      
      return result;
    } catch (error) {
      // Remove immediately on error
      this.pending.delete(key);
      throw error;
    }
  }
  
  /**
   * Check if a request is currently in flight
   * @param {string} key - Request key
   * @returns {boolean}
   */
  isPending(key) {
    return this.pending.has(key);
  }
  
  /**
   * Get statistics about deduplication
   * @returns {Object} Stats object
   */
  getStats() {
    return {
      ...this.stats,
      currentPending: this.pending.size,
      pendingKeys: Array.from(this.pending.keys()),
      deduplicationRate: this.stats.totalRequests > 0 
        ? (this.stats.deduplicatedRequests / this.stats.totalRequests * 100).toFixed(1) + '%'
        : '0%'
    };
  }
  
  /**
   * Clear all pending requests (use with caution)
   */
  clear() {
    this.pending.clear();
    if (__DEV__) {
      console.log('🗑️ [Deduplicator] Cleared all pending requests');
    }
  }
  
  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      deduplicatedRequests: 0,
      uniqueKeys: new Set()
    };
  }
}

// Export singleton instance
export default new GlobalRequestDeduplicator();
