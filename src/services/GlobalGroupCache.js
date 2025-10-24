/**
 * Global Group Cache Service
 * 
 * Singleton service for caching group data to prevent duplicate reads.
 * Similar pattern to GlobalUserProfileCache.
 */

import { doc } from 'firebase/firestore';
import { db } from '../config/firebase';
import GlobalRequestDeduplicator from './GlobalRequestDeduplicator';
import { getDoc } from './ReadTracking/TrackedFirestore';

const GROUP_TTL = 7 * 24 * 60 * 60 * 1000; // ULTRA-AGGRESSIVE: 7 days (groups rarely change)
const cache = new Map();
const pendingFetches = new Map();

class GlobalGroupCache {
  constructor() {
    if (GlobalGroupCache._instance) {
      return GlobalGroupCache._instance;
    }
    GlobalGroupCache._instance = this;
    console.log('🏠 GlobalGroupCache initialized');
  }

  /**
   * Get group data with caching and deduplication
   * @param {string} groupId - Group ID to fetch
   * @param {boolean} forceRefresh - Force refresh from Firestore
   * @returns {Promise<Object|null>} Group data or null
   */
  async getGroup(groupId, forceRefresh = false) {
    if (!groupId) {
      console.warn('GlobalGroupCache: groupId is required.');
      return null;
    }

    const cacheKey = `group_${groupId}`;

    // Check cache first
    if (!forceRefresh && cache.has(cacheKey)) {
      const cachedData = cache.get(cacheKey);
      if (Date.now() - cachedData.timestamp < GROUP_TTL) {
        console.log(`✅ [GlobalGroupCache] Cache HIT for ${groupId}`);
        return cachedData.data;
      } else {
        console.log(`⚠️ [GlobalGroupCache] Cache EXPIRED for ${groupId}`);
        cache.delete(cacheKey); // Clear expired entry
      }
    }

    console.log(`📥 [GlobalGroupCache] Cache MISS for ${groupId}, fetching...`);
    
    // Use global deduplicator for truly global deduplication
    const dedupeKey = `groupInfo_${groupId}`;
    return GlobalRequestDeduplicator.deduplicate(dedupeKey, () => this._fetchAndCacheGroup(groupId, cacheKey));
  }

  /**
   * Internal method to fetch and cache group data
   * @private
   */
  async _fetchAndCacheGroup(groupId, cacheKey) {
    try {
      const groupDocRef = doc(db, 'groups', groupId);
      const groupDoc = await getDoc(groupDocRef); // Using TrackedFirestore

      if (!groupDoc.exists()) {
        console.warn(`GlobalGroupCache: Group ${groupId} not found.`);
        return null;
      }

      const groupData = groupDoc.data();
      const group = {
        id: groupId,
        name: groupData.name || 'Unknown Group',
        description: groupData.description || '',
        icon: groupData.icon || null,
        memberCount: groupData.memberCount || 0,
        members: groupData.members || [],
        admins: groupData.admins || [],
        createdBy: groupData.createdBy || null,
        settings: groupData.settings || {},
        createdAt: groupData.createdAt?.toDate?.() || new Date(),
        lastActivity: groupData.lastActivity?.toDate?.() || new Date()
      };

      cache.set(cacheKey, { data: group, timestamp: Date.now() });
      console.log(`💾 [GlobalGroupCache] Cached group ${groupId} (TTL: ${GROUP_TTL / 1000}s)`);
      return group;
    } catch (error) {
      console.error(`❌ [GlobalGroupCache] Failed to fetch group ${groupId}:`, error);
      throw error;
    }
  }

  /**
   * Invalidate cache for a specific group
   * @param {string} groupId - Group ID to invalidate
   */
  invalidateGroup(groupId) {
    const cacheKey = `group_${groupId}`;
    if (cache.has(cacheKey)) {
      cache.delete(cacheKey);
      console.log(`🗑️ [GlobalGroupCache] Invalidated cache for ${groupId}`);
    }
  }

  /**
   * Clear all cached groups
   */
  clearAll() {
    cache.clear();
    pendingFetches.clear();
    console.log('🗑️ [GlobalGroupCache] Cleared all cache entries.');
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    return {
      cacheSize: cache.size,
      pendingFetches: pendingFetches.size,
      cachedGroups: Array.from(cache.keys()).map(key => key.replace('group_', ''))
    };
  }
}

export default new GlobalGroupCache();
