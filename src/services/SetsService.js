import {
    collection,
    doc,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where
} from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { updateGems } from '../utils/gemOperations';
import { RARITY_TYPES } from '../utils/rarity';
import { getDoc, getDocs } from './ReadTracking/TrackedFirestore';
import { awardSetCompletionXP } from './XPService';

/**
 * Generate random gem reward for a set
 * @param {number} min - Minimum gems
 * @param {number} max - Maximum gems
 * @returns {number} Random gem amount
 */
const generateRandomGemReward = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Set definitions with their requirements and rewards
export const SETS_DEFINITIONS = {
  RARITY_SPECTRUM: {
    id: 'rarity_spectrum',
    name: 'The Rarity Spectrum',
    description: 'Own at least one card of each available Rarity tier simultaneously (Common, Uncommon, Rare, Epic, and Legendary).',
    gemRewardRange: { min: 40, max: 60 }, // Narrowed from 25-75 to 40-60 gems
    requirements: [
      { type: 'rarity', rarity: RARITY_TYPES.COMMON, name: 'Common Card' },
      { type: 'rarity', rarity: RARITY_TYPES.UNCOMMON, name: 'Uncommon Card' },
      { type: 'rarity', rarity: RARITY_TYPES.RARE, name: 'Rare Card' },
      { type: 'rarity', rarity: RARITY_TYPES.EPIC, name: 'Epic Card' },
      { type: 'rarity', rarity: RARITY_TYPES.LEGENDARY, name: 'Legendary Card' },
    ]
  },

  PHOTOGRAPHERS_DEDICATION: {
    id: 'photographers_dedication',
    name: 'Photographer\'s Dedication',
    description: 'Own 5 distinct cards all created by the same photographer.',
    gemRewardRange: { min: 30, max: 45 }, // Narrowed from 20-60 to 30-45 gems
    requirements: [
      { type: 'photographer_count', count: 5, name: '5 cards from same photographer' }
    ]
  },

  BREADTH_OF_VISION: {
    id: 'breadth_of_vision',
    name: 'Breadth of Vision',
    description: 'Own at least one card from 10 different photographers.',
    gemRewardRange: { min: 45, max: 65 }, // Narrowed from 30-75 to 45-65 gems
    requirements: [
      { type: 'unique_photographers', count: 10, name: '10 different photographers' }
    ]
  },

  GROWING_HOARD: {
    id: 'growing_hoard',
    name: 'The Growing Hoard',
    description: 'Own a total of 50 distinct cards in your collection.',
    gemRewardRange: { min: 25, max: 40 }, // Narrowed from 15-50 to 25-40 gems
    requirements: [
      { type: 'total_cards', count: 50, name: '50 total cards' }
    ]
  }
};

/**
 * Get user's progress on all sets
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 * @returns {Promise<Array>} Array of sets with progress data
 */
export const getSetsProgress = async (userId, groupId) => {
  try {
    console.log(`📊 Getting sets progress for user ${userId} in group ${groupId}`);

    // Get user's cards - make sure to include all available cards
    const cardsRef = collection(db, 'cards');
    const cardsQuery = query(
      cardsRef,
      where('userId', '==', userId),
      where('groupId', '==', groupId)
    );
    const cardsSnapshot = await getDocs(cardsQuery);
    const userCards = cardsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(`📊 Found ${userCards.length} cards for user`);

    // Get user's sets completion status
    const userSetsRef = doc(db, 'userSets', `${userId}_${groupId}`);
    const userSetsDoc = await getDoc(userSetsRef);
    const userSetsData = userSetsDoc.exists() ? userSetsDoc.data() : {};

    // Calculate progress for each set
    const setsProgress = Object.values(SETS_DEFINITIONS).map(setDef => {
      const progress = calculateSetProgress(setDef, userCards, userSetsData);
      const completionData = userSetsData.completions?.[setDef.id] || {};
      
      return {
        ...setDef,
        progress: progress.completed,
        total: progress.total,
        progressDetails: progress.progressDetails, // Add detailed progress
        requirements: progress.requirements,
        claimed: completionData.claimed || false,
        completedAt: completionData.completedAt,
        claimedAt: completionData.claimedAt,
        isCompleted: progress.completed === progress.total, // Add completion flag
      };
    });

    console.log(`📊 Sets progress calculated:`, setsProgress.map(s => ({ 
      name: s.name, 
      progress: s.progress, 
      total: s.total, 
      progressDetails: s.progressDetails,
      claimed: s.claimed,
      isCompleted: s.isCompleted
    })));

    return setsProgress;
  } catch (error) {
    console.error('❌ Error getting sets progress:', error);
    throw error;
  }
};

