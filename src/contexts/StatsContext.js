import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContextSupabase';
import StatsService from '../services/StatsService';

const StatsContext = createContext();

export const useStats = () => {
  const context = useContext(StatsContext);
  if (!context) {
    throw new Error('useStats must be used within a StatsProvider');
  }
  return context;
};

export const StatsProvider = ({ children }) => {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadStats = useCallback(async () => {
    if (!user?.uid) return;
    
    try {
      setLoading(true);
      const userStats = await StatsService.getUserStats(user.uid);
      setStats(userStats);
      setError(null);
    } catch (err) {
      console.error('Failed to load stats:', err);
      setError('Failed to load statistics');
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  // Load stats when component mounts or user changes
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Function to refresh stats
  const refreshStats = useCallback(() => {
    return loadStats();
  }, [loadStats]);

  // Wrapper functions that refresh stats after recording
  const recordTradeComplete = useCallback(async (userId, tradeData) => {
    try {
      await StatsService.recordTradeComplete(userId, tradeData);
      await refreshStats();
      return true;
    } catch (error) {
      console.error('Error in recordTradeComplete:', error);
      return false;
    }
  }, [refreshStats]);

  const recordAuctionWin = useCallback(async (userId, auctionData) => {
    try {
      await StatsService.recordAuctionWin(userId, auctionData);
      await refreshStats();
      return true;
    } catch (error) {
      console.error('Error in recordAuctionWin:', error);
      return false;
    }
  }, [refreshStats]);

  const recordAuctionRarity = useCallback(async (userId, auctionData) => {
    try {
      await StatsService.recordAuctionRarity(userId, auctionData);
      await refreshStats();
      return true;
    } catch (error) {
      console.error('Error in recordAuctionRarity:', error);
      return false;
    }
  }, [refreshStats]);

  const value = {
    stats,
    loading,
    error,
    refreshStats,
    recordTradeComplete,
    recordAuctionWin,
    recordAuctionRarity
  };

  return (
    <StatsContext.Provider value={value}>
      {children}
    </StatsContext.Provider>
  );
};

export default StatsContext;
