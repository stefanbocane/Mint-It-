import { deleteField, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { updateGems } from './gemOperations';

// Achievement types
export const ACHIEVEMENT_TYPES = {
  FIRST_COIN: 'first_coin',
  FIRST_AUCTION_WIN: 'first_auction_win',
  FIRST_TRADE: 'first_trade'
};

// Achievement rewards (in gems)
const ACHIEVEMENT_REWARDS = {
  [ACHIEVEMENT_TYPES.FIRST_COIN]: 1,
  [ACHIEVEMENT_TYPES.FIRST_AUCTION_WIN]: 1,
  [ACHIEVEMENT_TYPES.FIRST_TRADE]: 1
};

/**
 * Check if a timestamp is from today
 */
const isToday = (timestamp) => {
  if (!timestamp) return false;
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const today = new Date();
  return date.getDate() === today.getDate() &&
         date.getMonth() === today.getMonth() &&
         date.getFullYear() === today.getFullYear();
};

/**
 * Get today's date string in YYYY-MM-DD format
 */
const getTodayDateString = () => {
  const today = new Date();
  return today.getFullYear() + '-' + 
         String(today.getMonth() + 1).padStart(2, '0') + '-' + 
         String(today.getDate()).padStart(2, '0');
};

/**
 * Get the user's daily achievements
 * @param {string} userId - The ID of the user
 * @returns {Promise<{completed: Object, availableToClaim: Array, claimed: Array}>}
 */
export const getDailyAchievements = async (userId) => {
  try {
    console.log(`🔍 Fetching daily achievements for user: ${userId}`);
    
    // Use GlobalUserProfileCache instead of direct fetch
    const GlobalUserProfileCache = require('../services/GlobalUserProfileCache').default;
    const userData = await GlobalUserProfileCache.getProfile(userId);
    
    if (!userData) {
      console.error('❌ User not found:', userId);
      return null;
    }
    const dailyCompletionTimestamps = userData.dailyAchievements || {};
    
    // NEW: Use daily-based claimed tracking instead of persistent array
    const todayDateString = getTodayDateString();
    const dailyClaimedAchievements = userData.dailyClaimedAchievements || {};
    const claimedTodayList = dailyClaimedAchievements[todayDateString] || [];
    
    // Check for old system data that might interfere
    const oldClaimedAchievements = userData.claimedAchievements || [];
    if (oldClaimedAchievements.length > 0) {
      console.warn(`⚠️ User ${userId} still has old claimedAchievements array:`, oldClaimedAchievements);
      console.warn('🔧 Migration may be needed');
    }
    
    console.log('📊 Raw achievements data:', { 
      dailyCompletionTimestamps, 
      dailyClaimedAchievements,
      todayDateString,
      claimedTodayList,
      oldClaimedAchievements: oldClaimedAchievements.length > 0 ? oldClaimedAchievements : 'none'
    });
    
    const completedStatus = {};
    const availableToClaim = [];
    
    Object.values(ACHIEVEMENT_TYPES).forEach(type => {
      const completionTimestamp = dailyCompletionTimestamps[type];
      const isCompletedToday = completionTimestamp && isToday(completionTimestamp);
      completedStatus[type] = isCompletedToday;
      
      console.log(`🎯 Achievement ${type}:`, {
        hasTimestamp: !!completionTimestamp,
        timestamp: completionTimestamp,
        isCompletedToday,
        isInClaimedList: claimedTodayList.includes(type)
      });
      
      // Available to claim if completed today AND NOT in today's claimed list
      if (isCompletedToday && !claimedTodayList.includes(type)) {
        availableToClaim.push(type);
        console.log(`✅ ${type} is available to claim`);
      } else if (isCompletedToday && claimedTodayList.includes(type)) {
        console.log(`🔒 ${type} is completed but already claimed today`);
      } else if (!isCompletedToday) {
        console.log(`⏳ ${type} is not completed today`);
      }
    });
    
    const result = {
      completed: completedStatus,
      availableToClaim,
      claimed: claimedTodayList
    };
    
    console.log('🎉 Processed achievements result:', result);
    return result;
  } catch (error) {
    console.error('❌ Error getting daily achievements:', error);
    return null;
  }
};

/**
 * Record an achievement for a user
 */
export const recordAchievement = async (userId, achievementType) => {
  console.log(`Recording achievement ${achievementType} for user ${userId}`);
  
  if (!Object.values(ACHIEVEMENT_TYPES).includes(achievementType)) {
    console.error('Invalid achievement type:', achievementType);
    throw new Error('Invalid achievement type');
  }
  
  try {
    // Use GlobalUserProfileCache instead of direct fetch
    const GlobalUserProfileCache = require('../services/GlobalUserProfileCache').default;
    const userData = await GlobalUserProfileCache.getProfile(userId);
    
    if (!userData) {
      console.error('User document does not exist:', userId);
      return false;
    }
    const achievements = userData.dailyAchievements || {};
    const now = serverTimestamp();
    
    console.log('Current achievements:', achievements);
    console.log(`Checking if ${achievementType} was completed today...`);
    
    // Only record if not already completed today
    if (!isToday(achievements[achievementType])) {
      console.log(`Recording new achievement: ${achievementType}`);
      
      try {
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
          [`dailyAchievements.${achievementType}`]: now,
          lastUpdated: now
        });
        
        // Invalidate cache after update
        GlobalUserProfileCache.invalidate(userId);
        
        console.log('Achievement recorded successfully');
        return true;
      } catch (updateError) {
        console.error('Error updating user document:', updateError);
        throw updateError;
      }
    } else {
      console.log('Achievement already completed today');
    }
    
    return false;
  } catch (error) {
    console.error('Error in recordAchievement:', error);
    throw error; // Re-throw to be caught by the caller
  }
};

