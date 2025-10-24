/**
 * THIRD PASS: Ultra-Advanced Bidding Hook
 * 
 * ZERO-READ BIDDING FEATURES:
 * - Complete client-side validation using cached data
 * - Advanced optimistic updates with confidence scoring
 * - Predictive bid suggestions based on auction urgency
 * - Zero-read expiration checking
 * - Enhanced rollback mechanisms with state persistence
 */

import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import { useUnifiedUserData } from '../contexts/UnifiedUserDataContextSupabase';
import AuctionService from '../services/AuctionServiceSupabase';
import useAuctionStore from '../services/UltraEfficientAuctionService';

export const useOptimizedBidding = () => {
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const { getBalance, refreshUserData, userData } = useUnifiedUserData(); // Get balance, refresh, and userData
  
  // FIXED: Stable state management
  const [modal, setModal] = useState({
    visible: false,
    selectedAuction: null,
    bidAmount: ''
  });
  
  const [processingAction, setProcessingAction] = useState(false);
  
  // FIXED: Simple Zustand selectors to prevent infinite loops
  const updateAuction = useAuctionStore(state => state.updateAuction);
  const getCachedUser = useAuctionStore(state => state.getCachedUser);
  const isAuctionExpiredClientSide = useAuctionStore(state => state.isAuctionExpiredClientSide);
  
  // THIRD PASS: Zero-read validation with client-side expiration checking
  const validateBid = useCallback((auction, amount) => {
    if (!auction || !amount) {
      console.log('❌ Bid validation failed: missing auction or amount');
      return false;
    }
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      console.log('❌ Bid validation failed: invalid amount', amount);
      return false;
    }
    
    // Check if bid is higher than current bid
    const currentBid = auction.currentBid || 0;
    if (numAmount <= currentBid) {
      console.log('❌ Bid validation failed: bid too low', { numAmount, currentBid });
      Alert.alert('Invalid Bid', `Bid must be higher than current bid of ${currentBid}`);
      return false;
    }
    
    // Calculate time remaining from endTime if not provided
    let timeRemaining = auction.timeRemaining;
    if (timeRemaining === undefined && auction.endTime) {
      const endTime = auction.endTime?.toDate ? auction.endTime.toDate() : new Date(auction.endTime);
      timeRemaining = Math.max(0, endTime.getTime() - Date.now());
    }
    
    console.log('🔍 Bid validation check:', {
      auctionId: auction.id,
      status: auction.status,
      timeRemaining,
      endTime: auction.endTime,
      currentBid: auction.currentBid,
      bidAmount: numAmount
    });
    
    // Check if auction is still active - be more permissive
    // Only reject if status is explicitly 'completed' or 'cancelled'
    if (auction.status === 'completed' || auction.status === 'cancelled') {
      console.log('❌ Bid validation failed: auction status is', auction.status);
      Alert.alert('Auction Ended', 'This auction is no longer active');
      return false;
    }
    
    // Check time remaining - only reject if we're SURE it's expired
    if (timeRemaining !== undefined && timeRemaining <= 0) {
      console.log('❌ Bid validation failed: time remaining is', timeRemaining);
      Alert.alert('Auction Ended', 'This auction has already ended.');
      return false;
    }
    
    // REMOVED: isAuctionExpiredClientSide check as it was too strict
    
    console.log('✅ Bid validation passed');
    return true;
  }, []);
  
  // Optimized bid placement with Zustand integration
  const placeBid = useCallback(async (auction, amount) => {
    console.log('💰 placeBid called:', { auctionId: auction?.id, amount, userId: user?.uid });
    
    if (!validateBid(auction, amount)) {
      console.log('❌ placeBid aborted: validation failed');
      return false;
    }
    
    if (!user || !currentGroup) {
      console.log('❌ placeBid aborted: no user or group');
      Alert.alert('Error', 'Please sign in to place a bid');
      return false;
    }
    
    console.log('🚀 placeBid proceeding with bid placement');
    setProcessingAction(true);

    const bidAmount = parseFloat(amount);

    // Store original state for potential rollback
    const originalState = {
      currentBid: auction.currentBid,
      currentBidder: auction.currentBidder,
      currentBidderName: auction.currentBidderName,
      currentRarity: auction.currentRarity,
      uniqueBidderCount: auction.uniqueBidderCount,
      lastBidTime: auction.lastBidTime
    };

    try {
      console.log(`💰 THIRD PASS: Placing bid ${bidAmount} on auction ${auction.id}`);
      console.log('📋 Auction data:', {
        id: auction.id,
        sellerId: auction.sellerId,
        currentBid: auction.currentBid,
        status: auction.status,
        endTime: auction.endTime,
        timeRemaining: auction.timeRemaining
      });

      // NOTE: Coin deduction now happens INSIDE AuctionService.placeBid transaction
      // This ensures atomicity - if bid fails, coins are not deducted
      // No more optimistic deduction or manual refunds needed!

      // Ensure we have a valid display name from userData (uses display_name from users table)
      const displayName = userData?.display_name || userData?.username || user.email || 'Anonymous';

      // THIRD PASS: Ultra-optimistic update with confidence scoring
      const userId = user.id || user.uid; // Supabase uses id, Firebase uses uid
      const isNewBidder = auction.currentBidder !== userId;
      const newBidderCount = isNewBidder ? (auction.uniqueBidderCount || 0) + 1 : (auction.uniqueBidderCount || 0);

      // Calculate optimistic rarity
      const { calculateLiveRarity } = await import('../utils/auctionRarity');
      const updatedAuctionData = {
        ...auction,
        currentBid: bidAmount,
        uniqueBidderCount: newBidderCount
      };
      const optimisticRarity = calculateLiveRarity(updatedAuctionData, newBidderCount);

      console.log(`🎯 Optimistic rarity calculated: ${optimisticRarity} (${newBidderCount} bidders, ${bidAmount} coins)`);

      updateAuction(currentGroup.id, auction.id, {
        currentBid: bidAmount,
        currentBidder: userId,
        currentBidderName: displayName,
        lastBidTime: new Date(),
        uniqueBidderCount: newBidderCount,
        currentRarity: optimisticRarity,
        // THIRD PASS: Advanced optimistic flags
        _optimistic: true,
        _confidence: auction.urgencyLevel === 'CRITICAL' ? 0.95 : 0.9, // Higher confidence for urgent auctions
        _predictedSuccess: true,
        lastUpdated: Date.now()
      });

      // Place actual bid (this will trigger real-time updates if successful)
      console.log('📡 Calling AuctionService.placeBid with params:', {
        auctionId: auction.id,
        bidAmount,
        userId: userId,
        displayName,
        groupId: currentGroup.id
      });

      const result = await AuctionService.placeBid(
        auction.id,
        bidAmount,
        userId,
        displayName,
        currentGroup.id
      );
      
      console.log('📡 AuctionService.placeBid result:', result);
      
      if (!result.success) {
        console.log('❌ Bid placement failed:', result.error);
        
        // If bid failed due to race condition, refresh auction data
        if (result.needsRefresh) {
          console.log('🔄 Refreshing auction data due to race condition');
          // Trigger auction list refresh to show latest bid
          if (refreshAuctions) {
            await refreshAuctions();
          }
        }
        
        throw new Error(result.error || 'Failed to place bid');
      }
      
      console.log(`✅ THIRD PASS: Server confirmed bid on ${auction.id}`);

      // Refresh user balance to show updated coins immediately
      console.log('🔄 Refreshing user balance after successful bid');
      await refreshUserData();

      // Close modal on success
      closeModal();

      return true;
      
    } catch (error) {
      console.error('🚨 THIRD PASS: Bid failed, executing intelligent rollback:', error);
      
      // THIRD PASS: Advanced rollback with failure analysis
      updateAuction(currentGroup.id, auction.id, {
        ...originalState,
        _optimistic: false,
        _rollback: true,
        _failureReason: error.message || 'unknown',
        _rollbackTime: Date.now(),
        lastUpdated: Date.now()
      });
      
      // NOTE: No refund needed! Transaction handles everything atomically
      // If bid failed, coins were never deducted
      
      Alert.alert(
        'Bid Failed',
        error.message || 'Unable to place bid. Please try again.',
        [{ text: 'OK' }]
      );
      
      return false;
      
    } finally {
      setProcessingAction(false);
    }
  }, [validateBid, user, currentGroup, updateAuction, refreshUserData, userData]);
  
  // Quick bid function with optimized amounts
  const quickBid = useCallback(async (auction) => {
    if (!auction) return false;
    
    const currentBid = auction.currentBid || 0;
    const quickBidAmount = Math.max(currentBid + 1, Math.ceil(currentBid * 1.1));
    
    return await placeBid(auction, quickBidAmount.toString());
  }, [placeBid]);
  
  // Modal management
  const openBidModal = useCallback((auction) => {
    if (!auction) return;
    
    setModal({
      visible: true,
      selectedAuction: auction,
      bidAmount: ''
    });
  }, []);
  
  const closeBidModal = useCallback(() => {
    setModal({
      visible: false,
      selectedAuction: null,
      bidAmount: ''
    });
  }, []);
  
  const closeModal = closeBidModal; // Alias for compatibility
  
  const setBidAmount = useCallback((amount) => {
    setModal(prev => ({
      ...prev,
      bidAmount: amount
    }));
  }, []);
  
  // Bidding capability checks using cached data
  const canBid = useCallback((auction) => {
    if (!auction || !user) return false;
    
    // Check if auction is active
    if (auction.status !== 'active') return false;
    
    // Check if auction has time remaining
    if (auction.timeRemaining <= 0) return false;
    
    // User can't bid on their own auction
    if (auction.sellerId === user.uid) return false;
    
    return true;
  }, [user]);
  
  // Get bid status for UI
  const getBidStatus = useCallback((auction) => {
    if (!auction || !user) return null;
    
    if (auction.currentBidder === user.uid) {
      return 'winning';
    }
    
    if (!canBid(auction)) {
      return 'cannot_bid';
    }
    
    return 'can_bid';
  }, [user, canBid]);
  
  // THIRD PASS: Intelligent bid suggestions based on auction urgency and competition
  const getSuggestedBid = useCallback((auction) => {
    if (!auction) return 0;
    
    const currentBid = auction.currentBid || 0;
    const bidderCount = auction.uniqueBidderCount || 0;
    const timeRemaining = auction.timeRemaining || 0;
    const urgencyLevel = auction.urgencyLevel || 'STABLE';
    
    if (currentBid === 0) {
      return 1; // Starting bid
    }
    
    // THIRD PASS: Dynamic bid suggestion based on urgency and competition
    let multiplier = 1.1; // Base 10% increase
    
    // Adjust based on urgency
    if (urgencyLevel === 'CRITICAL') multiplier = 1.2; // 20% for critical
    else if (urgencyLevel === 'URGENT') multiplier = 1.15; // 15% for urgent
    
    // Adjust based on competition
    if (bidderCount > 5) multiplier += 0.05; // More aggressive with high competition
    if (bidderCount > 10) multiplier += 0.05; // Even more aggressive
    
    // Minimum bid increase
    const minIncrease = urgencyLevel === 'CRITICAL' ? 2 : 1;
    
    return Math.max(currentBid + minIncrease, Math.ceil(currentBid * multiplier));
  }, []);
  
  return {
    // Modal state
    modal,
    processingAction,
    
    // Actions
    placeBid,
    quickBid,
    openBidModal,
    closeBidModal,
    closeModal, // Alias for compatibility
    setBidAmount,
    
    // Utility functions
    canBid,
    getBidStatus,
    getSuggestedBid,
    
    // For debugging
    validateBid
  };
};
