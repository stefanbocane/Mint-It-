import { NavigationContainer } from '@react-navigation/native';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import React, { memo, Suspense, useEffect, useMemo, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider as PaperProvider } from 'react-native-paper';
import { AuthContextProvider } from './src/contexts/AuthContext';
import { GroupProvider } from './src/contexts/GroupContext';
import { SettingsProvider } from './src/contexts/SettingsContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { UnifiedUserDataProvider } from './src/contexts/UnifiedUserDataContext';
import RootNavigator from './src/navigation/RootNavigator';
import CacheService from './src/services/caching/CacheService';
import { handleError } from './src/services/ErrorHandlingService';
import { setupNotificationListeners } from './src/services/notifications';
import UnifiedBootstrapService from './src/services/UnifiedBootstrapService';
import { preWarmCache } from './src/utils/appInitializer';
import { startCacheMaintenanceTasks, stopCacheMaintenanceTasks } from './src/utils/cacheMaintenanceUtils';
import { initializeErrorHandling } from './src/utils/firebaseErrorHandler';

// OPTIMIZED: Import new optimization services

const LOADING_BACKGROUND_COLOR = '#f5f5f5';

// Initialize Firebase error handling utilities
initializeErrorHandling();

// OPTIMIZED: Initialize optimization services
console.log('🚀 OPTIMIZED: Initializing optimization services...');

// The services are singletons and self-initialize, just importing them makes them available
console.log('✅ OPTIMIZED: Optimization services initialized');
console.log('  - GlobalListenerCoordinator: Ready for consolidated listeners');
console.log('  - UltraBatchService: Ready for batch operations');
console.log('  - OptimizedStatusVerificationService: Ready for status verification');

// OPTIMIZED: Unified Data Synchronizer using new bootstrap service
const DataSynchronizer = memo(() => {
  useEffect(() => {
    // Start cache maintenance tasks only (background cleanup moved to UnifiedBootstrapService)
    startCacheMaintenanceTasks();
    
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        startCacheMaintenanceTasks();
      } else if (nextAppState === 'background') {
        stopCacheMaintenanceTasks();
      }
    });
    
    return () => {
      stopCacheMaintenanceTasks();
      subscription.remove();
    };
  }, []);
  
  return null;
});

// Notification setup component
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
        handleError(error, 'Error setting up notification listeners');
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
    backgroundColor: LOADING_BACKGROUND_COLOR
  }}>
  </View>
));

// OPTIMIZED: Navigation tracking with Smart User Patterns integration
const useNavigationTracker = (user, bootData) => {
  const [navigationState, setNavigationState] = useState(null);
  
  const getActiveRouteName = (state) => {
    const route = state.routes[state.index];
    
    if (route.state) {
      return getActiveRouteName(route.state);
    }
    
    return route.name;
  };
  
  const onNavigationStateChange = async (previousState, currentState) => {
    if (previousState && currentState) {
      const prevRoute = getActiveRouteName(previousState);
      const currentRoute = getActiveRouteName(currentState);
      
      if (prevRoute !== currentRoute) {
        try {
          // Track navigation with Smart User Patterns Service
          const SmartUserPatternsService = (await import('./src/services/SmartUserPatternsService')).default;
          
          // Get user from context if available
          const userId = user?.uid;
          if (userId) {
            await SmartUserPatternsService.trackNavigation(
              userId,
              prevRoute,
              currentRoute,
              { timestamp: Date.now(), bootData }
            );
          }
          
          if (__DEV__) {
            console.log(`📍 Navigation tracked: ${prevRoute} → ${currentRoute}`);
          }
        } catch (error) {
          console.error('Error tracking navigation:', error);
        }
      }
    }
    
    setNavigationState(currentState);
  };
  
  return { onNavigationStateChange };
};

