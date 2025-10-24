import {
    doc,
    runTransaction,
    serverTimestamp
} from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { updateGems } from '../utils/gemOperations';
import { RARITY_TYPES } from '../utils/rarity';
import { getDoc } from './ReadTracking/TrackedFirestore';

// Maximum level cap
export const MAX_LEVEL = 30;

// XP rewards for different activities
export const XP_REWARDS = {
  COIN_CARD: 3,
  COMPLETE_TRADE: 2,
  COMPLETE_SET: 25, // Base amount, can be higher for more complex sets
  AUCTION_WIN: {
    [RARITY_TYPES.COMMON]: 5,
    [RARITY_TYPES.UNCOMMON]: 8,
    [RARITY_TYPES.RARE]: 12,
    [RARITY_TYPES.EPIC]: 18,
    [RARITY_TYPES.LEGENDARY]: 25,
    [RARITY_TYPES.MYTHIC]: 35
  }
};

// XP requirements for each level (exponential growth, but capped at level 30)
export const getXPRequiredForLevel = (level) => {
  if (level <= 1) return 0;
  if (level > MAX_LEVEL) return getXPRequiredForLevel(MAX_LEVEL); // Cap at max level
  
  // Formula: base * (level^1.5) for gradual exponential growth
  const base = 100;
  return Math.floor(base * Math.pow(level - 1, 1.5));
};

// Gem rewards for reaching each level (enhanced for higher levels)
export const getGemRewardForLevel = (level) => {
  if (level <= 1 || level > MAX_LEVEL) return 0;
  
  // Progressive gem rewards with bonus for higher levels
  if (level <= 5) return 5;
  if (level <= 10) return 10;
  if (level <= 15) return 15;
  if (level <= 20) return 25;
  if (level <= 25) return 40;
  if (level <= 30) return 60; // Maximum reward for reaching level 30
  
  return 0;
};

/**
 * Get user's current XP and level data
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User's XP data
 */
export const getUserXP = async (userId) => {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      return {
        level: 1,
        experience: 0,
        totalExperience: 0,
        gemsFromLeveling: 0
      };
    }
    
    const userData = userDoc.data();
    const level = Math.min(userData.level || 1, MAX_LEVEL); // Ensure level doesn't exceed max
    
    return {
      level,
      experience: userData.experience || 0,
      totalExperience: userData.totalExperience || 0,
      gemsFromLeveling: userData.gemsFromLeveling || 0
    };
  } catch (error) {
    console.error('Error getting user XP:', error);
    throw error;
  }
};

/**
 * Award XP to a user and handle level ups
 * @param {string} userId - User ID
 * @param {number} xpToAward - Amount of XP to award
 * @param {string} source - Source of the XP (for tracking)
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Result with level up info
 */
