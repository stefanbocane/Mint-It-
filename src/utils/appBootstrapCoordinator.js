import NetInfo from '@react-native-community/netinfo';
import { doc } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import IntelligentBootService from '../services/BootLoader/IntelligentBootService';
import { getDoc } from '../services/ReadTracking/TrackedFirestore';
import * as backgroundJobScheduler from './backgroundJobScheduler';
import * as cacheUtils from './cacheUtils';
import * as enhancedQueryCache from './enhancedQueryCache';
import GlobalListenerCoordinator from './GlobalListenerCoordinator';

/**
 * App Bootstrap Coordinator
 * 
 * This service orchestrates efficient app startup by:
 * 1. Controlling the loading sequence of essential data
 * 2. Prioritizing critical data during initialization
 * 3. Managing background tasks for maintenance
 * 4. Controlling listener creation
 */

// Track bootstrap state
let bootstrapState = {
  isInitialized: false,
  criticalDataLoaded: false,
  essentialDataLoaded: false,
  nonEssentialDataLoaded: false,
  offlineMode: false,
  lastBootstrapTime: null,
  errors: []
};

// Configuration
const CONFIG = {
  // How long to wait before starting non-essential loading
  ESSENTIAL_TIMEOUT_MS: 3000,
  
  // How long to wait before timing out the entire bootstrap
  BOOTSTRAP_TIMEOUT_MS: 10000,
  
  // How many times to retry failed operations
  MAX_RETRIES: 3,
  
  // How long to wait between retries (ms)
  RETRY_DELAY_MS: 1000
};

/**
 * Bootstrap the application with essential data
 * 
 * @param {Object} user - Authenticated user object
 * @param {Object} options - Bootstrap options
 * @returns {Promise<Object>} - Bootstrap results
 */
