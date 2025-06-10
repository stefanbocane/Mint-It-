import { handleError, withErrorHandling } from '../services/ErrorHandlingService';
import CacheService from '../services/caching/CacheService';

/**
 * Calculate time left for auction display based on timestamp
 * Uses a tiered approach for different time spans
 * 
 * @param {Timestamp} endTime - Firestore timestamp of the auction end time
 * @param {boolean} forceCheck - Force checking actual expiration status
 * @returns {string} - Formatted time left string
 */
export const calculateTimeLeft = withErrorHandling((endTime, forceCheck = false) => {
  if (!endTime) return 'No end time';
  
  // Try to use cached result for performance optimization
  if (endTime && typeof endTime !== 'object') {
    const cacheKey = `timeLeft_${endTime}`;
    const cachedResult = CacheService.getValueSync(cacheKey);
    if (cachedResult) return cachedResult;
  }
  
  const end = parseToDate(endTime);
  if (!end) return 'Unknown';
  
  const now = new Date();
  
  // If already ended and we're not forcing a check (during refresh)
  if (end <= now) {
    return 'Completed';
  }
  
  // Calculate time difference in milliseconds
  const diff = end - now;
  
  // Get time units
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  
  // Format output based on time left
  let result;
  if (days > 0) {
    result = `${days}d ${hours}h`;
  } else if (hours > 0) {
    result = `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    result = `${minutes}m ${seconds}s`;
  } else {
    result = `${seconds}s`;
  }
  
  // Cache the result if possible
  if (endTime && typeof endTime !== 'object') {
    const cacheKey = `timeLeft_${endTime}`;
    CacheService.setValueSync(cacheKey, result, { ttl: 10 }); // Cache for 10 seconds
  }
  
  return result;
}, {
  context: 'Time Utils',
  operation: 'Calculate Time Left'
});

/**
 * Determine if an auction needs a UI refresh based on how much time is left
 * 
 * @param {Timestamp} endTime - Firestore timestamp of the auction end time
 * @param {number} refreshKey - Current refresh key
 * @returns {boolean} - Whether the auction needs a UI refresh
 */
export const needsTimeRefresh = withErrorHandling((endTime, refreshKey) => {
  // Don't auto-refresh times anymore - only on manual refresh
  return false;
}, {
  context: 'Time Utils',
  operation: 'Check Refresh Need'
});

/**
 * Format a timestamp (or Date object) to a friendly relative time string
 * 
 * @param {Date|Object} date - Date object, Firestore timestamp, or serialized timestamp
 * @returns {string} - Formatted relative time
 */
export const formatRelativeTime = withErrorHandling((date) => {
  if (!date) return 'Unknown';
  
  // Handle different timestamp formats
  let jsDate;
  try {
    if (typeof date.toDate === 'function') {
      // It's a Firebase Timestamp object
      jsDate = date.toDate();
    } else if (date.seconds !== undefined && date.nanoseconds !== undefined) {
      // It's a serialized Timestamp object from AsyncStorage
      jsDate = new Date(date.seconds * 1000 + date.nanoseconds / 1000000);
    } else if (date._seconds !== undefined && date._nanoseconds !== undefined) {
      // Alternative format sometimes used in cached data
      jsDate = new Date(date._seconds * 1000 + date._nanoseconds / 1000000);
    } else if (date instanceof Date) {
      // It's already a Date object
      jsDate = date;
    } else if (typeof date === 'number') {
      // It's a timestamp in milliseconds
      jsDate = new Date(date);
    } else if (typeof date === 'string') {
      // It's an ISO date string
      jsDate = new Date(date);
    } else {
      // Unknown format
      console.warn('Unknown date format in formatRelativeTime:', date);
      return 'Unknown';
    }
  } catch (error) {
    handleError(error, {
      context: 'Time Utils',
      operation: 'Format Relative Time',
      additionalData: { dateInput: date }
    });
    return 'Unknown date';
  }
  
  const now = new Date();
  const diffMs = jsDate.getTime() - now.getTime();
  const diffSec = Math.round(diffMs / 1000);
  
  // Past dates
  if (diffSec < 0) {
    const absDiffSec = Math.abs(diffSec);
    
    if (absDiffSec < 60) return 'Just now';
    if (absDiffSec < 3600) return `${Math.floor(absDiffSec / 60)}m ago`;
    if (absDiffSec < 86400) return `${Math.floor(absDiffSec / 3600)}h ago`;
    if (absDiffSec < 2592000) return `${Math.floor(absDiffSec / 86400)}d ago`;
    
    return jsDate.toLocaleDateString();
  }
  
  // Future dates
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)}d`;
  
  return jsDate.toLocaleDateString();
}, {
  context: 'Time Utils',
  operation: 'Format Relative Time'
});

/**
 * Format time left for auctions with more detailed time remaining
 * 
 * @param {Date|Object} endTime - Auction end time (Date, Timestamp, or serialized object)
 * @returns {string} - Formatted time left string
 */
export const formatTimeLeft = withErrorHandling((endTime) => {
  // Try to use cached result for this calculation if available
  // Only for non-Date objects (as Date objects can't be used as cache keys)
  if (endTime && (typeof endTime !== 'object' || (endTime && !(endTime instanceof Date)))) {
    const cacheKey = `formatTimeLeft_${JSON.stringify(endTime)}`;
    const cachedResult = CacheService.getValueSync(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }
  }
  
  if (!endTime) return 'Unknown';
  
  // Handle different timestamp formats just like in calculateTimeLeft
  let end;
  try {
    if (typeof endTime.toDate === 'function') {
      // It's a Firebase Timestamp object
      end = endTime.toDate();
    } else if (endTime.seconds !== undefined && endTime.nanoseconds !== undefined) {
      // It's a serialized Timestamp object from AsyncStorage
      end = new Date(endTime.seconds * 1000 + endTime.nanoseconds / 1000000);
    } else if (endTime._seconds !== undefined && endTime._nanoseconds !== undefined) {
      // Alternative format sometimes used in cached data
      end = new Date(endTime._seconds * 1000 + endTime._nanoseconds / 1000000);
    } else if (endTime instanceof Date) {
      // It's already a Date object
      end = endTime;
    } else if (typeof endTime === 'number') {
      // It's a timestamp in milliseconds
      end = new Date(endTime);
    } else if (typeof endTime === 'string') {
      // It's an ISO date string
      end = new Date(endTime);
    } else {
      // Unknown format
      console.warn('Unknown endTime format:', endTime);
      return 'Unknown';
    }
  } catch (error) {
    handleError(error, {
      context: 'Time Utils',
      operation: 'Format Time Left',
      additionalData: { endTimeInput: endTime }
    });
    return 'Error';
  }
  
  const now = new Date();
  const diffMs = end.getTime() - now.getTime();
  
  // Handle ended auctions
  if (diffMs <= 0) return 'Ended';
  
  // Convert to seconds
  let seconds = Math.floor(diffMs / 1000);
  
  // Extract time components
  const days = Math.floor(seconds / 86400);
  seconds -= days * 86400;
  
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  
  // Format based on time left
  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}, {
  context: 'Time Utils',
  operation: 'Format Time Left'
});

/**
 * Format a date to a locale-specific date and time string
 * 
 * @param {Date|Object} date - Date object, Firestore timestamp, or serialized timestamp
 * @returns {string} - Formatted date and time string
 */
export const formatDateTime = withErrorHandling((date) => {
  if (!date) return 'Unknown';
  
  // Handle different timestamp formats
  let jsDate;
  try {
    if (typeof date.toDate === 'function') {
      // It's a Firebase Timestamp object
      jsDate = date.toDate();
    } else if (date.seconds !== undefined && date.nanoseconds !== undefined) {
      // It's a serialized Timestamp object from AsyncStorage
      jsDate = new Date(date.seconds * 1000 + date.nanoseconds / 1000000);
    } else if (date._seconds !== undefined && date._nanoseconds !== undefined) {
      // Alternative format sometimes used in cached data
      jsDate = new Date(date._seconds * 1000 + date._nanoseconds / 1000000);
    } else if (date instanceof Date) {
      // It's already a Date object
      jsDate = date;
    } else if (typeof date === 'number') {
      // It's a timestamp in milliseconds
      jsDate = new Date(date);
    } else if (typeof date === 'string') {
      // It's an ISO date string
      jsDate = new Date(date);
    } else {
      // Unknown format
      console.warn('Unknown date format in formatDateTime:', date);
      return 'Unknown';
    }
  } catch (error) {
    handleError(error, {
      context: 'Time Utils',
      operation: 'Format Date Time',
      additionalData: { dateInput: date }
    });
    return 'Unknown date';
  }
  
  // Use Intl.DateTimeFormat for locale-aware formatting
  const dateOptions = { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  };
  
  const timeOptions = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  };
  
  const formattedDate = new Intl.DateTimeFormat('en-US', dateOptions).format(jsDate);
  const formattedTime = new Intl.DateTimeFormat('en-US', timeOptions).format(jsDate);
  
  return `${formattedDate} at ${formattedTime}`;
}, {
  context: 'Time Utils',
  operation: 'Format Date Time'
});

