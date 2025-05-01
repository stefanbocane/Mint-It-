import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import 'react-native-gesture-handler';
import App from './App';
import { auth } from './src/config/firebase';

// Ensure Firebase auth is initialized before registering components
const initAuth = async () => {
  try {
    // Wait for auth to be ready
    await new Promise((resolve) => {
      const unsubscribe = auth.onAuthStateChanged(() => {
        unsubscribe();
        resolve(true);
      });
    });
    
    // Register components after auth is ready
    AppRegistry.registerComponent('auth', () => App);
    registerRootComponent(App);
  } catch (error) {
    console.error('Firebase initialization error:', error);
  }
};

initAuth(); 