export const bootstrapApplication = async (user, options = {}) => {
  const startTime = Date.now();
  
  const {
    skipIfRecentlyLoaded = true,
    recentThreshold = 5 * 60 * 1000, // 5 minutes
    forceRefresh = false,
    prefetchUserGroups = true,
    prefetchUserCards = true,
    prefetchActiveAuctions = true,
    prefetchActiveTrades = true
  } = options;
  
  // If we've recently bootstrapped, skip unless forced
  if (skipIfRecentlyLoaded && 
      bootstrapState.lastBootstrapTime && 
      Date.now() - bootstrapState.lastBootstrapTime < recentThreshold &&
      !forceRefresh) {
    console.log('Skipping bootstrap as it was recently performed');
    return { 
      success: true, 
      skipped: true, 
      state: bootstrapState 
    };
  }
  
  try {
    // Reset bootstrap state but retain error history
    const previousErrors = [...bootstrapState.errors];
    bootstrapState = {
      isInitialized: false,
      criticalDataLoaded: false,
      essentialDataLoaded: false,
      nonEssentialDataLoaded: false,
      offlineMode: false,
      lastBootstrapTime: null,
      errors: previousErrors
    };
    
    console.log('Starting app bootstrap sequence...');
    
    // Initialize services
    await backgroundJobScheduler.initJobScheduler();
    
    // Check network status
    const networkState = await NetInfo.fetch();
    const isConnected = networkState.isConnected && networkState.isInternetReachable;
    
    if (!isConnected) {
      console.log('Bootstrapping in offline mode');
      bootstrapState.offlineMode = true;
    }
    
    // 🚀 OPTIMIZED: Try Intelligent Boot Service first (single read)
    // This loads ALL essential data with 1 read and warms all caches
    let bootPayload = null;
    if (isConnected && user?.uid) {
      // Try to get current group from user doc using GlobalUserProfileCache
      const GlobalUserProfileCache = require('../services/GlobalUserProfileCache').default;
      const userData = await GlobalUserProfileCache.getProfile(user.uid);
      const currentGroupId = userData?.lastActiveGroup || null;
      
      if (currentGroupId) {
        bootPayload = await IntelligentBootService.loadEssentialData(user.uid, currentGroupId);
        
        if (bootPayload) {
          console.log('✅ [Bootstrap] Intelligent Boot Service succeeded (1 read)');
          console.log(`   All caches warmed, screens ready instantly`);
          
          // Mark all data as loaded since boot service handles everything
          bootstrapState.criticalDataLoaded = true;
          bootstrapState.essentialDataLoaded = true;
          bootstrapState.isInitialized = true;
          bootstrapState.lastBootstrapTime = Date.now();
          
          // Start background maintenance tasks
          Promise.all([
            backgroundJobScheduler.checkAndScheduleRoutineJobs(),
            backgroundJobScheduler.processJobs(2)
          ]).then(() => {
            bootstrapState.nonEssentialDataLoaded = true;
            scheduleMaintenanceTasks();
          }).catch(error => {
            console.error('Error with background tasks:', error);
          });
          
          return {
            success: true,
            state: bootstrapState,
            duration: Date.now() - startTime,
            bootMetrics: IntelligentBootService.getMetrics()
          };
        }
      }
    }
    
    // FALLBACK: Traditional boot sequence if Intelligent Boot fails or offline
    console.log('⚠️ [Bootstrap] Falling back to traditional boot sequence');
    
    // Load Critical User Data (must succeed for app to function)
    await loadCriticalUserData(user, { isOffline: !isConnected });
    bootstrapState.criticalDataLoaded = true;
    
    // Set up a timeout for essential data
    const essentialTimeout = setTimeout(() => {
      if (!bootstrapState.essentialDataLoaded) {
        console.log('Essential data loading timed out, continuing with bootstrap');
        bootstrapState.essentialDataLoaded = true;
      }
    }, CONFIG.ESSENTIAL_TIMEOUT_MS);
    
    // Load Essential Data (app can function without it, but UX suffers)
    if (isConnected) {
      await Promise.all([
        loadUserGroups(user, { prefetch: prefetchUserGroups }),
        loadUserPreferences(user)
      ]);
      
      bootstrapState.essentialDataLoaded = true;
      clearTimeout(essentialTimeout);
    } else {
      // In offline mode, try to load from cache only
      await Promise.all([
        loadUserGroups(user, { prefetch: false, offlineOnly: true }),
        loadUserPreferences(user, { offlineOnly: true })
      ]);
      
      bootstrapState.essentialDataLoaded = true;
      clearTimeout(essentialTimeout);
    }
    
    // Set bootstrap as initialized so app can display main UI
    bootstrapState.isInitialized = true;
    
    // Start Non-Essential data loading (can happen in background)
    Promise.all([
      prefetchUserCards && loadUserCards(user, { isOffline: !isConnected }),
      prefetchActiveAuctions && loadActiveAuctions(user, { isOffline: !isConnected }),
      prefetchActiveTrades && loadActiveTrades(user, { isOffline: !isConnected }),
      !bootstrapState.offlineMode && backgroundJobScheduler.checkAndScheduleRoutineJobs(),
      !bootstrapState.offlineMode && backgroundJobScheduler.processJobs(2)
    ]).then(() => {
      bootstrapState.nonEssentialDataLoaded = true;
      
      // If online, start scheduled maintenance tasks
      if (!bootstrapState.offlineMode) {
        scheduleMaintenanceTasks();
      }
    }).catch(error => {
      console.error('Error loading non-essential data:', error);
      bootstrapState.errors.push({
        phase: 'non-essential',
        error: error.message,
        time: new Date().toISOString()
      });
    });
    
    bootstrapState.lastBootstrapTime = Date.now();
    
    return {
      success: true,
      state: bootstrapState,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    console.error('Error bootstrapping application:', error);
    
    // Record the error
    bootstrapState.errors.push({
      phase: 'bootstrap',
      error: error.message,
      time: new Date().toISOString()
    });
    
    // Force initialization to prevent app from being unusable
    bootstrapState.isInitialized = true;
    bootstrapState.lastBootstrapTime = Date.now();
    
    return {
      success: false,
      error: error.message,
      state: bootstrapState,
      duration: Date.now() - startTime
    };
  }
};

/**
 * Load critical user data that's required for the app to function
 * 
 * @param {Object} user - Authenticated user object
 * @param {Object} options - Loading options
 * @returns {Promise<void>}
 */
const loadCriticalUserData = async (user, options = {}) => {
  if (!user || !user.uid) {
    throw new Error('Invalid user object');
  }
  
  const { isOffline = false } = options;
  
  try {
    // Create cache key for the user document
    const userCacheKey = cacheUtils.createDocCacheKey(`users/${user.uid}`);
    
    // Prepare fetch data function
    const fetchUserData = async () => {
      if (isOffline) return null;
      
      const userRef = doc(db, 'users', user.uid, 'sessions', 'main');
      const userSnapshot = await getDoc(userRef);
      
      if (userSnapshot.exists()) {
        return {
          id: userSnapshot.id,
          ...userSnapshot.data()
        };
      }
      
      return null;
    };
    
    // Try to load user data with caching
    const userData = await cacheUtils.getWithCache(
      userCacheKey,
      fetchUserData,
      { 
        ttl: cacheUtils.CACHE_TTL.VERY_LONG, 
        offline: isOffline 
      }
    );
    
    if (!userData && !isOffline) {
      throw new Error('Failed to load user data');
    }
    
    console.log('Critical user data loaded');
    return userData;
  } catch (error) {
    console.error('Error loading critical user data:', error);
    
    // Record the error
    bootstrapState.errors.push({
      phase: 'critical',
      error: error.message,
      time: new Date().toISOString()
    });
    
    // If we're offline, we can continue with potentially stale data
    if (isOffline) {
      console.log('Continuing in offline mode with stale data');
      return null;
    }
    
    throw error;
  }
};

/**
 * Load user groups (essential for main functionality)
 * 
 * @param {Object} user - Authenticated user
 * @param {Object} options - Loading options
 * @returns {Promise<Array>} - User groups
 */
const loadUserGroups = async (user, options = {}) => {
  if (!user || !user.uid) return [];
  
  const { 
    prefetch = true,
    offlineOnly = false
  } = options;
  
  try {
    // Use enhanced query cache for efficient loading
    const groups = await enhancedQueryCache.getQueryWithEnhancedCache(
      'groups',
      { 
        whereConditions: [
          ['members', 'array-contains', user.uid]
        ]
      },
      {
        ttl: cacheUtils.CACHE_TTL.LONG,
        fetchPolicy: offlineOnly ? 'cache-only' : 'cache-first'
      }
    );
    
    // If we're allowed to prefetch, get member counts
    if (prefetch && groups.length > 0 && !offlineOnly) {
      // Schedule a job to update group stats
      groups.forEach(group => {
        backgroundJobScheduler.scheduleJob(
          backgroundJobScheduler.JOB_TYPES.GROUP_STATS,
          { groupId: group.id },
          false
        );
      });
    }
    
    console.log(`Loaded ${groups.length} user groups`);
    return groups;
  } catch (error) {
    console.error('Error loading user groups:', error);
    
    // Record the error
    bootstrapState.errors.push({
      phase: 'groups',
      error: error.message,
      time: new Date().toISOString()
    });
    
    return [];
  }
};

/**
 * Load user preferences
 * 
 * @param {Object} user - Authenticated user
 * @param {Object} options - Loading options
 * @returns {Promise<Object>} - User preferences
 */
const loadUserPreferences = async (user, options = {}) => {
  if (!user || !user.uid) return null;
  
  const { offlineOnly = false } = options;
  
  try {
    // Use enhanced document cache
    const preferences = await enhancedQueryCache.getDocumentWithEnhancedCache(
      'userPreferences',
      user.uid,
      {
        ttl: cacheUtils.CACHE_TTL.LONG,
        fetchPolicy: offlineOnly ? 'cache-only' : 'cache-first'
      }
    );
    
    console.log('User preferences loaded');
    return preferences;
  } catch (error) {
    console.error('Error loading user preferences:', error);
    
    // Record the error
    bootstrapState.errors.push({
      phase: 'preferences',
      error: error.message,
      time: new Date().toISOString()
    });
    
    return null;
  }
};

/**
 * Load user cards (can happen in background)
 * 
 * @param {Object} user - Authenticated user
 * @param {Object} options - Loading options
 * @returns {Promise<Array>} - User cards
 */
const loadUserCards = async (user, options = {}) => {
  if (!user || !user.uid) return [];
  
  const { isOffline = false } = options;
  
  try {
    // For cards, we use pagination cache for efficiency
    const { data: cards } = await cacheUtils.getWithCache(
      `user_cards_${user.uid}`,
      async () => {
        if (isOffline) return { data: [] };
        
        // We use the query directly here to bypass pagination for bootstrapping
        const snapshot = await enhancedQueryCache.getQueryWithEnhancedCache(
          'cards',
          {
            whereConditions: [
              ['ownerId', '==', user.uid]
            ]
          },
          {
            ttl: cacheUtils.CACHE_TTL.MEDIUM,
            fetchPolicy: isOffline ? 'cache-only' : 'cache-first'
          }
        );
        
        return { data: snapshot || [] };
      },
      { 
        ttl: cacheUtils.CACHE_TTL.MEDIUM,
        offline: isOffline
      }
    );
    
    console.log(`Loaded ${cards.length} user cards`);
    
    // Update collection stats in background if online
    if (!isOffline && cards.length > 0) {
      backgroundJobScheduler.scheduleJob(
        backgroundJobScheduler.JOB_TYPES.USER_STATS,
        { userId: user.uid },
        false
      );
    }
    
    return cards;
  } catch (error) {
    console.error('Error loading user cards:', error);
    
    // Record the error
    bootstrapState.errors.push({
      phase: 'cards',
      error: error.message,
      time: new Date().toISOString()
    });
    
    return [];
  }
};

/**
 * Load active auctions (can happen in background)
 * 
 * @param {Object} user - Authenticated user
 * @param {Object} options - Loading options
 * @returns {Promise<Array>} - Active auctions
 */
const loadActiveAuctions = async (user, options = {}) => {
  if (!user || !user.uid) return [];
  
  const { isOffline = false } = options;
  
  try {
    // For active auctions relevant to the user
    const auctions = await enhancedQueryCache.getQueryWithEnhancedCache(
      'auctions',
      {
        whereConditions: [
          ['status', '==', 'active'],
          ['relevantUsers', 'array-contains', user.uid]
        ]
      },
      {
        ttl: cacheUtils.CACHE_TTL.SHORT, // Shorter TTL since auction status changes frequently
        fetchPolicy: isOffline ? 'cache-only' : 'cache-first'
      }
    );
    
    console.log(`Loaded ${auctions.length} active auctions`);
    return auctions;
  } catch (error) {
    console.error('Error loading active auctions:', error);
    
    // Record the error
    bootstrapState.errors.push({
      phase: 'auctions',
      error: error.message,
      time: new Date().toISOString()
    });
    
    return [];
  }
};

/**
 * Load active trades (can happen in background)
 * 
 * @param {Object} user - Authenticated user
 * @param {Object} options - Loading options
 * @returns {Promise<Array>} - Active trades
 */
const loadActiveTrades = async (user, options = {}) => {
  if (!user || !user.uid) return [];
  
  const { isOffline = false } = options;
  
  try {
    // For active trades involving the user
    const trades = await enhancedQueryCache.getQueryWithEnhancedCache(
      'trades',
      {
        whereConditions: [
          ['status', '==', 'active'],
          ['participantIds', 'array-contains', user.uid]
        ]
      },
      {
        ttl: cacheUtils.CACHE_TTL.MEDIUM,
        fetchPolicy: isOffline ? 'cache-only' : 'cache-first'
      }
    );
    
    console.log(`Loaded ${trades.length} active trades`);
    return trades;
  } catch (error) {
    console.error('Error loading active trades:', error);
    
    // Record the error
    bootstrapState.errors.push({
      phase: 'trades',
      error: error.message,
      time: new Date().toISOString()
    });
    
    return [];
  }
};

/**
 * Schedule maintenance tasks to run periodically
 */
const scheduleMaintenanceTasks = () => {
  // Clear expired cache entries
  cacheUtils.clearExpiredCache().catch(error => {
    console.error('Error clearing expired cache:', error);
  });
  
  // Schedule database maintenance if due
  backgroundJobScheduler.checkAndScheduleRoutineJobs().catch(error => {
    console.error('Error scheduling routine jobs:', error);
  });
  
  // Clean up listeners that aren't needed
  GlobalListenerCoordinator.cleanup();
  
  console.log('Maintenance tasks scheduled');
};

/**
 * Clean up app resources on logout or app closure
 */
export const cleanupAppResources = async () => {
  try {
    console.log('Cleaning up app resources...');
    
    // Clean up all active listeners
    GlobalListenerCoordinator.cleanup();
    
    // Cancel any pending background jobs
    // Note: maintaining some stats jobs can still be good even during logout
    
    // Reset bootstrap state
    bootstrapState = {
      isInitialized: false,
      criticalDataLoaded: false,
      essentialDataLoaded: false,
      nonEssentialDataLoaded: false,
      offlineMode: false,
      lastBootstrapTime: null,
      errors: []
    };
    
    // Clear frequent queries tracking
    enhancedQueryCache.clearQueryAccessTracking();
    
    console.log('App resources cleaned up');
    return true;
  } catch (error) {
    console.error('Error cleaning up app resources:', error);
    return false;
  }
};

/**
 * Get the current bootstrap state
 * 
 * @returns {Object} - Current bootstrap state
 */
export const getBootstrapState = () => {
  return { ...bootstrapState };
};

/**
 * Retry the bootstrap process
 * 
 * @param {Object} user - Authenticated user
 * @returns {Promise<Object>} - Bootstrap results
 */
export const retryBootstrap = async (user) => {
  return bootstrapApplication(user, { 
    skipIfRecentlyLoaded: false,
    forceRefresh: true 
  });
};

export default {
  bootstrapApplication,
  cleanupAppResources,
  getBootstrapState,
  retryBootstrap
}; 