/**
 * Check if an auction is about to end (within the specified timeframe)
 * 
 * @param {Date|Object} endTime - Date, Firestore timestamp, or serialized timestamp of auction end
 * @param {number} withinMinutes - Minutes threshold to check (default: 15)
 * @returns {boolean} - Whether the auction is ending soon
 */
export const isAuctionEndingSoon = withErrorHandling((endTime, withinMinutes = 15) => {
  if (!endTime) return false;
  
  // Handle different timestamp formats
  const jsEndTime = parseToDate(endTime);
  if (!jsEndTime) {
    console.warn('Unknown endTime format in isAuctionEndingSoon:', endTime);
    return false;
  }
  
  const now = new Date();
  const diffMs = jsEndTime.getTime() - now.getTime();
  
  // Already ended
  if (diffMs <= 0) return false;
  
  // Convert threshold to milliseconds
  const thresholdMs = withinMinutes * 60 * 1000;
  
  return diffMs <= thresholdMs;
}, {
  context: 'Time Utils',
  operation: 'Check Auction Ending Soon'
});

/**
 * Format a date to a standard locale string
 * Replacement for various custom formatDate implementations across the app
 * 
 * @param {Date|Object|string|number} date - Date to format
 * @param {string} defaultValue - Value to return if date is invalid (default: 'Never')
 * @returns {string} - Formatted date string
 */
