/**
 * useOptimizedTradeData Hook - OPTIMIZED with new optimization services
 * 
 * This hook handles:
 * - Trade data fetching using UltraBatchService
 * - Real-time updates using GlobalListenerCoordinator
 * - Smart status verification using OptimizedStatusVerificationService
 * - Performance optimization and monitoring
 */

import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import OptimizedStatusVerificationService from '../services/OptimizedStatusVerificationService';
import UltraBatchService from '../services/UltraBatchService';
import CacheService from '../services/caching/CacheService';
import GlobalListenerCoordinator from '../utils/GlobalListenerCoordinator';

// OPTIMIZED: Configuration for trade data optimization
const CONFIG = {
  LIMITS: {
    MAX_READS_PER_SESSION: 50,        // Much lower with optimization services
    PAGE_SIZE: 10,                    // Reasonable page size for batching
    CACHE_TTL: 5 * 60 * 1000,        // 5 minute cache TTL
    USER_INACTIVE_TIME: 20 * 60 * 1000, // 20 minutes
  }
};

// Session tracking
let sessionReadCount = 0;
let lastUserInteraction = Date.now();

const trackDatabaseRead = (operation = 'trade_fetch') => {
  sessionReadCount++;
  
  if (sessionReadCount % 5 === 0) {
    console.log(`📊 OPTIMIZED: useOptimizedTradeData - Session DB reads: ${sessionReadCount} (target: <50)`);
  }
};

const markUserActivity = () => {
  lastUserInteraction = Date.now();
};

const isUserInactive = () => {
  return Date.now() - lastUserInteraction > CONFIG.LIMITS.USER_INACTIVE_TIME;
};

