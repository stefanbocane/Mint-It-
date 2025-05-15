// Utilities for optimizing user data handling
import { CACHE_TTL } from '../constants/cacheConfig';
import { getCachedDoc, getCachedDocFields } from './firestoreUtils';

// Constants
const USER_CACHE_TTL = 60 * 60 * 1000; // 1 hour cache for user data
const USER_BATCH_CACHE_TTL = 30 * 60 * 1000; // 30 minutes for batch operations

// In-memory LRU cache for super-fast access to most frequently used users
// This avoids AsyncStorage overhead for very frequent accesses
const memoryCache = new Map();
const MEMORY_CACHE_SIZE = 50; // Maximum users to keep in memory

// First, let's add request deduplication to prevent redundant fetches
const userRequestsInProgress = new Map();

// In-memory cache for user data with timestamp
const userCache = new Map();

// Single request tracker to avoid parallel fetches for the same user
const pendingRequests = new Map();

/**
 * Get a user by ID with caching
 * 
 * @param {string} userId - User ID
 * @param {Object} options - Cache options
 * @returns {Promise<Object|null>} - User data or null
 */
export const getUser = async (userId, options = {}) => {
  if (!userId) return null;
  
  // Check memory cache first for even faster access
  if (memoryCache.has(userId)) {
    const cachedUser = memoryCache.get(userId);
    // Only use memory cache if still valid
    if (Date.now() - cachedUser.timestamp < USER_CACHE_TTL) {
      // Move to front of LRU cache
      memoryCache.delete(userId);
      memoryCache.set(userId, cachedUser);
      return cachedUser.data;
    }
    // If expired, remove from memory cache
    memoryCache.delete(userId);
  }
  
  // Default TTL is 1 hour for user data as it changes infrequently
  const mergedOptions = { 
    ttl: USER_CACHE_TTL,
    ...options
  };
  
  try {
    const userData = await getCachedDoc('users', userId, mergedOptions);
    
    if (userData) {
      // Add to memory cache
      if (memoryCache.size >= MEMORY_CACHE_SIZE) {
        // Remove oldest entry (first item in map) when we reach limit
        const firstKey = memoryCache.keys().next().value;
        memoryCache.delete(firstKey);
      }
      
      memoryCache.set(userId, {
        data: userData,
        timestamp: Date.now()
      });
    }
    
    return userData;
  } catch (error) {
    console.error(`Error fetching user ${userId}:`, error);
    return null;
  }
};

/**
 * Get multiple users by ID with efficient batching and caching
 * 
 * @param {string[]} userIds - Array of user IDs
 * @param {Object} options - Cache options
 * @returns {Promise<Object>} - Map of user IDs to user data
 */
export const getUsers = async (userIds, options = {}) => {
  if (!userIds || !userIds.length) return {};
  
  // Filter out duplicates
  const uniqueIds = [...new Set(userIds)];
  
  // Return map of userId -> userData
  const userMap = {};
  const missingIds = [];
  
  // Default TTL for batch user data is 30 minutes
  const mergedOptions = { 
    ttl: USER_BATCH_CACHE_TTL,
    ...options
  };
  
  // First check memory cache
  for (const userId of uniqueIds) {
    if (memoryCache.has(userId)) {
      const cachedUser = memoryCache.get(userId);
      if (Date.now() - cachedUser.timestamp < USER_BATCH_CACHE_TTL) {
        userMap[userId] = cachedUser.data;
        
        // Move to front of LRU cache
        memoryCache.delete(userId);
        memoryCache.set(userId, cachedUser);
      } else {
        // If expired, remove from memory cache and add to missing IDs
        memoryCache.delete(userId);
        missingIds.push(userId);
      }
    } else {
      missingIds.push(userId);
    }
  }
  
  // If we have missing users, fetch them
  if (missingIds.length > 0) {
    try {
      // Use getCachedDocs to efficiently fetch missing users
      const users = await getCachedDocs('users', missingIds, mergedOptions);
      
      // Add each user to the map and memory cache
      for (const user of users) {
        if (user) {
          userMap[user.id] = user;
          
          // Add to memory cache
          if (memoryCache.size >= MEMORY_CACHE_SIZE) {
            // Remove oldest entry when we reach limit
            const firstKey = memoryCache.keys().next().value;
            memoryCache.delete(firstKey);
          }
          
          memoryCache.set(user.id, {
            data: user,
            timestamp: Date.now()
          });
        }
      }
    } catch (error) {
      console.error('Error fetching multiple users:', error);
    }
  }
  
  return userMap;
};

/**
 * Preload users that will likely be needed soon (e.g., auction owners)
 * This runs in the background and doesn't block the UI
 * 
 * @param {string[]} userIds - Array of user IDs to preload
 */
export const preloadUsers = (userIds) => {
  if (!userIds || !userIds.length) return;
  
  // Run in background with setTimeout to avoid blocking UI
  setTimeout(() => {
    getUsers(userIds, { forceRefresh: false })
      .then(() => console.log(`Preloaded ${userIds.length} users`))
      .catch(err => console.error('Error preloading users:', err));
  }, 100);
};

