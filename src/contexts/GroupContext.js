import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import EventManager from '../utils/eventManager';
import { useAuth } from './AuthContext';

// Define constants for group events
export const GROUP_CHANGED_EVENT = 'GROUP_CHANGED';
export const GROUP_CREATED_EVENT = 'GROUP_CREATED';

const GroupContext = createContext();
const LAST_GROUP_KEY = 'CARDMATES_LAST_SELECTED_GROUP';

export const useGroup = () => {
  const context = useContext(GroupContext);
  if (!context) {
    throw new Error('useGroup must be used within a GroupProvider');
  }
  return context;
};

export const GroupProvider = ({ children, initialGroup = null }) => {
  const [groups, setGroups] = useState([]);
  const [currentGroup, setCurrentGroup] = useState(initialGroup);
  const [isNewUser, setIsNewUser] = useState(false);
  const { user } = useAuth();

  // FIXED: Stabilize initialGroup reference to prevent infinite loops
  const stableInitialGroup = React.useMemo(() => initialGroup, [initialGroup?.id]);

  // Load the last selected group from AsyncStorage when component mounts or user changes
  useEffect(() => {
    // If we already have an initialGroup, don't try to load from AsyncStorage
    if (stableInitialGroup) {
      return;
    }
    
    const loadLastGroup = async () => {
      if (!user) {
        setCurrentGroup(null);
        return;
      }
      
      try {
        // Get last selected group from AsyncStorage using user ID as part of the key
        const savedGroupKey = `${LAST_GROUP_KEY}_${user.uid}`;
        const savedGroup = await AsyncStorage.getItem(savedGroupKey);
        
        if (savedGroup) {
          const parsedGroup = JSON.parse(savedGroup);
          setCurrentGroup(parsedGroup);
          console.log('Restored last selected group:', parsedGroup.name);
        } else {
          // No previous group found - this might be a new user
          setIsNewUser(true);
          setCurrentGroup(null);
        }
      } catch (error) {
        console.error('Error loading last selected group:', error);
      }
    };
    
    loadLastGroup();
  }, [user?.uid, stableInitialGroup]); // FIXED: Use stable references to prevent loops

  // Enhanced setCurrentGroup to also save to AsyncStorage and trigger data refresh
  const switchGroup = useCallback(async (group) => {
    setCurrentGroup(group);
    
    // If user is logged in, save the selected group
    if (user && group) {
      try {
        const savedGroupKey = `${LAST_GROUP_KEY}_${user.uid}`;
        await AsyncStorage.setItem(savedGroupKey, JSON.stringify(group));
        console.log('Saved selected group:', group.name);
        
        // Use EventManager to emit the group change event
        EventManager.emit(GROUP_CHANGED_EVENT, { groupId: group.id });
        
        // IMPROVED CACHE CLEARING: Be more selective about what to clear
        // Only clear cache data that's actually group-specific to prevent
        // unnecessary "no data found" states during group switching
        try {
          const cacheKeys = [
            `auctions_${group.id}`,
            `trades_${group.id}`,
            `collection_${group.id}`,
            // Be more specific about shared listener caches
            `shared_group_trades_${group.id}`,
            `shared_user_cards_${user.uid}_${group.id}`
          ];
          
          // Clear each cache sequentially with error handling
          for (const key of cacheKeys) {
            try {
              await AsyncStorage.removeItem(key);
              console.log(`Cleared cache for ${key}`);
            } catch (error) {
              console.error(`Error clearing cache for ${key}:`, error);
              // Continue with other caches even if one fails
            }
          }
          
          // Add a small delay to prevent race conditions with new data loading
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          console.error('Error clearing caches:', error);
        }
      } catch (error) {
        console.error('Error saving selected group:', error);
      }
    }
  }, [user]);

  // Memoize all handlers to prevent unnecessary re-renders
  const addGroup = useCallback((group) => {
    setGroups((prevGroups) => [...prevGroups, group]);
  }, []);

  // Enhanced addGroup that also emits group creation event
  const notifyGroupCreated = useCallback((group) => {
    console.log('📢 Notifying about new group creation:', group.name);
    EventManager.emit(GROUP_CREATED_EVENT, { group, groupId: group.id });
  }, []);

  const removeGroup = useCallback((groupId) => {
    console.log(`🗑️ GroupContext: Removing group ${groupId} from global state`);
    setGroups((prevGroups) => {
      const filteredGroups = prevGroups.filter((group) => group.id !== groupId);
      console.log(`🗑️ GroupContext: Groups after removal: ${filteredGroups.length} (removed: ${prevGroups.length - filteredGroups.length})`);
      return filteredGroups;
    });
    
    // If the removed group was the current group, clear it
    setCurrentGroup(prevCurrentGroup => {
      if (prevCurrentGroup?.id === groupId) {
        console.log(`🗑️ GroupContext: Cleared current group as it was the removed group`);
        return null;
      }
      return prevCurrentGroup;
    });
  }, []);

  const updateGroup = useCallback((groupId, updatedData) => {
    setGroups((prevGroups) =>
      prevGroups.map((group) =>
        group.id === groupId ? { ...group, ...updatedData } : group
      )
    );
  }, []);

  const refreshGroups = useCallback(async () => {
    // Implement group refresh logic here if needed
    console.log('Refreshing groups list');
    return true;
  }, []);

  // Memoize context value to prevent unnecessary context updates
  const value = useMemo(() => ({
    groups,
    currentGroup,
    isNewUser,
    setIsNewUser,
    setCurrentGroup: switchGroup, // Use the enhanced version that saves to AsyncStorage
    addGroup,
    removeGroup,
    updateGroup,
    refreshGroups,
    switchGroup,
    notifyGroupCreated,
  }), [groups, currentGroup, isNewUser, addGroup, removeGroup, updateGroup, refreshGroups, switchGroup, notifyGroupCreated]);

  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}; 