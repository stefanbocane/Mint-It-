/**
 * useAuctionData Hook - OPTIMIZED with new optimization services
 * 
 * This hook handles:
 * - Auction data fetching using UltraBatchService
 * - Real-time updates using GlobalListenerCoordinator
 * - Smart status verification using OptimizedStatusVerificationService
 * - Performance optimization and monitoring
 */

import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContextSupabase';
import { GROUP_CREATED_EVENT, useGroup } from '../contexts/GroupContextSupabase';
import AuctionService from '../services/AuctionServiceSupabase';
import OptimizedStatusVerificationService from '../services/OptimizedStatusVerificationService';
import UltraBatchService from '../services/UltraBatchService';
import CacheService from '../services/caching/CacheService';
import GlobalListenerCoordinator from '../utils/GlobalListenerCoordinator';
import { calculateTimeRemaining, getCorrectedNow } from '../utils/auctionTimerUtils';
import EventManager from '../utils/eventManager';
import PerformanceOptimizer from '../utils/performanceOptimizer';
import { getBidderCount } from '../utils/smartBidderCountService';

// OPTIMIZED: Simplified polling configuration for new optimization services
const CONFIG = {
  POLLING_INTERVALS: {
    CRITICAL: 3 * 60 * 1000,          // 3 minutes for critical auctions
    URGENT: 10 * 60 * 1000,           // 10 minutes for urgent auctions  
    NORMAL: 60 * 60 * 1000,           // 1 hour for normal auctions
    BACKGROUND: 4 * 60 * 60 * 1000,   // 4 hours for background polling
    INACTIVE: 12 * 60 * 60 * 1000,    // 12 hours when user inactive
    DEEP_SLEEP: 24 * 60 * 60 * 1000   // 24 hours for deep sleep
  },
  LIMITS: {
    MAX_READS_PER_SESSION: 100,        // OPTIMIZED: Much lower with batch operations
    PAGE_SIZE: 10,                     // Reasonable page size for batching
    CRITICAL_THRESHOLD: 5 * 60 * 1000,  // 5 minutes
    URGENT_THRESHOLD: 30 * 60 * 1000,   // 30 minutes
    NORMAL_THRESHOLD: 2 * 60 * 60 * 1000, // 2 hours
    MAX_EXPIRED_PROCESS: 5,             // Process more with efficient batching
    USER_INACTIVE_TIME: 20 * 60 * 1000, // 20 minutes
    MIN_POLL_INTERVAL: 3 * 60 * 1000,   // Minimum 3 minutes
    MAX_POLL_INTERVAL: 24 * 60 * 60 * 1000, // Maximum 24 hours
    
    // OPTIMIZED: Enhanced optimization flags for new services
    USE_GLOBAL_LISTENER: true,      // Use GlobalListenerCoordinator
    USE_BATCH_OPERATIONS: true,     // Use UltraBatchService
    USE_STATUS_VERIFICATION: true,  // Use OptimizedStatusVerificationService
    CACHE_TTL: 5 * 60 * 1000       // 5 minute cache TTL
  }
};

// Session read tracking - much lower with optimization services
let sessionReadCount = 0;
let lastUserInteraction = Date.now();

const trackDatabaseRead = (operation = 'auction_fetch') => {
  sessionReadCount++;
  PerformanceOptimizer.trackDatabaseRead(operation, 'auctions');
  
  // Log read count periodically
  if (sessionReadCount % 10 === 0) {
    console.log(`📊 OPTIMIZED: useAuctionData - Session DB reads: ${sessionReadCount} (target: <100)`);
  }
};

const hasExceededReadLimit = () => sessionReadCount >= CONFIG.LIMITS.MAX_READS_PER_SESSION;

const markUserActivity = () => {
  lastUserInteraction = Date.now();
};

const isUserInactive = () => {
  return Date.now() - lastUserInteraction > CONFIG.LIMITS.USER_INACTIVE_TIME;
};

// OPTIMIZED: Simplified polling interval calculation for real-time listeners
const getOptimalPollingInterval = (auctions = [], hasRecentActivity = false) => {
  if (!auctions || auctions.length === 0) {
    console.log(`😴 OPTIMIZED: No auctions, using deep sleep mode`);
    return CONFIG.POLLING_INTERVALS.DEEP_SLEEP;
  }
  
  // Count auctions by urgency
  let criticalCount = 0;
  let urgentCount = 0;
  
  auctions.forEach(auction => {
    const timeRemaining = calculateTimeRemaining(auction.endTime);
    if (timeRemaining.totalMs <= 0) return;
    
    if (timeRemaining.totalMs < CONFIG.LIMITS.CRITICAL_THRESHOLD) {
      criticalCount++;
    } else if (timeRemaining.totalMs < CONFIG.LIMITS.URGENT_THRESHOLD) {
      urgentCount++;
    }
  });
  
  // User inactive and no critical auctions
  if (isUserInactive() && criticalCount === 0) {
    console.log(`😴 OPTIMIZED: User inactive, using background polling`);
    return CONFIG.POLLING_INTERVALS.INACTIVE;
  }
  
  // Critical auctions
  if (criticalCount > 0) {
    console.log(`🔥 OPTIMIZED: ${criticalCount} critical auctions, using 3-minute polling`);
    return CONFIG.POLLING_INTERVALS.CRITICAL;
  }
  
  // Urgent auctions
  if (urgentCount > 0) {
    console.log(`⚡ OPTIMIZED: ${urgentCount} urgent auctions, using 10-minute polling`);
    return CONFIG.POLLING_INTERVALS.URGENT;
  }
  
  // Default to normal polling
  console.log(`📊 OPTIMIZED: Using normal 1-hour polling`);
  return CONFIG.POLLING_INTERVALS.NORMAL;
};