/**
 * Clear the memory cache
 */
export const clearMemoryCache = () => {
  memoryCache.clear();
  console.log('User memory cache cleared');
};

/**
 * Get user data with built-in deduplication to avoid redundant fetches
 * 
 * @param {string} userId - User ID to fetch
 * @param {Object} options - Options for the fetch
 * @param {number} options.ttl - Cache TTL in milliseconds
 * @param {Array<string>} options.fields - Specific fields to fetch (null for all)
 * @param {boolean} options.forceRefresh - Force refresh from Firestore
 * @returns {Promise<Object|null>} - User data object or null
 */
export const getUserWithDeduplication = async (userId, options = {}) => {
  if (!userId) return null;
  
  const { 
    ttl = CACHE_TTL.USER_PROFILE, 
    fields = null,
    forceRefresh = false 
  } = options;
  
  const cacheKey = fields ? `${userId}_${fields.join('_')}` : userId;
  
  // Check if there's an in-flight request for this user
  if (pendingRequests.has(cacheKey) && !forceRefresh) {
    try {
      return await pendingRequests.get(cacheKey);
    } catch (error) {
      console.error(`Error in pending request for user ${userId}:`, error);
      // Continue to try fetching again
    }
  }
  
  // Check in-memory cache first
  if (!forceRefresh && userCache.has(cacheKey)) {
    const cachedData = userCache.get(cacheKey);
    const now = Date.now();
    
    if (now - cachedData.timestamp < ttl) {
      return cachedData.data;
    }
  }
  
  // Create a promise for this request and store it
  const fetchPromise = (async () => {
    try {
      // Use the cached doc fields function for Firebase fetching
      const userData = await getCachedDocFields(
        'users', 
        userId, 
        fields,
        { ttl, forceRefresh }
      );
      
      if (userData) {
        // Update the in-memory cache
        userCache.set(cacheKey, {
          data: userData,
          timestamp: Date.now()
        });
      }
      
      return userData;
    } catch (error) {
      console.error(`Error fetching user ${userId}:`, error);
      throw error; // Re-throw to propagate to Promise.catch
    } finally {
      // Remove this request from pending requests
      pendingRequests.delete(cacheKey);
    }
  })();
  
  // Store the promise
  pendingRequests.set(cacheKey, fetchPromise);
  
  return fetchPromise;
};

/**
 * Clear the user cache for a specific user or all users
 * 
 * @param {string|null} userId - User ID to clear (null for all)
 */
export const clearUserCache = (userId = null) => {
  if (userId) {
    // Remove all cache entries for this user
    for (const key of userCache.keys()) {
      if (key === userId || key.startsWith(`${userId}_`)) {
        userCache.delete(key);
      }
    }
  } else {
    // Clear all user cache
    userCache.clear();
  }
};

/**
 * Batch fetch multiple users with deduplication
 * 
 * @param {Array<string>} userIds - Array of user IDs to fetch
 * @param {Object} options - Options for the fetch
 * @returns {Promise<Object>} - Map of user ID to user data
 */
export const batchGetUsers = async (userIds, options = {}) => {
  if (!userIds || !userIds.length) return {};
  
  // Deduplicate user IDs
  const uniqueIds = [...new Set(userIds)];
  
  // Fetch all users in parallel with deduplication
  const userPromises = uniqueIds.map(id => 
    getUserWithDeduplication(id, options)
  );
  
  const users = await Promise.all(userPromises);
  
  // Create a map of ID to user data
  const userMap = {};
  uniqueIds.forEach((id, index) => {
    if (users[index]) {
      userMap[id] = users[index];
    }
  });
  
  return userMap;
};

/**
 * Update a user in the cache without a Firestore fetch
 * Useful when you have updated a user and want to update the cache
 * 
 * @param {string} userId - User ID to update
 * @param {Object} userData - Updated user data
 */
export const updateUserInCache = (userId, userData) => {
  if (!userId || !userData) return;
  
  // Update all variations of this user's cache
  for (const key of userCache.keys()) {
    if (key === userId || key.startsWith(`${userId}_`)) {
      const currentData = userCache.get(key).data;
      userCache.set(key, {
        data: { ...currentData, ...userData },
        timestamp: Date.now()
      });
    }
  }
};

/**
 * Attempt to extract a human-readable name from user data
 * 
 * @param {Object} user - User data object
 * @returns {string} - Best available name for the user
 */
export const getUserDisplayName = (user) => {
  if (!user) return 'Unknown User';
  
  // Try multiple fields in order of preference
  return user.displayName || 
         user.username || 
         user.name || 
         (user.email ? user.email.split('@')[0] : 'Unknown User');
};

export default {
  getUser,
  getUsers,
  preloadUsers,
  clearMemoryCache,
  getUserWithDeduplication,
  clearUserCache,
  batchGetUsers,
  updateUserInCache,
  getUserDisplayName
}; 