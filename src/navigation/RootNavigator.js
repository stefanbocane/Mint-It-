import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import BackgroundImage from '../components/BackgroundImage';
import { auth } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import AuthStack from './AuthStack';
import TabNavigator from './TabNavigator';

const RootNavigator = () => {
  const { user, loading } = useAuth();
  const { theme } = useTheme();
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
      <BackgroundImage>
        <View style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(255, 255, 255, 0.5)'
        }}>
          <ActivityIndicator size="large" color="#4FC3A1" />
        </View>
      </BackgroundImage>
    );
  }

  return user ? <TabNavigator /> : <AuthStack />;
};

export default RootNavigator; 