export const useOptimizedTradeData = (options = {}) => {
  const { autoRefresh = true } = options;
  
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  
  // State management
  const [state, setState] = useState({
    trades: [],
    loading: true,
    refreshing: false,
    error: null,
    hasNextPage: true,
    currentPage: 0,
    initialized: false
  });
  
  // Refs
  const unsubscribeRef = useRef(null);
  
  // OPTIMIZED: Initialize real-time trade data using GlobalListenerCoordinator
  const initializeTradeData = useCallback(async () => {
    if (!user || !currentGroup || state.initialized) return;

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      
      console.log('🚀 OPTIMIZED: Initializing trade data with GlobalListenerCoordinator');

      // Cleanup any existing listeners
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }

      // Use GlobalListenerCoordinator for consolidated real-time trade updates
      const unsubscribe = GlobalListenerCoordinator.subscribeToGroupTrades(
        currentGroup.id,
        'trades-screen',
        async (tradesData) => {
          try {
            console.log(`📡 OPTIMIZED: Received ${tradesData.length} trades from GlobalListenerCoordinator`);
            
            // Track this as a successful data fetch
            trackDatabaseRead('trade_listener_update');
            
            // Filter trades relevant to the current user
            const userTrades = tradesData.filter(trade => 
              trade.senderId === user.uid || 
              trade.receiverId === user.uid ||
              (trade.participants && trade.participants.includes(user.uid))
            );
            
            // Set trades immediately for fast UI update
            setState(prev => ({
              ...prev,
              trades: userTrades,
              loading: false,
              refreshing: false,
              initialized: true,
              error: null
            }));
            
            // Asynchronously verify status for trades that might need it
            if (userTrades.length > 0 && !isUserInactive()) {
              console.log('🔍 OPTIMIZED: Running status verification for trades');
              await OptimizedStatusVerificationService.verifyTradeStatuses?.(userTrades);
            }
            
            markUserActivity();
            
          } catch (error) {
            console.error('🚨 Error processing trade data:', error);
            setState(prev => ({ ...prev, error: error.message }));
          }
        },
        {
          enableThrottling: true,
          throttleMs: 30000, // 30 second throttle for non-critical updates
          enableCaching: true,
          cacheExpiryMs: CONFIG.LIMITS.CACHE_TTL
        }
      );

      unsubscribeRef.current = unsubscribe;
      
      console.log('✅ OPTIMIZED: Trade data initialized with consolidated listener');

    } catch (error) {
      console.error('🚨 Failed to initialize trade data:', error);
      setState(prev => ({ 
        ...prev, 
        loading: false, 
        error: error.message 
      }));
    }
  }, [user, currentGroup, state.initialized]);

  // OPTIMIZED: Load more trades using UltraBatchService
  const loadMoreTrades = useCallback(async () => {
    if (!user || !currentGroup || !state.hasNextPage) return;

    try {
      markUserActivity();
      
      console.log('📄 OPTIMIZED: Loading more trades with UltraBatchService');
      
      // Get trade IDs for the next page
      // This would need to be implemented in your trade service
      const tradeIds = await getTradeIds(
        currentGroup.id,
        user.uid,
        { 
          page: state.currentPage + 1, 
          pageSize: CONFIG.LIMITS.PAGE_SIZE 
        }
      );
      
      if (tradeIds.length === 0) {
        setState(prev => ({ 
          ...prev, 
          hasNextPage: false 
        }));
        return;
      }
      
      // Use UltraBatchService to batch fetch trade data
      const tradeData = await UltraBatchService.batchGetDocuments('trades', tradeIds);
      const newTrades = Array.from(tradeData.values());
      
      console.log(`📦 OPTIMIZED: Loaded ${newTrades.length} more trades in batch`);
      
      setState(prev => ({
        ...prev,
        trades: [...prev.trades, ...newTrades],
        currentPage: prev.currentPage + 1,
        hasNextPage: newTrades.length === CONFIG.LIMITS.PAGE_SIZE
      }));
      
      trackDatabaseRead('trade_load_more_batch');
      
    } catch (error) {
      console.error('🚨 Failed to load more trades:', error);
      setState(prev => ({ 
        ...prev, 
        error: error.message 
      }));
    }
  }, [user, currentGroup, state.hasNextPage, state.currentPage]);

  // OPTIMIZED: Refresh using GlobalListenerCoordinator
  const refresh = useCallback(async () => {
    if (!user || !currentGroup) return;

    try {
      setState(prev => ({ ...prev, refreshing: true, error: null }));
      markUserActivity();
      
      console.log('🔄 OPTIMIZED: Refreshing trade data');

      // Force refresh through GlobalListenerCoordinator
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }

      // Re-initialize with fresh data
      setState(prev => ({ 
        ...prev, 
        initialized: false, 
        currentPage: 0, 
        hasNextPage: true 
      }));
      
      await initializeTradeData();
      
    } catch (error) {
      console.error('🚨 Refresh failed:', error);
      setState(prev => ({ 
        ...prev, 
        refreshing: false, 
        error: error.message 
      }));
    }
  }, [user, currentGroup, initializeTradeData]);

  // OPTIMIZED: Update single trade using batch operations
  const updateTrade = useCallback(async (tradeId, updates) => {
    try {
      markUserActivity();
      
      // Optimistic update
      setState(prev => ({
        ...prev,
        trades: prev.trades.map(trade => 
          trade.id === tradeId ? { ...trade, ...updates } : trade
        )
      }));
      
      console.log(`🔄 OPTIMIZED: Updating trade ${tradeId}`);
      
      // Use Firebase batch operation for update
      const { updateDoc, doc } = await import('firebase/firestore');
      const { db } = await import('../config/firebase');
      
      await updateDoc(doc(db, 'trades', tradeId), updates);
      
      // Invalidate relevant caches
      await Promise.allSettled([
        CacheService.invalidate(`trade_${tradeId}`),
        CacheService.invalidate(`group_trades_${currentGroup.id}`)
      ]);
      
    } catch (error) {
      console.error('🚨 Failed to update trade:', error);
      // Revert optimistic update
      refresh();
    }
  }, [currentGroup, refresh]);

  // Mark activity for optimization
  const markActivity = useCallback(() => {
    markUserActivity();
  }, []);

  // Screen-focused initialization to minimize idle listeners
  useFocusEffect(
    React.useCallback(() => {
      if (user && currentGroup && autoRefresh) {
        initializeTradeData();
      }
      return () => {
        if (unsubscribeRef.current) {
          unsubscribeRef.current();
          unsubscribeRef.current = null;
          setState(prev => ({ ...prev, initialized: false }));
        }
      };
    }, [user, currentGroup, autoRefresh, initializeTradeData])
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        console.log('🧹 OPTIMIZED: Cleaned up trade listener');
      }
      
      // Log final metrics
      console.log('📊 OPTIMIZED: useOptimizedTradeData cleanup - Session reads:', sessionReadCount);
    };
  }, []);

  return {
    trades: state.trades,
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
    hasNextPage: state.hasNextPage,
    
    // Actions
    refresh,
    loadMoreTrades,
    updateTrade,
    markActivity,
    
    // Metrics
    sessionReadCount
  };
};

// Helper function - would need to be implemented in your trade service
const getTradeIds = async (groupId, userId, options) => {
  // This is a placeholder - you'd implement this in your trade service
  // to get trade IDs for pagination
  const { query, collection, where, limit, startAfter, getDocs } = await import('firebase/firestore');
  const { db } = await import('../config/firebase');
  
  let q = query(
    collection(db, 'trades'),
    where('groupId', '==', groupId),
    where('participants', 'array-contains', userId),
    limit(options.pageSize)
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.id);
}; 