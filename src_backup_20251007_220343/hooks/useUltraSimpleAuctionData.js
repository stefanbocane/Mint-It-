/**
 * Ultra-Simple Auction Data Hook - Third Pass
 * 
 * ULTRA-SIMPLE: Minimal implementation that just works
 * - No complex caching
 * - No read limits
 * - Direct Firestore queries
 * - Guaranteed reliability
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import AuctionService from '../services/AuctionService';

export const useUltraSimpleAuctionData = () => {
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  
  const [state, setState] = useState({
    auctions: [],
    loading: true,
    refreshing: false,
    error: null
  });

  // Ultra-simple fetch
  const fetchAuctions = useCallback(async () => {
    if (!user || !currentGroup) return;

    try {
      console.log('🚀 THIRD PASS: Ultra-simple auction fetch');
      
      const auctionsData = await AuctionService.getActiveAuctions(currentGroup.id, {
        limit: 50 // Get more items in single call
      });
      
      setState(prev => ({
        ...prev,
        auctions: auctionsData,
        loading: false,
        refreshing: false,
        error: null
      }));
      
      console.log(`✅ THIRD PASS: Fetched ${auctionsData.length} auctions`);
      
    } catch (error) {
      console.error('🚨 Ultra-simple fetch failed:', error);
      setState(prev => ({ 
        ...prev, 
        loading: false,
        refreshing: false,
        error: error.message 
      }));
    }
  }, [user, currentGroup]);

  // Initialize
  useEffect(() => {
    fetchAuctions();
  }, [fetchAuctions]);

  // Refresh
  const refresh = useCallback(async () => {
    setState(prev => ({ ...prev, refreshing: true }));
    await fetchAuctions();
  }, [fetchAuctions]);

  // Update single auction
  const updateAuction = useCallback((auctionId, updates) => {
    setState(prev => ({
      ...prev,
      auctions: prev.auctions.map(auction => 
        auction.id === auctionId 
          ? { ...auction, ...updates }
          : auction
      )
    }));
  }, []);

  return {
    auctions: state.auctions,
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
    
    // Actions
    refresh,
    updateAuction
  };
}; 