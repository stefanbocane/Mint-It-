/**
 * Ultra-Simple Auction Data Hook - Third Pass
 * 
 * ULTRA-SIMPLE: Minimal implementation that just works
 * - Module-level caching to survive component unmounts
 * - No read limits
 * - Direct Firestore queries
 * - Guaranteed reliability
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import AuctionService from '../services/AuctionServiceSupabase';

// Module-level cache (survives component unmounts)
const MODULE_AUCTION_CACHE = new Map();
const MODULE_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

export const useUltraSimpleAuctionData = () => {
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  
  const [state, setState] = useState({
    auctions: [],
    loading: true,
    refreshing: false,
    error: null
  });

  // Ultra-simple fetch with module-level caching
  const fetchAuctions = useCallback(async (forceRefresh = false) => {
    if (!user || !currentGroup) return;

    const cacheKey = currentGroup?.id ? `auctions_${currentGroup.id}` : null;
    if (!cacheKey) {
      console.warn('⚠️ Cannot cache auctions: currentGroup.id is missing');
      return;
    }

    // Check module cache FIRST (unless forcing refresh)
    if (!forceRefresh && MODULE_AUCTION_CACHE.has(cacheKey)) {
      const cached = MODULE_AUCTION_CACHE.get(cacheKey);
      if (Date.now() - cached.timestamp < MODULE_CACHE_TTL) {
        console.log(`📦 Using module-level auction cache (${cached.data.length} auctions)`);
        setState(prev => ({
          ...prev,
          auctions: cached.data,
          loading: false,
          refreshing: false,
          error: null
        }));
        return;
      } else {
        // Cache expired
        MODULE_AUCTION_CACHE.delete(cacheKey);
      }
    }

    try {
      console.log('🚀 THIRD PASS: Ultra-simple auction fetch');
      
      const auctionsData = await AuctionService.getActiveAuctions(currentGroup.id, {
        limit: 50 // Get more items in single call
      });
      
      // Update module cache
      MODULE_AUCTION_CACHE.set(cacheKey, {
        data: auctionsData,
        timestamp: Date.now()
      });
      
      setState(prev => ({
        ...prev,
        auctions: auctionsData,
        loading: false,
        refreshing: false,
        error: null
      }));
      
      console.log(`✅ THIRD PASS: Fetched ${auctionsData.length} auctions (cached for ${MODULE_CACHE_TTL/1000}s)`);
      
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

  // Initialize - check cache before fetching
  useEffect(() => {
    if (!user || !currentGroup) return;

    // Check cache first before fetching
    const cacheKey = currentGroup?.id ? `auctions_${currentGroup.id}` : null;
    if (cacheKey && MODULE_AUCTION_CACHE.has(cacheKey)) {
      const cached = MODULE_AUCTION_CACHE.get(cacheKey);
      if (Date.now() - cached.timestamp < MODULE_CACHE_TTL) {
        console.log(`📦 [useEffect] Using cached auctions on mount (${cached.data.length} auctions)`);
        setState(prev => ({
          ...prev,
          auctions: cached.data,
          loading: false
        }));
        return; // Don't call fetchAuctions
      }
    }
    
    fetchAuctions();
  }, [user, currentGroup, fetchAuctions]);

  // Refresh (force refresh bypasses cache)
  const refresh = useCallback(async () => {
    setState(prev => ({ ...prev, refreshing: true }));
    await fetchAuctions(true); // Force refresh
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