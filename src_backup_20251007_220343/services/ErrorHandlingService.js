/**
 * Centralized Error Handling Service
 * 
 * This service provides a unified approach to error handling:
 * - Standardized error logging
 * - Sentry integration
 * - User-friendly error messages
 * - Debugging helpers
 */
import Sentry, { captureError, captureMessage } from './sentry';

// Error severities
export const ERROR_SEVERITY = {
  INFO: 'info',        // Informational, not an error but worth noting
  WARNING: 'warning',  // Non-critical error, operation can continue
  ERROR: 'error',      // Error that affects functionality but isn't fatal
  CRITICAL: 'critical' // Critical error that prevents core functionality
};

// Error categories for better organization
export const ERROR_CATEGORY = {
  NETWORK: 'network',
  DATABASE: 'database',
  CACHE: 'cache',
  AUTH: 'auth',
  UI: 'ui',
  BUSINESS_LOGIC: 'business',
  UNKNOWN: 'unknown'
};

/**
 * Handle an error with standardized logging and reporting
 * 
 * @param {Error|string} error - The error object or message
 * @param {Object} options - Additional options
 * @param {string} options.context - Where the error occurred
 * @param {string} options.severity - Error severity (from ERROR_SEVERITY)
 * @param {string} options.category - Error category (from ERROR_CATEGORY)
 * @param {Object} options.metadata - Additional data about the error
 * @param {boolean} options.silent - If true, don't show to user
 * @param {Function} options.onReport - Callback after error is reported
 * @returns {string} - User-friendly error message
 */
export const handleError = (error, options = {}) => {
  const {
    context = 'Unknown',
    severity = ERROR_SEVERITY.ERROR,
    category = ERROR_CATEGORY.UNKNOWN,
    metadata = {},
    silent = false,
    onReport = null
  } = options;

  // Format the error
  const errorObject = error instanceof Error ? error : new Error(error);
  
  // Add context to the error message
  const errorWithContext = `[${context}] ${errorObject.message}`;
  
  // Determine log method based on severity
  switch (severity) {
    case ERROR_SEVERITY.INFO:
      console.info(errorWithContext, metadata);
      break;
    case ERROR_SEVERITY.WARNING:
      console.warn(errorWithContext, metadata);
      break;
    case ERROR_SEVERITY.CRITICAL:
      console.error('CRITICAL:', errorWithContext, metadata);
      break;
    case ERROR_SEVERITY.ERROR:
    default:
      console.error(errorWithContext, metadata);
  }
  
  // Report to Sentry for non-info severities
  if (severity !== ERROR_SEVERITY.INFO) {
    const sentryContext = {
      ...metadata,
      context,
      category,
      severity
    };
    
    captureError(errorObject, sentryContext);
    
    // Execute callback if provided
    if (onReport && typeof onReport === 'function') {
      onReport(errorObject, sentryContext);
    }
  }
  
  // Generate user-friendly message
  const userMessage = getUserFriendlyMessage(errorObject, category);
  
  return userMessage;
};

/**
 * Generate a user-friendly error message
 * 
 * @param {Error} error - The error object
 * @param {string} category - Error category
 * @returns {string} - User-friendly message
 */
const getUserFriendlyMessage = (error, category) => {
  // Common error messages by category
  const errorMessages = {
    [ERROR_CATEGORY.NETWORK]: 'There was a problem with your connection. Please check your internet and try again.',
    [ERROR_CATEGORY.DATABASE]: 'Unable to access data at this time. Please try again later.',
    [ERROR_CATEGORY.CACHE]: 'There was a problem loading cached data.',
    [ERROR_CATEGORY.AUTH]: 'Authentication failed. Please log in again.',
    [ERROR_CATEGORY.UI]: 'There was a problem displaying this content.',
    [ERROR_CATEGORY.BUSINESS_LOGIC]: 'Unable to complete this action.',
    [ERROR_CATEGORY.UNKNOWN]: 'An unexpected error occurred. Please try again.'
  };
  
  // Network error detection
  if (error.message.includes('network') || 
      error.message.includes('Network') || 
      error.message.includes('connection') ||
      error.message.includes('timeout')) {
    return errorMessages[ERROR_CATEGORY.NETWORK];
  }
  
  // Authentication error detection
  if (error.message.includes('auth') || 
      error.message.includes('permission') || 
      error.message.includes('unauthorized')) {
    return errorMessages[ERROR_CATEGORY.AUTH];
  }
  
  // Use category-specific message
  return errorMessages[category] || errorMessages[ERROR_CATEGORY.UNKNOWN];
};

/**
 * Log an event or message without treating it as an error
 * 
 * @param {string} message - The message to log
 * @param {string} level - Logging level (from ERROR_SEVERITY)
 * @param {Object} metadata - Additional data
 */
export const logEvent = (message, level = ERROR_SEVERITY.INFO, metadata = {}) => {
  // Log to console
  switch (level) {
    case ERROR_SEVERITY.WARNING:
      console.warn(message, metadata);
      break;
    case ERROR_SEVERITY.ERROR:
    case ERROR_SEVERITY.CRITICAL:
      console.error(message, metadata);
      break;
    case ERROR_SEVERITY.INFO:
    default:
      console.log(message, metadata);
  }
  
  // Report to Sentry for warning and above
  if (level !== ERROR_SEVERITY.INFO) {
    captureMessage(message, level);
  }
};

/**
 * Wrap a function with error handling
 * 
 * @param {Function} fn - Function to wrap
 * @param {Object} options - Error handling options
 * @returns {Function} - Wrapped function
 */
export const withErrorHandling = (fn, options = {}) => {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(error, options);
      
      // Allow customizing return value on error
      if (options.returnOnError !== undefined) {
        return options.returnOnError;
      }
      
      // Re-throw if specified
      if (options.rethrow) {
        throw error;
      }
      
      return null;
    }
  };
};

export default {
  handleError,
  logEvent,
  withErrorHandling,
  ERROR_SEVERITY,
  ERROR_CATEGORY
};
