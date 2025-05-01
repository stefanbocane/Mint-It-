import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import 'react-native-gesture-handler';
import App from './App';

// Standard Expo registration ("main")
registerRootComponent(App);

// Intercept any rogue registration that expects "auth"
AppRegistry.registerComponent('auth', () => App); 