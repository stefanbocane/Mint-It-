/**
 * Global User Profile Cache
 * 
 * PURPOSE: Eliminate duplicate user profile reads by providing a singleton cache
 * 
 * PROBLEM: User profiles were being read 18 times during app boot
 * SOLUTION: Single source of truth with request deduplication
 * 
 * Features:
 * - In-memory cache with configurable TTL
 * - Request deduplication (concurrent requests share same promise)
 * - Automatic cache invalidation
 * - Session-based caching
 * 
 * @version 1.0.0
 */

import { doc } from 'firebase/firestore';
import { db } from '../config/firebase';
import GlobalRequestDeduplicator from './GlobalRequestDeduplicator';
import { getDoc } from './ReadTracking/TrackedFirestore';

class GlobalUserProfileCache {
  constructor() {
    // Cache storage: userId -> profile data
    this.cache = new Map();
    
    // Pending promises for deduplication: userId -> Promise
    this.pendingPromises = new Map();
    
    // Cache metadata: userId -> { timestamp, ttl }
    this.metadata = new Map();
    
    // ULTRA-AGGRESSIVE: 24 hour cache to minimize reads
    this.defaultTTL = 24 * 60 * 60 * 1000;
    
    if (__DEV__) {
      console.log('🌐 GlobalUserProfileCache initialized');
    }
  }
  
  /**
   * Get user profile with automatic caching and deduplication
   * @param {string} userId - User ID
   * @param {Object} options - Options { ttl, forceRefresh }
   * @returns {Promise<Object|null>} User profile data or null
   */
  async getProfile(userId, options = {}) {
    const { ttl = this.defaultTTL, forceRefresh = false } = options;
    
    if (!userId) {
      console.warn('[GlobalUserProfileCache] getProfile called without userId');
      return null;
    }
    
    // Check cache (unless force refresh)
    if (!forceRefresh && this.has(userId)) {
      if (__DEV__) {
        console.log(`✅ [GlobalUserProfileCache] Cache HIT for ${userId}`);
      }
      return this.cache.get(userId);
    }
    
    // Use global deduplicator for truly global deduplication
    const dedupeKey = `userProfile_${userId}`;
    return GlobalRequestDeduplicator.deduplicate(dedupeKey, () => this._fetchProfile(userId, ttl));
  }
  
  /**
   * Internal fetch method
   * @private
   */
  async _fetchProfile(userId, ttl) {
    try {
      const userRef = doc(db, 'users', userId);
      const snap = await getDoc(userRef);
      
      if (!snap.exists()) {
        if (__DEV__) {
          console.warn(`⚠️ [GlobalUserProfileCache] User profile not found: ${userId}`);
        }
        return null;
      }
      
      const profile = { id: snap.id, ...snap.data() };
      
      // Store in cache
      this.cache.set(userId, profile);
      this.metadata.set(userId, {
        timestamp: Date.now(),
        ttl
      });
      
      if (__DEV__) {
        console.log(`💾 [GlobalUserProfileCache] Cached profile for ${userId} (TTL: ${ttl / 1000}s)`);
      }
      
      return profile;
    } catch (error) {
      console.error(`❌ [GlobalUserProfileCache] Error fetching profile for ${userId}:`, error);
      return null;
    }
  }
  
  /**
   * Check if user profile is in cache and not expired
   */
  has(userId) {
    if (!this.cache.has(userId)) {
      return false;
    }
    
    const meta = this.metadata.get(userId);
    if (!meta) {
      return false;
    }
    
    // Check TTL
    const age = Date.now() - meta.timestamp;
    if (age > meta.ttl) {
      // Expired
      this.cache.delete(userId);
      this.metadata.delete(userId);
      return false;
    }
    
    return true;
  }
  
  /**
   * Invalidate cached profile (force refresh on next access)
   */
  invalidate(userId) {
    if (this.cache.has(userId)) {
      this.cache.delete(userId);
      this.metadata.delete(userId);
      
      if (__DEV__) {
        console.log(`🗑️ [GlobalUserProfileCache] Invalidated cache for ${userId}`);
      }
    }
  }
  
  /**
   * Clear all cached profiles
   */
  clear() {
    this.cache.clear();
    this.metadata.clear();
    this.pendingPromises.clear();
    
    if (__DEV__) {
      console.log('🗑️ [GlobalUserProfileCache] Cleared all cached profiles');
    }
  }
  
  /**
   * Get cache statistics
   */
  getStats() {
    return {
      cachedProfiles: this.cache.size,
      pendingRequests: this.pendingPromises.size,
      entries: Array.from(this.metadata.entries()).map(([userId, meta]) => ({
        userId,
        age: Date.now() - meta.timestamp,
        ttl: meta.ttl,
        expired: (Date.now() - meta.timestamp) > meta.ttl
      }))
    };
  }
}

// Export singleton instance
export default new GlobalUserProfileCache();
