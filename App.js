import { NavigationContainer } from '@react-navigation/native';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { memo, Suspense, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { MD3LightTheme, Provider as PaperProvider } from 'react-native-paper';
import { db } from './src/config/firebase';
import { AuthContextProvider } from './src/contexts/AuthContext';
import { BalanceProvider } from './src/contexts/BalanceContext';
import { GroupProvider } from './src/contexts/GroupContext';
import { SettingsProvider } from './src/contexts/SettingsContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import RootNavigator from './src/navigation/RootNavigator';
import { setupNotificationListeners } from './src/services/notifications';
import { preWarmCache } from './src/utils/appInitializer';
import { flushUpdateQueue } from './src/utils/batchProcessor';
import { startCacheMaintenanceTasks, stopCacheMaintenanceTasks } from './src/utils/cacheMaintenanceUtils';
import { clearExpiredCache } from './src/utils/cacheUtils';
import { logDatabaseAudit } from './src/utils/databaseAudit';
import { initializeErrorHandling } from './src/utils/firebaseErrorHandler';
import { getCacheMetrics } from './src/utils/globalCacheManager';
import { deleteEmptyGroups } from './src/utils/groupUtils';
import { clearAllThrottledListeners } from './src/utils/throttledListener';

// Initialize Firebase error handling utilities right away
initializeErrorHandling();

// Data synchronizer component that handles cache and data cleanup
const DataSynchronizer = memo(() => {
  useEffect(() => {
    // Clean up expired cache entries on app startup
    const initCleanup = async () => {
      try {
        console.log('Performing initial cache cleanup...');
        const clearedCount = await clearExpiredCache();
        console.log(`Cleared ${clearedCount} expired cache entries on app startup`);
        
        // Also check for empty groups that can be deleted
        const groupCleanup = await deleteEmptyGroups();
        if (groupCleanup.success) {
          console.log(`Deleted ${groupCleanup.deleted} empty groups on app startup`);
        }
        
        // Start automated cache maintenance tasks
        startCacheMaintenanceTasks();
        console.log('Automated cache maintenance tasks started');
        
        // Run initial database audit for optimization insights
        await logDatabaseAudit();
      } catch (error) {
        console.error('Error during app startup cleanup:', error);
      }
    };
    
    initCleanup();
    
    // Set up app state listener to optimize cache usage
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        // App came to foreground - restart maintenance tasks
        startCacheMaintenanceTasks();
        console.log('App is active, cache maintenance resumed');
      } else if (nextAppState === 'background') {
        // App went to background - stop maintenance to save resources
        stopCacheMaintenanceTasks();
        
        // Flush any pending database operations before going to background
        flushUpdateQueue().catch(err => console.error('Error flushing update queue:', err));
        
        // Log cache metrics for debugging/optimization
        const metrics = getCacheMetrics();
        console.log('Cache metrics before background:', metrics);
        
        console.log('App is in background, cache maintenance paused');
      }
    });
    
    // Set up periodic database audits (only in dev mode)
    let auditInterval = null;
    if (__DEV__) {
      auditInterval = setInterval(async () => {
        console.log('Running periodic database audit (dev only)...');
        await logDatabaseAudit();
      }, 5 * 60 * 1000); // Every 5 minutes in dev mode
    }
    
    // Clean up on unmount
    return () => {
      stopCacheMaintenanceTasks();
      clearAllThrottledListeners();
      subscription.remove();
      
      if (auditInterval) {
        clearInterval(auditInterval);
      }
      
      console.log('Automated cache maintenance tasks stopped and listeners cleaned up');
    };
  }, []);
  
  // This component doesn't render anything
  return null;
});

// Notification setup component to fix the deprecated function warning
const NotificationSetup = memo(() => {
  useEffect(() => {
    const setupNotifications = async () => {
      try {
        const unsubscribe = await setupNotificationListeners();
        return () => {
          if (unsubscribe) unsubscribe();
        };
      } catch (error) {
        console.error('Error setting up notification listeners:', error);
      }
    };
    
    setupNotifications();
  }, []);
  
  return null;
});

const LoadingScreen = memo(() => (
  <View style={{ 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center',
    backgroundColor: '#f5f5f5' // You can customize this background color
  }}>
    {/* You can replace the ActivityIndicator with your own custom loading component or image */}
    <ActivityIndicator size="large" color="#4FC3A1" />
    {/* Add a custom text or logo below the spinner if desired */}
  </View>
));

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#4FC3A1',
    secondary: '#4FC3A1',
    background: 'transparent',
  },
};

const AppContent = memo(() => {
  const { theme } = useTheme();

  return (
    <PaperProvider theme={theme}>
      <NavigationContainer>
        <NotificationSetup />
        <RootNavigator />
      </NavigationContainer>
    </PaperProvider>
  );
});

// Ensure correct provider nesting order to fix the useGroup error
const App = () => {
  // Fix the hook usage by using a custom hook for initialization
  const [user, setUser] = useState(null);
  const [currentGroup, setCurrentGroup] = useState(null);
  
  useEffect(() => {
    // Move initialization logic into the useEffect
    const auth = getAuth();
    
    // Set up auth state listener
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      if (authUser) {
        // User is signed in
        setUser(authUser);
        
        try {
          // Get user document to check for lastActiveGroup
          const userDocRef = doc(db, 'users', authUser.uid);
          const userDoc = await getDoc(userDocRef);
          
          if (userDoc.exists() && userDoc.data().lastActiveGroup) {
            // Get the last active group
            const groupId = userDoc.data().lastActiveGroup;
            const groupDocRef = doc(db, 'groups', groupId);
            const groupDoc = await getDoc(groupDocRef);
            
            if (groupDoc.exists()) {
              setCurrentGroup({
                id: groupDoc.id,
                ...groupDoc.data()
              });
            }
          }
        } catch (error) {
          console.error('Error fetching user data or last active group:', error);
        }
      } else {
        // User is signed out
        setUser(null);
        setCurrentGroup(null);
      }
    });
    
    // Clean up on unmount
    return () => unsubscribe();
  }, []);
  
  // Pre-warm cache when user and group are set
  useEffect(() => {
    if (user && currentGroup) {
      preWarmCache(user.uid, currentGroup.id)
        .catch(err => console.warn('Error pre-warming cache:', err));
    }
  }, [user?.uid, currentGroup?.id]);
  
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AuthContextProvider initialUser={user}>
        <GroupProvider initialGroup={currentGroup}>
          <BalanceProvider>
            <SettingsProvider>
              <ThemeProvider>
                <DataSynchronizer />
                <AppContent />
              </ThemeProvider>
            </SettingsProvider>
          </BalanceProvider>
        </GroupProvider>
      </AuthContextProvider>
    </Suspense>
  );
};

export default memo(App); 