export const awardXP = async (userId, xpToAward, source = 'unknown', options = {}) => {
  try {
    console.log(`🌟 Awarding ${xpToAward} XP to user ${userId} from ${source}`);
    
    const result = await runTransaction(db, async (transaction) => {
      const userRef = doc(db, 'users', userId);
      const userDoc = await transaction.get(userRef);
      
      let userData = {};
      if (userDoc.exists()) {
        userData = userDoc.data();
      }
      
      const currentLevel = Math.min(userData.level || 1, MAX_LEVEL);
      const currentXP = userData.experience || 0;
      const currentTotalXP = userData.totalExperience || 0;
      const currentGemsFromLeveling = userData.gemsFromLeveling || 0;
      
      // If already at max level, don't award XP but still track it
      if (currentLevel >= MAX_LEVEL) {
        console.log(`🏆 User ${userId} is already at max level ${MAX_LEVEL}, no XP awarded`);
        return {
          success: true,
          xpAwarded: 0,
          levelsGained: 0,
          newLevel: MAX_LEVEL,
          newExperience: currentXP,
          totalGemsAwarded: 0,
          xpToNextLevel: 0,
          maxLevelReached: true
        };
      }
      
      const newTotalXP = currentTotalXP + xpToAward;
      let newLevel = currentLevel;
      let newCurrentXP = currentXP + xpToAward;
      let levelsGained = 0;
      let totalGemsAwarded = 0;
      
      // Check for level ups (but cap at MAX_LEVEL)
      while (newLevel < MAX_LEVEL) {
        const xpRequiredForNextLevel = getXPRequiredForLevel(newLevel + 1);
        
        if (newCurrentXP >= xpRequiredForNextLevel) {
          // Level up!
          newCurrentXP -= xpRequiredForNextLevel;
          newLevel++;
          levelsGained++;
          
          const gemReward = getGemRewardForLevel(newLevel);
          totalGemsAwarded += gemReward;
          
          console.log(`🎉 User ${userId} leveled up to level ${newLevel}! Awarded ${gemReward} gems.`);
          
          // Special message for reaching max level
          if (newLevel === MAX_LEVEL) {
            console.log(`🏆 User ${userId} reached maximum level ${MAX_LEVEL}!`);
            break;
          }
        } else {
          break;
        }
      }
      
      // Update user document
      const updateData = {
        level: newLevel,
        experience: newCurrentXP,
        totalExperience: newTotalXP,
        gemsFromLeveling: currentGemsFromLeveling + totalGemsAwarded,
        lastXPUpdate: serverTimestamp()
      };
      
      if (userDoc.exists()) {
        transaction.update(userRef, updateData);
      } else {
        transaction.set(userRef, updateData);
      }
      
      // Track XP history (optional, for analytics)
      if (options.trackHistory) {
        const xpHistoryRef = doc(db, 'xpHistory', `${userId}_${Date.now()}`);
        transaction.set(xpHistoryRef, {
          userId,
          xpAwarded: xpToAward,
          source,
          timestamp: serverTimestamp(),
          levelBefore: currentLevel,
          levelAfter: newLevel,
          gemsAwarded: totalGemsAwarded
        });
      }
      
      const xpToNextLevel = newLevel >= MAX_LEVEL ? 0 : getXPRequiredForLevel(newLevel + 1) - newCurrentXP;
      
      return {
        success: true,
        xpAwarded: xpToAward,
        levelsGained,
        newLevel,
        newExperience: newCurrentXP,
        totalGemsAwarded,
        xpToNextLevel,
        maxLevelReached: newLevel >= MAX_LEVEL
      };
    });
    
    // Award gems for level ups after transaction completes
    if (result.totalGemsAwarded > 0) {
      try {
        const gemsResult = await updateGems(userId, result.totalGemsAwarded, {
          reason: 'level_up',
          // Use global gems for level-up rewards for consistency
          groupId: null, 
          levelsGained: result.levelsGained,
          newLevel: result.newLevel,
          source: 'xp_service'
        });
        console.log(`💎 Successfully awarded ${result.totalGemsAwarded} global gems for level up - New balance: ${gemsResult.newBalance}`);
      } catch (gemError) {
        console.error('❌ Failed to award gems for level up:', gemError);
        // Don't fail the XP award if gem award fails
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error awarding XP:', error);
    throw error;
  }
};

/**
 * Award XP for coining a card
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID for group-specific gems
 * @returns {Promise<Object>} XP award result
 */
export const awardCoinXP = async (userId, groupId) => {
  return await awardXP(userId, XP_REWARDS.COIN_CARD, 'coin_card', { groupId });
};

/**
 * Award XP for winning an auction
 * @param {string} userId - User ID
 * @param {string} cardRarity - Rarity of the card won
 * @param {string} groupId - Group ID for group-specific gems
 * @returns {Promise<Object>} XP award result
 */
export const awardAuctionWinXP = async (userId, cardRarity, groupId) => {
  const xpReward = XP_REWARDS.AUCTION_WIN[cardRarity] || XP_REWARDS.AUCTION_WIN[RARITY_TYPES.COMMON];
  return await awardXP(userId, xpReward, `auction_win_${cardRarity}`, { groupId });
};

/**
 * Award XP for completing a trade
 * @param {string} userId - User ID
 * @param {number} tradesCompletedToday - Number of trades completed today (for daily limit)
 * @param {string} groupId - Group ID for group-specific gems
 * @returns {Promise<Object>} XP award result
 */
export const awardTradeXP = async (userId, tradesCompletedToday = 0, groupId) => {
  // Only award XP for up to 3 trades per day
  if (tradesCompletedToday >= 3) {
    return {
      success: true,
      xpAwarded: 0,
      levelsGained: 0,
      message: 'Daily trade XP limit reached (3 trades per day)'
    };
  }
  
  return await awardXP(userId, XP_REWARDS.COMPLETE_TRADE, 'trade_complete', { groupId });
};

/**
 * Award XP for completing a set
 * @param {string} userId - User ID
 * @param {string} setId - ID of the completed set
 * @param {string} groupId - Group ID for group-specific gems
 * @returns {Promise<Object>} XP award result
 */
export const awardSetCompletionXP = async (userId, setId, groupId) => {
  // Different sets can have different XP rewards
  let xpReward = XP_REWARDS.COMPLETE_SET;
  
  // Adjust XP based on set difficulty
  switch (setId) {
    case 'rarity_spectrum':
      xpReward = 30; // More XP for collecting all rarities
      break;
    case 'photographers_dedication':
      xpReward = 25; // Standard XP
      break;
    case 'breadth_of_vision':
      xpReward = 35; // More XP for the broader collection
      break;
    case 'growing_hoard':
      xpReward = 40; // Most XP for the largest collection
      break;
    default:
      xpReward = XP_REWARDS.COMPLETE_SET;
  }
  
  return await awardXP(userId, xpReward, `set_complete_${setId}`, { groupId });
};

/**
 * Get user's progress to next level
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Progress data
 */
export const getLevelProgress = async (userId) => {
  try {
    const xpData = await getUserXP(userId);
    const isMaxLevel = xpData.level >= MAX_LEVEL;
    const xpRequiredForNext = isMaxLevel ? 0 : getXPRequiredForLevel(xpData.level + 1);
    const progressPercentage = isMaxLevel ? 100 : (xpRequiredForNext > 0 ? (xpData.experience / xpRequiredForNext) * 100 : 100);
    
    return {
      currentLevel: xpData.level,
      currentXP: xpData.experience,
      xpRequiredForNext,
      progressPercentage: Math.min(100, progressPercentage),
      gemRewardForNext: isMaxLevel ? 0 : getGemRewardForLevel(xpData.level + 1),
      totalExperience: xpData.totalExperience,
      gemsFromLeveling: xpData.gemsFromLeveling,
      isMaxLevel,
      maxLevel: MAX_LEVEL
    };
  } catch (error) {
    console.error('Error getting level progress:', error);
    throw error;
  }
};

/**
 * Count user's trades completed today (for daily XP limit)
 * @param {string} userId - User ID
 * @returns {Promise<number>} Number of trades completed today
 */
export const getTradesCompletedToday = async (userId) => {
  try {
    // This would ideally query a trades collection with today's date
    // For now, we'll use a simple counter that resets daily
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) return 0;
    
    const userData = userDoc.data();
    const lastTradeDate = userData.lastTradeDate?.toDate?.() || new Date(userData.lastTradeDate || 0);
    const today = new Date();
    
    // Check if last trade was today
    const isToday = lastTradeDate.getDate() === today.getDate() &&
                   lastTradeDate.getMonth() === today.getMonth() &&
                   lastTradeDate.getFullYear() === today.getFullYear();
    
    return isToday ? (userData.tradesCompletedToday || 0) : 0;
  } catch (error) {
    console.error('Error getting trades completed today:', error);
    return 0;
  }
};

export default {
  getUserXP,
  awardXP,
  awardCoinXP,
  awardAuctionWinXP,
  awardTradeXP,
  awardSetCompletionXP,
  getLevelProgress,
  getTradesCompletedToday,
  getXPRequiredForLevel,
  getGemRewardForLevel,
  XP_REWARDS,
  MAX_LEVEL
}; 