import { handleError } from '../services/ErrorHandlingService';

let hasShownOfflineAlert = false;
let isFirstLoad = true;

/**
 * Show a user-friendly offline alert
 */
export const showOfflineAlert = () => {
  if (hasShownOfflineAlert) return;
  
  hasShownOfflineAlert = true;
  
  // Use centralized error handling
  handleError(new Error('Offline mode'), 'Offline mode detected');
  
  // Show user-friendly message
  Alert.alert(
    'Offline Mode',
    'You are currently offline. Some features may be limited until you reconnect.',
    [
      {
        text: 'OK',
        style: 'default',
        onPress: () => {
          // Reset after a sufficient delay to prevent immediate re-trigger
          setTimeout(() => { hasShownOfflineAlert = false; }, 10000);
        }
      }
    ]
  );
};

/**
 * Reset offline alert state
 */
export const resetOfflineAlert = () => {
  hasShownOfflineAlert = false;
  isFirstLoad = false;
};

/**
 * Check if we should show the offline alert
 */
export const shouldShowOfflineAlert = () => {
  return !hasShownOfflineAlert && !isFirstLoad;
};
