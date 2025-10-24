import { doc, updateDoc } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { db } from '../config/firebase';
import AuctionCompletionService from '../services/AuctionCompletionService';
import CacheService from '../services/caching/CacheService';
import { getDoc, runTransaction } from '../services/ReadTracking/TrackedFirestore';
import { useAuth } from './AuthContextSupabase';
import { useGroup } from './GroupContextSupabase';

// Input validation utilities
const ValidationUtils = {
  validateAmount: (amount, context = 'operation') => {
    if (typeof amount !== 'number') {
      throw new Error(`${context}: Amount must be a number, received ${typeof amount}`);
    }
    if (isNaN(amount)) {
      throw new Error(`${context}: Amount cannot be NaN`);
    }
    if (!isFinite(amount)) {
      throw new Error(`${context}: Amount must be finite`);
    }
    if (amount < 0) {
      throw new Error(`${context}: Amount cannot be negative`);
    }
    if (amount === 0) {
      throw new Error(`${context}: Amount must be greater than zero`);
    }
    if (!Number.isInteger(amount)) {
      throw new Error(`${context}: Amount must be an integer`);
    }
    if (amount > Number.MAX_SAFE_INTEGER) {
      throw new Error(`${context}: Amount exceeds maximum safe integer`);
    }
    return true;
  },

  validateUserId: (userId, context = 'operation') => {
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      throw new Error(`${context}: Valid user ID is required`);
    }
    return true;
  },

  validateGroupId: (groupId, context = 'operation', allowNull = true) => {
    if (!allowNull && (!groupId || typeof groupId !== 'string' || groupId.trim() === '')) {
      throw new Error(`${context}: Valid group ID is required`);
    }
    if (groupId && (typeof groupId !== 'string' || groupId.trim() === '')) {
      throw new Error(`${context}: Group ID must be a non-empty string`);
    }
    return true;
  },

  sanitizeAmount: (amount) => {
    // Ensure amount is a positive integer
    const num = Math.abs(Math.floor(Number(amount)));
    return isFinite(num) ? num : 0;
  }
};

const UnifiedUserDataContext = createContext();

export const useUnifiedUserData = () => {
  const context = useContext(UnifiedUserDataContext);
  if (!context) {
    throw new Error('useUnifiedUserData must be used within a UnifiedUserDataProvider');
  }
  return context;
};

/**
 * Enhanced Unified User Data Provider
 * 
 * This consolidates all user data listeners (balance, gems, profile) into a single
 * real-time listener to reduce redundant reads of the same user document.
 * 
 * Replaces functionality from:
 * - GemContext
 * - BalanceContext  
 * - Profile-related parts of AuthContext
 */
