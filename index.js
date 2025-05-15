import { registerRootComponent } from 'expo';
import 'expo-modules-core';
import { LogBox } from 'react-native';
import App from './App';

// Ignore specific warnings
LogBox.ignoreLogs([
  'Require cycle:',
  'Non-serializable values were found in the navigation state',
]);

// Handle unhandled promise rejections that may come from Firebase/Firestore
const originalHandler = global.ErrorUtils.getGlobalHandler();
global.ErrorUtils.setGlobalHandler((error, isFatal) => {
  // Check if the error is related to Firestore
  const errorString = error?.toString() || '';
  const isFirestoreError = 
    errorString.includes('FIRESTORE') || 
    errorString.includes('InternalBytecode.js') ||
    errorString.includes('Cannot read property');
  
  if (isFirestoreError && !isFatal) {
    // Log but don't crash for non-fatal Firebase errors
    console.log('[Suppressed Firebase Error]:', errorString);
    return;
  }
  
  // Pass to the original handler for normal processing
  originalHandler(error, isFatal);
});

// Register the app
registerRootComponent(App);
