/**
 * Error Monitoring Utility
 * Helps track and debug caching and Firestore errors
 */

const ERROR_TYPES = {
  CACHE_KEY_ERROR: 'CACHE_KEY_ERROR',
  FIRESTORE_INDEX_ERROR: 'FIRESTORE_INDEX_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  GENERAL_ERROR: 'GENERAL_ERROR'
};

class ErrorMonitor {
  constructor() {
    this.errors = new Map();
    this.errorCounts = new Map();
    this.maxErrors = 100; // Keep last 100 errors
  }

  /**
   * Log an error with context
   * @param {string} type - Error type from ERROR_TYPES
   * @param {Error} error - The error object
   * @param {object} context - Additional context
   */
  logError(type, error, context = {}) {
    const timestamp = new Date().toISOString();
    const errorId = `${type}_${timestamp}`;
    
    const errorInfo = {
      id: errorId,
      type,
      message: error.message,
      stack: error.stack,
      context,
      timestamp,
      resolved: false
    };

    // Store the error
    this.errors.set(errorId, errorInfo);
    
    // Update count
    const count = this.errorCounts.get(type) || 0;
    this.errorCounts.set(type, count + 1);
    
    // Clean up old errors if we have too many
    if (this.errors.size > this.maxErrors) {
      const oldestKey = this.errors.keys().next().value;
      this.errors.delete(oldestKey);
    }

    // Log to console with enhanced formatting
    console.error(`[ErrorMonitor] ${type}:`, {
      message: error.message,
      context,
      timestamp,
      errorId
    });

    // Check for specific error patterns and provide suggestions
    this.provideSuggestions(type, error, context);
  }

  /**
   * Provide debugging suggestions based on error patterns
   */
  provideSuggestions(type, error, context) {
    switch (type) {
      case ERROR_TYPES.CACHE_KEY_ERROR:
        if (error.message.includes("Property 'cacheKey' doesn't exist")) {
          console.warn('[ErrorMonitor] SUGGESTION: Check variable scope in getWithCache function');
        }
        break;
        
      case ERROR_TYPES.FIRESTORE_INDEX_ERROR:
        if (error.message.includes('index')) {
          console.warn('[ErrorMonitor] SUGGESTION: Run: firebase deploy --only firestore:indexes');
          const indexUrl = this.extractIndexUrl(error);
          if (indexUrl) {
            console.warn('[ErrorMonitor] INDEX URL:', indexUrl);
          }
        }
        break;
        
      case ERROR_TYPES.NETWORK_ERROR:
        console.warn('[ErrorMonitor] SUGGESTION: Check network connectivity and Firebase connection');
        break;
    }
  }

  /**
   * Extract index creation URL from Firestore error
   */
  extractIndexUrl(error) {
    const message = error.message || '';
    const urlMatch = message.match(/https:\/\/console\.firebase\.google\.com[^\s\]]+/);
    return urlMatch ? urlMatch[0] : null;
  }

  /**
   * Get error statistics
   */
  getStats() {
    const stats = {
      totalErrors: this.errors.size,
      errorsByType: Object.fromEntries(this.errorCounts),
      recentErrors: Array.from(this.errors.values())
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 10)
    };
    
    return stats;
  }

  /**
   * Mark an error as resolved
   */
  resolveError(errorId) {
    if (this.errors.has(errorId)) {
      const error = this.errors.get(errorId);
      error.resolved = true;
      this.errors.set(errorId, error);
      console.log(`[ErrorMonitor] Error resolved: ${errorId}`);
    }
  }

  /**
   * Clear all errors
   */
  clearErrors() {
    this.errors.clear();
    this.errorCounts.clear();
    console.log('[ErrorMonitor] All errors cleared');
  }

  /**
   * Get recent errors of a specific type
   */
  getErrorsByType(type, limit = 5) {
    return Array.from(this.errors.values())
      .filter(error => error.type === type)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Print error summary
   */
  printSummary() {
    const stats = this.getStats();
    console.group('[ErrorMonitor] Error Summary');
    console.log('Total Errors:', stats.totalErrors);
    console.log('Errors by Type:', stats.errorsByType);
    console.log('Recent Errors:');
    stats.recentErrors.forEach(error => {
      console.log(`  - ${error.type}: ${error.message} (${error.timestamp})`);
    });
    console.groupEnd();
  }
}

// Create singleton instance
const errorMonitor = new ErrorMonitor();

// Enhanced error logging functions
export const logCacheError = (error, context) => {
  errorMonitor.logError(ERROR_TYPES.CACHE_KEY_ERROR, error, context);
};

export const logFirestoreError = (error, context) => {
  errorMonitor.logError(ERROR_TYPES.FIRESTORE_INDEX_ERROR, error, context);
};

export const logNetworkError = (error, context) => {
  errorMonitor.logError(ERROR_TYPES.NETWORK_ERROR, error, context);
};

export const logGeneralError = (error, context) => {
  errorMonitor.logError(ERROR_TYPES.GENERAL_ERROR, error, context);
};

// Utility functions
export const getErrorStats = () => errorMonitor.getStats();
export const printErrorSummary = () => errorMonitor.printSummary();
export const clearAllErrors = () => errorMonitor.clearErrors();

export { ERROR_TYPES, errorMonitor };
export default errorMonitor; 