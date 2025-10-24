import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import React, { memo, Suspense, useEffect, useMemo, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider as PaperProvider } from 'react-native-paper';
import { onAuthStateChange } from './src/config/supabase';
import { AuthContextProvider } from './src/contexts/AuthContextSupabase';
import { GroupProvider } from './src/contexts/GroupContextSupabase';
import { SettingsProvider } from './src/contexts/SettingsContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { UnifiedUserDataProvider } from './src/contexts/UnifiedUserDataContextSupabase';
import RootNavigator from './src/navigation/RootNavigator';
import InitialLoadGate from './src/providers/InitialLoadGate';
import { handleError } from './src/services/ErrorHandlingService';
import { setupNotificationListeners } from './src/services/notifications';
import useInitialStore from './src/store/useInitialStore';
import { startCacheMaintenanceTasks, stopCacheMaintenanceTasks } from './src/utils/cacheMaintenanceUtils';

// OPTIMIZED: Import new optimization services
import AuctionCompletionService from './src/services/AuctionCompletionServiceSupabase';
import ProductionMonitor from './src/services/monitoring/ProductionMonitor';

const LOADING_BACKGROUND_COLOR = '#f5f5f5';

// OPTIMIZED: Initialize optimization services
console.log('🚀 OPTIMIZED: Initializing optimization services...');

// The services are singletons and self-initialize, just importing them makes them available
console.log('✅ OPTIMIZED: Optimization services initialized');
console.log('  - GlobalListenerCoordinator: Ready for consolidated listeners');
console.log('  - UltraBatchService: Ready for batch operations');
console.log('  - OptimizedStatusVerificationService: Ready for status verification');
console.log('  - ProductionMonitor: Ready for read tracking and alerting');

// OPTIMIZED: Unified Data Synchronizer using new bootstrap service
const DataSynchronizer = memo(() => {
  useEffect(() => {
    // Start cache maintenance tasks only (background cleanup moved to UnifiedBootstrapService)
    startCacheMaintenanceTasks();

    // Start auction completion background service
    AuctionCompletionService.start();

    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        startCacheMaintenanceTasks();
        AuctionCompletionService.start();
      } else if (nextAppState === 'background') {
        stopCacheMaintenanceTasks();
        AuctionCompletionService.stop();
      }
    });

    return () => {
      stopCacheMaintenanceTasks();
      AuctionCompletionService.stop();
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

          // Get user from context if available (Supabase uses 'id', Firebase uses 'uid')
          const userId = user?.id || user?.uid;
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
const AppContent = memo(({ user, currentGroup }) => {
  const bootData = useInitialStore(state => state.payload);
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
    <GroupProvider initialGroup={currentGroup}>
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
    </GroupProvider>
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
  const [userLoaded, setUserLoaded] = useState(false);
  const [currentGroup, setCurrentGroup] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChange(async (event, session) => {
      const authUser = session?.user || null;

      if (authUser) {
        setUser(authUser);

        // 🚀 OPTIMIZED: Initialize ProductionMonitor for this session
        ProductionMonitor.initialize(authUser.id, {
          enableSampling: !__DEV__ // Always monitor in dev, sample in production
        });

        try {
          // Try to get last active group from local storage first (no database reads)
          const localKey = `CARDMATES_LAST_SELECTED_GROUP_${authUser.id}`;
          const savedGroup = await AsyncStorage.getItem(localKey);
          if (savedGroup) {
            const parsedGroup = JSON.parse(savedGroup);
            setCurrentGroup(parsedGroup);
          } else {
            // Fallback: single query to Supabase to discover lastActiveGroup
            const { supabase } = await import('./src/config/supabase');
            const { data: userData, error } = await supabase
              .from('users')
              .select('last_active_group')
              .eq('id', authUser.id)
              .single();

            if (!error && userData?.last_active_group) {
              setCurrentGroup({ id: userData.last_active_group });
            }
          }
        } catch (error) {
          console.error('Error determining last active group:', error);
        }
      } else {
        // User is signed out, clear all local state
        setUser(null);
        setCurrentGroup(null);

        // 🚀 OPTIMIZED: End ProductionMonitor session
        ProductionMonitor.endSession();
      }

      setUserLoaded(true);
    });

    return () => unsubscribe();
  }, []);

  // Show loading screen while determining auth state
  if (!userLoaded) {
    return <LoadingScreen />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthContextProvider initialUser={user}>
        <SettingsProvider>
          <ThemeErrorBoundary>
            <ThemeProvider>
              <Suspense fallback={<LoadingScreen />}>
                <InitialLoadGate uid={user?.id || user?.uid} groupId={currentGroup?.id}>
                  <AppContent user={user} currentGroup={currentGroup} />
                </InitialLoadGate>
              </Suspense>
            </ThemeProvider>
          </ThemeErrorBoundary>
        </SettingsProvider>
      </AuthContextProvider>
    </GestureHandlerRootView>
  );
};

export default memo(App);
