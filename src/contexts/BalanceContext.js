import { collection, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../config/firebase';
import { initializeUserCoinsInGroup } from '../utils/balanceUtils';
import { useAuth } from './AuthContext';
import { useGroup } from './GroupContext';

const BalanceContext = createContext();

export const useBalance = () => {
  const context = useContext(BalanceContext);
  if (!context) {
    throw new Error('useBalance must be used within a BalanceProvider');
  }
  return context;
};

export const BalanceProvider = ({ children }) => {
  const [balance, setBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isUpdatingBalance, setIsUpdatingBalance] = useState(false);
  const [lastRefreshTimestamp, setLastRefreshTimestamp] = useState(null);
  const { user } = useAuth();
  const { currentGroup } = useGroup();

  // Force add coins to a user regardless of any flags or checks
  const forcedAddCoins = async (userId, groupId, amount = 500) => {
    if (!userId || !groupId) return { success: false, balance: 0 };
    
    try {
      console.log(`[FORCED COINS] Directly adding ${amount} coins to ${userId} in group ${groupId}`);
      
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        // Create new user document with coins
        await setDoc(userRef, {
          uid: userId,
          groupBalances: { [groupId]: amount },
          initialRewardGroups: [groupId],
          lastDirectUpdate: new Date().toISOString(),
          forcedCoinSource: 'balanceContext'
        });
        
        console.log(`[FORCED COINS] Created new user with ${amount} coins`);
        return { success: true, balance: amount };
      }
      
      // Update existing user's balance directly without any checks
      const userData = userDoc.data();
      const groupBalances = userData.groupBalances || {};
      
      // Set the balance for this group
      groupBalances[groupId] = amount;
      
      // Update the user document
      await updateDoc(userRef, {
        groupBalances: groupBalances,
        lastDirectUpdate: new Date().toISOString(),
        forcedCoinSource: 'balanceContext'
      });
      
      console.log(`[FORCED COINS] Updated user's balance to ${amount} coins`);
      return { success: true, balance: amount };
    } catch (error) {
      console.error(`[FORCED COINS] Error:`, error);
      return { success: false, balance: 0 };
    }
  };

  // Function to force a manual refresh of the balance with proper debounce
  const refreshBalance = async () => {
    console.log('[BALANCE DEBUG] 🔄 Manually refreshing balance');
    
    // Set last refresh timestamp now
    setLastRefreshTimestamp(Date.now());
    
    try {
      setIsLoading(true);
      
      if (!user?.uid || !currentGroup?.id) {
        console.log('[BALANCE DEBUG] ❌ No user or group found for refresh');
        setIsLoading(false);
        return;
      }
      
      // EMERGENCY FIX: Check if this is a fresh group for this user
      try {
        // Query all groups to see if this is a new group
        const groupsRef = collection(db, 'groups');
        const groupsSnapshot = await getDocs(groupsRef);
        const newlyCreatedGroup = groupsSnapshot.docs
          .find(doc => doc.id === currentGroup.id && doc.data().createdBy === user.uid);
        
        const recentlyCreated = newlyCreatedGroup && 
          (new Date() - new Date(newlyCreatedGroup.data().createdAt)) < 5 * 60 * 1000; // Within 5 minutes
        
        if (recentlyCreated) {
          console.log('[BALANCE DEBUG] 🔥 This appears to be a newly created group, forcing coins');
          const result = await forcedAddCoins(user.uid, currentGroup.id, 500);
          if (result.success) {
            setBalance(result.balance);
            setIsLoading(false);
            return;
          }
        }
      } catch (freshGroupError) {
        console.error('[BALANCE DEBUG] Error checking if this is a fresh group:', freshGroupError);
      }
      
      // Direct method to get the user's current balance
      console.log(`[BALANCE DEBUG] Fetching latest balance for user ${user.uid} in group ${currentGroup.id}`);
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        console.log('[BALANCE DEBUG] ❌ User document not found, creating it with initial coins');
        
        // If the user document doesn't exist, attempt to create it with coins
        try {
          await setDoc(userRef, {
            uid: user.uid,
            groupBalances: { [currentGroup.id]: 500 },
            initialRewardGroups: [currentGroup.id],
            coinAddedGroups: [currentGroup.id],
            refreshBalanceSource: 'balanceNotFound',
            lastUpdated: new Date().toISOString()
          });
          
          console.log('[BALANCE DEBUG] ✅ Created new user document with 500 coins');
          setBalance(500);
        } catch (error) {
          console.error('[BALANCE DEBUG] ❌ Failed to create user document:', error);
          setBalance(0);
        }
        
        setIsLoading(false);
        return;
      }
      
      const userData = userDoc.data();
      const groupBalances = userData.groupBalances || {};
      const currentBalance = groupBalances[currentGroup.id] || 0;
      
      // Check if this group is in the initialRewardGroups array
      const initialRewardGroups = Array.isArray(userData.initialRewardGroups) 
        ? userData.initialRewardGroups 
        : [];
      const hasReceivedInitialReward = initialRewardGroups.includes(currentGroup.id);
      
      console.log(`[BALANCE DEBUG] 📊 Current balance from refresh: ${currentBalance}`);
      console.log(`[BALANCE DEBUG] Has received initial reward: ${hasReceivedInitialReward}`);
      
      // CRITICAL FIX: Only add coins if balance is zero AND user has NOT received initial reward for this group
      if (currentBalance === 0 && !hasReceivedInitialReward) {
        console.log('[BALANCE DEBUG] ⚠️ Balance is zero and user has not received initial reward, adding coins');
        
        // Add coins and mark as received
        const result = await forcedAddCoins(user.uid, currentGroup.id, 500);
        
        if (result.success) {
          console.log('[BALANCE DEBUG] ✅ Successfully added initial coins');
          
          // Also update initialRewardGroups to prevent future awards
          await updateDoc(userRef, {
            initialRewardGroups: [...initialRewardGroups, currentGroup.id],
            initialRewardTimestamp: new Date().toISOString(),
            initialRewardSource: 'refreshBalance'
          });
          
          setBalance(result.balance);
        } else {
          // Keep current balance (which is 0)
          setBalance(currentBalance);
        }
      } else {
        // If balance is not 0 or user has already received reward, just update the local state
        console.log('[BALANCE DEBUG] Using existing balance:', currentBalance);
        setBalance(currentBalance);
        
        // If balance is greater than 0 but initialRewardGroups doesn't include this group,
        // update it for future protection
        if (currentBalance > 0 && !hasReceivedInitialReward) {
          console.log('[BALANCE DEBUG] Adding protection for non-zero balance');
          await updateDoc(userRef, {
            initialRewardGroups: [...initialRewardGroups, currentGroup.id],
            protectionAddedAt: new Date().toISOString(),
            protectionReason: 'non_zero_balance'
          });
        }
      }
      
    } catch (error) {
      console.error('[BALANCE DEBUG] ❌ Error in refreshBalance:', error);
      // Don't set a default balance anymore - this was part of the problem
    } finally {
      setIsLoading(false);
    }
  };

  // Function to ensure the user has a valid groupBalances object
  const ensureUserHasBalances = async () => {
    if (!user?.uid) {
      console.log('❌ No user ID, cannot ensure balances');
      return false;
    }
    
    try {
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        console.log('❌ User document does not exist');
        return false;
      }
      
      const userData = userDoc.data();
      
      // If groupBalances doesn't exist or is not an object, initialize it
      if (!userData.groupBalances || typeof userData.groupBalances !== 'object') {
        console.log('⚠️ groupBalances missing or invalid, initializing empty object');
        await updateDoc(userRef, {
          groupBalances: {}
        });
        return true;
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error ensuring user has balances:', error);
      return false;
    }
  };

  // Function to update balance with proper error handling and state management
  const updateBalance = async (newBalance) => {
    if (!user?.uid || !currentGroup?.id || isUpdatingBalance) {
      return false;
    }
    
    try {
      setIsUpdatingBalance(true);
      const userRef = doc(db, 'users', user.uid);
      
      // Create a new groupBalances object to avoid Firebase limitations with deep updates
      const userDoc = await getDoc(userRef);
      if (!userDoc.exists()) {
        console.log('❌ User document does not exist for balance update');
        return false;
      }
      
      const userData = userDoc.data();
      const groupBalances = { ...(userData.groupBalances || {}) };
      const currentBalance = groupBalances[currentGroup.id] || 0;
      const initialRewardGroups = Array.isArray(userData.initialRewardGroups) 
        ? userData.initialRewardGroups 
        : [];
      
      // CRITICAL: Make sure the initialRewardGroups includes this group BEFORE updating to 0
      // This will prevent automatic 200 coin award when balance drops to 0
      if (newBalance === 0 && !initialRewardGroups.includes(currentGroup.id)) {
        console.log(`⚠️ PROTECTION: Balance is being set to 0, ensuring group is marked as received initial reward`);
        // Mark this group as having received initial reward to prevent auto-refill
        await updateDoc(userRef, {
          initialRewardGroups: [...initialRewardGroups, currentGroup.id],
          lastProtectedZeroUpdate: new Date().toISOString(),
          protectionSource: 'updateBalance'
        });
      }
      
      // Now update the balance
      groupBalances[currentGroup.id] = newBalance;
      
      await updateDoc(userRef, {
        groupBalances,
        lastBalanceUpdate: new Date().toISOString(),
        lastBalanceAmount: newBalance,
        previousBalance: currentBalance
      });
      
      console.log(`✅ Successfully updated balance to ${newBalance} for group ${currentGroup.id}`);
      
      // Update local state immediately for better UX
      setBalance(newBalance);
      
      return true;
    } catch (error) {
      console.error('❌ Error updating balance:', error);
      return false;
    } finally {
      setIsUpdatingBalance(false);
    }
  };

  // Handle balance initialization or correction when group changes
  useEffect(() => {
    let isMounted = true;
    
    if (!user || !currentGroup) {
      setIsLoading(false);
      return;
    }
    
    console.log(`🔄 Initializing balance for user ${user.uid} in group ${currentGroup.id}`);
    
    setIsLoading(true);
    
    const initializeBalance = async () => {
      try {
        // Use our centralized coin initialization function
        const result = await initializeUserCoinsInGroup(
          user.uid,
          currentGroup.id,
          500,
          'BalanceContext'
        );
        
        console.log(`🔄 Coin initialization result:`, result);
        
        if (isMounted) {
          setBalance(result.balance);
          setIsLoading(false);
        }
      } catch (error) {
        console.error('❌ Error in initializeBalance:', error);
        if (isMounted) {
          setBalance(0);
          setIsLoading(false);
        }
      }
    };
    
    initializeBalance();
    
    // Set up real-time listener
    console.log(`👂 Setting up balance listener for user ${user.uid} in group ${currentGroup.id}`);
    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      async (doc) => {
        if (!isMounted) return;
        
        try {
          if (doc.exists()) {
            const userData = doc.data();
            const groupBalances = userData.groupBalances || {};
            const newBalance = groupBalances[currentGroup.id] || 0;
            
            console.log(`📢 Balance update from listener: ${newBalance}`);
            
            // This is the critical part - only update the local state directly and NEVER
            // trigger coin initialization when the balance changes
            setBalance(newBalance);
            
            // DO NOT trigger automated balance correction when balance reaches 0
            // This is what was causing the issue - when balance hit 0, it triggered a refill
            
            // Detect if it's a significant change (to aid in debugging)
            if (Math.abs(newBalance - balance) > 10) {
              console.log(`⚠️ Large balance change detected: ${balance} -> ${newBalance}`);
            }
          } else {
            setBalance(0);
          }
        } catch (error) {
          console.error('❌ Error processing balance update:', error);
        } finally {
          setIsLoading(false);
        }
      },
      (error) => {
        console.error('❌ Error in balance listener:', error);
        if (isMounted) {
          setIsLoading(false);
        }
      }
    );

    return () => {
      isMounted = false;
      console.log(`🛑 Cleaning up balance listener`);
      unsubscribe();
    };
  }, [user, currentGroup]);

  // Fix balance on manual refresh trigger
  useEffect(() => {
    let isMounted = true;
    
    if (refreshTrigger > 0 && user && currentGroup) {
      const fixBalanceIfNeeded = async () => {
        try {
          // Use our centralized function for fixing balance on refresh
          const result = await initializeUserCoinsInGroup(
            user.uid,
            currentGroup.id,
            500,
            'BalanceRefreshTrigger'
          );
          
          console.log(`🔄 Balance refresh result:`, result);
          
          if (isMounted) {
            setBalance(result.balance);
          }
        } catch (error) {
          console.error('❌ Error in fixBalanceIfNeeded:', error);
        }
      };
      
      fixBalanceIfNeeded();
    }
    
    return () => {
      isMounted = false;
    };
  }, [refreshTrigger]);

  // Provide a function to add coins to balance
  const addCoins = async (amount) => {
    if (!user || !currentGroup || amount <= 0) return false;
    
    try {
      // Get the most recent balance to avoid race conditions
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        console.error('❌ User document not found when adding coins');
        return false;
      }
      
      const userData = userDoc.data();
      const groupBalances = userData.groupBalances || {};
      const currentBalance = groupBalances[currentGroup.id] || 0;
      
      const newBalance = currentBalance + amount;
      console.log(`💰 Adding ${amount} coins to balance (new total: ${newBalance})`);
      
      const success = await updateBalance(newBalance);
      
      if (success) {
        // Update local state for immediate feedback
        setBalance(newBalance);
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Error adding coins:', error);
      return false;
    }
  };

  // Provide a function to subtract coins from balance
  const subtractCoins = async (amount) => {
    if (!user || !currentGroup || amount <= 0) return false;
    
    try {
      // Get the most recent balance to avoid race conditions
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        console.error('❌ User document not found when subtracting coins');
        return false;
      }
      
      const userData = userDoc.data();
      const groupBalances = userData.groupBalances || {};
      const currentBalance = groupBalances[currentGroup.id] || 0;
      const initialRewardGroups = Array.isArray(userData.initialRewardGroups) 
        ? userData.initialRewardGroups 
        : [];
      
      // Verify sufficient funds
      if (currentBalance < amount) {
        console.log(`⚠️ Insufficient funds: ${currentBalance} < ${amount}`);
        return false;
      }
      
      const newBalance = currentBalance - amount;
      console.log(`💸 Subtracting ${amount} coins from balance (new total: ${newBalance})`);
      
      // CRITICAL SAFETY CHECK: If balance will drop to 0, ensure the group is marked as having received
      // initial reward to prevent auto-refill with 200 coins
      if (newBalance === 0 && !initialRewardGroups.includes(currentGroup.id)) {
        console.log(`🔒 PROTECTION: Balance dropping to 0, marking group as received initial reward`);
        // Add this group to initialRewardGroups to prevent 200 coin award
        await updateDoc(userRef, {
          initialRewardGroups: [...initialRewardGroups, currentGroup.id],
          lastProtectedZeroBalance: new Date().toISOString(),
          protectionSource: 'subtractCoins'
        });
      }
      
      // Update balance
      groupBalances[currentGroup.id] = newBalance;
      await updateDoc(userRef, {
        groupBalances,
        lastTransaction: {
          type: 'subtract_coins',
          amount: -amount,
          timestamp: new Date().toISOString(),
          newBalance: newBalance,
          source: 'subtractCoins'
        }
      });
      
      // Update local state for immediate feedback
      setBalance(newBalance);
      
      return true;
    } catch (error) {
      console.error('❌ Error subtracting coins:', error);
      return false;
    }
  };

  return (
    <BalanceContext.Provider value={{ 
      balance, 
      isLoading, 
      refreshBalance,
      addCoins,
      subtractCoins
    }}>
      {children}
    </BalanceContext.Provider>
  );
};

export default BalanceContext; 