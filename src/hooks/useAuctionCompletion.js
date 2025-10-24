/**
 * Hook for handling auction completion events and automatic collection updates
 * 
 * Provides real-time notifications when auctions complete and ensures
 * the user's collection is immediately updated with correct rarities.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import AuctionCompletionService from '../services/AuctionCompletionService';

export const useAuctionCompletion = (options = {}) => {
  const { 
    autoRefreshCollection = true,
    notifyOnCompletion = true 
  } = options;

  const [recentCompletions, setRecentCompletions] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const { user } = useAuth();
  const { currentGroup } = useGroup();

  // Track completion notifications to avoid duplicates
  const notificationsSent = useRef(new Set());

  /**
   * Add a completion notification
   */
  const addCompletionNotification = useCallback((auctionData) => {
    const notificationKey = `${auctionData.id}_${auctionData.status}`;
    
    if (notificationsSent.current.has(notificationKey)) {
      return; // Already notified about this completion
    }

    notificationsSent.current.add(notificationKey);
    
    setRecentCompletions(prev => {
      const newCompletion = {
        ...auctionData,
        completionTime: new Date(),
        notificationKey
      };
      
      // Keep only the last 10 completions
      const updated = [newCompletion, ...prev].slice(0, 10);
      return updated;
    });

    if (notifyOnCompletion) {
      console.log(`🎯 Auction completion notification: ${auctionData.id} - ${auctionData.status}`);
    }
  }, [notifyOnCompletion]);

  /**
   * Force refresh the user's collection
   */
  const forceCollectionRefresh = useCallback(async () => {
    if (!user?.uid || !currentGroup?.id) {
      console.warn('useAuctionCompletion: Cannot refresh collection without user and group');
      return false;
    }

    try {
      setIsProcessing(true);
      await AuctionCompletionService.forceCollectionRefresh(user.uid, currentGroup.id);
      console.log('🔄 Collection refresh triggered successfully');
      return true;
    } catch (error) {
      console.error('❌ Error forcing collection refresh:', error);
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [user?.uid, currentGroup?.id]);

  /**
   * Clear completion notifications
   */
  const clearNotifications = useCallback(() => {
    setRecentCompletions([]);
    notificationsSent.current.clear();
  }, []);

  /**
   * Check if auction completion service is active
   */
  const isServiceActive = useCallback(() => {
    return AuctionCompletionService.isInitialized();
  }, []);

  /**
   * Get recent completions for a specific time period
   */
  const getRecentCompletions = useCallback((minutesAgo = 5) => {
    const cutoffTime = new Date(Date.now() - minutesAgo * 60 * 1000);
    
    return recentCompletions.filter(completion => 
      completion.completionTime >= cutoffTime
    );
  }, [recentCompletions]);

  /**
   * Check if user won any recent auctions
   */
  const hasRecentWins = useCallback((minutesAgo = 5) => {
    const recent = getRecentCompletions(minutesAgo);
    return recent.some(completion => 
      completion.status === 'completed' && 
      completion.winnerUserId === user?.uid
    );
  }, [getRecentCompletions, user?.uid]);

  /**
   * Get recent wins for the current user
   */
  const getRecentWins = useCallback((minutesAgo = 5) => {
    const recent = getRecentCompletions(minutesAgo);
    return recent.filter(completion => 
      completion.status === 'completed' && 
      completion.winnerUserId === user?.uid
    );
  }, [getRecentCompletions, user?.uid]);

  // Initialize or cleanup service based on user and group availability
  useEffect(() => {
    if (user?.uid && currentGroup?.id) {
      if (!AuctionCompletionService.isInitialized()) {
        console.log('🎯 useAuctionCompletion: Initializing service');
        AuctionCompletionService.initialize(user.uid, currentGroup.id);
      }
    }

    return () => {
      // Don't cleanup here since the service might be used by other components
      // The UnifiedUserDataProvider handles cleanup
    };
  }, [user?.uid, currentGroup?.id]);

  // Cleanup notifications after 30 minutes
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      
      setRecentCompletions(prev => 
        prev.filter(completion => completion.completionTime >= thirtyMinutesAgo)
      );

      // Also cleanup the notification tracking set
      const recentKeys = recentCompletions
        .filter(completion => completion.completionTime >= thirtyMinutesAgo)
        .map(completion => completion.notificationKey);
      
      const newNotificationSet = new Set();
      recentKeys.forEach(key => newNotificationSet.add(key));
      notificationsSent.current = newNotificationSet;
      
    }, 5 * 60 * 1000); // Check every 5 minutes

    return () => clearInterval(cleanupInterval);
  }, [recentCompletions]);

  return {
    // State
    recentCompletions,
    isProcessing,
    isServiceActive: isServiceActive(),

    // Actions
    addCompletionNotification,
    forceCollectionRefresh,
    clearNotifications,

    // Queries
    getRecentCompletions,
    hasRecentWins,
    getRecentWins,

    // Computed values
    totalRecentCompletions: recentCompletions.length,
    hasRecentActivity: recentCompletions.length > 0,
    lastCompletionTime: recentCompletions[0]?.completionTime || null,

    // Service status
    isEnabled: !!(user?.uid && currentGroup?.id),
    userId: user?.uid,
    groupId: currentGroup?.id
  };
};

export default useAuctionCompletion; 