/**
 * Calculate progress for a specific set
 * @param {Object} setDef - Set definition
 * @param {Array} userCards - User's cards
 * @param {Object} userSetsData - User's sets data
 * @returns {Object} Progress data
 */
const calculateSetProgress = (setDef, userCards, userSetsData) => {
  const requirements = setDef.requirements.map(req => ({ ...req, completed: false }));
  let completedCount = 0;
  let progressDetails = {};

  switch (setDef.id) {
    case 'rarity_spectrum':
      const ownedRarities = new Set(userCards.map(card => card.rarity));
      const totalRarities = setDef.requirements.length;
      
      requirements.forEach((req, index) => {
        if (req.type === 'rarity' && ownedRarities.has(req.rarity)) {
          req.completed = true;
          completedCount++;
        }
      });
      
      progressDetails = {
        ownedRarities: Array.from(ownedRarities),
        requiredRarities: setDef.requirements.map(req => req.rarity),
        description: `${completedCount}/${totalRarities} rarities collected`
      };
      break;

    case 'photographers_dedication':
      const photographerCounts = {};
      userCards.forEach(card => {
        // Check multiple possible photographer fields for compatibility
        const photographerId = card.photographerId || card.createdBy || card.userId;
        if (photographerId) {
          photographerCounts[photographerId] = (photographerCounts[photographerId] || 0) + 1;
        }
      });
      
      const maxFromOnePhotographer = Math.max(0, ...Object.values(photographerCounts));
      const targetCount = 5;
      
      if (maxFromOnePhotographer >= targetCount) {
        requirements[0].completed = true;
        completedCount = 1;
      }
      
      requirements[0].progress = `${maxFromOnePhotographer}/${targetCount}`;
      progressDetails = {
        maxFromOnePhotographer,
        targetCount,
        photographerCounts,
        description: `${Math.min(maxFromOnePhotographer, targetCount)}/${targetCount} cards from one photographer`
      };
      break;

    case 'breadth_of_vision':
      const uniquePhotographers = new Set(
        userCards
          .filter(card => card.photographerId || card.createdBy || card.userId)
          .map(card => card.photographerId || card.createdBy || card.userId)
      ).size;
      const targetPhotographers = 10;
      
      if (uniquePhotographers >= targetPhotographers) {
        requirements[0].completed = true;
        completedCount = 1;
      }
      
      requirements[0].progress = `${uniquePhotographers}/${targetPhotographers}`;
      progressDetails = {
        uniquePhotographers,
        targetPhotographers,
        description: `${Math.min(uniquePhotographers, targetPhotographers)}/${targetPhotographers} different photographers`
      };
      break;

    case 'growing_hoard':
      const totalCards = userCards.length;
      const targetCards = 50;
      
      if (totalCards >= targetCards) {
        requirements[0].completed = true;
        completedCount = 1;
      }
      
      requirements[0].progress = `${totalCards}/${targetCards}`;
      progressDetails = {
        totalCards,
        targetCards,
        description: `${Math.min(totalCards, targetCards)}/${targetCards} total cards`
      };
      break;

    default:
      break;
  }

  return {
    completed: completedCount,
    total: requirements.length,
    requirements,
    progressDetails
  };
};

/**
 * Claim reward for a completed set
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 * @param {string} setId - Set ID
 * @returns {Promise<Object>} Result object
 */