export const UnifiedUserDataProvider = ({ children }) => {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  
  const { user } = useAuth();
  const { currentGroup } = useGroup();

  // Transaction batching for efficiency - Enhanced with race condition protection
  const pendingTransactions = useRef(new Map());
  const transactionTimeoutRef = useRef(null);
  const isProcessingBatch = useRef(false);
  const batchPromises = useRef(new Map()); // Track promises for queued operations
  
  // Initialize AuctionCompletionService when user and group are available
  useEffect(() => {
    if (user?.uid && currentGroup?.id) {
      console.log('🎯 Initializing AuctionCompletionService for automatic rarity updates');
      AuctionCompletionService.initialize(user.uid, currentGroup.id);
    } else {
      console.log('🧹 Cleaning up AuctionCompletionService');
      AuctionCompletionService.cleanup();
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      AuctionCompletionService.cleanup();
    };
  }, [user?.uid, currentGroup?.id]);
  
  // Batch multiple balance/gem operations into a single Firestore transaction
  const batchTransaction = useCallback(async (operations) => {
    if (!user?.uid || operations.length === 0) return { success: false, error: 'Invalid parameters' };
    
    // Validate all operations first
    try {
      for (const operation of operations) {
        ValidationUtils.validateAmount(operation.amount, `Batch ${operation.type}`);
        if (operation.groupId) {
          ValidationUtils.validateGroupId(operation.groupId, `Batch ${operation.type}`, false);
        }
      }
    } catch (validationError) {
      console.error('❌ Batch validation failed:', validationError);
      return { success: false, error: validationError.message };
    }
    
    try {
      const userRef = doc(db, 'users', user.uid, 'sessions', 'main');
      
      const result = await runTransaction(db, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        
        // If user document doesn't exist (e.g., new user or deleted), create a minimal one on-the-fly
        let currentData;
        if (!userDoc.exists()) {
          currentData = {
            gems: 0,
            groupBalances: {},
            createdAt: new Date(),
            lastUpdated: new Date(),
          };
          transaction.set(userRef, currentData); // initialize the document
        } else {
          currentData = userDoc.data();
        }
        
        const updates = { lastUpdated: new Date() };
        const results = [];
        
        // Apply all operations with validation
        for (const operation of operations) {
          const { type, field, amount, groupId } = operation;
          
          if (field === 'gems') {
            const currentGems = currentData.gems || 0;
            const newGems = type === 'add' ? currentGems + amount : currentGems - amount;
            
            if (newGems < 0) {
              throw new Error(`Insufficient gems: ${currentGems} < ${amount}`);
            }
            
            updates.gems = newGems;
            results.push({ type, field, oldValue: currentGems, newValue: newGems });
          } else if (field.startsWith('groupBalances.')) {
            const groupBalances = currentData.groupBalances || {};
            const currentBalance = groupBalances[groupId] || 0;
            const newBalance = type === 'add' ? currentBalance + amount : currentBalance - amount;
            
            if (newBalance < 0) {
              throw new Error(`Insufficient balance: ${currentBalance} < ${amount}`);
            }
            
            updates[`groupBalances.${groupId}`] = newBalance;
            results.push({ type, field: groupId, oldValue: currentBalance, newValue: newBalance });
          }
        }
        
        transaction.update(userRef, updates);
        return { success: true, updates, results };
      });
      
      console.log(`✅ Batched ${operations.length} operations successfully`, result);
      return result;
    } catch (error) {
      console.error('❌ Transaction failed:', error);
      return { success: false, error: error.message };
    }
  }, [user?.uid]);
  
  // Enhanced queue operation with promise tracking
  const queueOperation = useCallback((operation) => {
    return new Promise((resolve, reject) => {
      const operationId = `${operation.type}_${operation.field}_${Date.now()}_${Math.random()}`;
      
      // Store operation with promise resolvers
      pendingTransactions.current.set(operationId, operation);
      batchPromises.current.set(operationId, { resolve, reject });
      
      // If already processing a batch, wait for it to complete
      if (isProcessingBatch.current) {
        return; // Operation will be included in next batch
      }
      
      // Clear existing timeout
      if (transactionTimeoutRef.current) {
        clearTimeout(transactionTimeoutRef.current);
      }
      
      // Process batch after collecting operations
      transactionTimeoutRef.current = setTimeout(async () => {
        if (isProcessingBatch.current) return; // Prevent concurrent processing
        
        isProcessingBatch.current = true;
        
        const operations = Array.from(pendingTransactions.current.values());
        const promises = Array.from(batchPromises.current.values());
        const operationIds = Array.from(pendingTransactions.current.keys());
        
        // Clear pending operations
        pendingTransactions.current.clear();
        batchPromises.current.clear();
        
        if (operations.length > 0) {
          try {
            const result = await batchTransaction(operations);
            
            // Resolve all promises
            promises.forEach(({ resolve }) => resolve(result));
          } catch (error) {
            console.error('Batch transaction failed:', error);
            
            // Reject all promises
            promises.forEach(({ reject }) => reject(error));
          }
        }
        
        isProcessingBatch.current = false;
      }, 150); // Slightly longer delay for better batching
    });
  }, [batchTransaction]);

  // 🚀 OPTIMIZED: Cached fetch instead of real-time listener
  // This eliminates 30-50+ reads per session from continuous listener updates
  useEffect(() => {
    if (!user?.uid) {
      setUserData(null);
      setLoading(false);
      return;
    }

    let isMounted = true;

    const loadUserData = async () => {
      try {
        setLoading(true);
        setError(null);

        // 1. Check cache first (2-hour TTL for user data)
        const cacheKey = `unified_user_${user.uid}`;
        const cached = await CacheService.getValue(cacheKey);
        
        if (cached && cached.data && Date.now() - (cached.timestamp || 0) < 2 * 60 * 60 * 1000) {
          if (isMounted) {
            setUserData(cached.data);
            setLastUpdated(new Date(cached.timestamp));
            setLoading(false);
            console.log('✅ Unified user data loaded from cache (no read)');
          }
          return;
        }

        // 2. Cache miss: fetch once from Firestore (sessions/main document where balances are stored)
        const userSessionRef = doc(db, 'users', user.uid, 'sessions', 'main');
        const userSnap = await getDoc(userSessionRef);

        // Track read for monitoring

        if (!isMounted) return;

        if (userSnap.exists()) {
          const data = { id: userSnap.id, ...userSnap.data() };
          setUserData(data);
          setLastUpdated(new Date());

          // Cache with 2-hour TTL
          await CacheService.setValue(cacheKey, {
            data,
            timestamp: Date.now()
          }, { ttl: 2 * 60 * 60 * 1000 });

          console.log('✅ Unified user data loaded from Firestore sessions/main (1 read)');
        } else {
          console.warn('⚠️ User session document does not exist');
          setUserData(null);
        }
      } catch (err) {
        console.error('❌ Error loading user data:', err);
        if (isMounted) {
          setError(err);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadUserData();

    // Cleanup function
    return () => {
      isMounted = false;
      console.log('🧹 Cleaning up UnifiedUserData and pending operations...');
      
      // Clear any pending transaction timeouts
      if (transactionTimeoutRef.current) {
        clearTimeout(transactionTimeoutRef.current);
        transactionTimeoutRef.current = null;
      }
      
      // Set processing flag to prevent new operations
      isProcessingBatch.current = true;
      
      // Execute any remaining batched operations before unmount
      const pendingOps = Array.from(pendingTransactions.current.values());
      const pendingPromises = Array.from(batchPromises.current.values());
      
      if (pendingOps.length > 0) {
        console.log(`🧹 Executing ${pendingOps.length} pending operations before unmount`);
        
        // Execute operations synchronously during cleanup
        batchTransaction(pendingOps)
          .then(result => {
            console.log('✅ Cleanup operations completed successfully', result);
            // Resolve pending promises
            pendingPromises.forEach(({ resolve }) => resolve(result));
          })
          .catch(err => {
            console.error('❌ Error executing pending operations on unmount:', err);
            // Reject pending promises
            pendingPromises.forEach(({ reject }) => reject(err));
          })
          .finally(() => {
            // Clear all pending data
            pendingTransactions.current.clear();
            batchPromises.current.clear();
          });
      } else {
        // Clear maps even if no pending operations
        pendingTransactions.current.clear();
        batchPromises.current.clear();
      }
    };
  }, [user?.uid, batchTransaction]);

  // Cached fetch method for one-time data access
  const fetchUserData = useCallback(async (forceRefresh = false) => {
    if (!user?.uid) return null;

    try {
      setLoading(true);
      setError(null);

      const cacheKey = `unified_user_${user.uid}`;
      
      // Check cache first unless forcing refresh
      if (!forceRefresh) {
        const cached = await CacheService.getValue(cacheKey);
        if (cached && cached.data && Date.now() - (cached.timestamp || 0) < 2 * 60 * 60 * 1000) {
          setUserData(cached.data);
          setLastUpdated(new Date(cached.timestamp));
          console.log('✅ Fetch user data from cache (no read)');
          return cached.data;
        }
      }

      // Cache miss or force refresh: fetch from Firestore (sessions/main document where balances are stored)
      const userSessionRef = doc(db, 'users', user.uid, 'sessions', 'main');
      const userSnap = await getDoc(userSessionRef);

      // Track read

      if (userSnap.exists()) {
        const userData = { id: userSnap.id, ...userSnap.data() };
        setUserData(userData);
        setLastUpdated(new Date());

        // Update cache
        await CacheService.setValue(cacheKey, {
          data: userData,
          timestamp: Date.now()
        }, { ttl: 2 * 60 * 60 * 1000 });

        console.log(`✅ Fetch user data from Firestore sessions/main (1 read)${forceRefresh ? ' [forced]' : ''}`);
        return userData;
      }
      
      return null;
    } catch (err) {
      console.error('Error fetching user data:', err);
      setError(err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  // Refresh user data (force refresh - manual only)
  const refreshUserData = useCallback(() => {
    console.log('🔄 Manual user data refresh requested');
    return fetchUserData(true);
  }, [fetchUserData]);

  // Get specific user field with caching
  const getUserField = useCallback(async (field, options = {}) => {
    if (!user?.uid) return options.defaultValue || null;

    // Try from current state first
    if (userData && userData[field] !== undefined) {
      return userData[field];
    }

    try {
      const sessionRef = doc(db, 'users', user.uid, 'sessions', 'main');
      const userData = await CacheService.getDocument(sessionRef, {
        ttl: options.ttl || 2 * 60 * 1000, // 2 minute cache for individual fields
        forceRefresh: options.forceRefresh || false
      });

      return userData?.[field] || options.defaultValue || null;
    } catch (err) {
      console.error(`Error fetching user field ${field}:`, err);
      return options.defaultValue || null;
    }
  }, [user?.uid, userData]);

  // Get group-specific balance
  const getBalance = useCallback((groupId = null) => {
    const targetGroupId = groupId || currentGroup?.id;
    if (!targetGroupId || !userData) return 0;
    
    return userData.groupBalances?.[targetGroupId] || 0;
  }, [userData, currentGroup?.id]);

  // Update user field (with optimistic updates and smarter caching)
  const updateUserField = useCallback(async (field, value, options = {}) => {
    if (!user?.uid) return false;

    try {
      // Store original value for potential revert
      const originalValue = userData?.[field];
      
      // Optimistic update
      if (options.optimistic !== false && userData) {
        setUserData(prev => ({
          ...prev,
          [field]: value
        }));
      }

      // Actual Firestore update
      const userRef = doc(db, 'users', user.uid, 'sessions', 'main');
      await updateDoc(userRef, {
        [field]: value,
        lastUpdated: new Date()
      });
      
      // Update cache with new value instead of invalidating
      if (userData) {
        const updatedData = { ...userData, [field]: value, lastUpdated: new Date() };
        await CacheService.setValue(`unified_user_${user.uid}`, updatedData, { 
          ttl: 10 * 60 * 1000 // Keep same TTL as listener cache
        });
        console.log(`📦 Cache updated for field: ${field}`);
      }
      
      return true;
    } catch (err) {
      console.error(`Error updating user field ${field}:`, err);
      
      // Revert optimistic update on error
      if (options.optimistic !== false && userData && originalValue !== undefined) {
        setUserData(prev => ({
          ...prev,
          [field]: originalValue
        }));
      }
      
      return false;
    }
  }, [user?.uid, userData]);

  // Shared coin operation utility to reduce duplication
  const performCoinOperation = useCallback(async (operationType, amount, groupId = null) => {
    try {
      // Input validation
      ValidationUtils.validateAmount(amount, `${operationType}Coins`);
      ValidationUtils.validateUserId(user?.uid, `${operationType}Coins`);
      
      const targetGroupId = groupId || currentGroup?.id;
      ValidationUtils.validateGroupId(targetGroupId, `${operationType}Coins`, false);
      
      const currentBalance = getBalance(targetGroupId);
      
      // Check sufficient funds for subtraction
      if (operationType === 'subtract' && currentBalance < amount) {
        const error = `Insufficient balance: ${currentBalance} < ${amount}`;
        console.warn(`❌ ${operationType}Coins failed: ${error}`);
        return { success: false, error, currentBalance };
      }
      
      // Calculate new balance
      const newBalance = operationType === 'add' ? currentBalance + amount : currentBalance - amount;
      
      // Apply optimistic update IMMEDIATELY for better UX
      setUserData(prev => ({
        ...prev,
        groupBalances: {
          ...prev?.groupBalances,
          [targetGroupId]: newBalance
        }
      }));
      
      // Update Firestore IMMEDIATELY (synchronous) to prevent data loss on reload
      try {
        const userRef = doc(db, 'users', user.uid, 'sessions', 'main');
        await updateDoc(userRef, {
          [`groupBalances.${targetGroupId}`]: newBalance,
          lastUpdated: new Date()
        });
        
        console.log(`✅ ${operationType}Coins applied and persisted: ${amount} coins. Balance: ${currentBalance} → ${newBalance}`);
        return { success: true, oldBalance: currentBalance, newBalance, amount };
      } catch (error) {
        console.error(`❌ Failed to persist ${operationType}Coins:`, error);
        // Revert optimistic update on failure
        setUserData(prev => ({
          ...prev,
          groupBalances: {
            ...prev?.groupBalances,
            [targetGroupId]: currentBalance
          }
        }));
        return { success: false, error: error.message, currentBalance };
      }
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      console.error(`❌ Error in ${operationType}Coins:`, errorMsg);
      return { success: false, error: errorMsg, currentBalance: getBalance(groupId) };
    }
  }, [user?.uid, currentGroup?.id, getBalance, queueOperation, setUserData]);

  // Shared gem operation utility to reduce duplication and improve validation
  const performGemOperation = useCallback(async (operationType, amount, options = {}) => {
    try {
      // Input validation
      ValidationUtils.validateAmount(amount, `${operationType}Gems`);
      ValidationUtils.validateUserId(user?.uid, `${operationType}Gems`);
      
      const { groupId = null, useGlobal = false } = options;
      const targetGroupId = !useGlobal && groupId ? groupId : (useGlobal ? null : currentGroup?.id);
      
      if (targetGroupId) {
        ValidationUtils.validateGroupId(targetGroupId, `${operationType}Gems`, false);
      }
      
      // Check current gem balance
      const currentGems = targetGroupId && userData?.groupGems?.[targetGroupId] !== undefined 
        ? userData.groupGems[targetGroupId] 
        : userData?.gems || 0;
      
      // Check sufficient funds for subtraction
      if (operationType === 'subtract' && currentGems < amount) {
        const location = targetGroupId ? `group: ${targetGroupId}` : 'global';
        const error = `Insufficient gems: ${currentGems} < ${amount} (${location})`;
        console.warn(`❌ ${operationType}Gems failed: ${error}`);
        return { success: false, error, currentGems };
      }
      
      // Calculate new gem balance
      const newGems = operationType === 'add' ? currentGems + amount : currentGems - amount;
      
      // Apply optimistic update IMMEDIATELY for better UX
      if (targetGroupId) {
        // Group-specific gems
        setUserData(prev => ({
          ...prev,
          groupGems: {
            ...prev?.groupGems,
            [targetGroupId]: newGems
          }
        }));
      } else {
        // Global gems
        setUserData(prev => ({
          ...prev,
          gems: newGems
        }));
      }
      
      // Update Firestore IMMEDIATELY (synchronous) to prevent data loss on reload
      try {
        const userSessionRef = doc(db, 'users', user.uid, 'sessions', 'main');
        const updateData = targetGroupId
          ? { [`groupGems.${targetGroupId}`]: newGems, lastUpdated: new Date() }
          : { gems: newGems, lastUpdated: new Date() };

        await updateDoc(userSessionRef, updateData);

        console.log(`✅ ${operationType}Gems applied and persisted: ${amount} gems. Balance: ${currentGems} → ${newGems}`);
        return { success: true, oldBalance: currentGems, newBalance: newGems, amount };
      } catch (error) {
        console.error(`❌ Failed to persist ${operationType}Gems:`, error);
        // Revert optimistic update on failure
        if (targetGroupId) {
          setUserData(prev => ({
            ...prev,
            groupGems: {
              ...prev?.groupGems,
              [targetGroupId]: currentGems
            }
          }));
        } else {
          setUserData(prev => ({
            ...prev,
            gems: currentGems
          }));
        }
        return { success: false, error: error.message, currentGems };
      }
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      console.error(`❌ Error in ${operationType}Gems:`, errorMsg);
      return { success: false, error: errorMsg, currentGems: 0 };
    }
  }, [user?.uid, currentGroup?.id, userData]);

  // Computed values for backward compatibility with existing contexts
  const computedValues = {
    // Gems context compatibility - use global gems by default, but provide access to group gems
    gems: userData?.gems || 0,
    groupGems: userData?.groupGems || {},
    getGems: (groupId = null) => {
      if (groupId && userData?.groupGems?.[groupId] !== undefined) {
        return userData.groupGems[groupId];
      }
      return userData?.gems || 0;
    },
    isLoadingGems: loading,
    
    // Balance context compatibility  
    balance: getBalance(),
    isLoadingBalance: loading,
    groupBalances: userData?.groupBalances || {},
    
    // Profile context compatibility
    username: userData?.username || user?.email?.split('@')[0] || 'Unknown',
    showcase: userData?.showcase || Array(3).fill(null),
    cardBorders: userData?.cardBorders || ['default'],
    hasInitialReward: (groupId = null) => {
      const targetGroupId = groupId || currentGroup?.id;
      return userData?.initialRewardGroups?.includes(targetGroupId) || false;
    }
  };

  // Context value with all necessary methods and data
  const contextValue = {
    // Core data
    userData,
    loading,
    error,
    lastUpdated,

    // Methods
    fetchUserData,
    refreshUserData,
    getUserField,
    getBalance,
    updateUserField,

    // Computed values for compatibility
    ...computedValues,

    // Utilities
    isReady: !loading && !error && userData !== null,
    hasError: !!error,
    isEmpty: !loading && !error && userData === null,

    // Backward compatibility methods (now with efficient batching)
    subtractCoins: async (amount, groupId = null) => {
      const result = await performCoinOperation('subtract', amount, groupId);
      return result.success;
    },
    
    addCoins: async (amount, groupId = null) => {
      const result = await performCoinOperation('add', amount, groupId);
      return result.success;
    },
    
    // Add gem operations (with batching)
    subtractGems: async (amount, options = {}) => {
      const result = await performGemOperation('subtract', amount, options);
      return result.success;
    },
    
    addGems: async (amount, options = {}) => {
      const result = await performGemOperation('add', amount, options);
      return result.success;
    },
    
    // Bulk operations for even better efficiency
    executeBulkOperation: async (operations) => {
      try {
        const batchOps = operations.map(op => {
          if (op.type === 'subtractCoins' || op.type === 'addCoins') {
            const targetGroupId = op.groupId || currentGroup?.id;
            return {
              type: op.type === 'addCoins' ? 'add' : 'subtract',
              field: `groupBalances.${targetGroupId}`,
              amount: op.amount,
              groupId: targetGroupId
            };
          } else if (op.type === 'subtractGems' || op.type === 'addGems') {
            return {
              type: op.type === 'addGems' ? 'add' : 'subtract',
              field: 'gems',
              amount: op.amount
            };
          }
          return null;
        }).filter(Boolean);
        
        if (batchOps.length > 0) {
          await queueOperation(batchOps[0]);
          console.log(`✅ Executed bulk operation with ${batchOps.length} operations`);
          return true;
        }
        
        return false;
      } catch (error) {
        console.error('Error in executeBulkOperation:', error);
        return false;
      }
    }
  };

  return (
    <UnifiedUserDataContext.Provider value={contextValue}>
      {children}
    </UnifiedUserDataContext.Provider>
  );
};

export default UnifiedUserDataContext; 