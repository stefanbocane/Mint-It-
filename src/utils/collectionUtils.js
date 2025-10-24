import { collection, query, where } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { getDocs } from '../services/ReadTracking/TrackedFirestore';
import { invalidateCache } from './firestoreUtils';

// Constants
const COLLECTION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Refresh a user's collection for a specific group
 * 
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 * @returns {Promise<void>}
 */
export const refreshUserCollection = async (userId, groupId) => {
  if (!userId || !groupId) return;
  
  try {
    // Invalidate the collection query cache
    const cacheKey = `query_cards_user_${userId}_group_${groupId}`;
    await invalidateCache(cacheKey);
    
    console.log(`Refreshed collection cache for user ${userId} in group ${groupId}`);
  } catch (error) {
    console.error(`Error refreshing collection for user ${userId} in group ${groupId}:`, error);
  }
};

/**
 * Optimized method to get user's collection with minimal fields
 * 
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 * @param {boolean} forceRefresh - Whether to force a refresh
 * @returns {Promise<Array>} - Array of cards
 */
export const getUserCollectionOptimized = async (userId, groupId, forceRefresh = false) => {
  if (!userId || !groupId) return [];
  
  try {
    // Create query for user's cards in group
    const cardsRef = collection(db, 'cards');
    const q = query(
      cardsRef,
      where('userId', '==', userId),
      where('groupId', '==', groupId)
    );
    
    // Execute query
    const querySnapshot = await getDocs(q);
    
    // Handle invalid snapshot
    if (!querySnapshot || !querySnapshot.docs) {
      console.error('Empty or invalid snapshot received when fetching user collection');
      return [];
    }
    
    // Map to minimal card objects with only necessary fields
    const cards = querySnapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name,
      imageUrl: doc.data().imageUrl,
      rarity: doc.data().rarity,
      inAuction: doc.data().inAuction || false,
      inTrade: doc.data().inTrade || false,
      status: doc.data().status || 'active'
    }));
    
    return cards;
  } catch (error) {
    console.error('Error fetching optimized user collection:', error);
    return [];
  }
};

export default {
  refreshUserCollection,
  getUserCollectionOptimized
}; 