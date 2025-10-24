/**
 * Cached Card Queries Utility
 * 
 * Provides module-level caching for card queries to prevent duplicate reads
 * across multiple screens and components.
 */

import { collection, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { getDocs } from '../services/ReadTracking/TrackedFirestore';

const CARD_CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached user cards with automatic cache management
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 * @param {boolean} forceRefresh - Force refresh from Firestore
 * @returns {Promise<Array>} Array of cards
 */
export async function getCachedUserCards(userId, groupId, forceRefresh = false) {
  if (!userId || !groupId) {
    console.warn('getCachedUserCards: userId and groupId are required');
    return [];
  }

  const cacheKey = `cards_${userId}_${groupId}`;
  
  // Check cache first (unless forcing refresh)
  if (!forceRefresh && CARD_CACHE.has(cacheKey)) {
    const cached = CARD_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`📦 [CachedCardQueries] Using cached cards for ${userId} (${cached.data.length} cards)`);
      return cached.data;
    } else {
      // Cache expired, remove it
      CARD_CACHE.delete(cacheKey);
    }
  }
  
  console.log(`📥 [CachedCardQueries] Cache MISS for ${userId}, fetching from Firestore...`);
  
  try {
    const q = query(
      collection(db, 'cards'),
      where('ownerId', '==', userId),
      where('groupId', '==', groupId)
    );
    
    const snapshot = await getDocs(q);
    const cards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Cache the results
    CARD_CACHE.set(cacheKey, { data: cards, timestamp: Date.now() });
    console.log(`💾 [CachedCardQueries] Cached ${cards.length} cards for ${userId} (TTL: ${CACHE_TTL / 1000}s)`);
    
    return cards;
  } catch (error) {
    console.error(`❌ [CachedCardQueries] Failed to fetch cards for ${userId}:`, error);
    return [];
  }
}

/**
 * Invalidate cache for a specific user
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 */
export function invalidateUserCards(userId, groupId) {
  const cacheKey = `cards_${userId}_${groupId}`;
  if (CARD_CACHE.has(cacheKey)) {
    CARD_CACHE.delete(cacheKey);
    console.log(`🗑️ [CachedCardQueries] Invalidated cache for ${userId}`);
  }
}

/**
 * Clear all cached cards
 */
export function clearAllCardCache() {
  CARD_CACHE.clear();
  console.log('🗑️ [CachedCardQueries] Cleared all card cache');
}

/**
 * Get cache statistics
 * @returns {Object} Cache stats
 */
export function getCardCacheStats() {
  return {
    cacheSize: CARD_CACHE.size,
    cachedUsers: Array.from(CARD_CACHE.keys()).map(key => key.replace('cards_', ''))
  };
}

