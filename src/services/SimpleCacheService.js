/**
 * Simple Cache Service - Third Pass Optimization
 * 
 * ULTRA-SIMPLE: Minimal cache implementation that just works
 * - No complex TTL logic
 * - No AsyncStorage complications  
 * - Just memory-based caching for performance
 * - Guaranteed method availability
 */

class SimpleCacheService {
  constructor() {
    this.cache = new Map();
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0
    };
  }

  /**
   * Get value from cache - GUARANTEED to exist
   */
  get(key) {
    if (this.cache.has(key)) {
      const entry = this.cache.get(key);
      
      // Check if expired
      if (Date.now() > entry.expiry) {
        this.cache.delete(key);
        this.metrics.misses++;
        return null;
      }
      
      this.metrics.hits++;
      return entry.data;
    }
    this.metrics.misses++;
    return null;
  }

  /**
   * Set value in cache - GUARANTEED to exist
   */
  set(key, value, ttl = 300000) { // 5 minute default TTL
    this.metrics.sets++;
    
    // Simple TTL: store with expiry timestamp
    this.cache.set(key, {
      data: value,
      expiry: Date.now() + ttl
    });

    // Prevent cache from growing too large
    if (this.cache.size > 1000) {
      this.cleanup();
    }
  }

  /**
   * Check if key exists and is not expired
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Clear expired entries
   */
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get metrics
   */
  getMetrics() {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      ...this.metrics,
      hitRate: total > 0 ? this.metrics.hits / total : 0,
      size: this.cache.size
    };
  }
}

// Export singleton instance
export default new SimpleCacheService(); 