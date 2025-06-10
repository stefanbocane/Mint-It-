import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import CacheService from '../services/caching/CacheService';

/**
 * Custom hook for optimized user data fetching with intelligent caching
 * @param {Object} options - Hook options
 * @param {string[]} options.fields - Specific fields to fetch (optional)
 * @param {number} options.ttl - Cache TTL in milliseconds
 * @param {boolean} options.autoRefresh - Whether to auto-refresh on mount
 * @param {string} options.groupId - Specific group ID for group-related data
 */
export const useUserData = (options = {}) => {
  const {
    fields = null,
    ttl = 60 * 1000, // 1 minute default
    autoRefresh = true,
    groupId = null
  } = options;

  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const targetGroupId = groupId || currentGroup?.id;

  // Fetch user data with caching
  const fetchUserData = useCallback(async (forceRefresh = false) => {
    if (!user?.uid) {
      setUserData(null);
      setLoading(false);
      return null;
    }

    try {
      setLoading(true);
      setError(null);

      const userData = await CacheService.getDocument('users', user.uid, {
        ttl,
        forceRefresh
      });

      if (userData) {
        // If specific fields are requested, return only those
        const resultData = fields ? 
          fields.reduce((acc, field) => {
            acc[field] = userData[field];
            return acc;
          }, {}) : 
          userData;

        setUserData(resultData);
        setLastUpdated(new Date());
        return resultData;
      } else {
        setUserData(null);
        return null;
      }
    } catch (err) {
      console.error('Error fetching user data:', err);
      setError(err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [user?.uid, ttl, fields]);

  // Refresh user data (force refresh)
  const refreshUserData = useCallback(() => {
    return fetchUserData(true);
  }, [fetchUserData]);

  // Get specific field value
  const getUserField = useCallback(async (field, fieldOptions = {}) => {
    if (!user?.uid) return null;

    try {
      const userData = await CacheService.getDocument('users', user.uid, {
        ttl: fieldOptions.ttl || ttl,
        forceRefresh: fieldOptions.forceRefresh || false
      });

      return userData?.[field] || fieldOptions.defaultValue || null;
    } catch (err) {
      console.error(`Error fetching user field ${field}:`, err);
      return fieldOptions.defaultValue || null;
    }
  }, [user?.uid, ttl]);

  // Get group-specific data
  const getGroupData = useCallback(async (dataType = 'balance') => {
    if (!user?.uid || !targetGroupId) return null;

    try {
      const userData = await CacheService.getDocument('users', user.uid, {
        ttl: 30 * 1000 // Shorter cache for group-specific data
      });

      switch (dataType) {
        case 'balance':
          return userData?.groupBalances?.[targetGroupId] || 0;
        case 'hasInitialReward':
          return userData?.initialRewardGroups?.includes(targetGroupId) || false;
        default:
          return userData?.[dataType] || null;
      }
    } catch (err) {
      console.error(`Error fetching group data ${dataType}:`, err);
      return null;
    }
  }, [user?.uid, targetGroupId]);

  // Invalidate cache and refresh
  const invalidateAndRefresh = useCallback(async () => {
    if (!user?.uid) return;

    try {
      await CacheService.invalidate(`users:${user.uid}`);
      return await fetchUserData(true);
    } catch (err) {
      console.error('Error invalidating and refreshing user data:', err);
      throw err;
    }
  }, [user?.uid, fetchUserData]);

  // Auto-fetch on mount and user/group changes
  useEffect(() => {
    if (autoRefresh) {
      fetchUserData();
    }
  }, [autoRefresh, fetchUserData]);

  // Computed values for common use cases
  const computedValues = {
    balance: userData?.groupBalances?.[targetGroupId] || 0,
    gems: userData?.gems || 0,
    username: userData?.username || user?.email?.split('@')[0] || 'Unknown',
    hasInitialReward: userData?.initialRewardGroups?.includes(targetGroupId) || false,
    cardBorders: userData?.cardBorders || ['default'],
    showcase: userData?.showcase || Array(3).fill(null)
  };

  return {
    // Core data
    userData,
    loading,
    error,
    lastUpdated,

    // Methods
    fetchUserData,
    refreshUserData,
    getUserField,
    getGroupData,
    invalidateAndRefresh,

    // Computed values
    ...computedValues,

    // Utilities
    isReady: !loading && !error && userData !== null,
    hasError: !!error,
    isEmpty: !loading && !error && userData === null
  };
};

export default useUserData; 