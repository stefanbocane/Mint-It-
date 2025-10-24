/**
 * Constants for cache configuration
 * This file defines the TTL (time-to-live) values for different data types
 * to standardize caching across the application.
 */

/**
 * Cache TTL (Time To Live) constants in milliseconds
 * These determine how long data should be considered fresh in the cache
 */
export const CACHE_TTL = {
  // Very short-lived cache for rapidly changing data
  EPHEMERAL: 10 * 1000, // 10 seconds
  
  // Short-lived cache for frequently updated data
  SHORT: 60 * 1000, // 1 minute
  
  // Standard cache for regularly updated data
  STANDARD: 5 * 60 * 1000, // 5 minutes
  
  // Medium-length cache for less frequently updated data
  MEDIUM: 15 * 60 * 1000, // 15 minutes
  
  // Long-lived cache for rarely updated data
  LONG: 60 * 60 * 1000, // 1 hour
  
  // Very long-lived cache for static data
  PERSISTENT: 24 * 60 * 60 * 1000, // 24 hours
  
  // Specific domain caches
  USER_PROFILE: 10 * 60 * 1000, // 10 minutes
  USER_CARD_LIST: 5 * 60 * 1000, // 5 minutes
  GROUP_DATA: 15 * 60 * 1000, // 15 minutes
  AUCTION_DATA: 2 * 60 * 1000, // 2 minutes
  AUCTION_BIDS: 30 * 1000, // 30 seconds
  TRADE_DATA: 1 * 60 * 1000, // 1 minute
  
  // Offline mode may use extended TTLs
  OFFLINE_USER_PROFILE: 7 * 24 * 60 * 60 * 1000, // 7 days
  OFFLINE_CARDS: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/**
 * Maximum size for cached items in bytes
 * Used to prevent storing overly large objects that could impact performance
 */
export const MAX_CACHE_ITEM_SIZE = {
  DEFAULT: 1024 * 50, // 50KB
  LARGE_OBJECT: 1024 * 250, // 250KB
  IMAGE_DATA: 1024 * 1024, // 1MB
};

/**
 * Batch processing configuration
 */
export const BATCH_CONFIG = {
  // Delay before committing a batch update (ms)
  UPDATE_DELAY: 300,
  
  // Maximum number of items in a batch
  MAX_BATCH_SIZE: 20,
};

/**
 * Cache prefixes for different data types
 */
export const CACHE_PREFIXES = {
  DOC: 'doc:',
  QUERY: 'query:',
  USER: 'user:',
  CARD: 'card:',
  GROUP: 'group:',
  AUCTION: 'auction:',
  TRADE: 'trade:',
  OFFLINE: 'offline:',
};

// Cache invalidation patterns - use these to invalidate related cache entries
export const CACHE_PATTERNS = {
  USER_ALL: 'users',
  GROUP_ALL: 'groups',
  CARD_ALL: 'cards',
  AUCTION_ALL: 'auctions',
  TRADE_ALL: 'trades'
};

// In-memory cache size limits
export const MEMORY_CACHE_LIMITS = {
  USERS: 50,
  CARDS: 100,
  GROUPS: 20,
  RECENT_ACTIVITY: 30
};

// Batch processing limits
export const BATCH_LIMITS = {
  MAX_BATCH_SIZE: 500,
  RECOMMENDED_BATCH_SIZE: 100
};

// Cache cleaning intervals
export const CACHE_MAINTENANCE = {
  CLEANUP_INTERVAL: 60 * 60 * 1000, // 1 hour
  MAX_CACHE_AGE: 24 * 60 * 60 * 1000, // 24 hours
  MEMORY_CACHE_CLEANUP: 30 * 60 * 1000 // 30 minutes
};

export default {
  CACHE_TTL,
  MAX_CACHE_ITEM_SIZE,
  BATCH_CONFIG,
  CACHE_PREFIXES,
  CACHE_PATTERNS,
  MEMORY_CACHE_LIMITS,
  BATCH_LIMITS,
  CACHE_MAINTENANCE
}; 