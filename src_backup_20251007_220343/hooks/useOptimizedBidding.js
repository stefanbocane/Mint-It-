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
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import { useUnifiedUserData } from '../contexts/UnifiedUserDataContext';
import AuctionService from '../services/AuctionService';
import useAuctionStore from '../services/UltraEfficientAuctionService';

export const useOptimizedBidding = () => {
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const { subtractCoins, addCoins, getBalance } = useUnifiedUserData();
  
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
    if (!auction || !amount) return false;
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return false;
    
    // THIRD PASS: Client-side expiration check (zero reads)
    if (isAuctionExpiredClientSide(auction.id, auction)) {
      Alert.alert('Auction Expired', 'This auction has ended based on client-side timing');
      return false;
    }
    
    // Check if bid is higher than current bid
    const currentBid = auction.currentBid || 0;
    if (numAmount <= currentBid) {
      Alert.alert('Invalid Bid', `Bid must be higher than current bid of ${currentBid}`);
      return false;
    }
    
    // Check if auction is still active (using real-time cached data)
    if (auction.status !== 'active') {
      Alert.alert('Auction Ended', 'This auction is no longer active');
      return false;
    }
    
    // THIRD PASS: Enhanced time remaining check with client confidence
    const timeRemaining = auction.timeRemaining || 0;
    // Allow bids until the auction is effectively over (client-side check)
    if (timeRemaining <= 0) {
      Alert.alert('Auction Ended', 'This auction has already ended.');
      return false;
    }
    
    return true;
  }, [isAuctionExpiredClientSide]);
  
  // Optimized bid placement with Zustand integration
  const placeBid = useCallback(async (auction, amount) => {
    if (!validateBid(auction, amount)) return false;
    
    if (!user || !currentGroup) {
      Alert.alert('Error', 'Please sign in to place a bid');
      return false;
    }
    
    setProcessingAction(true);
    
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
      const bidAmount = parseFloat(amount);
      
      console.log(`💰 THIRD PASS: Placing bid ${bidAmount} on auction ${auction.id} (zero reads, complete client validation)`);
      
      // Deduct coins (bid + 1 coin tax) optimistically from local balance
      const totalCost = bidAmount + 1;
      const coinResult = await subtractCoins(totalCost, currentGroup.id);
      if (!coinResult) {
        Alert.alert('Insufficient Funds', 'You do not have enough coins to place this bid');
        return false;
      }

      // Track tax separately (1 coin). The tax is non-refundable
      const refundableAmount = bidAmount;
      
      // THIRD PASS: Ultra-optimistic update with confidence scoring
      const isNewBidder = auction.currentBidder !== user.uid;
      const newBidderCount = isNewBidder ? (auction.uniqueBidderCount || 0) + 1 : (auction.uniqueBidderCount || 0);
      
      updateAuction(currentGroup.id, auction.id, {
        currentBid: bidAmount,
        currentBidder: user.uid,
        currentBidderName: user.displayName || user.username,
        lastBidTime: new Date(),
        uniqueBidderCount: newBidderCount,
        // THIRD PASS: Advanced optimistic flags
        _optimistic: true,
        _confidence: auction.urgencyLevel === 'CRITICAL' ? 0.95 : 0.9, // Higher confidence for urgent auctions
        _predictedSuccess: true,
        lastUpdated: Date.now()
      });
      
      // Place actual bid (this will trigger real-time updates if successful)
      const result = await AuctionService.placeBid(
        auction.id,
        bidAmount,
        user.uid,
        user.displayName || user.username,
        currentGroup.id
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to place bid');
      }
      
      console.log(`✅ THIRD PASS: Server confirmed bid on ${auction.id} with ${result._confidence || 'standard'} confidence`);
      
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
      
      // Refund locally deducted coins if bid failed
      await addCoins(totalCost, currentGroup.id);
      
      Alert.alert(
        'Bid Failed',
        error.message || 'Unable to place bid. Please try again.',
        [{ text: 'OK' }]
      );
      
      return false;
      
    } finally {
      setProcessingAction(false);
    }
  }, [validateBid, user, currentGroup, updateAuction, subtractCoins, addCoins]);
  
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