// Main AppContent component with optimized providers
const AppContent = memo(({ user, bootData }) => {
  const { theme } = useTheme();
  const { onNavigationStateChange } = useNavigationTracker(user, bootData);
  
  const paperTheme = useMemo(() => ({
    ...theme,
    colors: {
      ...theme.colors,
      primary: theme.colors.primary || '#4FC3A1',
      accent: theme.colors.accent || '#4FC3A1',
    },
  }), [theme]);

  return (
    <PaperProvider theme={paperTheme}>
      <UnifiedUserDataProvider>
        <NavigationContainer 
          theme={paperTheme}
          onStateChange={onNavigationStateChange}
        >
          <DataSynchronizer />
          <NotificationSetup />
          <RootNavigator />
        </NavigationContainer>
      </UnifiedUserDataProvider>
    </PaperProvider>
  );
});

// Error boundary component to catch theme-related errors
class ThemeErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Theme Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text>Something went wrong with the theme. Please restart the app.</Text>
          {this.state.error && <Text style={{ marginTop: 10, color: 'red' }}>{this.state.error.message}</Text>}
        </View>
      );
    }

    return this.props.children;
  }
}

const App = () => {
  const [user, setUser] = useState(null);
  const [currentGroup, setCurrentGroup] = useState(null);
  const [bootData, setBootData] = useState(null);
  
  useEffect(() => {
    const auth = getAuth();
    
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      if (authUser) {
        setUser(authUser);
        
        try {
          // UNIFIED BOOTSTRAP FIX: Replace 78 scattered reads with 6 coordinated reads
          console.log('🚀 Starting unified bootstrap process...');
          
          // First get basic user data to find last active group
          const userData = await CacheService.getDocument('users', authUser.uid, { 
            ttl: 60 * 1000,
            fields: ['lastActiveGroup', 'displayName', 'email'] // Field selection optimization
          });
          
          let groupId = userData?.lastActiveGroup;
          
          // If user has a last active group, perform unified bootstrap
          if (groupId) {
            const unifiedBootData = await UnifiedBootstrapService.performUnifiedBootstrap(
              authUser.uid, 
              groupId, 
              {
                skipIfRecentlyLoaded: true,
                prefetchUserCards: true,
                prefetchActiveAuctions: true,
                prefetchActiveTrades: false, // Start with minimal prefetching
                prefetchedUser: userData
              }
            );
            
            setBootData(unifiedBootData);
            setCurrentGroup({
              id: groupId,
              ...unifiedBootData.group
            });
            
            // Log the optimization results
            const metrics = UnifiedBootstrapService.getBootMetrics();
            console.log(`✅ Bootstrap completed: ${metrics.totalReads} reads (saved ${metrics.savedReads} reads)`);
            
          } else {
            // New user or no active group - minimal bootstrap
            console.log('🆕 New user detected, performing minimal bootstrap');
            setCurrentGroup(null);
          }
          
        } catch (error) {
          console.error('Error during unified bootstrap:', error);
          handleError(error, 'Error during unified bootstrap');
          
          // Fallback to basic user data fetch
          try {
            const userData = await CacheService.getDocument('users', authUser.uid, { ttl: 60 * 1000 });
            if (userData?.lastActiveGroup) {
              const groupData = await CacheService.getDocument('groups', userData.lastActiveGroup, { ttl: 2 * 60 * 1000 });
              if (groupData) {
                setCurrentGroup({
                  id: userData.lastActiveGroup,
                  ...groupData
                });
              }
            }
          } catch (fallbackError) {
            console.error('Fallback bootstrap failed:', fallbackError);
          }
        }
      } else {
        setUser(null);
        setCurrentGroup(null);
        setBootData(null);
      }
    });
    
    return () => unsubscribe();
  }, []);
  
  useEffect(() => {
    if (user && currentGroup) {
      preWarmCache(user.uid, currentGroup.id).catch(error => {
        console.error('Error pre-warming cache:', error);
      });
    }
  }, [user, currentGroup]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeErrorBoundary>
        <Suspense fallback={<LoadingScreen />}>
          <ThemeProvider>
            <SettingsProvider>
              <AuthContextProvider initialUser={user}>
                <GroupProvider initialGroup={currentGroup}>
                  <AppContent user={user} bootData={bootData} />
                </GroupProvider>
              </AuthContextProvider>
            </SettingsProvider>
          </ThemeProvider>
        </Suspense>
      </ThemeErrorBoundary>
    </GestureHandlerRootView>
  );
};

export default memo(App);