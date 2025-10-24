/**
 * useDailyClaims Hook - Supabase Version
 *
 * Handles daily coin claim functionality including:
 * - Checking claim eligibility
 * - Managing claim cooldowns
 * - Processing coin claims
 *
 * Extracted from SocialScreen for better maintainability
 */

import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../config/supabase';
import CacheService from '../services/caching/CacheService';

// UI Constants
const UI_CONSTANTS = {
  DAILY_CLAIM_COINS: 50,
};

/**
 * Custom hook for daily coin claims
 *
 * @param {Object} user - Current user object
 * @param {Object} currentGroup - Currently selected group
 * @param {Function} addCoins - Function to add coins to user balance
 * @returns {Object} Daily claim functions and states
 */
export const useDailyClaims = (user, currentGroup, addCoins) => {
  const [dailyClaimLoading, setDailyClaimLoading] = useState(false);
  const [lastClaimTimes, setLastClaimTimes] = useState({});

  // Check last claim times from Supabase
  const checkLastClaimTimes = useCallback(async () => {
    if (!user?.id) return;

    try {
      const cacheKey = `daily_claims_${user.id}`;

      // Try cache first
      const cached = await CacheService.getValue(cacheKey);
      if (cached) {
        setLastClaimTimes(cached);
        return;
      }

      // Fetch from Supabase user_sessions table
      const { data, error } = await supabase
        .from('user_sessions')
        .select('last_daily_claim')
        .eq('user_id', user.id)
        .single();

      if (error) {
        console.error('Error checking last claim times:', error);
        return;
      }

      const claimTimes = data?.last_daily_claim || {};
      setLastClaimTimes(claimTimes);

      // Cache for 5 minutes
      await CacheService.setValue(cacheKey, claimTimes, { ttl: 5 * 60 * 1000 });
    } catch (error) {
      console.error('Error checking last claim times:', error);
    }
  }, [user]);
  
  const canClaimDailyCoins = useCallback((groupId) => {
    if (!groupId || !lastClaimTimes[groupId]) return true;
    
    const lastClaim = new Date(lastClaimTimes[groupId]);
    const now = new Date();
    const hoursSinceLastClaim = (now - lastClaim) / (1000 * 60 * 60);
    
    return hoursSinceLastClaim >= 24;
  }, [lastClaimTimes]);
  
  const claimDailyCoins = useCallback(async () => {
    if (!user?.id || !currentGroup?.id) {
      Alert.alert('Error', 'You need to select a group first');
      return;
    }

    try {
      setDailyClaimLoading(true);

      if (!canClaimDailyCoins(currentGroup.id)) {
        const lastClaim = new Date(lastClaimTimes[currentGroup.id]);
        const nextClaim = new Date(lastClaim.getTime() + 24 * 60 * 60 * 1000);
        const timeRemaining = nextClaim - new Date();
        const hoursRemaining = Math.ceil(timeRemaining / (1000 * 60 * 60));

        Alert.alert(
          'Already Claimed',
          `You've already claimed your daily coins for this group. You can claim again in ${hoursRemaining} hours.`
        );
        return;
      }

      const success = await addCoins(UI_CONSTANTS.DAILY_CLAIM_COINS);

      if (success) {
        const updatedClaimTimes = {
          ...lastClaimTimes,
          [currentGroup.id]: new Date().toISOString()
        };

        setLastClaimTimes(updatedClaimTimes);

        // Update last_daily_claim in user_sessions table
        const { error: updateError } = await supabase
          .from('user_sessions')
          .update({
            last_daily_claim: updatedClaimTimes,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user.id);

        if (updateError) {
          console.error('Error updating last claim time:', updateError);
        }

        // Invalidate the cache
        await CacheService.invalidate(`daily_claims_${user.id}`);
        await CacheService.invalidate(`unified_user_${user.id}`);

        Alert.alert('Success', `You claimed ${UI_CONSTANTS.DAILY_CLAIM_COINS} coins!`);
      } else {
        Alert.alert('Error', 'Failed to claim daily coins');
      }
    } catch (error) {
      console.error('Error claiming daily coins:', error);
      Alert.alert('Error', 'Something went wrong while claiming coins');
    } finally {
      setDailyClaimLoading(false);
    }
  }, [user, currentGroup, lastClaimTimes, canClaimDailyCoins, addCoins]);

  return {
    dailyClaimLoading,
    lastClaimTimes,
    checkLastClaimTimes,
    canClaimDailyCoins,
    claimDailyCoins
  };
};

export default useDailyClaims;


