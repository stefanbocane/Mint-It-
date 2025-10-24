/**
 * Ultra Efficient Auction Service - Stub
 * 
 * This service has been replaced by useUltraSimpleAuctionData hook.
 * This stub exists for backward compatibility with existing imports.
 */

import { useEffect, useState } from 'react';

// Default state
const defaultState = {
  auctions: [],
  sessionMetrics: {
    totalReads: 0,
    cacheHits: 0,
    listenerUpdates: 0,
    optimizationScore: 100
  },
  groupListeners: new Map(),
  cachedUsers: new Map(),
  
  // Helper functions
  updateAuction: (auctionId, updates) => {
    const index = globalState.auctions.findIndex(a => a.id === auctionId);
    if (index !== -1) {
      const newAuctions = [...globalState.auctions];
      newAuctions[index] = { ...newAuctions[index], ...updates };
      useAuctionStore.setState({ auctions: newAuctions });
    }
  },
  
  getCachedUser: (userId) => {
    return globalState.cachedUsers.get(userId) || null;
  },
  
  isAuctionExpiredClientSide: (auctionId, auction) => {
    if (!auction) {
      auction = globalState.auctions.find(a => a.id === auctionId);
    }
    
    // If auction not found, consider it expired
    if (!auction) {
      console.warn(`[isAuctionExpiredClientSide] Auction ${auctionId} not found`);
      return true;
    }
    
    // Check status first
    if (auction.status && auction.status !== 'active') {
      return true;
    }
    
    // Use timeRemaining if available (more accurate than endTime calculation)
    if (auction.hasOwnProperty('timeRemaining')) {
      return auction.timeRemaining <= 0;
    }
    
    // Fallback to endTime calculation
    try {
      const endTime = auction.endTime?.toDate ? auction.endTime.toDate() : new Date(auction.endTime);
      const now = new Date();
      return endTime <= now;
    } catch (error) {
      console.error('[isAuctionExpiredClientSide] Error checking expiration:', error);
      return true; // Err on side of caution
    }
  }
};

// Global state
let globalState = { ...defaultState };
const listeners = new Set();

// Notify all listeners
const notifyListeners = () => {
  listeners.forEach(listener => listener(globalState));
};

// Store API compatible with Zustand
const useAuctionStore = (selector) => {
  const [state, setState] = useState(() => 
    selector ? selector(globalState) : globalState
  );
  
  useEffect(() => {
    const listener = (newState) => {
      const selected = selector ? selector(newState) : newState;
      setState(selected);
    };
    
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, [selector]);
  
  return state;
};

// Store methods
useAuctionStore.getState = () => globalState;

useAuctionStore.setState = (newState) => {
  if (typeof newState === 'function') {
    globalState = { ...globalState, ...newState(globalState) };
  } else {
    globalState = { ...globalState, ...newState };
  }
  notifyListeners();
};

useAuctionStore.subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

useAuctionStore.reset = () => {
  globalState = { ...defaultState };
  notifyListeners();
};

// Export as default for backward compatibility
export default useAuctionStore;
export { useAuctionStore };