export const useAuctionData = (options = {}) => {
  const { 
    autoRefresh = true, 
    enablePolling = true, 
    useCentralizedPolling = true
  } = options;
  
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  
  // State management
  const [state, setState] = useState({
    auctions: [],
    loading: true,
    loadingMore: false,
    refreshing: false,
    error: null,
    hasNextPage: true,
    currentPage: 0,
    initialized: false
  });
  
  // Refs
  const unsubscribeRef = useRef(null);
  const pollingTimerRef = useRef(null);
  const lastFetchTime = useRef(0);
  const pollingMetrics = useRef({
    totalPolls: 0,
    successfulPolls: 0,
    failedPolls: 0,
    averageResponseTime: 0
  });

  // OPTIMIZED: Initialize real-time auction data using GlobalListenerCoordinator
  const initializeAuctionData = useCallback(async () => {
    if (!user || !currentGroup || state.initialized) return;

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      
      console.log('🚀 OPTIMIZED: Initializing auction data with GlobalListenerCoordinator');

      // Cleanup any existing listeners
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }

      // Use GlobalListenerCoordinator for consolidated real-time auction updates
      const unsubscribe = GlobalListenerCoordinator.subscribeToGroupAuctions(
        currentGroup.id,
        'auction-screen',
        (auctionsData) => {
          try {
            console.log(`📡 OPTIMIZED: Received ${auctionsData.length} auctions from GlobalListenerCoordinator`);
            
            // Track this as a successful data fetch
            trackDatabaseRead('auction_listener_update');
            
            // Filter out ended or inactive auctions before updating
            const now = getCorrectedNow();
            const activeAuctions = auctionsData.filter(a => {
              if (a.status && a.status !== 'active') return false;
              if (a.endTime) {
                const end = a.endTime.toDate ? a.endTime.toDate() : new Date(a.endTime.seconds*1000);
                return end > now;
              }
              return true;
            });
            
            // Set auctions immediately for fast UI update
            setState(prev => ({
              ...prev,
              auctions: activeAuctions,
              loading: false,
              refreshing: false,
              initialized: true,
              error: null
            }));
            
            // Run status verification in background WITHOUT awaiting (non-blocking)
            if (activeAuctions.length > 0 && !isUserInactive()) {
              console.log('🔍 OPTIMIZED: Running background status verification for auctions');
              Promise.resolve().then(() => 
                OptimizedStatusVerificationService.verifyRecentAuctionCompletions(
                  activeAuctions,
                  { userActivity: 'active' }
                )
              ).catch(error => {
                console.warn('⚠️ Background auction status verification failed:', error);
              });
            }
            
            markUserActivity();
            
          } catch (error) {
            console.error('🚨 Error processing auction data:', error);
            setState(prev => ({ ...prev, error: error.message }));
          }
        },
        {
          enableThrottling: true,
          throttleMs: getOptimalPollingInterval(state.auctions, true),
          enableCaching: true,
          cacheExpiryMs: CONFIG.LIMITS.CACHE_TTL,
          fields: ['status','minPrice','endTime','lastBidTime'] // summary-only payload
        }
      );

      unsubscribeRef.current = unsubscribe;
      
      console.log('✅ OPTIMIZED: Auction data initialized with consolidated listener');

    } catch (error) {
      console.error('🚨 Failed to initialize auction data:', error);
      setState(prev => ({ 
        ...prev, 
        loading: false, 
        error: error.message 
      }));
    }
  }, [user, currentGroup, state.initialized, state.auctions]);

  // OPTIMIZED: Load more auctions using UltraBatchService
  const loadMoreAuctions = useCallback(async () => {
    if (!user || !currentGroup || state.loadingMore || !state.hasNextPage) return;

    try {
      setState(prev => ({ ...prev, loadingMore: true }));
      markUserActivity();
      
      console.log('📄 OPTIMIZED: Loading more auctions with UltraBatchService');
      
      // Get auction IDs for the next page
      const auctionIds = await AuctionService.getAuctionIds(
        currentGroup.id,
        { 
          page: state.currentPage + 1, 
          pageSize: CONFIG.LIMITS.PAGE_SIZE 
        }
      );
      
      if (auctionIds.length === 0) {
        setState(prev => ({ 
          ...prev, 
          loadingMore: false, 
          hasNextPage: false 
        }));
        return;
      }
      
      // Use UltraBatchService to batch fetch auction data
      const auctionData = await UltraBatchService.batchGetDocuments('auctions', auctionIds);
      const newAuctions = Array.from(auctionData.values());
      
      console.log(`📦 OPTIMIZED: Loaded ${newAuctions.length} more auctions in batch`);
      
      setState(prev => ({
        ...prev,
        auctions: [...prev.auctions, ...newAuctions],
        loadingMore: false,
        currentPage: prev.currentPage + 1,
        hasNextPage: newAuctions.length === CONFIG.LIMITS.PAGE_SIZE
      }));
      
      trackDatabaseRead('auction_load_more_batch');
      
    } catch (error) {
      console.error('🚨 Failed to load more auctions:', error);
      setState(prev => ({ 
        ...prev, 
        loadingMore: false, 
        error: error.message 
      }));
    }
  }, [user, currentGroup, state.loadingMore, state.hasNextPage, state.currentPage]);

  // OPTIMIZED: Refresh using GlobalListenerCoordinator
  const refresh = useCallback(async () => {
    if (!user || !currentGroup) return;

    try {
      setState(prev => ({ ...prev, refreshing: true, error: null }));
      markUserActivity();
      
      console.log('🔄 OPTIMIZED: Refreshing auction data');

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
      
      await initializeAuctionData();
      
    } catch (error) {
      console.error('🚨 Refresh failed:', error);
      setState(prev => ({ 
        ...prev, 
        refreshing: false, 
        error: error.message 
      }));
    }
  }, [user, currentGroup, initializeAuctionData]);

  // OPTIMIZED: Update single auction using batch operations
  const updateAuction = useCallback(async (auctionId, updates) => {
    try {
      markUserActivity();
      
      // Optimistic update
      setState(prev => ({
        ...prev,
        auctions: prev.auctions.map(auction => 
          auction.id === auctionId ? { ...auction, ...updates } : auction
        )
      }));
      
      console.log(`🔄 OPTIMIZED: Updating auction ${auctionId}`);
      
      // Use AuctionService for the actual update (it uses Firebase batch operations)
      await AuctionService.updateAuction(auctionId, updates);
      
      // Invalidate relevant caches
      await Promise.allSettled([
        CacheService.invalidate(`auction_${auctionId}`),
        CacheService.invalidate(`group_auctions_${currentGroup.id}`)
      ]);
      
    } catch (error) {
      console.error('🚨 Failed to update auction:', error);
      // Revert optimistic update
      refresh();
    }
  }, [currentGroup, refresh]);

  // OPTIMIZED: Mark activity and update polling interval
  const markActivity = useCallback(() => {
    markUserActivity();
    
    // Update polling interval based on current auctions and activity
    if (unsubscribeRef.current && state.auctions.length > 0) {
      const newInterval = getOptimalPollingInterval(state.auctions, true);
      console.log(`⚡ OPTIMIZED: Updated polling interval to ${newInterval / 1000}s based on activity`);
    }
  }, [state.auctions]);

  // OPTIMIZED: Enhanced bidder count using batch operations
  const getAuctionBidderCount = useCallback(async (auctionId) => {
    try {
      // Use existing smart bidder count service which may use caching
      const count = await getBidderCount(auctionId);
      trackDatabaseRead('bidder_count_check');
      return count;
    } catch (error) {
      console.error(`🚨 Failed to get bidder count for auction ${auctionId}:`, error);
      return 0;
    }
  }, []);

  // Screen-focus controlled initialization
  useFocusEffect(
    React.useCallback(() => {
      if (user && currentGroup && autoRefresh) {
        initializeAuctionData();
      }
      return () => {
        if (unsubscribeRef.current) {
          unsubscribeRef.current();
          unsubscribeRef.current = null;
          setState(prev => ({ ...prev, initialized: false }));
        }
      };
    }, [user, currentGroup, autoRefresh, initializeAuctionData])
  );

  // Handle group changes
  useEffect(() => {
    const handleGroupChange = () => {
      console.log('🔄 OPTIMIZED: Group changed, reinitializing auction data');
      setState(prev => ({ 
        ...prev, 
        initialized: false, 
        auctions: [], 
        currentPage: 0 
      }));
    };

    EventManager.subscribe(GROUP_CREATED_EVENT, handleGroupChange);
    
    return () => {
      EventManager.unsubscribe(GROUP_CREATED_EVENT, handleGroupChange);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        console.log('🧹 OPTIMIZED: Cleaned up auction listener');
      }
      
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
      }
      
      // Log final metrics
      const finalMetrics = {
        sessionReads: sessionReadCount,
        pollingMetrics: pollingMetrics.current
      };
      console.log('📊 OPTIMIZED: useAuctionData cleanup metrics:', finalMetrics);
    };
  }, []);

  return {
    auctions: state.auctions,
    loading: state.loading,
    loadingMore: state.loadingMore,
    refreshing: state.refreshing,
    error: state.error,
    hasNextPage: state.hasNextPage,
    
    // Actions
    refresh,
    loadMoreAuctions,
    updateAuction,
    markActivity,
    getAuctionBidderCount,
    
    // Metrics
    sessionReadCount,
    pollingMetrics: pollingMetrics.current
  };
}; 