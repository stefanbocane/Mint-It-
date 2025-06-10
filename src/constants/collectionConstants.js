/**
 * Shared Collection Configuration Constants
 * 
 * Centralized configuration for collection screen and related components
 * to eliminate redundancy and ensure consistency across the application.
 */

// Card loading and pagination
export const COLLECTION_CONFIG = {
  CARD_LOAD_BATCH_SIZE: 20,
  CACHE_CLEANUP_INTERVAL: 5 * 60 * 1000, // 5 minutes
  LOAD_MORE_THRESHOLD: 0.8, // Load more when 80% scrolled
  ANIMATION_DURATION: 250,
  
  // Cache TTL configurations
  CACHE_TTL: {
    USER_GEMS: 60 * 1000, // 1 minute
    GENERAL: 5 * 60 * 1000, // 5 minutes
    STATUS_VERIFICATION: 10 * 60 * 1000, // 10 minutes
    AUCTION_CHECK: 2 * 60 * 1000, // 2 minutes for periodic auction checks
  },
  
  // Virtualization settings - Optimized for faster initial load
  VIRTUALIZATION: {
    INITIAL_NUM_TO_RENDER: 4, // Reduced from 8 to 4 for faster startup
    WINDOW_SIZE: 3, // Reduced from 5 to 3 for lower memory usage
    MAX_TO_RENDER_PER_BATCH: 2, // Reduced from 4 to 2 for smoother updates
    CARD_HEIGHT: 240,
    SCROLL_EVENT_THROTTLE: 32, // Increased from 16 to reduce scroll events
    UPDATE_CELLS_BATCHING_PERIOD: 100 // Increased from 50 for better batching
  },
  
  // Performance monitoring
  PERFORMANCE: {
    ENABLE_METRICS: __DEV__,
    LOG_SLOW_RENDERS: __DEV__,
    SLOW_RENDER_THRESHOLD: 16, // 16ms for smooth 60fps
    BATCH_UPDATE_DELAY: 16 // Single frame delay for batching
  },
  
  // UI styling constants
  UI: {
    COLORS: {
      PRIMARY: '#4CAF50',
      ERROR: '#e74c3c',
      WARNING: '#f39c12',
      SUCCESS: '#27ae60'
    },
    SPACING: {
      SMALL: 8,
      MEDIUM: 16,
      LARGE: 24,
      EXTRA_LARGE: 32
    }
  },
  
  // Database optimization settings
  DATABASE: {
    MAX_VERIFICATION_BATCH_SIZE: 5, // Reduced from 10 to limit simultaneous verifications
    STATUS_CACHE_SIZE: 200, // Increased from 100 to cache more status data
    RECENT_TRANSFER_WINDOW: 30 * 60 * 1000, // Increased to 30 minutes (was 10)
    PERIODIC_CHECK_INTERVAL: 20 * 60 * 1000, // Increased to 20 minutes (was 5) - MAJOR REDUCTION
    MAX_RETRY_ATTEMPTS: 2, // Reduced from 3
    EXPONENTIAL_BACKOFF_BASE: 2000, // Increased to 2 seconds (was 1 second)
    
    // NEW: Ultra-conservative verification settings
    STATUS_VERIFICATION_TTL: 45 * 60 * 1000, // 45 minutes cache for status verification (increased from 30)
    COMPLETED_AUCTION_CHECK_LIMIT: 2, // Only check 2 most recent cards (reduced from 3)
    BACKGROUND_SYNC_INTERVAL: 90 * 60 * 1000, // 1.5 hours between background syncs (increased from 1 hour)
    DISABLE_STATUS_CHECKS_WHEN_INACTIVE: true, // NEW: Stop checks when user inactive
    USER_INACTIVITY_THRESHOLD: 10 * 60 * 1000, // 10 minutes of inactivity before reducing operations
  }
};

// Rarity system constants
export const RARITY_CONFIG = {
  ORDER: {
    common: 0,
    uncommon: 1,
    rare: 2,
    'ultra-rare': 3,
    ultraRare: 3,
    epic: 4,
    legendary: 5,
    mythic: 6
  },
  
  DISPLAY_NAMES: {
    common: 'Common',
    uncommon: 'Uncommon',
    rare: 'Rare',
    'ultra-rare': 'Ultra Rare',
    ultraRare: 'Ultra Rare',
    epic: 'Epic',
    legendary: 'Legendary',
    mythic: 'Mythic'
  }
};

// Filter and sort configurations
export const FILTER_CONFIG = {
  STATUSES: {
    ALL: 'all',
    AVAILABLE: 'available',
    IN_TRADE: 'inTrade',
    IN_AUCTION: 'inAuction'
  },
  
  SORT_OPTIONS: {
    NAME: 'name',
    RARITY: 'rarity',
    DATE_ADDED: 'dateAdded'
  },
  
  SORT_ORDERS: {
    ASC: 'asc',
    DESC: 'desc'
  },
  
  // Filter predicates as reusable functions
  PREDICATES: {
    available: card => !card.inTrade && !card.inAuction && 
                      card.status !== 'auction' && card.status !== 'traded',
    inTrade: card => card.inTrade || card.status === 'traded',
    inAuction: card => card.inAuction || card.status === 'auction'
  }
};

// Error codes and messages
export const ERROR_CONFIG = {
  CODES: {
    PERMISSION_DENIED: 'permission-denied',
    NOT_FOUND: 'not-found',
    NETWORK_FAILED: 'network-request-failed',
    QUOTA_EXCEEDED: 'quota-exceeded'
  },
  
  MESSAGES: {
    'permission-denied': 'You do not have permission to perform this action.',
    'not-found': 'The requested item was not found.',
    'network-request-failed': 'Network error. Please check your connection and try again.',
    'quota-exceeded': 'Service temporarily unavailable. Please try again later.',
    default: 'Something went wrong. Please try again.'
  }
};

// Cache key patterns for consistency
export const CACHE_KEYS = {
  USER_CARDS: (userId, groupId) => `user_cards_${userId}_${groupId}`,
  SHARED_USER_CARDS: (userId, groupId) => `shared_user_cards_${userId}_${groupId}`,
  CARDS_OWNER: (userId, groupId) => `cards_owner_${userId}_${groupId}`,
  CARDS_USERID: (userId, groupId) => `cards_userid_${userId}_${groupId}`,
  COLLECTION: (userId, groupId) => `collection_${userId}_${groupId}`,
  STATUS_VERIFICATION: (type, id) => `${type}_${id}`,
  USER_GEMS: (userId) => `user_gems_${userId}`
};

// Performance monitoring labels
export const PERFORMANCE_LABELS = {
  SORT_AND_FILTER: 'Sort and Filter Cards',
  STATUS_VERIFICATION: 'Status Verification',
  COLLECTION_LOAD: 'Collection Load',
  CACHE_OPERATION: 'Cache Operation',
  BATCH_UPDATE: 'Batch Update'
}; 