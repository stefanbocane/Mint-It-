/**
 * CacheService - Handles aggressive caching with TTL and size limits
 * Implements LRU (Least Recently Used) cache strategy
 */
export class CacheService {
  constructor(options = {}) {
    this.cache = new Map();
    this.ttl = options.ttl || 5 * 60 * 1000; // Default 5 minutes
    this.maxItems = options.maxItems || 100;
    this.lastCleanup = Date.now();
    this.cleanupInterval = 60 * 1000; // Cleanup every minute
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any>} - Cached value or null if not found/expired
   */
  async getValue(key) {
    this.cleanupIfNeeded();
    
    const item = this.cache.get(key);
    if (!item) return null;

    // Check if expired
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    // Update last accessed time
    item.lastAccessed = Date.now();
    return item.value;
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {Object} options - Cache options
   */
  async setValue(key, value, options = {}) {
    this.cleanupIfNeeded();

    // Check if we need to make space
    if (this.cache.size >= this.maxItems) {
      this.evictLeastRecentlyUsed();
    }

    const item = {
      value,
      expiry: Date.now() + (options.ttl || this.ttl),
      lastAccessed: Date.now()
    };

    this.cache.set(key, item);
  }

  /**
   * Remove value from cache
   * @param {string} key - Cache key to remove
   */
  async removeValue(key) {
    this.cache.delete(key);
  }

  /**
   * Clear entire cache
   */
  async clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxItems: this.maxItems,
      ttl: this.ttl,
      lastCleanup: this.lastCleanup
    };
  }

  /**
   * Evict least recently used item
   * @private
   */
  evictLeastRecentlyUsed() {
    let oldestKey = null;
    let oldestAccess = Infinity;

    for (const [key, item] of this.cache.entries()) {
      if (item.lastAccessed < oldestAccess) {
        oldestAccess = item.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Cleanup expired items if needed
   * @private
   */
  cleanupIfNeeded() {
    const now = Date.now();
    if (now - this.lastCleanup > this.cleanupInterval) {
      this.cleanup();
      this.lastCleanup = now;
    }
  }

  /**
   * Cleanup expired items
   * @private
   */
  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

// Export singleton instance
export const cacheService = new CacheService(); 