/**
 * useBidding Hook - Centralized bidding operations
 * 
 * This hook handles:
 * - Bid placement with validation
 * - Optimistic UI updates
 * - Error handling and recovery
 * - Modal state management
 * - Database read tracking
 */

import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import AuctionService from '../services/AuctionService';
import { getOptimisticRarity } from '../utils/rarityUtils';

// Session read tracking for bidding operations
let biddingReadCount = 0;
const trackBiddingRead = () => {
  biddingReadCount++;
  if (biddingReadCount % 10 === 0) {
    console.log(`📊 useBidding - Session reads: ${biddingReadCount}`);
  }
};

export const useBidding = (onAuctionUpdate) => {
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  
  // Modal state
  const [modal, setModal] = useState({
    visible: false,
    selectedAuction: null,
    bidAmount: ''
  });
  
  // Processing state
  const [processingAction, setProcessingAction] = useState(false);

  /**
   * Open bid modal for specific auction
   */
  const openBidModal = useCallback((auction) => {
    setModal({
      visible: true,
      selectedAuction: auction,
      bidAmount: ''
    });
    
    // Note: markActivity removed from bidding flow as it's handled by consolidated service
  }, [onAuctionUpdate]);

  /**
   * Close bid modal
   */
  const closeBidModal = useCallback(() => {
    setModal({
      visible: false,
      selectedAuction: null,
      bidAmount: ''
    });
  }, []);

  /**
   * Update bid amount in modal
   */
  const setBidAmount = useCallback((amount) => {
    setModal(prev => ({ ...prev, bidAmount: amount }));
  }, []);

  /**
   * Validate bid amount and auction state
   */
  const validateBid = useCallback((auction, amount) => {
    if (!auction || !amount) {
      Alert.alert('Error', 'Invalid auction or bid amount');
      return false;
    }

    const bidValue = parseInt(amount);
    if (isNaN(bidValue) || bidValue <= 0) {
      Alert.alert('Error', 'Please enter a valid bid amount');
      return false;
    }

    // 🚀 FIX: Use original bid data, ignore optimistic updates for validation
    const currentBid = auction._optimistic ? auction._originalCurrentBid || auction.currentBid : auction.currentBid || 0;
    if (bidValue <= currentBid) {
      Alert.alert('Error', `Bid must be higher than ${currentBid} coins`);
      return false;
    }

    if (auction.status !== 'active') {
      Alert.alert('Error', 'This auction is no longer active');
      return false;
    }

    return true;
  }, []);

  /**
   * Place bid with optimistic updates and comprehensive error handling with rollback
   */
  const placeBid = useCallback(async (auction, amount) => {
    if (!validateBid(auction, amount)) {
      return false;
    }

    if (!user || !currentGroup) {
      Alert.alert('Error', 'Please sign in to place a bid');
      return false;
    }

    setProcessingAction(true);
    
    // OPTIMIZATION: Trust current auction data completely - no pre-fetch validation
    // The consolidated bid service ensures data freshness through real-time updates
    console.log(`💰 ULTRA-OPTIMIZED: Placing bid without pre-validation read for auction ${auction.id}`);
    
    // Store original auction state for rollback
    const originalAuctionState = {
      currentBid: auction.currentBid,
      currentBidder: auction.currentBidder,
      currentBidderName: auction.currentBidderName,
      currentRarity: auction.currentRarity,
      uniqueBidderCount: auction.uniqueBidderCount,
      lastBidTime: auction.lastBidTime
    };

    try {
      console.log(`💰 useBidding - Placing bid: ${amount} on auction ${auction.id}`);
      
      // Apply optimistic update first with live rarity calculation
      const isNewBidder = auction.currentBidder !== user.uid;
      const newBidderCount = isNewBidder ? (auction.uniqueBidderCount || 0) + 1 : (auction.uniqueBidderCount || 0);
      
      // Use centralized optimistic rarity calculation
      const optimisticRarity = getOptimisticRarity(
        auction.currentRarity || auction.cardRarity || 'common',
        parseInt(amount),
        newBidderCount
      );
      
      const optimisticUpdate = {
        currentBid: parseInt(amount),
        currentBidder: user.uid,
        currentBidderName: user.displayName || user.username || user.email || 'Unknown User',
        currentRarity: optimisticRarity, // Now includes optimistic rarity calculation
        uniqueBidderCount: newBidderCount,
        lastBidTime: new Date(),
        _optimistic: true, // Flag to identify optimistic updates
        _originalCurrentBid: auction.currentBid || 0 // 🚀 FIX: Store original bid for validation
      };
      
      // Apply optimistic update through callback
      if (onAuctionUpdate?.updateAuction) {
        onAuctionUpdate.updateAuction(auction.id, optimisticUpdate);
      }
      
      // Note: Activity marking handled by consolidated bid service
      
      // Make the actual bid request
      const result = await AuctionService.placeBid(
        auction.id,
        amount,
        user.uid,
        user.displayName || user.email,
        currentGroup.id
      );
      
      trackBiddingRead();
      
      // Apply real server response (removes _optimistic flag)
      const serverUpdate = {
        currentBid: result.newBid,
        currentBidder: user.uid,
        currentBidderName: user.displayName || user.username || user.email || 'Unknown User',
        currentRarity: result.newRarity,
        uniqueBidderCount: result.bidderCount,
        lastBidTime: new Date(),
        _optimistic: false
      };
      
      // Update with server response
      if (onAuctionUpdate?.updateAuction) {
        onAuctionUpdate.updateAuction(auction.id, serverUpdate);
      }
      
      console.log(`✅ useBidding - Bid placed successfully, server confirmed`);
      
      // Close modal on success
      closeBidModal();
      
      return true;
      
    } catch (error) {
      console.error('❌ useBidding - Error placing bid:', error);
      trackBiddingRead();
      
      // ROLLBACK: Restore original auction state
      console.log('🔄 useBidding - Rolling back optimistic update');
      if (onAuctionUpdate?.updateAuction) {
        onAuctionUpdate.updateAuction(auction.id, {
          ...originalAuctionState,
          _optimistic: false,
          _rollback: true // Flag to indicate this is a rollback
        });
      }
      
      // Note: Error recovery handled by consolidated service, no manual refresh needed
      
      // Enhanced error handling with specific error types
      let errorMessage = 'Failed to place bid. Please try again.';
      
      if (error.message?.includes('insufficient')) {
        errorMessage = 'Insufficient coins to place this bid.';
      } else if (error.message?.includes('Bid must be higher than current bid')) {
        errorMessage = 'Someone else just placed a bid. Please refresh and try a higher amount.';
      } else if (error.message?.includes('outbid')) {
        errorMessage = 'You have been outbid. Please try a higher amount.';
      } else if (error.message?.includes('ended')) {
        errorMessage = 'This auction has ended.';
      } else if (error.message?.includes('network')) {
        errorMessage = 'Network error. Please check your connection.';
      }
      
      // Show user-friendly error message
      Alert.alert('Bid Failed', errorMessage);
      
      return false;
    } finally {
      setProcessingAction(false);
    }
  }, [user, currentGroup, validateBid, onAuctionUpdate, closeBidModal]);

  /**
   * Quick bid with predefined amounts
   */
  const quickBid = useCallback(async (auction, increment = 10) => {
    const currentBid = auction.currentBid || 0;
    const newBidAmount = (currentBid + increment).toString();
    
    return await placeBid(auction, newBidAmount);
  }, [placeBid]);

  /**
   * Get suggested bid amount
   */
  const getSuggestedBid = useCallback((auction) => {
    const currentBid = auction.currentBid || 0;
    const increment = Math.max(10, Math.ceil(currentBid * 0.1)); // 10% or minimum 10
    return currentBid + increment;
  }, []);

  /**
   * Check if user can bid on auction
   */
  const canBid = useCallback((auction) => {
    if (!auction || !user) return false;
    
    // REMOVED: Allow users to bid on their own auctions
    // if (auction.sellerId === user.uid) return false;
    
    // Check if auction is active
    if (auction.status !== 'active') return false;
    
    // Check if auction has ended
    const endTime = auction.endTime?.toDate?.() || new Date(auction.endTime?.seconds * 1000);
    if (endTime && endTime <= new Date()) return false;
    
    return true;
  }, [user]);

  /**
   * Get user's bid status for auction
   */
  const getBidStatus = useCallback((auction) => {
    if (!auction || !user) return 'none';
    
    if (auction.currentBidder === user.uid) return 'winning';
    if (auction.sellerId === user.uid) return 'owner';
    
    return 'can_bid';
  }, [user]);

  return {
    // Modal state
    modal,
    processingAction,
    
    // Modal actions
    openBidModal,
    closeBidModal,
    setBidAmount,
    
    // Bidding actions
    placeBid,
    quickBid,
    
    // Utility functions
    getSuggestedBid,
    canBid,
    getBidStatus,
    
    // Stats
    biddingReadCount
  };
}; 