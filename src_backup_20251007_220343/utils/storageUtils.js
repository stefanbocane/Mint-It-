import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Try to import RNFS but don't fail if not available
let RNFS = null;
try {
  RNFS = require('react-native-fs');
} catch (error) {
  console.warn('react-native-fs not available, some storage features will be limited');
}

/**
 * Storage Utilities
 * 
 * This module provides utilities for monitoring storage usage,
 * helping to ensure the app doesn't consume too much device storage.
 */

// Constants
const MAX_RECOMMENDED_CACHE_SIZE = 50 * 1024 * 1024; // 50MB
const CACHE_PREFIX = 'firebase_cache_';
const DATA_PREFIXES = [
  'firebase_cache_', 
  'pagination_cache_', 
  'last_maintenance_run',
  'last_aggregation_run',
  'pending_background_jobs',
  'user_cards_'
];

/**
 * Get the total size of all cached data in AsyncStorage
 * 
 * @returns {Promise<number>} - Size in bytes
 */
export const getCacheUsage = async () => {
  try {
    // Get all keys
    const allKeys = await AsyncStorage.getAllKeys();
    let totalSize = 0;
    
    // Filter keys that are related to our cache systems
    const cacheKeys = allKeys.filter(key => 
      DATA_PREFIXES.some(prefix => key.startsWith(prefix))
    );
    
    // Get all data
    const keyValuePairs = await AsyncStorage.multiGet(cacheKeys);
    
    // Calculate size
    for (const [key, value] of keyValuePairs) {
      if (value) {
        // Estimate size in bytes (2 bytes per character in JavaScript)
        const itemSize = key.length * 2 + value.length * 2;
        totalSize += itemSize;
      }
    }
    
    return totalSize;
  } catch (error) {
    console.error('Error calculating cache size:', error);
    return 0;
  }
};

/**
 * Check if the cache size exceeds recommended limits
 * 
 * @param {number} maxSize - Maximum recommended size in bytes
 * @returns {Promise<boolean>} - Whether the cache exceeds limits
 */
export const isCacheSizeExcessive = async (maxSize = MAX_RECOMMENDED_CACHE_SIZE) => {
  const currentSize = await getCacheUsage();
  return currentSize > maxSize;
};

/**
 * Clean up the oldest cache entries to reduce storage usage
 * 
 * @param {number} targetSize - Target size to reduce to in bytes
 * @returns {Promise<number>} - Number of entries removed
 */
export const trimCacheToSize = async (targetSize = MAX_RECOMMENDED_CACHE_SIZE * 0.8) => {
  try {
    // Get current size
    const currentSize = await getCacheUsage();
    
    // If we're already under target, do nothing
    if (currentSize <= targetSize) {
      return 0;
    }
    
    // Get all keys
    const allKeys = await AsyncStorage.getAllKeys();
    
    // Filter keys that are related to our cache systems
    const cacheKeys = allKeys.filter(key => 
      DATA_PREFIXES.some(prefix => key.startsWith(prefix))
    );
    
    // Get all data with timestamps
    const keyValuePairs = await AsyncStorage.multiGet(cacheKeys);
    
    // Create array of objects with key, size, and timestamp
    const cacheItems = [];
    
    for (const [key, value] of keyValuePairs) {
      if (value) {
        try {
          const parsedValue = JSON.parse(value);
          const timestamp = parsedValue.timestamp || 0;
          const itemSize = key.length * 2 + value.length * 2;
          
          cacheItems.push({
            key,
            size: itemSize,
            timestamp
          });
        } catch (e) {
          // If we can't parse it, just use current time as timestamp
          const itemSize = key.length * 2 + value.length * 2;
          cacheItems.push({
            key,
            size: itemSize,
            timestamp: 0 // Prioritize removing items we can't parse
          });
        }
      }
    }
    
    // Sort by timestamp (oldest first)
    cacheItems.sort((a, b) => a.timestamp - b.timestamp);
    
    // Remove items until we're under target size
    let removedCount = 0;
    let removedSize = 0;
    let remainingSize = currentSize;
    const keysToRemove = [];
    
    for (const item of cacheItems) {
      // If removing this would put us under target, stop
      if (remainingSize - item.size <= targetSize) {
        break;
      }
      
      // Otherwise remove it
      keysToRemove.push(item.key);
      remainingSize -= item.size;
      removedSize += item.size;
      removedCount++;
    }
    
    // Remove the selected keys
    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
    }
    
    console.log(`Trimmed cache by ${removedSize} bytes (${removedCount} items)`);
    return removedCount;
  } catch (error) {
    console.error('Error trimming cache:', error);
    return 0;
  }
};

/**
 * Get device storage stats
 * Only works on Android as iOS doesn't provide this info
 * 
 * @returns {Promise<Object>} - Storage stats
 */
export const getDeviceStorageStats = async () => {
  // Default stats
  const stats = {
    available: null,
    total: null,
    free: null,
    isLow: false
  };
  
  try {
    // Only attempt to get stats if RNFS is available and we're on Android
    if (RNFS && Platform.OS === 'android') {
      // Android provides storage info
      const externalDir = RNFS.ExternalDirectoryPath;
      const fsStats = await RNFS.getFSInfo();
      
      stats.available = fsStats.freeSpace;
      stats.total = fsStats.totalSpace;
      stats.free = fsStats.freeSpace;
      
      // Consider storage low if less than 500MB free
      stats.isLow = fsStats.freeSpace < 500 * 1024 * 1024;
    } 
    // iOS doesn't provide storage info through the API
    
    return stats;
  } catch (error) {
    console.error('Error getting device storage stats:', error);
    return stats;
  }
};

/**
 * Export all cached data for debugging
 * 
 * @returns {Promise<Object>} - Cache data
 */
export const exportCacheData = async () => {
  try {
    // Get all keys
    const allKeys = await AsyncStorage.getAllKeys();
    
    // Filter keys that are related to our cache systems
    const cacheKeys = allKeys.filter(key => 
      DATA_PREFIXES.some(prefix => key.startsWith(prefix))
    );
    
    // Get all data
    const keyValuePairs = await AsyncStorage.multiGet(cacheKeys);
    
    // Format data for export
    const exportData = {};
    
    for (const [key, value] of keyValuePairs) {
      try {
        exportData[key] = JSON.parse(value);
      } catch (e) {
        exportData[key] = {
          error: 'Could not parse JSON',
          raw: value ? (value.length > 100 ? value.substring(0, 100) + '...' : value) : null
        };
      }
    }
    
    return exportData;
  } catch (error) {
    console.error('Error exporting cache data:', error);
    return { error: error.message };
  }
};

/**
 * Monitor cache size and auto-trim if it gets too large
 * This can be called periodically from the app to keep storage usage in check
 * 
 * @returns {Promise<Object>} - Result of the operation
 */
export const monitorAndMaintainCacheSize = async () => {
  try {
    const currentSize = await getCacheUsage();
    const isExcessive = await isCacheSizeExcessive();
    
    if (isExcessive) {
      const removedCount = await trimCacheToSize();
      const newSize = await getCacheUsage();
      
      return {
        success: true,
        initialSize: currentSize,
        finalSize: newSize,
        removedItems: removedCount,
        action: 'trimmed'
      };
    }
    
    return {
      success: true,
      currentSize,
      action: 'none'
    };
  } catch (error) {
    console.error('Error monitoring cache size:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

export default {
  getCacheUsage,
  isCacheSizeExcessive,
  trimCacheToSize,
  getDeviceStorageStats,
  exportCacheData,
  monitorAndMaintainCacheSize
}; 