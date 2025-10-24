/**
 * Bootstrap Service
 * Optimized boot sequence that minimizes Firestore reads
 *
 * Goal: Get all initial data in 1-2 reads instead of 10+
 */

import { doc } from 'firebase/firestore';
import { getDoc } from './ReadTracking/TrackedFirestore';
import { db } from '../config/firebase';

// Module-level cache to prevent duplicate reads
const BOOTSTRAP_CACHE = new Map();
const CACHE_TTL = 60000; // 1 minute cache

class BootstrapService {
  /**
   * Get complete boot payload with minimal reads
   * Priority 1: initialAppLoad (1 read for everything)
   * Priority 2: cardOverview (1 read for cards)
   *
   * @param {string} userId
   * @param {string} groupId
   * @returns {Promise<Object|null>} Boot data or null if not available
   */
  static async getBootPayload(userId, groupId) {
    if (!userId || !groupId) return null;

    const cacheKey = `${userId}_${groupId}`;

    // Check cache first
    const cached = BOOTSTRAP_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log(`📦 Bootstrap cache hit: ${cached.exists ? 'Document exists' : 'Document missing'}`);
      return cached.data;
    }

    try {
      // Priority 1: Try initialAppLoad (1 read gets EVERYTHING)
      console.log('📦 Checking initialAppLoad...');
      const bootRef = doc(db, 'initialAppLoad', `${userId}_${groupId}`);
      const bootSnap = await getDoc(bootRef);

      let result = null;

      if (bootSnap.exists()) {
        const data = bootSnap.data();
        console.log('✅ Using initialAppLoad (1 read for all data)');

        result = {
          cards: data.cards || [],
          userProfile: data.userProfile || null,
          groupInfo: data.groupInfo || null,
          userBalance: data.userBalance || 0,
          source: 'initialAppLoad',
          reads: 1,
          timestamp: data.updatedAt?.toDate?.() || new Date()
        };
      } else {
        console.log('⚠️ No initialAppLoad found');
      }

      // Cache the result (even if null - means "doesn't exist")
      BOOTSTRAP_CACHE.set(cacheKey, {
        data: result,
        exists: bootSnap.exists(),
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      console.error('❌ Bootstrap failed:', error);
      return null;
    }
  }

  /**
   * Invalidate cache for a specific user/group
   */
  static invalidateCache(userId, groupId) {
    const cacheKey = `${userId}_${groupId}`;
    BOOTSTRAP_CACHE.delete(cacheKey);
    console.log(`🗑️ Bootstrap cache invalidated for ${cacheKey}`);
  }

  /**
   * Clear all bootstrap cache
   */
  static clearCache() {
    BOOTSTRAP_CACHE.clear();
    console.log('🗑️ All bootstrap cache cleared');
  }

  /**
   * Check if initialAppLoad exists and is fresh
   * @param {string} userId
   * @param {string} groupId
   * @returns {Promise<boolean>}
   */
  static async hasValidBootPayload(userId, groupId) {
    try {
      const bootRef = doc(db, 'initialAppLoad', `${userId}_${groupId}`);
      const bootSnap = await getDoc(bootRef);

      if (!bootSnap.exists()) return false;

      // Check if data is recent (less than 5 minutes old)
      const data = bootSnap.data();
      const updatedAt = data.updatedAt?.toDate?.();
      if (updatedAt) {
        const age = Date.now() - updatedAt.getTime();
        return age < 5 * 60 * 1000; // 5 minutes
      }

      return true;
    } catch (error) {
      return false;
    }
  }
}

export default BootstrapService;
