/**
 * @deprecated This file is deprecated. Use services/caching/CacheService.js instead.
 * This is a compatibility layer that forwards requests to the new centralized caching system.
 */

// Import the centralized cache service
import CacheService from './caching/CacheService';
import { CACHE_TTL } from '../constants/cacheConfig';

// For compatibility with existing codebase
const warn = () => {
  console.warn('UserCache is deprecated. Use CacheService instead.');
};

// This runs once at import time to warn developers
warn();

/**
 * Get a user by ID with multi-level caching
 * 
 * @param {string} userId - User ID
 * @param {Object} options - Cache options
 * @returns {Promise<Object|null>} - User data or null
 */
export const getUser = async (userId, options = {}) => {
  warn();
  // Simply delegate to the centralized cache service
  return CacheService.getUser(userId, options);
};

/**
 * Get multiple users by ID with efficient batching and multi-level caching
 * 
 * @param {string[]} userIds - Array of user IDs
 * @param {Object} options - Cache options
 * @returns {Promise<Object>} - Map of user IDs to user data
 */
export const getUsers = async (userIds, options = {}) => {
  warn();
  
  if (!userIds || !userIds.length) return {};
  
  // Filter out duplicates
  const uniqueIds = [...new Set(userIds)];
  
  // Use Promise.all to fetch all users with the centralized cache service
  const userPromises = uniqueIds.map(userId => CacheService.getUser(userId, options));
  const users = await Promise.all(userPromises);
  
  // Build the user map
  const userMap = {};
  users.forEach((userData, index) => {
    if (userData) {
      userMap[uniqueIds[index]] = userData;
    }
  });
  
  return userMap;
};

/**
 * Clear the user cache (both memory and AsyncStorage)
 * Call this when user data is expected to be stale (e.g., after profile updates)
 * 
 * @param {string} userId - User ID to clear, or null to clear all users
 * @returns {Promise<void>}
 */
export const clearUserCache = async (userId) => {
  if (userId) {
    // Clear specific user
    memoryCache.delete(userId);
    // AsyncStorage cache will expire naturally
  } else {
    // Clear all users
    memoryCache.clear();
    // AsyncStorage cache will expire naturally
  }
}; 