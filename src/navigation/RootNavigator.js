import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { DefaultTheme } from 'react-native-paper';
import BackgroundImage from '../components/BackgroundImage';
import { auth } from '../config/firebase';
import { useAuth } from '../contexts/AuthContextSupabase';
import { StatsProvider } from '../contexts/StatsContext';
import { useTheme } from '../contexts/ThemeContext';
import AuthStack from './AuthStack';
import TabNavigator from './TabNavigator';

// Create a default theme for the loading state
const loadingTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#4FC3A1',
    background: '#f6f6f6',
    surface: '#ffffff',
    text: '#000000',
  },
};

const RootNavigator = () => {
  const { user, loading } = useAuth();
  const [isFirebaseInitialized, setIsFirebaseInitialized] = useState(false);
  
  // Use theme from context with fallback
  const themeContext = useTheme();
  
  // Safely get theme with fallback to loadingTheme
  const theme = useMemo(() => {
    try {
      return themeContext?.theme || loadingTheme;
    } catch (error) {
      console.warn('Error getting theme, using fallback:', error);
      return loadingTheme;
    }
  }, [themeContext]);

  // Safely get primary color with fallback
  const primaryColor = useMemo(() => {
    try {
      return theme?.colors?.primary || '#4FC3A1';
    } catch (error) {
      return '#4FC3A1';
    }
  }, [theme]);

  useEffect(() => {
    let isMounted = true;
    
    const checkAuth = async () => {
      try {
        // Wait for auth to be ready
        await new Promise((resolve) => {
          const unsubscribe = auth.onAuthStateChanged(() => {
            if (unsubscribe && typeof unsubscribe === 'function') {
              unsubscribe();
            }
            resolve(true);
          });
        });
        
        if (isMounted) {
          setIsFirebaseInitialized(true);
        }
      } catch (error) {
        console.error('Firebase initialization error:', error);
        if (isMounted) {
          setIsFirebaseInitialized(true); // Still continue even if there's an error
        }
      }
    };

    checkAuth();
    
    return () => {
      isMounted = false;
    };
  }, []);

  // Show loading state while initializing
  if (loading || !isFirebaseInitialized) {
    return (
      <BackgroundImage>
        <View style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(255, 255, 255, 0.5)'
        }}>
          <ActivityIndicator size="large" color={primaryColor} />
        </View>
      </BackgroundImage>
    );
  }

  // Render the appropriate navigator based on auth state
  try {
    return (
      <StatsProvider>
        <BackgroundImage>
          {user ? <TabNavigator /> : <AuthStack />}
        </BackgroundImage>
      </StatsProvider>
    );
  } catch (error) {
    console.error('Error rendering navigator:', error);
    // Fallback to auth stack if there's an error
    return <AuthStack />;
  }
};

export default RootNavigator; 