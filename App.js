import { NavigationContainer } from '@react-navigation/native';
import { registerRootComponent } from 'expo';
import React from 'react';
import { ActivityIndicator, SafeAreaView } from 'react-native';
import { Provider as PaperProvider } from 'react-native-paper';
import AuthContextProvider, { useAuth } from './src/contexts/AuthContext';
import AppStack from './src/navigation/AppStack';
import AuthStack from './src/navigation/AuthStack';
import { theme } from './src/theme';

function RootNavigator() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }
  return <NavigationContainer>{user ? <AppStack /> : <AuthStack />}</NavigationContainer>;
}

function App() {
  return (
    <PaperProvider theme={theme}>
      <AuthContextProvider>
        <RootNavigator />
      </AuthContextProvider>
    </PaperProvider>
  );
}

// Register the app
registerRootComponent(App);

export default App; 