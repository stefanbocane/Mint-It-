import { arrayUnion, collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Adds coins to a user's balance for a specific group
 * 
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @param {number} amount - The amount of coins to add (use negative for subtraction)
 * @returns {Promise<boolean>} - Success status
 */
export const addCoinsToUserBalance = async (userId, groupId, amount) => {
  if (!userId || !groupId || !amount) return false;
  
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) return false;
    
    const userData = userDoc.data();
    const groupBalances = userData.groupBalances || {};
    const currentBalance = groupBalances[groupId] || 0;
    
    // Create updated groupBalances object
    const updatedGroupBalances = {
      ...groupBalances,
      [groupId]: currentBalance + amount
    };
    
    // Update the user document
    await updateDoc(userRef, {
      groupBalances: updatedGroupBalances,
      lastOperation: amount > 0 ? 'add_coins' : 'remove_coins',
      lastOperationTimestamp: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error('Error adding coins to user balance:', error);
    return false;
  }
};

/**
 * Sets a user's balance for a specific group
 * 
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @param {number} amount - The amount to set the balance to
 * @returns {Promise<boolean>} - Success status
 */
export const setUserBalance = async (userId, groupId, amount) => {
  if (!userId || !groupId || amount === undefined) return false;
  
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) return false;
    
    const userData = userDoc.data();
    const groupBalances = userData.groupBalances || {};
    
    // Create updated groupBalances object
    const updatedGroupBalances = {
      ...groupBalances,
      [groupId]: amount
    };
    
    // Update the user document
    await updateDoc(userRef, {
      groupBalances: updatedGroupBalances,
      lastOperation: 'set_balance',
      lastOperationTimestamp: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error('Error setting user balance:', error);
    return false;
  }
};

/**
 * Gets a user's balance for a specific group
 * 
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @returns {Promise<number>} - The user's balance for the group
 */
export const getUserBalance = async (userId, groupId) => {
  if (!userId || !groupId) return 0;
  
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) return 0;
    
    const userData = userDoc.data();
    const groupBalances = userData.groupBalances || {};
    
    return groupBalances[groupId] || 0;
  } catch (error) {
    console.error('Error getting user balance:', error);
    return 0;
  }
};

/**
 * Checks if a user has already received the initial coin reward for a group
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @returns {Promise<boolean>} - True if user has received the reward, false otherwise
 */
export const hasReceivedInitialReward = async (userId, groupId) => {
  if (!userId || !groupId) return false;
  
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) return false;
    
    const userData = userDoc.data();
    const initialRewardGroups = Array.isArray(userData.initialRewardGroups) 
      ? userData.initialRewardGroups 
      : [];
    
    // CRITICAL FIX: Also check if they actually have coins in this group
    // Don't trust just the initialRewardGroups flag as it might be set incorrectly
    const groupBalances = userData.groupBalances || {};
    const currentBalance = groupBalances[groupId] || 0;
    
    console.log(`[REWARD CHECK] User ${userId} for group ${groupId}:`);
    console.log(`[REWARD CHECK] In initialRewardGroups: ${initialRewardGroups.includes(groupId)}`);
    console.log(`[REWARD CHECK] Current balance: ${currentBalance}`);
    
    // Only return true if they're both in initialRewardGroups AND have coins
    // This prevents users from being marked as "received" without actually having coins
    return initialRewardGroups.includes(groupId) && currentBalance > 0;
  } catch (error) {
    console.error('Error checking initial reward status:', error);
    return false;
  }
};

/**
 * Marks a user as having received the initial coin reward for a group
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @returns {Promise<boolean>} - Success status
 */
export const markInitialRewardReceived = async (userId, groupId) => {
  if (!userId || !groupId) return false;
  
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) return false;
    
    const userData = userDoc.data();
    const initialRewardGroups = Array.isArray(userData.initialRewardGroups) 
      ? userData.initialRewardGroups 
      : [];
      
    // Only add the group if it's not already in the array
    if (!initialRewardGroups.includes(groupId)) {
      const updatedRewardGroups = [...initialRewardGroups, groupId];
      
      await updateDoc(userRef, {
        initialRewardGroups: updatedRewardGroups,
        lastInitialRewardGroup: groupId,
        lastInitialRewardTime: new Date().toISOString()
      });
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error marking initial reward as received:', error);
    return false;
  }
};

