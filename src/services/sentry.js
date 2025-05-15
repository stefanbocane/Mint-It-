/**
 * Sentry service implementation
 * 
 * This implementation will use the real Sentry if available,
 * or fallback to a mock implementation if the package is not installed.
 */

// Mock Sentry implementation for when the package is not available
const SentryMock = {
  captureException: (error, options = {}) => {
    console.log('[Sentry Mock] Error captured:', error.message || error, options);
  },
  captureMessage: (message, options = {}) => {
    console.log('[Sentry Mock] Message captured:', message, options);
  },
  setUser: (user) => {
    console.log('[Sentry Mock] User set:', user);
  },
  setTag: (key, value) => {
    console.log('[Sentry Mock] Tag set:', key, value);
  },
  setExtra: (key, value) => {
    console.log('[Sentry Mock] Extra set:', key, value);
  },
  Severity: {
    Info: 'info',
    Warning: 'warning',
    Error: 'error',
    Fatal: 'fatal'
  }
};

// Try to import the real Sentry, fallback to mock if not available
let Sentry;
try {
  // Try to dynamically import Sentry
  Sentry = require('@sentry/react-native');
  
  // Initialize Sentry if available
  Sentry.init({
    dsn: 'YOUR_SENTRY_DSN', // Replace with actual DSN in production
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
  });
  
  console.log('Sentry initialized successfully');
} catch (error) {
  // Fallback to mock implementation
  console.log('Sentry package not available, using mock implementation');
  Sentry = SentryMock;
}

/**
 * Capture an error and send to Sentry
 * 
 * @param {Error|any} error - The error to capture
 * @param {Object} context - Additional context information
 */
export const captureError = (error, context = {}) => {
  try {
    Sentry.captureException(error, {
      extra: context,
    });
  } catch (sentryError) {
    console.error('Error reporting to Sentry:', sentryError);
    // Log the original error to console as fallback
    console.error('Original error:', error);
  }
};

/**
 * Capture a message and send to Sentry
 * 
 * @param {string} message - The message to capture
 * @param {string} level - Severity level (info, warning, error, fatal)
 */
export const captureMessage = (message, level = 'info') => {
  try {
    Sentry.captureMessage(message, {
      level,
    });
  } catch (sentryError) {
    console.error('Error sending message to Sentry:', sentryError);
    // Log the message to console as fallback
    console.log(`[${level.toUpperCase()}] ${message}`);
  }
};

/**
 * Set the current user for Sentry
 * 
 * @param {Object} user - The user object
 */
export const setUser = (user) => {
  try {
    Sentry.setUser(user);
  } catch (error) {
    console.log('Error setting Sentry user:', error);
  }
};

// Export the Sentry object for advanced usage
export default Sentry; 