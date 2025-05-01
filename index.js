import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import 'react-native-gesture-handler';
import App from './App';

/* ---  SAFETY PATCH ----------------------------------------------
   Some library in your bundle tries to register a component called "auth".
   We monkey-patch registerComponent so that if **anything** asks for "auth",
   we give it the real App component instead and never crash.          */
const originalRegister = AppRegistry.registerComponent;
AppRegistry.registerComponent = (key, getComp) => {
  if (key === 'auth') {
    console.warn('[entry] Intercepted rogue registration for "auth"; mapping to App.');
    return originalRegister('auth', () => App);
  }
  return originalRegister(key, getComp);
};

// 🚀 Standard Expo registration (produces component name "main")
registerRootComponent(App); 