/**
 * A complete solution to handle the initial coin award for a user in a group
 * This ensures the user only gets the initial award once per group
 * 
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @param {number} amount - The amount of coins to award (default: 500)
 * @returns {Promise<{success: boolean, awarded: boolean, reason: string}>} - Result object
 */
export const handleOneTimeInitialCoinAward = async (userId, groupId, amount = 500) => {
  if (!userId || !groupId) {
    return { 
      success: false, 
      awarded: false, 
      reason: 'Invalid user or group ID' 
    };
  }
  
  try {
    // Get user document to check initialRewardGroups
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    // If user document exists, check initialRewardGroups
    if (userDoc.exists()) {
      const userData = userDoc.data();
      const initialRewardGroups = Array.isArray(userData.initialRewardGroups) 
        ? userData.initialRewardGroups 
        : [];
      
      // CRITICAL FIX: Only check initialRewardGroups flag, not the current balance
      // This ensures users don't get coins again if they spend all their coins
      if (initialRewardGroups.includes(groupId)) {
        console.log(`[COIN AWARD] User ${userId} already marked as received initial reward for group ${groupId}`);
        return { 
          success: true, 
          awarded: false, 
          reason: 'User has already received initial reward for this group' 
        };
      }
      
      // Get the current balance
      const groupBalances = userData.groupBalances || {};
      const currentBalance = groupBalances[groupId] || 0;
      
      // If user has coins but isn't marked, add protection but don't award
      if (currentBalance > 0) {
        await updateDoc(userRef, {
          initialRewardGroups: [...initialRewardGroups, groupId],
          protectionAddedAt: new Date().toISOString(),
          protectionReason: 'already_has_coins'
        });
        
        return { 
          success: true, 
          awarded: false, 
          reason: 'User already has coins in this group' 
        };
      }
      
      // Only reach here if user exists, has 0 coins, and hasn't received initial reward
      
      // Award the coins
      const success = await setUserBalance(userId, groupId, amount);
      
      if (!success) {
        return { 
          success: false, 
          awarded: false, 
          reason: 'Failed to update user balance' 
        };
      }
      
      // Mark the user as having received the initial reward
      await updateDoc(userRef, {
        initialRewardGroups: [...initialRewardGroups, groupId],
        lastInitialRewardAt: new Date().toISOString(),
        lastInitialRewardGroup: groupId,
        lastInitialRewardAmount: amount
      });
      
      return { 
        success: true, 
        awarded: true, 
        reason: `Successfully awarded ${amount} coins to user` 
      };
    } else {
      // User doesn't exist, create new document with coins and flag
      await setDoc(userRef, {
        uid: userId,
        groupBalances: { [groupId]: amount },
        initialRewardGroups: [groupId],
        createdAt: new Date().toISOString(),
        lastInitialRewardGroup: groupId,
        lastInitialRewardAmount: amount
      });
      
      return { 
        success: true, 
        awarded: true, 
        reason: `Created new user with ${amount} coins` 
      };
    }
  } catch (error) {
    console.error('Error in handleOneTimeInitialCoinAward:', error);
    return { 
      success: false, 
      awarded: false, 
      reason: `Error: ${error.message}` 
    };
  }
};

/**
 * Handles the initial coin reward for users when they have 0 coins
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @returns {Promise<boolean>} - Success status
 */
export const handleInitialCoinReward = async (userId, groupId) => {
  // Use the new utility function for a more robust solution
  const result = await handleOneTimeInitialCoinAward(userId, groupId, 200);
  console.log(`COINS DEBUG: handleInitialCoinReward result:`, result);
  return result.awarded;
};

/**
 * Verifies and fixes balance display issues for a user
 * This can be called from anywhere in the app when balance issues are suspected
 * 
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} - Object with fixed groups and counts
 */
