import { addDoc, collection, doc, serverTimestamp } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { runTransaction } from '../services/ReadTracking/TrackedFirestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { getDoc } from '../services/ReadTracking/TrackedFirestore';

// Rarities and their values
const RARITIES = {
  common: { weight: 60, sellValue: 5 },
  rare: { weight: 25, sellValue: 15 },
  epic: { weight: 10, sellValue: 45 },
  legendary: { weight: 5, sellValue: 100 }
};

/**
 * Update user's gem balance
 * @param {string} userId - The ID of the user
 * @param {number} amount - The amount to add (can be negative to subtract)
 * @param {Object} [metadata={}] - Additional metadata for the transaction
 * @param {string} [metadata.groupId] - Optional group ID for group-specific gems
 * @param {string} [metadata.reason] - Reason for the transaction
 * @returns {Promise<{success: boolean, newBalance: number, amountAdded: number}>}
 */
export const updateGems = async (userId, amount, metadata = {}) => {
  if (!userId) throw new Error('User ID is required');
  if (typeof amount !== 'number' || isNaN(amount)) {
    throw new Error('Amount must be a valid number');
  }
  
  try {
    console.log(`💎 Updating gems for user ${userId}: ${amount >= 0 ? '+' : ''}${amount}`);
    
    const userRef = doc(db, 'users', userId);
    const { groupId, ...transactionMetadata } = metadata;
    
    let newGems;
    const result = await runTransaction(db, async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists()) throw new Error('User not found');
      
      const userData = userDoc.data();
      
      // Handle group-specific gems if groupId is provided
      if (groupId) {
        console.log(`💎 Using group-specific gems for group: ${groupId}`);
        const groupGems = userData.groupGems || {};
        const currentGems = groupGems[groupId] || 0;
        newGems = currentGems + amount;
        
        if (newGems < 0) {
          throw new Error(`Insufficient group gems: ${currentGems} < ${Math.abs(amount)}`);
        }
        
        // Update group-specific gems
        const updatedGroupGems = { ...groupGems, [groupId]: newGems };
        transaction.update(userRef, {
          groupGems: updatedGroupGems,
          lastUpdated: serverTimestamp()
        });
        
        console.log(`💎 Group gems updated: ${currentGems} → ${newGems}`);
      } else {
        // Handle global gems
        console.log(`💎 Using global gems`);
        const currentGems = userData.gems || 0;
        newGems = currentGems + amount;
        
        if (newGems < 0) {
          throw new Error(`Insufficient global gems: ${currentGems} < ${Math.abs(amount)}`);
        }
        
        transaction.update(userRef, {
          gems: newGems,
          lastUpdated: serverTimestamp()
        });
        
        console.log(`💎 Global gems updated: ${currentGems} → ${newGems}`);
      }
      
      return { success: true, newBalance: newGems, amountAdded: amount };
    });

    // Log the transaction after the main transaction completes
    try {
      await addDoc(collection(db, 'gemTransactions'), {
        userId,
        amount,
        newBalance: newGems,
        timestamp: serverTimestamp(),
        groupId: groupId || null,
        type: groupId ? 'group_gems' : 'global_gems',
        ...transactionMetadata
      });
      console.log(`📝 Gem transaction logged successfully`);
    } catch (logError) {
      console.warn('Failed to log gem transaction:', logError);
      // Don't fail the main operation if logging fails
    }

    console.log(`✅ Gem update completed successfully: ${result.newBalance} gems`);
    return result;
  } catch (error) {
    console.error('❌ Error updating gems:', error);
    throw error;
  }
};

/**
 * Get user's gem balance
 * @param {string} userId - The ID of the user
 * @param {Object} options - Options for getting gems
 * @param {string} [options.groupId] - Optional group ID for group-specific gems
 * @param {boolean} [options.preferGlobal] - Whether to prefer global gems over group gems
 * @returns {Promise<number>} The user's gem balance
 */
export const getGems = async (userId, { groupId, preferGlobal = false } = {}) => {
  if (!userId) return 0;
  
  try {
    console.log(`💎 Getting gems for user ${userId}${groupId ? ` (group: ${groupId})` : ''}`);
    
    const userDoc = await getDoc(doc(db, 'users', userId, 'sessions', 'main'));
    if (!userDoc.exists()) {
      console.warn(`User document not found: ${userId}`);
      return 0;
    }
    
    const userData = userDoc.data();
    
    // If preferGlobal is true, always return global gems
    if (preferGlobal) {
      const globalGems = userData.gems || 0;
      console.log(`💎 Returning global gems (preferred): ${globalGems}`);
      return globalGems;
    }
    
    // If groupId is provided, try to get group-specific gems first
    if (groupId) {
      const groupGems = userData.groupGems?.[groupId];
      if (groupGems !== undefined) {
        console.log(`💎 Returning group gems for ${groupId}: ${groupGems}`);
        return groupGems;
      }
      console.log(`💎 No group gems found for ${groupId}, falling back to global gems`);
    }
    
    // Fall back to global gems
    const globalGems = userData.gems || 0;
    console.log(`💎 Returning global gems: ${globalGems}`);
    return globalGems;
  } catch (error) {
    console.error('❌ Error getting gems:', error);
    return 0;
  }
};

export default {
  RARITIES,
  updateGems,
  getGems
};