export const formatDate = withErrorHandling((date, defaultValue = 'Never') => {
  // Check cache for common date formats
  if (date) {
    let cacheKey;
    if (typeof date === 'string' || typeof date === 'number') {
      cacheKey = `formatDate_${date}`;
      const cachedResult = CacheService.getValueSync(cacheKey);
      if (cachedResult) {
        return cachedResult;
      }
    }
  }
  
  if (!date) return defaultValue;
  
  // Use the same parsing logic as other functions
  const jsDate = parseToDate(date);
  if (!jsDate) {
    console.warn('Unknown date format in formatDate:', date);
    return defaultValue;
  }
  
  return jsDate.toLocaleString();
}, {
  context: 'Time Utils',
  operation: 'Format Date'
});

export function parseToDate(date) {
  if (!date) return null;
  if (typeof date.toDate === 'function') {
    // It's a Firebase Timestamp object
    return date.toDate();
  } else if (date.seconds !== undefined && date.nanoseconds !== undefined) {
    // It's a serialized Timestamp object from AsyncStorage
    return new Date(date.seconds * 1000 + date.nanoseconds / 1000000);
  } else if (date._seconds !== undefined && date._nanoseconds !== undefined) {
    // Alternative format sometimes used in cached data
    return new Date(date._seconds * 1000 + date._nanoseconds / 1000000);
  } else if (date instanceof Date) {
    // It's already a Date object
    return date;
  } else if (typeof date === 'number') {
    // It's a timestamp in milliseconds
    return new Date(date);
  } else if (typeof date === 'string') {
    // It's an ISO date string
    return new Date(date);
  } else {
    // Unknown format
    console.warn('Unknown date format in parseToDate:', date);
    return null;
  }
}


export default {
  formatRelativeTime,
  formatTimeLeft,
  formatDateTime,
  isAuctionEndingSoon,
  formatDate,
  calculateTimeLeft,
  needsTimeRefresh
};