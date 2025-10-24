import { deleteField, doc, updateDoc } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { getDoc } from '../services/ReadTracking/TrackedFirestore';

/**
 * Migration utility to transition users from old claimedAchievements array 
 * to new daily-based tracking system
 * 
 * This should be run once for existing users to clean up the old data structure
 */

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
 * Migrate a single user from old system to new system
 * @param {string} userId - The user ID to migrate
 * @returns {Promise<{success: boolean, message: string}>}
 */
export const migrateUserGemRewards = async (userId) => {
  try {
    console.log(`Starting migration for user: ${userId}`);
    
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      return { success: false, message: 'User not found' };
    }
    
    const userData = userDoc.data();
    const oldClaimedAchievements = userData.claimedAchievements || [];
    const dailyAchievements = userData.dailyAchievements || {};
    
    // If user doesn't have old claimedAchievements, no migration needed
    if (oldClaimedAchievements.length === 0) {
      console.log(`No migration needed for user ${userId} - no old claimed achievements`);
      return { success: true, message: 'No migration needed' };
    }
    
    console.log(`Migrating user ${userId}:`, {
      oldClaimedAchievements,
      dailyAchievements
    });
    
    // Check which of the old claimed achievements were actually completed today
    const todayDateString = getTodayDateString();
    const claimedToday = oldClaimedAchievements.filter(achievementType => {
      const completionTimestamp = dailyAchievements[achievementType];
      return completionTimestamp && isToday(completionTimestamp);
    });
    
    // Prepare the update object
    const updateData = {
      // Remove the old claimedAchievements array
      claimedAchievements: deleteField()
    };
    
    // If there are achievements claimed today, add them to the new structure
    if (claimedToday.length > 0) {
      updateData[`dailyClaimedAchievements.${todayDateString}`] = claimedToday;
    }
    
    // Apply the migration
    await updateDoc(userRef, updateData);
    
    console.log(`Migration completed for user ${userId}:`, {
      removedOldClaimed: oldClaimedAchievements.length,
      migratedToToday: claimedToday.length,
      todayDateString
    });
    
    return {
      success: true,
      message: `Migrated ${oldClaimedAchievements.length} old claims, ${claimedToday.length} moved to today`
    };
    
  } catch (error) {
    console.error(`Error migrating user ${userId}:`, error);
    return { success: false, message: error.message };
  }
};

/**
 * Check if a user needs migration (has old claimedAchievements array)
 * @param {string} userId - The user ID to check
 * @returns {Promise<boolean>}
 */
export const userNeedsMigration = async (userId) => {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) return false;
    
    const userData = userDoc.data();
    const oldClaimedAchievements = userData.claimedAchievements;
    
    // User needs migration if they have the old claimedAchievements field
    return Array.isArray(oldClaimedAchievements) && oldClaimedAchievements.length > 0;
  } catch (error) {
    console.error(`Error checking migration status for user ${userId}:`, error);
    return false;
  }
};

/**
 * Auto-migrate user if needed (call this when user loads the gem rewards)
 * @param {string} userId - The user ID to auto-migrate
 * @returns {Promise<void>}
 */
export const autoMigrateIfNeeded = async (userId) => {
  try {
    const needsMigration = await userNeedsMigration(userId);
    
    if (needsMigration) {
      console.log(`Auto-migrating user ${userId} from old gem rewards system`);
      const result = await migrateUserGemRewards(userId);
      console.log(`Auto-migration result for ${userId}:`, result);
    }
  } catch (error) {
    console.error(`Error in auto-migration for user ${userId}:`, error);
    // Don't throw - migration failure shouldn't break the app
  }
}; 