export const claimSetReward = async (userId, groupId, setId) => {
  try {
    console.log(`🎁 Claiming reward for set ${setId} for user ${userId}`);

    const setDef = SETS_DEFINITIONS[setId.toUpperCase()];
    if (!setDef) {
      return { success: false, error: 'Invalid set ID' };
    }

    // Check if set is completed and not already claimed
    const setsProgress = await getSetsProgress(userId, groupId);
    const setProgress = setsProgress.find(s => s.id === setId);
    
    if (!setProgress) {
      return { success: false, error: 'Set not found' };
    }

    if (!setProgress.isCompleted) {
      return { success: false, error: 'Set not completed yet' };
    }

    if (setProgress.claimed) {
      return { success: false, error: 'Reward already claimed' };
    }

    // Award gems
    const gemsAwarded = generateRandomGemReward(setDef.gemRewardRange.min, setDef.gemRewardRange.max);
    const updateResult = await updateGems(userId, gemsAwarded, {
      reason: 'set_completion',
      setId: setId,
      setName: setDef.name,
      // Use global gems for set completion rewards
      groupId: null
    });
    
    if (!updateResult.success) {
      return { success: false, error: 'Failed to award gems' };
    }

    console.log(`💎 Successfully awarded ${gemsAwarded} global gems for completing set ${setDef.name}`);

    // Award XP for set completion
    try {
      const xpResult = await awardSetCompletionXP(userId, setId, groupId);
      console.log(`🌟 Awarded ${xpResult.xpAwarded} XP for completing set ${setId}`);
      if (xpResult.levelsGained > 0) {
        console.log(`🎉 User leveled up ${xpResult.levelsGained} time(s) to level ${xpResult.newLevel}!`);
      }
    } catch (xpError) {
      console.error('Error awarding XP for set completion:', xpError);
      // Don't fail the entire operation if XP fails
    }

    // Mark set as claimed
    const userSetsRef = doc(db, 'userSets', `${userId}_${groupId}`);
    const userSetsDoc = await getDoc(userSetsRef);
    const currentData = userSetsDoc.exists() ? userSetsDoc.data() : {};

    const updatedData = {
      ...currentData,
      completions: {
        ...currentData.completions,
        [setId]: {
          completed: true,
          claimed: true,
          completedAt: currentData.completions?.[setId]?.completedAt || serverTimestamp(),
          claimedAt: serverTimestamp(),
          gemsAwarded
        }
      },
      lastUpdated: serverTimestamp()
    };

    if (userSetsDoc.exists()) {
      await updateDoc(userSetsRef, updatedData);
    } else {
      await setDoc(userSetsRef, updatedData);
    }

    console.log(`✅ Set reward claimed successfully: ${gemsAwarded} gems`);
    
    return {
      success: true,
      gemsAwarded,
      setName: setDef.name
    };
  } catch (error) {
    console.error('❌ Error claiming set reward:', error);
    return { success: false, error: 'Failed to claim reward' };
  }
};

/**
 * Check and auto-complete sets when conditions are met
 * @param {string} userId - User ID
 * @param {string} groupId - Group ID
 */
export const checkSetCompletions = async (userId, groupId) => {
  try {
    console.log(`🔍 Checking set completions for user ${userId}`);
    
    const setsProgress = await getSetsProgress(userId, groupId);
    const userSetsRef = doc(db, 'userSets', `${userId}_${groupId}`);
    const userSetsDoc = await getDoc(userSetsRef);
    const currentData = userSetsDoc.exists() ? userSetsDoc.data() : {};
    
    let hasNewCompletions = false;
    const updatedCompletions = { ...currentData.completions };

    setsProgress.forEach(set => {
      const isCompleted = set.isCompleted;
      const alreadyMarkedComplete = currentData.completions?.[set.id]?.completed;
      
      if (isCompleted && !alreadyMarkedComplete) {
        console.log(`✅ Set "${set.name}" newly completed!`);
        updatedCompletions[set.id] = {
          completed: true,
          claimed: false,
          completedAt: serverTimestamp()
        };
        hasNewCompletions = true;
      }
    });

    if (hasNewCompletions) {
      const updatedData = {
        ...currentData,
        completions: updatedCompletions,
        lastUpdated: serverTimestamp()
      };

      if (userSetsDoc.exists()) {
        await updateDoc(userSetsRef, updatedData);
      } else {
        await setDoc(userSetsRef, updatedData);
      }

      console.log(`🎉 Updated set completions for user ${userId}`);
    }
  } catch (error) {
    console.error('❌ Error checking set completions:', error);
  }
};

export default {
  getSetsProgress,
  claimSetReward,
  checkSetCompletions,
  SETS_DEFINITIONS
}; 