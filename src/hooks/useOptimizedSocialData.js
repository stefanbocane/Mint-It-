/**
 * useOptimizedSocialData Hook - OPTIMIZED with new optimization services
 * 
 * This hook handles:
 * - Group data fetching using UltraBatchService
 * - Real-time updates using GlobalListenerCoordinator
 * - User data batch loading and caching
 * - Performance optimization and monitoring
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import UltraBatchService from '../services/UltraBatchService';
import CacheService from '../services/caching/CacheService';
import GlobalListenerCoordinator from '../utils/GlobalListenerCoordinator';

// OPTIMIZED: Configuration for social data optimization
const CONFIG = {
  LIMITS: {
    MAX_READS_PER_SESSION: 30,        // Very low with optimization services
    CACHE_TTL: 10 * 60 * 1000,       // 10 minute cache TTL for social data
    USER_INACTIVE_TIME: 20 * 60 * 1000, // 20 minutes
  }
};

// Session tracking
let sessionReadCount = 0;
let lastUserInteraction = Date.now();

const trackDatabaseRead = (operation = 'social_fetch') => {
  sessionReadCount++;
  
  if (sessionReadCount % 3 === 0) {
    console.log(`📊 OPTIMIZED: useOptimizedSocialData - Session DB reads: ${sessionReadCount} (target: <30)`);
  }
};

const markUserActivity = () => {
  lastUserInteraction = Date.now();
};

const isUserInactive = () => {
  return Date.now() - lastUserInteraction > CONFIG.LIMITS.USER_INACTIVE_TIME;
};

export const useOptimizedSocialData = (options = {}) => {
  const { autoRefresh = true } = options;
  
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  
  // State management
  const [state, setState] = useState({
    groupData: null,
    groupMembers: [],
    userGroups: [],
    loading: true,
    refreshing: false,
    error: null,
    initialized: false
  });
  
  // Refs
  const unsubscribeGroupRef = useRef(null);
  const unsubscribeUserRef = useRef(null);
  
  // OPTIMIZED: Initialize group data using GlobalListenerCoordinator
  const initializeGroupData = useCallback(async () => {
    if (!user || !currentGroup || state.initialized) return;

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      
      console.log('🚀 OPTIMIZED: Initializing social data with GlobalListenerCoordinator');

      // Cleanup any existing listeners
      if (unsubscribeGroupRef.current) {
        unsubscribeGroupRef.current();
        unsubscribeGroupRef.current = null;
      }

      // Use GlobalListenerCoordinator for consolidated real-time group updates
      const unsubscribeGroup = GlobalListenerCoordinator.subscribeToGroupData(
        currentGroup.id,
        'social-screen',
        async (groupData) => {
          try {
            console.log(`📡 OPTIMIZED: Received group data from GlobalListenerCoordinator`);
            
            // Track this as a successful data fetch
            trackDatabaseRead('group_listener_update');
            
            setState(prev => ({
              ...prev,
              groupData,
              loading: false,
              refreshing: false,
              initialized: true,
              error: null
            }));
            
            // Load group members using batch operations
            if (groupData.members && groupData.members.length > 0) {
              await loadGroupMembers(groupData.members);
            }
            
            markUserActivity();
            
          } catch (error) {
            console.error('🚨 Error processing group data:', error);
            setState(prev => ({ ...prev, error: error.message }));
          }
        },
        {
          enableThrottling: true,
          throttleMs: 60000, // 1 minute throttle for group data
          enableCaching: true,
          cacheExpiryMs: CONFIG.LIMITS.CACHE_TTL
        }
      );

      unsubscribeGroupRef.current = unsubscribeGroup;
      
      console.log('✅ OPTIMIZED: Group data initialized with consolidated listener');

    } catch (error) {
      console.error('🚨 Failed to initialize group data:', error);
      setState(prev => ({ 
        ...prev, 
        loading: false, 
        error: error.message 
      }));
    }
  }, [user, currentGroup, state.initialized]);

  // OPTIMIZED: Load group members using UltraBatchService
  const loadGroupMembers = useCallback(async (memberIds) => {
    if (!memberIds || memberIds.length === 0) return;

    try {
      console.log('📦 OPTIMIZED: Loading group members with UltraBatchService');
      
      // Use UltraBatchService to batch fetch user data
      const memberData = await UltraBatchService.batchGetUsers(memberIds);
      const members = Array.from(memberData.values());
      
      console.log(`📦 OPTIMIZED: Loaded ${members.length} group members in batch`);
      
      setState(prev => ({
        ...prev,
        groupMembers: members
      }));
      
      trackDatabaseRead('group_members_batch');
      
    } catch (error) {
      console.error('🚨 Failed to load group members:', error);
    }
  }, []);

  // OPTIMIZED: Initialize user groups data
  const initializeUserGroups = useCallback(async () => {
    if (!user) return;

    try {
      // Get user data with groups
      const userData = await UltraBatchService.batchGetUsers([user.uid]);
      const userInfo = userData.get(user.uid);
      
      if (userInfo && userInfo.groups && userInfo.groups.length > 0) {
        console.log('📦 OPTIMIZED: Loading user groups with UltraBatchService');
        
        // Batch fetch all user's groups
        const groupsData = await UltraBatchService.batchGetDocuments('groups', userInfo.groups);
        const groups = Array.from(groupsData.values());
        
        console.log(`📦 OPTIMIZED: Loaded ${groups.length} user groups in batch`);
        
        setState(prev => ({
          ...prev,
          userGroups: groups
        }));
        
        trackDatabaseRead('user_groups_batch');
      }
      
    } catch (error) {
      console.error('🚨 Failed to load user groups:', error);
    }
  }, [user]);

  // OPTIMIZED: Refresh using GlobalListenerCoordinator
  const refresh = useCallback(async () => {
    if (!user || !currentGroup) return;

    try {
      setState(prev => ({ ...prev, refreshing: true, error: null }));
      markUserActivity();
      
      console.log('🔄 OPTIMIZED: Refreshing social data');

      // Force refresh through GlobalListenerCoordinator
      if (unsubscribeGroupRef.current) {
        unsubscribeGroupRef.current();
      }

      // Re-initialize with fresh data
      setState(prev => ({ 
        ...prev, 
        initialized: false
      }));
      
      await Promise.all([
        initializeGroupData(),
        initializeUserGroups()
      ]);
      
    } catch (error) {
      console.error('🚨 Refresh failed:', error);
      setState(prev => ({ 
        ...prev, 
        refreshing: false, 
        error: error.message 
      }));
    }
  }, [user, currentGroup, initializeGroupData, initializeUserGroups]);

  // OPTIMIZED: Update group using batch operations
  const updateGroup = useCallback(async (groupId, updates) => {
    try {
      markUserActivity();
      
      // Optimistic update
      setState(prev => ({
        ...prev,
        groupData: prev.groupData ? { ...prev.groupData, ...updates } : null
      }));
      
      console.log(`🔄 OPTIMIZED: Updating group ${groupId}`);
      
      // Use Firebase batch operation for update
      const { updateDoc, doc } = await import('firebase/firestore');
      const { db } = await import('../config/firebase');
      
      await updateDoc(doc(db, 'groups', groupId), updates);
      
      // Invalidate relevant caches
      await Promise.allSettled([
        CacheService.invalidate(`group_${groupId}`),
        CacheService.invalidate(`groups_${groupId}`)
      ]);
      
    } catch (error) {
      console.error('🚨 Failed to update group:', error);
      // Revert optimistic update
      refresh();
    }
  }, [refresh]);

  // Mark activity for optimization
  const markActivity = useCallback(() => {
    markUserActivity();
  }, []);

  // Initialize data when dependencies change
  useEffect(() => {
    if (user && currentGroup && !state.initialized && autoRefresh) {
      initializeGroupData();
    }
  }, [user, currentGroup, state.initialized, autoRefresh, initializeGroupData]);

  // Initialize user groups when user changes
  useEffect(() => {
    if (user && autoRefresh) {
      initializeUserGroups();
    }
  }, [user, autoRefresh, initializeUserGroups]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeGroupRef.current) {
        unsubscribeGroupRef.current();
        console.log('🧹 OPTIMIZED: Cleaned up group listener');
      }
      
      if (unsubscribeUserRef.current) {
        unsubscribeUserRef.current();
        console.log('🧹 OPTIMIZED: Cleaned up user listener');
      }
      
      // Log final metrics
      console.log('📊 OPTIMIZED: useOptimizedSocialData cleanup - Session reads:', sessionReadCount);
    };
  }, []);

  return {
    groupData: state.groupData,
    groupMembers: state.groupMembers,
    userGroups: state.userGroups,
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
    
    // Actions
    refresh,
    updateGroup,
    markActivity,
    
    // Metrics
    sessionReadCount
  };
}; 