export const verifyAndFixUserBalances = async (userId) => {
  if (!userId) {
    console.error('BALANCE FIX: Missing userId');
    return { success: false, fixed: 0 };
  }
  
  console.log(`BALANCE FIX: Verifying balances for user ${userId}`);
  
  try {
    // Get user data
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      console.error('BALANCE FIX: User document not found');
      return { success: false, fixed: 0 };
    }
    
    const userData = userDoc.data();
    let groupBalances = userData.groupBalances || {};
    // Get the initialRewardGroups to respect the one-time reward rule
    const initialRewardGroups = Array.isArray(userData.initialRewardGroups) 
      ? userData.initialRewardGroups 
      : [];
    
    console.log(`BALANCE FIX: initialRewardGroups:`, initialRewardGroups);
    
    // Get all groups this user is a member of
    const groupsCollection = collection(db, 'groups');
    const groupsSnapshot = await getDocs(groupsCollection);
    const userGroups = groupsSnapshot.docs
      .filter(doc => doc.data().members?.includes(userId))
      .map(doc => ({ id: doc.id, name: doc.data().name }));
    
    console.log(`BALANCE FIX: User is a member of ${userGroups.length} groups`);
    
    // Track fixed groups
    let fixedGroups = [];
    let updatedBalances = { ...groupBalances };
    // Track groups that received initial reward
    let newRewardGroups = [...initialRewardGroups];
    
    // Verify each group has a balance
    for (const group of userGroups) {
      const currentBalance = groupBalances[group.id] || 0;
      const hasReceivedInitialReward = initialRewardGroups.includes(group.id);
      
      // If balance is 0 or undefined AND user hasn't received initial reward, set it to 200
      if ((currentBalance === 0 || currentBalance === undefined) && !hasReceivedInitialReward) {
        console.log(`BALANCE FIX: Setting balance for group ${group.id} to 200 coins (initial reward)`);
        updatedBalances[group.id] = 500;
        fixedGroups.push(group.id);
        
        // Add to the list of groups that received initial reward
        if (!newRewardGroups.includes(group.id)) {
          newRewardGroups.push(group.id);
        }
      }
    }
    
    // If we fixed any groups, update the user document
    if (fixedGroups.length > 0) {
      console.log(`BALANCE FIX: Updating ${fixedGroups.length} group balances`);
      
      await updateDoc(userRef, {
        groupBalances: updatedBalances,
        initialRewardGroups: newRewardGroups,
        balanceFixedAt: new Date().toISOString(),
        balanceFixedGroups: fixedGroups
      });
      
      return { 
        success: true, 
        fixed: fixedGroups.length, 
        fixedGroups,
        balances: updatedBalances
      };
    }
    
    console.log('BALANCE FIX: No balance issues found');
    return { success: true, fixed: 0 };
  } catch (error) {
    console.error('BALANCE FIX: Error verifying balances:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Central function to manage a user's initial coin award when joining or creating a group
 * This is the ONLY function that should be used for initializing a user's coins in a group
 * All other balance initialization code should call this function
 * 
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @param {number} amount - The amount of coins to award (default: 500)
 * @param {string} source - The source of the initialization (for debugging)
 * @returns {Promise<{success: boolean, awarded: boolean, balance: number, reason: string}>}
 */
export const initializeUserCoinsInGroup = async (userId, groupId, amount = 500, source = 'unknown') => {
  if (!userId || !groupId) {
    return { 
      success: false, 
      awarded: false,
      balance: 0,
      reason: 'Invalid user or group ID' 
    };
  }
  
  try {
    console.log(`[COIN INIT] ${source}: Initializing coins for user ${userId} in group ${groupId}`);
    
    // Get user document
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      console.log(`[COIN INIT] ${source}: User document doesn't exist, creating it with initial coins`);
      
      // Create new user with coins and mark as received
      await setDoc(userRef, {
        uid: userId,
        groupBalances: { [groupId]: amount },
        initialRewardGroups: [groupId],
        coinAddedGroups: [groupId],
        coinInitSource: source,
        coinInitTimestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        awarded: true,
        balance: amount,
        reason: `New user document created with ${amount} coins`
      };
    }
    
    // User exists, get data
    const userData = userDoc.data();
    const groupBalances = userData.groupBalances || {};
    const currentBalance = groupBalances[groupId] || 0;
    
    // Track which groups have received initial reward
    const initialRewardGroups = Array.isArray(userData.initialRewardGroups) 
      ? userData.initialRewardGroups 
      : [];
    
    console.log(`[COIN INIT] ${source}: Current balance: ${currentBalance}, initialRewardGroups includes this group: ${initialRewardGroups.includes(groupId)}`);
      
    // IMPORTANT: Only use the protection if the balance is actually greater than 0
    // This prevents empty groups from being incorrectly marked as protected
    if (currentBalance > 0 && !initialRewardGroups.includes(groupId)) {
      console.log(`[COIN INIT] ${source}: User has coins but isn't marked as received, adding protection`);
      await updateDoc(userRef, {
        initialRewardGroups: arrayUnion(groupId),
        protectionAdded: new Date().toISOString(),
        protectionSource: `${source}_precheck`
      });
      
      // Update our local copy to reflect this change
      initialRewardGroups.push(groupId);
    }
      
    // FIXED: Check if the user has ACTUALLY received the reward - both flag and coins
    // CRITICAL UPDATE: The check has been modified to ONLY check if the initialRewardGroups includes the groupId,
    // regardless of the current balance. This prevents users from getting coins again if they spend them all.
    if (initialRewardGroups.includes(groupId)) {
      console.log(`[COIN INIT] ${source}: User already marked as received initial reward for group ${groupId}, current balance: ${currentBalance}`);
      
      // Return current balance without changing anything
      return {
        success: true,
        awarded: false,
        balance: currentBalance,
        reason: 'User already received initial reward for this group'
      };
    }
    
    // ONLY REACH HERE IF user hasn't received the initial reward for this group
    
    // Check if user already has coins in this group
    if (currentBalance > 0) {
      console.log(`[COIN INIT] ${source}: User already has ${currentBalance} coins in group ${groupId}`);
      
      // Add to initialRewardGroups to prevent future awards, but don't change balance
      await updateDoc(userRef, {
        initialRewardGroups: arrayUnion(groupId),
        lastInitCheck: new Date().toISOString(),
        initCheckSource: source
      });
      
      return {
        success: true,
        awarded: false,
        balance: currentBalance,
        reason: 'User already has coins in this group'
      };
    }
    
    // User has 0 coins and isn't marked as received - this is the only case where we award new coins
    
    console.log(`[COIN INIT] ${source}: Awarding ${amount} coins to user in group ${groupId}`);
    
    // Update balance and mark as received in a single atomic operation
    await updateDoc(userRef, {
      [`groupBalances.${groupId}`]: amount,
      initialRewardGroups: arrayUnion(groupId),
      coinInitSource: source,
      coinInitTimestamp: new Date().toISOString()
    });
    
    return {
      success: true,
      awarded: true,
      balance: amount,
      reason: `Successfully awarded ${amount} coins to user`
    };
  } catch (error) {
    console.error(`[COIN INIT] ${source}: Error:`, error);
    return {
      success: false,
      awarded: false,
      balance: 0,
      reason: `Error: ${error.message}`
    };
  }
};

/**
 * Ensures that a user's group is properly marked as having received initial reward
 * Call this whenever a balance might drop to 0 to prevent unwanted 200 coin awards
 * 
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @param {string} source - Source of the protection call for logging
 * @returns {Promise<boolean>} - True if protection was added, false if not needed
 */
export const ensureInitialRewardProtection = async (userId, groupId, source = 'unknown') => {
  if (!userId || !groupId) return false;
  
  try {
    console.log(`[PROTECTION] ${source}: Checking protections for ${userId} in group ${groupId}`);
    
    // Get user document
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      console.log(`[PROTECTION] ${source}: User document doesn't exist`);
      return false;
    }
    
    // Get current data
    const userData = userDoc.data();
    const groupBalances = userData.groupBalances || {};
    const currentBalance = groupBalances[groupId] || 0;
    const initialRewardGroups = Array.isArray(userData.initialRewardGroups) 
      ? userData.initialRewardGroups 
      : [];
    
    // Check if protection is needed
    // We always add protection if:
    // 1. Balance is 0 or very low and
    // 2. Group is not already in initialRewardGroups
    if (currentBalance <= 5 && !initialRewardGroups.includes(groupId)) {
      console.log(`[PROTECTION] ${source}: Adding protection for ${userId} in group ${groupId}`);
      
      // Update user document to mark this group as having received initial reward
      await updateDoc(userRef, {
        initialRewardGroups: arrayUnion(groupId),
        protectionTimestamp: new Date().toISOString(),
        protectionSource: source
      });
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`[PROTECTION] ${source}: Error:`, error);
    return false;
  }
};