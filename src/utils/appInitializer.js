/**
 * App initialization utilities for optimizing startup and caching
 */

import { getAuth } from 'firebase/auth';
import { collection, doc, getDoc, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { CACHE_TTL } from '../constants/cacheConfig';
import { clearExpiredCache } from './cacheUtils';
import { getCachedDoc, getCachedDocFields, getCachedQuery } from './firestoreUtils';
import { getCacheMetrics } from './globalCacheManager';

// Preload important user-specific data on login
export const preloadUserData = async (userId, groupId) => {
  if (!userId) return;
  
  console.log('Preloading essential user data...');
  
  try {
    // Execute these in parallel for speed
    const preloadPromises = [];
    
    // 1. Preload user profile
    preloadPromises.push(
      getCachedDoc('users', userId, { 
        ttl: CACHE_TTL.USER_PROFILE,
        forceRefresh: true 
      })
    );
    
    // If we have a group ID, load group-specific data
    if (groupId) {
      // 2. Preload user cards
      const cardsQuery = query(
        collection(db, 'cards'),
        where('userId', '==', userId),
        where('groupId', '==', groupId),
        limit(20)
      );
      
      preloadPromises.push(
        getCachedQuery(cardsQuery, {
          ttl: CACHE_TTL.COLLECTION,
          cacheKey: `cards_user_${userId}_${groupId}_preload`
        })
      );
      
      // 3. Preload active auctions
      const auctionsQuery = query(
        collection(db, 'auctions'),
        where('groupId', '==', groupId),
        where('status', '==', 'active'),
        limit(10)
      );
      
      preloadPromises.push(
        getCachedQuery(auctionsQuery, {
          ttl: CACHE_TTL.AUCTION_DATA,
          cacheKey: `auctions_active_${groupId}_preload`
        })
      );
      
      // 4. Preload active trades
      const tradesQuery = query(
        collection(db, 'trades'),
        where('groupId', '==', groupId),
        where('status', '==', 'pending'),
        where('participantIds', 'array-contains', userId),
        limit(10)
      );
      
      preloadPromises.push(
        getCachedQuery(tradesQuery, {
          ttl: CACHE_TTL.TRADE_DATA,
          cacheKey: `trades_active_${userId}_${groupId}_preload`
        })
      );
    }
    
    // Execute all preloads in parallel
    await Promise.all(preloadPromises);
    console.log('Essential user data preloaded successfully');
    
    // Preload non-essential data in the background with a delay
    setTimeout(() => {
      preloadNonEssentialData(userId, groupId)
        .catch(err => console.error('Error preloading non-essential data:', err));
    }, 3000);
    
  } catch (error) {
    console.error('Error preloading user data:', error);
  }
};

// Preload non-essential data in the background
const preloadNonEssentialData = async (userId, groupId) => {
  if (!userId || !groupId) return;
  
  console.log('Preloading non-essential data in background...');
  
  try {
    // 1. Preload user preferences
    await getCachedDoc('userPreferences', userId, { ttl: CACHE_TTL.USER_PREFERENCES });
    
    // 2. Preload group details
    await getCachedDoc('groups', groupId, { ttl: CACHE_TTL.GROUP_DATA });
    
    // 3. Preload recent activity
    const activityQuery = query(
      collection(db, 'activity'),
      where('groupId', '==', groupId),
      orderBy('timestamp', 'desc'),
      limit(10)
    );
    
    await getCachedQuery(activityQuery, { ttl: CACHE_TTL.GROUP_ACTIVITY });
    
    console.log('Non-essential data preloaded successfully');
  } catch (error) {
    console.error('Error preloading non-essential data:', error);
  }
};

// Maintenance function to optimize cache storage
export const performCacheMaintenance = async () => {
  console.log('Performing cache maintenance...');
  
  try {
    // Clear expired cache entries
    const clearedCount = await clearExpiredCache();
    console.log(`Cleared ${clearedCount} expired cache entries`);
    
    // Log cache statistics
    const metrics = getCacheMetrics();
    console.log('Cache metrics:', metrics);
    
    return {
      clearedCount,
      metrics
    };
  } catch (error) {
    console.error('Error performing cache maintenance:', error);
    return {
      error: error.message,
      clearedCount: 0
    };
  }
};

/**
 * Pre-warm cache with frequently accessed data to improve perceived performance
 * This should be called once on app startup after user authentication
 * 
 * @param {string} userId - Current user ID
 * @param {string} groupId - Current group ID
 * @returns {Promise<void>}
 */
export const preWarmCache = async (userId, groupId) => {
  if (!userId || !groupId) {
    console.log('Cannot pre-warm cache without user ID and group ID');
    return;
  }
  
  try {
    console.log('Pre-warming cache for frequently accessed data...');
    
    const startTime = Date.now();
    const promises = [];
    
    // 1. Pre-fetch user profile with selective fields and long TTL
    promises.push(
      getCachedDocFields('users', userId, 
        ['displayName', 'username', 'email', 'photoURL', 'groupBalances'], 
        { ttl: CACHE_TTL.USER_PROFILE * 2 }
      )
    );
    
    // 2. Pre-fetch current group data
    promises.push(
      getCachedDoc('groups', groupId, { ttl: CACHE_TTL.GROUP_DATA })
    );
    
    // 3. Pre-fetch first batch of user's cards
    const cardsQuery = query(
      collection(db, 'cards'),
      where('ownerId', '==', userId),
      where('groupId', '==', groupId),
      limit(10)
    );
    promises.push(
      getCachedQuery(cardsQuery, { ttl: CACHE_TTL.COLLECTION })
    );
    
    // 4. Pre-fetch active auctions for the group
    const auctionsQuery = query(
      collection(db, 'auctions'),
      where('groupId', '==', groupId),
      where('status', '==', 'active'),
      limit(10)
    );
    promises.push(
      getCachedQuery(auctionsQuery, { ttl: CACHE_TTL.AUCTION_DATA })
    );
    
    // Execute all promises in parallel
    await Promise.all(promises);
    
    console.log(`Cache pre-warming completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.warn('Error pre-warming cache:', error);
    // Continue even if pre-warming fails - this is just an optimization
  }
}; 

/**
 * Initialize the app by setting up auth listener and retrieving last active group
 * @returns {Promise<{ user: Object|null, currentGroup: Object|null }>} Promise that resolves to current user and group objects
 */
export const initializeApp = async () => {
  try {
    const auth = getAuth();
    
    // Get current user if already logged in
    const authUser = auth.currentUser;
    
    if (!authUser) {
      return { user: null, currentGroup: null };
    }
    
    // User is signed in
    const user = authUser;
    let currentGroup = null;
    
    try {
      // Get user document to check for lastActiveGroup
      const userDocRef = doc(db, 'users', authUser.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists() && userDoc.data().lastActiveGroup) {
        // Get the last active group
        const groupId = userDoc.data().lastActiveGroup;
        const groupDocRef = doc(db, 'groups', groupId);
        const groupDoc = await getDoc(groupDocRef);
        
        if (groupDoc.exists()) {
          currentGroup = {
            id: groupDoc.id,
            ...groupDoc.data()
          };
        }
      }
    } catch (error) {
      console.error('Error fetching user data or last active group:', error);
    }
    
    return { user, currentGroup };
  } catch (error) {
    console.error('Error in initializeApp:', error);
    return { user: null, currentGroup: null };
  }
}; 