import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import 'react-native-gesture-handler';
import App from './App';

// 👉 Expo normally registers "main".  We ALSO register "auth" to satisfy any library that expects it.
registerRootComponent(App);               // registers "main"
AppRegistry.registerComponent('auth', () => App); 