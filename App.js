import { NavigationContainer } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView } from 'react-native';
import { Provider as PaperProvider } from 'react-native-paper';
import { auth } from './src/config/firebase';
import AuthContextProvider, { useAuth } from './src/contexts/AuthContext';
import AuthStack from './src/navigation/AuthStack';
import TabNavigator from './src/navigation/TabNavigator';
import { theme } from './src/theme';

function RootNavigator() {
  const { user, loading } = useAuth();
  const [isFirebaseInitialized, setIsFirebaseInitialized] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Wait for auth to be ready
        await new Promise((resolve) => {
          const unsubscribe = auth.onAuthStateChanged(() => {
            unsubscribe();
            resolve(true);
          });
        });
        setIsFirebaseInitialized(true);
      } catch (error) {
        console.error('Firebase initialization error:', error);
      }
    };

    checkAuth();
  }, []);

  if (loading || !isFirebaseInitialized) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  return <NavigationContainer>{user ? <TabNavigator /> : <AuthStack />}</NavigationContainer>;
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

export default App; 