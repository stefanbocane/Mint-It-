/**
 * Firebase Error Handler
 * 
 * Utility for handling common Firebase Firestore errors, especially with Hermes engine
 */

import { Alert, LogBox, Platform } from 'react-native';

// Counter for tracking Firebase errors in the current session
let errorCount = 0;
const ERROR_THRESHOLD = 5; // Number of errors before suggesting a reload
const errorTypes = {};

// Ignore specific warnings that are known issues with Firebase + Hermes
export const ignoreFirebaseWarnings = () => {
  LogBox.ignoreLogs([
    'AsyncStorage has been extracted from react-native',
    'Setting a timer for a long period of time',
    'FIRESTORE (10.14.1) INTERNAL ASSERTION FAILED',
    'Firestore (10.14.1): FIRESTORE (10.14.1) INTERNAL ASSERTION FAILED',
    'Error: FIRESTORE (10.14.1) INTERNAL ASSERTION FAILED', 
    "TypeError: Cannot read property 'view' of undefined",
    // Add any other Firebase errors you encounter
  ]);
};

// Track and report Firebase errors
export const trackFirebaseError = (error, operation = 'unknown') => {
  // Increment error counter
  errorCount++; 
  
  // Categorize error
  const errorMessage = error?.message || error?.toString() || 'Unknown error';
  const errorType = getErrorCategory(errorMessage);
  
  // Track error types
  errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
  
  // Log error for debugging
  console.error(`Firebase operation "${operation}" failed with ${errorType} error: ${errorMessage}`);
  
  // Check if we need to suggest a reload
  if (errorCount >= ERROR_THRESHOLD) {
    const mostCommonError = Object.entries(errorTypes)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type} (${count}x)`)
      .join(', ');
      
    // Only show in development mode
    if (__DEV__) {
      Alert.alert(
        'Firebase Connection Issues',
        `There have been multiple Firebase errors (${errorCount} total: ${mostCommonError}). ` +
        'You may need to restart the app or check your connection.',
        [{ text: 'OK' }]
      );
    }
    
    // Reset counters after alerting
    errorCount = 0;
    Object.keys(errorTypes).forEach(key => errorTypes[key] = 0);
  }
  
  return error; // Return the error for chaining
};

// Helper to determine error category
const getErrorCategory = (errorMessage) => {
  if (errorMessage.includes('INTERNAL ASSERTION FAILED')) return 'ASSERTION';
  if (errorMessage.includes('network')) return 'NETWORK';
  if (errorMessage.includes('permission')) return 'PERMISSION';
  if (errorMessage.includes('not found')) return 'NOT_FOUND';
  if (errorMessage.includes('index')) return 'INDEX';
  if (errorMessage.includes('offline')) return 'OFFLINE';
  if (errorMessage.includes('timeout')) return 'TIMEOUT';
  if (errorMessage.includes('undefined')) return 'UNDEFINED';
  return 'OTHER';
};

// Silence console errors for specific patterns (useful for production)
export const silenceConsoleErrors = () => {
  if (__DEV__) return; // Only apply in production

  const originalConsoleError = console.error;
  console.error = (...args) => {
    const message = args[0]?.toString() || '';
    if (
      message.includes('INTERNAL ASSERTION FAILED') ||
      message.includes('InternalBytecode.js') ||
      message.includes("Cannot read property 'view' of undefined")
    ) {
      // Silently ignore these specific errors
      return;
    }
    originalConsoleError(...args);
  };
};

// Helper to retry failed Firestore operations
export const retryFirestoreOperation = async (operation, maxRetries = 3, delayMs = 300) => {
  let lastError;
  const operationName = operation.name || 'anonymous function';
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.log(`Firebase operation "${operationName}" failed (attempt ${attempt + 1}/${maxRetries}):`, error.message);
      
      // Wait before retrying
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  // Track the error after all retries failed
  trackFirebaseError(lastError, operationName);
  throw lastError;
};

// Initialize common error handling
export const initializeErrorHandling = () => {
  // Apply platform-specific fixes
  if (Platform.OS !== 'web') {
    ignoreFirebaseWarnings();
    silenceConsoleErrors();
  }
};

export default {
  ignoreFirebaseWarnings,
  silenceConsoleErrors,
  retryFirestoreOperation,
  initializeErrorHandling,
  trackFirebaseError
}; 