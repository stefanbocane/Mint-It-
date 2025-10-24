/**
 * Lazy Data Loading Hook
 * 
 * LAZY LOADING FIX: Removes 25+ non-essential reads from boot sequence
 * Loads data only when components become visible or are accessed
 * Implements intersection observer and viewport-based loading
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import CacheService from '../services/caching/CacheService';
import SmartUserPatternsService from '../services/SmartUserPatternsService';

export const useLazyDataLoading = (userId, groupId, options = {}) => {
  const [loadedSections, setLoadedSections] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [userPatterns, setUserPatterns] = useState(null);
  const loadingPromises = useRef(new Map());

  const {
    enableIntersectionObserver = true,
    loadOnDemand = true,
    preloadDelay = 2000, // 2 second delay before preloading
    backgroundLoadDelay = 5000 // 5 second delay for background loading
  } = options;

  // Load user patterns on mount
  useEffect(() => {
    if (userId) {
      SmartUserPatternsService.analyzeUserPatterns(userId)
        .then(patterns => {
          setUserPatterns(patterns);
          
          // Schedule background loading based on patterns
          if (patterns.isHighActivityUser) {
            setTimeout(() => {
              preloadHighPriorityData(patterns);
            }, preloadDelay);
          }
        })
        .catch(error => {
          console.error('Error loading user patterns for lazy loading:', error);
        });
    }
  }, [userId, preloadDelay]);

  /**
   * Lazy load data for a specific section
   */
  const loadSectionData = useCallback(async (sectionName, forceRefresh = false) => {
    if (!userId || !groupId) return null;

    // Check if already loaded
    if (loadedSections.has(sectionName) && !forceRefresh) {
      return Promise.resolve(null);
    }

    // Check if already loading
    if (loadingPromises.current.has(sectionName)) {
      return loadingPromises.current.get(sectionName);
    }

    console.log(`📦 Lazy loading section: ${sectionName}`);
    setLoading(true);

    const loadPromise = (async () => {
      try {
        let data = null;

        switch (sectionName) {
          case 'userStats':
            data = await loadUserStats(userId);
            break;
          case 'leaderboard':
            data = await loadLeaderboardData(groupId);
            break;
          case 'groupActivity':
            data = await loadGroupActivity(groupId);
            break;
          case 'userPreferences':
            data = await loadUserPreferences(userId);
            break;
          case 'storeData':
            data = await loadStoreData();
            break;
          case 'socialData':
            data = await loadSocialData(userId, groupId);
            break;
          case 'notificationHistory':
            data = await loadNotificationHistory(userId);
            break;
          case 'tradeHistory':
            data = await loadTradeHistory(userId, groupId);
            break;
          case 'auctionHistory':
            data = await loadAuctionHistory(userId, groupId);
            break;
          case 'achievements':
            data = await loadAchievements(userId);
            break;
          default:
            console.warn(`Unknown section for lazy loading: ${sectionName}`);
        }

        // Mark as loaded
        setLoadedSections(prev => new Set(prev).add(sectionName));
        
        return data;
      } catch (error) {
        console.error(`Error lazy loading ${sectionName}:`, error);
        return null;
      } finally {
        loadingPromises.current.delete(sectionName);
        setLoading(false);
      }
    })();

    loadingPromises.current.set(sectionName, loadPromise);
    return loadPromise;
  }, [userId, groupId, loadedSections]);

  /**
   * Preload high priority data based on user patterns
   */
  const preloadHighPriorityData = useCallback(async (patterns) => {
    if (!patterns || !userId || !groupId) return;

    console.log('🚀 Preloading high priority data based on user patterns');

    const preloadPromises = [];

    // Preload based on user behavior
    if (patterns.checksLeaderboard) {
      preloadPromises.push(loadSectionData('leaderboard'));
    }

    if (patterns.isHighActivityUser) {
      preloadPromises.push(
        loadSectionData('userStats'),
        loadSectionData('groupActivity')
      );
    }

    if (patterns.usesStore) {
      preloadPromises.push(loadSectionData('storeData'));
    }

    // Execute preloads in parallel
    await Promise.allSettled(preloadPromises);
  }, [loadSectionData, userId, groupId]);

  /**
   * Load data when component becomes visible (intersection observer)
   */
  const observeComponent = useCallback((elementRef, sectionName) => {
    if (!enableIntersectionObserver || !elementRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            loadSectionData(sectionName);
            observer.unobserve(entry.target);
          }
        });
      },
      {
        rootMargin: '100px', // Load 100px before element enters viewport
        threshold: 0.1
      }
    );

    observer.observe(elementRef.current);

    return () => {
      if (elementRef.current) {
        observer.unobserve(elementRef.current);
      }
    };
  }, [loadSectionData, enableIntersectionObserver]);

  // Individual lazy loading functions
  const loadUserStats = async (userId) => {
    return await CacheService.getDocument('userStats', userId, {
      ttl: 5 * 60 * 1000 // 5 minute cache
    });
  };

  const loadLeaderboardData = async (groupId) => {
    return await CacheService.getDocument('leaderboards', `group_${groupId}`, {
      ttl: 10 * 60 * 1000 // 10 minute cache
    });
  };

  const loadGroupActivity = async (groupId) => {
    const { collection, query, where, orderBy, limit } = await import('firebase/firestore');
    const { db } = await import('../config/firebase');
    
    const activityQuery = query(
      collection(db, 'activity'),
      where('groupId', '==', groupId),
      orderBy('timestamp', 'desc'),
      limit(20)
    );

    return await CacheService.getQuery(activityQuery, {
      cacheKey: `groupActivity_${groupId}_lazy`,
      ttl: 5 * 60 * 1000
    });
  };

  const loadUserPreferences = async (userId) => {
    return await CacheService.getDocument('userPreferences', userId, {
      ttl: 30 * 60 * 1000 // 30 minute cache for preferences
    });
  };

  const loadStoreData = async () => {
    return await CacheService.getDocument('store', 'config', {
      ttl: 60 * 60 * 1000 // 1 hour cache for store data
    });
  };

  const loadSocialData = async (userId, groupId) => {
    const { collection, query, where, limit } = await import('firebase/firestore');
    const { db } = await import('../config/firebase');
    
    const friendsQuery = query(
      collection(db, 'friendships'),
      where('participants', 'array-contains', userId),
      where('groupId', '==', groupId),
      limit(20)
    );

    return await CacheService.getQuery(friendsQuery, {
      cacheKey: `socialData_${userId}_${groupId}_lazy`,
      ttl: 15 * 60 * 1000
    });
  };

  const loadNotificationHistory = async (userId) => {
    const { collection, query, where, orderBy, limit } = await import('firebase/firestore');
    const { db } = await import('../config/firebase');
    
    const notificationsQuery = query(
      collection(db, 'notifications'),
      where('userId', '==', userId),
      orderBy('timestamp', 'desc'),
      limit(15)
    );

    return await CacheService.getQuery(notificationsQuery, {
      cacheKey: `notifications_${userId}_lazy`,
      ttl: 5 * 60 * 1000
    });
  };

  const loadTradeHistory = async (userId, groupId) => {
    const { collection, query, where, orderBy, limit } = await import('firebase/firestore');
    const { db } = await import('../config/firebase');
    
    const tradesQuery = query(
      collection(db, 'trades'),
      where('participantIds', 'array-contains', userId),
      where('groupId', '==', groupId),
      orderBy('createdAt', 'desc'),
      limit(10)
    );

    return await CacheService.getQuery(tradesQuery, {
      cacheKey: `tradeHistory_${userId}_${groupId}_lazy`,
      ttl: 10 * 60 * 1000
    });
  };

  const loadAuctionHistory = async (userId, groupId) => {
    const { collection, query, where, orderBy, limit } = await import('firebase/firestore');
    const { db } = await import('../config/firebase');
    
    const auctionsQuery = query(
      collection(db, 'auctions'),
      where('createdBy', '==', userId),
      where('groupId', '==', groupId),
      orderBy('createdAt', 'desc'),
      limit(10)
    );

    return await CacheService.getQuery(auctionsQuery, {
      cacheKey: `auctionHistory_${userId}_${groupId}_lazy`,
      ttl: 10 * 60 * 1000
    });
  };

  const loadAchievements = async (userId) => {
    return await CacheService.getDocument('achievements', userId, {
      ttl: 60 * 60 * 1000 // 1 hour cache for achievements
    });
  };

  /**
   * Prefetch data for all visible sections
   */
  const prefetchVisibleSections = useCallback((visibleSections = []) => {
    const promises = visibleSections.map(section => loadSectionData(section));
    return Promise.allSettled(promises);
  }, [loadSectionData]);

  /**
   * Clear loaded sections (for testing or reset)
   */
  const clearLoadedSections = useCallback(() => {
    setLoadedSections(new Set());
    loadingPromises.current.clear();
  }, []);

  /**
   * Get loading status for specific section
   */
  const isSectionLoaded = useCallback((sectionName) => {
    return loadedSections.has(sectionName);
  }, [loadedSections]);

  /**
   * Get loading status for specific section
   */
  const isSectionLoading = useCallback((sectionName) => {
    return loadingPromises.current.has(sectionName);
  }, []);

  return {
    loadSectionData,
    observeComponent,
    prefetchVisibleSections,
    clearLoadedSections,
    isSectionLoaded,
    isSectionLoading,
    loading,
    loadedSections: Array.from(loadedSections),
    userPatterns
  };
};

export default useLazyDataLoading; 