/**
 * Claim gem rewards for completed achievements
 */
export const claimGemRewards = async (userId, groupId) => {
  try {
    console.log(`💎 Starting gem claim process for user: ${userId}, group: ${groupId}`);
    
    const achievements = await getDailyAchievements(userId);
    if (!achievements) {
      console.error('❌ Failed to get achievements');
      return { success: false, error: 'Failed to get achievements' };
    }
    
    const rewardsToClaim = achievements.availableToClaim;
    console.log(`💎 Rewards available to claim:`, rewardsToClaim);
    
    if (rewardsToClaim.length === 0) {
      console.log('💎 No rewards to claim');
      return { success: false, error: 'No rewards to claim' };
    }
    
    // Calculate total gems to award
    const gemsToAward = rewardsToClaim.reduce(
      (total, type) => total + (ACHIEVEMENT_REWARDS[type] || 0), 0
    );
    
    console.log(`💎 Total gems to award: ${gemsToAward}`);
    
    // Update user's gems - use global gems for daily achievement rewards
    try {
      console.log(`💎 Calling updateGems with userId: ${userId}, amount: ${gemsToAward}, using global gems`);
      
      const gemUpdate = await updateGems(userId, gemsToAward, { 
        // Use global gems for daily achievement rewards for consistency
        groupId: null,
        reason: 'daily_gem_rewards',
        achievements: rewardsToClaim,
        source: 'daily_achievements'
      });
      
      console.log('💎 updateGems result:', gemUpdate);
      
      if (!gemUpdate || !gemUpdate.success) {
        console.error('❌ Failed to update gems for user:', userId, 'Result:', gemUpdate);
        return { success: false, error: 'Failed to update gems' };
      }
      
      console.log('✅ Successfully updated global gems:', gemUpdate);
    } catch (error) {
      console.error('❌ Error calling updateGems:', error);
      return { success: false, error: `Gem update failed: ${error.message}` };
    }
    
    // NEW: Mark achievements as claimed for today only
    const todayDateString = getTodayDateString();
    const userRef = doc(db, 'users', userId);
    
    try {
      // Get current daily claimed achievements using GlobalUserProfileCache
      const GlobalUserProfileCache = require('../services/GlobalUserProfileCache').default;
      const userData = await GlobalUserProfileCache.getProfile(userId);
      const dailyClaimedAchievements = userData?.dailyClaimedAchievements || {};
      const currentClaimedToday = dailyClaimedAchievements[todayDateString] || [];
      
      // Add new claimed achievements to today's list
      const updatedClaimedToday = [...new Set([...currentClaimedToday, ...rewardsToClaim])];
      
      console.log(`💎 Updating daily claimed achievements for ${todayDateString}:`, updatedClaimedToday);
      
      await updateDoc(userRef, {
        [`dailyClaimedAchievements.${todayDateString}`]: updatedClaimedToday,
        lastGemClaim: serverTimestamp()
      });
      
      console.log(`✅ Marked achievements as claimed for ${todayDateString}:`, updatedClaimedToday);
    } catch (error) {
      console.error('❌ Error updating claimed achievements:', error);
      // Don't fail the whole operation if this fails, gems were already awarded
    }
    
    const result = {
      success: true,
      gemsAwarded: gemsToAward,
      achievementsClaimed: rewardsToClaim
    };
    
    console.log('🎉 Gem claim completed successfully:', result);
    return result;
  } catch (error) {
    console.error('❌ Error claiming gem rewards:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Force clear old gem reward data and reset for today (debugging/admin function)
 * This function helps fix any corrupted data from the old system
 * @param {string} userId - The user ID to reset
 * @returns {Promise<{success: boolean, message: string}>}
 */
export const forceResetGemRewards = async (userId) => {
  try {
    console.log(`🔧 Force resetting gem rewards for user: ${userId}`);
    
    const userRef = doc(db, 'users', userId);
    
    // Use GlobalUserProfileCache instead of direct fetch
    const GlobalUserProfileCache = require('../services/GlobalUserProfileCache').default;
    const userData = await GlobalUserProfileCache.getProfile(userId);
    
    if (!userData) {
      return { success: false, message: 'User not found' };
    }
    
    const todayDateString = getTodayDateString();
    
    // Prepare update to remove old data and reset today's claims
    const updateData = {};
    
    // Remove old claimedAchievements array if it exists
    if (userData.claimedAchievements) {
      updateData.claimedAchievements = deleteField();
      console.log('🗑️ Removing old claimedAchievements array');
    }
    
    // Reset today's claimed achievements to empty
    updateData[`dailyClaimedAchievements.${todayDateString}`] = [];
    console.log(`🔄 Resetting today's (${todayDateString}) claimed achievements to empty`);
    
    // Apply the reset
    await updateDoc(userRef, updateData);
    
    console.log(`✅ Force reset completed for user ${userId}`);
    
    return {
      success: true,
      message: `Reset completed - today's claims cleared and old data removed`
    };
    
  } catch (error) {
    console.error(`❌ Error force resetting gem rewards for user ${userId}:`, error);
    return { success: false, message: error.message };
  }
};

/**
 * Clean up old daily claimed achievements (optional maintenance function)
 * Removes claimed achievement records older than 30 days to prevent database bloat
 */
export const cleanupOldClaimedAchievements = async (userId, daysToKeep = 30) => {
  try {
    const userRef = doc(db, 'users', userId);
    
    // Use GlobalUserProfileCache instead of direct fetch
    const GlobalUserProfileCache = require('../services/GlobalUserProfileCache').default;
    const userData = await GlobalUserProfileCache.getProfile(userId);
    
    if (!userData) return;
    
    const dailyClaimedAchievements = userData.dailyClaimedAchievements || {};
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const updatedClaimedAchievements = {};
    
    Object.keys(dailyClaimedAchievements).forEach(dateString => {
      const date = new Date(dateString);
      if (date >= cutoffDate) {
        updatedClaimedAchievements[dateString] = dailyClaimedAchievements[dateString];
      }
    });
    
    await updateDoc(userRef, {
      dailyClaimedAchievements: updatedClaimedAchievements
    });
    
    console.log(`Cleaned up old claimed achievements for user ${userId}`);
  } catch (error) {
    console.error('Error cleaning up old claimed achievements:', error);
  }
};
