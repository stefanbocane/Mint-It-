/**
 * Unified User Data Context - Supabase Version
 *
 * Replaces Firebase Firestore operations with Supabase Postgres functions.
 * Uses Postgres functions for atomic balance/gem operations instead of client transactions.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import CacheService from '../services/caching/CacheService';
import { supabase } from '../services/ReadTracking/SupabaseTracked';
import { useAuth } from './AuthContextSupabase';
import { useGroup } from './GroupContextSupabase';

// Input validation utilities
const ValidationUtils = {
  validateAmount: (amount, context = 'operation') => {
    if (typeof amount !== 'number') {
      throw new Error(`${context}: Amount must be a number, received ${typeof amount}`);
    }
    if (isNaN(amount)) {
      throw new Error(`${context}: Amount cannot be NaN`);
    }
    if (!isFinite(amount)) {
      throw new Error(`${context}: Amount must be finite`);
    }
    if (amount < 0) {
      throw new Error(`${context}: Amount cannot be negative`);
    }
    if (amount === 0) {
      throw new Error(`${context}: Amount must be greater than zero`);
    }
    if (!Number.isInteger(amount)) {
      throw new Error(`${context}: Amount must be an integer`);
    }
    if (amount > Number.MAX_SAFE_INTEGER) {
      throw new Error(`${context}: Amount exceeds maximum safe integer`);
    }
    return true;
  },

  validateUserId: (userId, context = 'operation') => {
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      throw new Error(`${context}: Valid user ID is required`);
    }
    return true;
  },

  validateGroupId: (groupId, context = 'operation', allowNull = true) => {
    if (!allowNull && (!groupId || typeof groupId !== 'string' || groupId.trim() === '')) {
      throw new Error(`${context}: Valid group ID is required`);
    }
    if (groupId && (typeof groupId !== 'string' || groupId.trim() === '')) {
      throw new Error(`${context}: Group ID must be a non-empty string`);
    }
    return true;
  },
};

const UnifiedUserDataContext = createContext();

export const useUnifiedUserData = () => {
  const context = useContext(UnifiedUserDataContext);
  if (!context) {
    throw new Error('useUnifiedUserData must be used within a UnifiedUserDataProvider');
  }
  return context;
};

export const UnifiedUserDataProvider = ({ children }) => {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const { user } = useAuth();
  const { currentGroup } = useGroup();

  // Load user data with caching
  useEffect(() => {
    if (!user?.id) {
      setUserData(null);
      setLoading(false);
      return;
    }

    let isMounted = true;

    const loadUserData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Check cache first (2-hour TTL)
        const cacheKey = `unified_user_${user.id}`;
        const cached = await CacheService.getValue(cacheKey);

        if (cached && cached.data && Date.now() - (cached.timestamp || 0) < 2 * 60 * 60 * 1000) {
          if (isMounted) {
            setUserData(cached.data);
            setLastUpdated(new Date(cached.timestamp));
            setLoading(false);
            console.log('✅ Unified user data loaded from cache (no query)');
          }
          return;
        }

        // Cache miss: fetch from Supabase
        // Query both users and user_sessions tables
        const [userResult, sessionResult] = await Promise.all([
          supabase
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single(),
          supabase
            .from('user_sessions')
            .select('*')
            .eq('user_id', user.id)
            .single()
        ]);

        if (!isMounted) return;

        if (userResult.error && userResult.error.code !== 'PGRST116') {
          throw userResult.error;
        }

        if (sessionResult.error && sessionResult.error.code !== 'PGRST116') {
          throw sessionResult.error;
        }

        // Merge user and session data
        const mergedData = {
          ...userResult.data,
          groupBalances: sessionResult.data?.group_balances || {},
          groupGems: sessionResult.data?.group_gems || {},
        };

        setUserData(mergedData);
        setLastUpdated(new Date());

        // Cache with 2-hour TTL
        await CacheService.setValue(cacheKey, {
          data: mergedData,
          timestamp: Date.now()
        }, { ttl: 2 * 60 * 60 * 1000 });

        console.log('✅ Unified user data loaded from Supabase (2 queries)');
      } catch (err) {
        console.error('❌ Error loading user data:', err);
        if (isMounted) {
          setError(err);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadUserData();

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  // Fetch user data with optional force refresh
  const fetchUserData = useCallback(async (forceRefresh = false) => {
    if (!user?.id) return null;

    try {
      setLoading(true);
      setError(null);

      const cacheKey = `unified_user_${user.id}`;

      if (!forceRefresh) {
        const cached = await CacheService.getValue(cacheKey);
        if (cached && cached.data && Date.now() - (cached.timestamp || 0) < 2 * 60 * 60 * 1000) {
          setUserData(cached.data);
          setLastUpdated(new Date(cached.timestamp));
          console.log('✅ Fetch user data from cache (no query)');
          return cached.data;
        }
      }

      const [userResult, sessionResult] = await Promise.all([
        supabase.from('users').select('*').eq('id', user.id).single(),
        supabase.from('user_sessions').select('*').eq('user_id', user.id).single()
      ]);

      if (userResult.error && userResult.error.code !== 'PGRST116') throw userResult.error;
      if (sessionResult.error && sessionResult.error.code !== 'PGRST116') throw sessionResult.error;

      const mergedData = {
        ...userResult.data,
        groupBalances: sessionResult.data?.group_balances || {},
        groupGems: sessionResult.data?.group_gems || {},
      };

      setUserData(mergedData);
      setLastUpdated(new Date());

      await CacheService.setValue(cacheKey, {
        data: mergedData,
        timestamp: Date.now()
      }, { ttl: 2 * 60 * 60 * 1000 });

      console.log(`✅ Fetch user data from Supabase (2 queries)${forceRefresh ? ' [forced]' : ''}`);
      return mergedData;
    } catch (err) {
      console.error('Error fetching user data:', err);
      setError(err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // Manual refresh
  const refreshUserData = useCallback(() => {
    console.log('🔄 Manual user data refresh requested');
    return fetchUserData(true);
  }, [fetchUserData]);

  // Get group-specific balance
  const getBalance = useCallback((groupId = null) => {
    const targetGroupId = groupId || currentGroup?.id;
    if (!targetGroupId || !userData) return 0;

    return userData.groupBalances?.[targetGroupId] || 0;
  }, [userData, currentGroup?.id]);

  // Coin operations using Postgres functions
  const performCoinOperation = useCallback(async (operationType, amount, groupId = null) => {
    try {
      ValidationUtils.validateAmount(amount, `${operationType}Coins`);
      ValidationUtils.validateUserId(user?.id, `${operationType}Coins`);

      const targetGroupId = groupId || currentGroup?.id;
      ValidationUtils.validateGroupId(targetGroupId, `${operationType}Coins`, false);

      const currentBalance = getBalance(targetGroupId);

      // Calculate new balance
      const delta = operationType === 'add' ? amount : -amount;
      const newBalance = currentBalance + delta;

      // Optimistic update
      setUserData(prev => ({
        ...prev,
        groupBalances: {
          ...prev?.groupBalances,
          [targetGroupId]: newBalance
        }
      }));

      // Call Postgres function
      const { data, error } = await supabase.rpc('update_balance', {
        p_user_id: user.id,
        p_group_id: targetGroupId,
        p_amount: delta
      });

      if (error) {
        console.error(`❌ Failed to ${operationType} coins:`, error);
        // Revert optimistic update
        setUserData(prev => ({
          ...prev,
          groupBalances: {
            ...prev?.groupBalances,
            [targetGroupId]: currentBalance
          }
        }));
        return { success: false, error: error.message, currentBalance };
      }

      console.log(`✅ ${operationType}Coins: ${amount} coins. Balance: ${currentBalance} → ${newBalance}`);
      return { success: true, oldBalance: currentBalance, newBalance, amount };
    } catch (error) {
      console.error(`❌ Error in ${operationType}Coins:`, error.message);
      return { success: false, error: error.message, currentBalance: getBalance(groupId) };
    }
  }, [user?.id, currentGroup?.id, getBalance]);

  // Gem operations using Postgres functions
  const performGemOperation = useCallback(async (operationType, amount, options = {}) => {
    try {
      ValidationUtils.validateAmount(amount, `${operationType}Gems`);
      ValidationUtils.validateUserId(user?.id, `${operationType}Gems`);

      const { groupId = null, useGlobal = false } = options;
      const targetGroupId = !useGlobal && groupId ? groupId : (useGlobal ? null : currentGroup?.id);

      if (targetGroupId) {
        ValidationUtils.validateGroupId(targetGroupId, `${operationType}Gems`, false);
      }

      const currentGems = targetGroupId && userData?.groupGems?.[targetGroupId] !== undefined
        ? userData.groupGems[targetGroupId]
        : userData?.gems || 0;

      const delta = operationType === 'add' ? amount : -amount;
      const newGems = currentGems + delta;

      // Optimistic update
      if (targetGroupId) {
        setUserData(prev => ({
          ...prev,
          groupGems: {
            ...prev?.groupGems,
            [targetGroupId]: newGems
          }
        }));
      } else {
        setUserData(prev => ({
          ...prev,
          gems: newGems
        }));
      }

      // Call Postgres function
      const { data, error } = await supabase.rpc('update_gems', {
        p_user_id: user.id,
        p_amount: delta,
        p_group_id: targetGroupId
      });

      if (error) {
        console.error(`❌ Failed to ${operationType} gems:`, error);
        // Revert optimistic update
        if (targetGroupId) {
          setUserData(prev => ({
            ...prev,
            groupGems: {
              ...prev?.groupGems,
              [targetGroupId]: currentGems
            }
          }));
        } else {
          setUserData(prev => ({
            ...prev,
            gems: currentGems
          }));
        }
        return { success: false, error: error.message, currentGems };
      }

      console.log(`✅ ${operationType}Gems: ${amount} gems. Balance: ${currentGems} → ${newGems}`);
      return { success: true, oldBalance: currentGems, newBalance: newGems, amount };
    } catch (error) {
      console.error(`❌ Error in ${operationType}Gems:`, error.message);
      return { success: false, error: error.message, currentGems: 0 };
    }
  }, [user?.id, currentGroup?.id, userData]);

  // Computed values for compatibility
  const computedValues = {
    gems: userData?.gems || 0,
    groupGems: userData?.groupGems || {},
    getGems: (groupId = null) => {
      if (groupId && userData?.groupGems?.[groupId] !== undefined) {
        return userData.groupGems[groupId];
      }
      return userData?.gems || 0;
    },
    isLoadingGems: loading,
    balance: getBalance(),
    isLoadingBalance: loading,
    groupBalances: userData?.groupBalances || {},
    username: userData?.username || user?.email?.split('@')[0] || 'Unknown',
    showcase: userData?.showcase || Array(3).fill(null),
    cardBorders: userData?.card_borders || ['default'],
    hasInitialReward: (groupId = null) => {
      const targetGroupId = groupId || currentGroup?.id;
      return userData?.initial_reward_groups?.includes(targetGroupId) || false;
    }
  };

  const contextValue = {
    userData,
    loading,
    error,
    lastUpdated,
    fetchUserData,
    refreshUserData,
    getBalance,
    ...computedValues,
    isReady: !loading && !error && userData !== null,
    hasError: !!error,
    isEmpty: !loading && !error && userData === null,

    // Backward compatibility methods
    subtractCoins: async (amount, groupId = null) => {
      const result = await performCoinOperation('subtract', amount, groupId);
      return result.success;
    },
    addCoins: async (amount, groupId = null) => {
      const result = await performCoinOperation('add', amount, groupId);
      return result.success;
    },
    subtractGems: async (amount, options = {}) => {
      const result = await performGemOperation('subtract', amount, options);
      return result.success;
    },
    addGems: async (amount, options = {}) => {
      const result = await performGemOperation('add', amount, options);
      return result.success;
    },
  };

  return (
    <UnifiedUserDataContext.Provider value={contextValue}>
      {children}
    </UnifiedUserDataContext.Provider>
  );
};

export default UnifiedUserDataContext;
