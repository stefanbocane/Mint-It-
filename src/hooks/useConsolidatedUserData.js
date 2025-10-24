/**
 * Consolidated User Data Hook
 * 
 * Replaces multiple individual hooks (useBalance, useGems, etc.) with a single
 * optimized hook that fetches all user-related data in one database read.
 * 
 * Performance Benefits:
 * - Reduces 3-4 separate database reads to 1 read
 * - Shared cache for all user data
 * - Consistent update patterns
 * - Memory efficient state management
 */

import { doc } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { useCallback, useEffect, useRef, useState } from 'react';
import { onSnapshot } from '../services/ReadTracking/TrackedFirestore';

import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import centralizedCacheManager from '../utils/centralizedCacheManager';

const CACHE_TTL = 2 * 60 * 1000; // 2 minutes for user data
const UPDATE_THROTTLE = 1000; // Throttle updates to once per second

export const useConsolidatedUserData = () => {
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  
  // Consolidated state
  const [userData, setUserData] = useState({
    balance: 0,
    gems: 0,
    xp: 0,
    level: 1,
    achievements: [],
    stats: {},
    loading: true,
    error: null,
    lastUpdated: null
  });
  
  const unsubscribeRef = useRef(null);
  const lastUpdateRef = useRef(0);
  const cacheKeyRef = useRef(null);

  // Throttled update function to prevent excessive re-renders
  const throttledUpdate = useCallback((newData) => {
    const now = Date.now();
    if (now - lastUpdateRef.current < UPDATE_THROTTLE) {
      return; // Skip update if too soon
    }
    
    lastUpdateRef.current = now;
    setUserData(prev => ({
      ...prev,
      ...newData,
      loading: false,
      lastUpdated: now
    }));
  }, []);

  // Error handler
  const handleError = useCallback((error) => {
    console.error('Consolidated user data error:', error);
    setUserData(prev => ({
      ...prev,
      error: error.message || 'Failed to load user data',
      loading: false
    }));
  }, []);

  // Main data fetching effect
  useEffect(() => {
    if (!user?.uid || !currentGroup?.id) {
      setUserData(prev => ({ ...prev, loading: false }));
      return;
    }

    const cacheKey = `consolidated_user_${user.uid}_${currentGroup.id}`;
    cacheKeyRef.current = cacheKey;
    
    let mounted = true;

    const setupUserDataListener = async () => {
      try {
        // Check cache first
        const cachedData = await centralizedCacheManager.get('user_data', user.uid, currentGroup.id);
        if (cachedData && mounted) {
          throttledUpdate(cachedData);
        }

        // Set up real-time listener
        const userDocRef = doc(db, 'users', user.uid);
        
        const unsubscribe = onSnapshot(userDocRef, 
          async (docSnapshot) => {
            if (!mounted) return;
            
            try {
              if (docSnapshot.exists()) {
                const rawData = docSnapshot.data();
                
                // Extract and normalize user data
                const consolidatedData = {
                  balance: rawData.balance || 0,
                  gems: rawData.gems || 0,
                  xp: rawData.xp || 0,
                  level: rawData.level || 1,
                  achievements: rawData.achievements || [],
                  stats: {
                    totalCards: rawData.totalCards || 0,
                    totalTrades: rawData.totalTrades || 0,
                    totalAuctions: rawData.totalAuctions || 0,
                    winRate: rawData.winRate || 0,
                    ...rawData.stats
                  },
                  error: null
                };

                // Update cache with new data
                await centralizedCacheManager.set('user_data', consolidatedData, CACHE_TTL, user.uid, currentGroup.id);
                
                // Update state
                throttledUpdate(consolidatedData);
                
              } else {
                // User document doesn't exist - create default data
                const defaultData = {
                  balance: 0,
                  gems: 0,
                  xp: 0,
                  level: 1,
                  achievements: [],
                  stats: {},
                  error: null
                };
                
                throttledUpdate(defaultData);
              }
            } catch (error) {
              handleError(error);
            }
          },
          (error) => {
            if (mounted) {
              handleError(error);
            }
          }
        );

        unsubscribeRef.current = unsubscribe;
        
      } catch (error) {
        if (mounted) {
          handleError(error);
        }
      }
    };

    setupUserDataListener();

    return () => {
      mounted = false;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [user?.uid, currentGroup?.id, throttledUpdate, handleError]);

  // Helper functions for backward compatibility
  const updateBalance = useCallback((newBalance) => {
    setUserData(prev => ({ ...prev, balance: newBalance }));
  }, []);

  const addCoins = useCallback((amount) => {
    setUserData(prev => ({ ...prev, balance: prev.balance + amount }));
  }, []);

  const subtractCoins = useCallback((amount) => {
    setUserData(prev => ({ 
      ...prev, 
      balance: Math.max(0, prev.balance - amount) 
    }));
  }, []);

  const updateGems = useCallback((newGems) => {
    setUserData(prev => ({ ...prev, gems: newGems }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  return {
    // Consolidated data
    userData,
    
    // Individual accessors for backward compatibility
    balance: userData.balance,
    gems: userData.gems,
    xp: userData.xp,
    level: userData.level,
    achievements: userData.achievements,
    stats: userData.stats,
    
    // State flags
    loading: userData.loading,
    error: userData.error,
    lastUpdated: userData.lastUpdated,
    
    // Update functions
    updateBalance,
    addCoins,
    subtractCoins,
    updateGems,
    
    // Utility
    isLoaded: !userData.loading && !userData.error,
    hasData: !userData.loading && userData.lastUpdated !== null
  };
}; 