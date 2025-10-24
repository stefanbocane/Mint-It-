/**
 * Backward Compatibility Hooks
 * 
 * These hooks maintain API compatibility with existing contexts while using
 * the optimized UnifiedUserDataContext underneath to eliminate redundant reads.
 */

import { useUnifiedUserData } from '../contexts/UnifiedUserDataContextSupabase';

/**
 * Backward compatible hook for GemContext
 * Replaces useGems() from GemContext
 */
export const useGems = () => {
  const { 
    gems, 
    isLoadingGems, 
    hasError, 
    error,
    subtractGems,
    addGems,
    userData,
    refreshUserData
  } = useUnifiedUserData();
  
  return {
    gems: userData?.gems || 0,
    isLoading: isLoadingGems,
    error: hasError ? error : null,
    subtractGems,
    addGems,
    refreshGems: refreshUserData
  };
};

/**
 * Backward compatible hook for BalanceContext  
 * Replaces useBalance() from BalanceContext
 */
export const useBalance = () => {
  const { 
    balance, 
    isLoadingBalance, 
    hasError, 
    error, 
    subtractCoins, 
    addCoins, 
    getBalance,
    refreshUserData,
    groupBalances
  } = useUnifiedUserData();
  
  return {
    balance,
    isLoading: isLoadingBalance,
    error: hasError ? error : null,
    subtractCoins,
    addCoins,
    getBalance,
    refreshBalance: refreshUserData,
    groupBalances,
    // Additional utility methods
    hasBalance: (amount, groupId = null) => {
      const currentBalance = typeof getBalance === 'function' ? getBalance(groupId) : balance;
      return currentBalance >= amount;
    },
    isUpdating: false // For compatibility with old BalanceContext
  };
};

/**
 * Backward compatible hook for Profile data
 * Can replace profile-related parts of existing contexts
 */
export const useProfile = () => {
  const { 
    username, 
    showcase, 
    cardBorders, 
    userData, 
    loading, 
    error, 
    getUserField,
    updateUserField 
  } = useUnifiedUserData();
  
  return {
    username,
    showcase,
    cardBorders,
    profile: userData,
    isLoading: loading,
    error,
    getUserField,
    updateUserField
  };
};

/**
 * General user data hook for components that need multiple user fields
 */
export const useUserData = (options = {}) => {
  const unifiedData = useUnifiedUserData();
  
  // If specific fields are requested, return only those
  if (options.fields && Array.isArray(options.fields)) {
    const { userData } = unifiedData;
    const filteredData = {};
    
    options.fields.forEach(field => {
      filteredData[field] = userData?.[field];
    });
    
    return {
      ...unifiedData,
      userData: filteredData
    };
  }
  
  return unifiedData;
}; 