import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Utilities for persisting view state across navigation and app restarts
 * Helps reduce redundant queries by storing and reusing UI state
 */

const VIEW_STATE_PREFIX = 'view_state_';
const VIEW_STATE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Save view state for a screen
 * 
 * @param {string} screenName - Screen identifier
 * @param {Object} state - State data to save
 * @param {number} ttl - Optional custom TTL in milliseconds
 * @returns {Promise<void>}
 */
export const saveViewState = async (screenName, state, ttl = VIEW_STATE_TTL) => {
  if (!screenName || !state) return;
  
  try {
    const key = `${VIEW_STATE_PREFIX}${screenName}`;
    await AsyncStorage.setItem(key, JSON.stringify({
      data: state,
      timestamp: Date.now(),
      ttl
    }));
    console.log(`Saved view state for ${screenName}`);
  } catch (error) {
    console.warn('Error saving view state:', error);
  }
};

/**
 * Load view state for a screen
 * 
 * @param {string} screenName - Screen identifier
 * @returns {Promise<Object|null>} - The saved state or null if unavailable/expired
 */
export const loadViewState = async (screenName) => {
  if (!screenName) return null;
  
  try {
    const key = `${VIEW_STATE_PREFIX}${screenName}`;
    const storedData = await AsyncStorage.getItem(key);
    
    if (storedData) {
      const { data, timestamp, ttl = VIEW_STATE_TTL } = JSON.parse(storedData);
      const age = Date.now() - timestamp;
      
      if (age < ttl) {
        console.log(`Loaded view state for ${screenName}, age: ${Math.round(age/1000)}s`);
        return data;
      } else {
        console.log(`View state for ${screenName} expired, age: ${Math.round(age/1000)}s`);
        // Clean up expired state
        await AsyncStorage.removeItem(key);
        return null;
      }
    }
    return null;
  } catch (error) {
    console.warn('Error loading view state:', error);
    return null;
  }
};

/**
 * Clear the view state for a specific screen
 * 
 * @param {string} screenName - Screen identifier
 * @returns {Promise<void>}
 */
export const clearViewState = async (screenName) => {
  if (!screenName) return;
  
  try {
    const key = `${VIEW_STATE_PREFIX}${screenName}`;
    await AsyncStorage.removeItem(key);
    console.log(`Cleared view state for ${screenName}`);
  } catch (error) {
    console.warn('Error clearing view state:', error);
  }
};

/**
 * Clear all expired view states
 * 
 * @returns {Promise<number>} - Number of cleared items
 */
export const clearExpiredViewStates = async () => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const viewStateKeys = keys.filter(key => key.startsWith(VIEW_STATE_PREFIX));
    
    let clearedCount = 0;
    
    for (const key of viewStateKeys) {
      try {
        const data = await AsyncStorage.getItem(key);
        
        if (data) {
          const { timestamp, ttl = VIEW_STATE_TTL } = JSON.parse(data);
          const age = Date.now() - timestamp;
          
          if (age >= ttl) {
            await AsyncStorage.removeItem(key);
            clearedCount++;
          }
        }
      } catch (err) {
        console.warn(`Error processing view state key ${key}:`, err);
      }
    }
    
    if (clearedCount > 0) {
      console.log(`Cleared ${clearedCount} expired view states`);
    }
    
    return clearedCount;
  } catch (error) {
    console.warn('Error clearing expired view states:', error);
    return 0;
  }
}; 