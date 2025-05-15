import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import EventManager from '../utils/eventManager';
import { useAuth } from './AuthContext';

// Define a constant for the group change event name
export const GROUP_CHANGED_EVENT = 'GROUP_CHANGED';

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

  // Load the last selected group from AsyncStorage when component mounts or user changes
  useEffect(() => {
    // If we already have an initialGroup, don't try to load from AsyncStorage
    if (initialGroup) {
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
  }, [user, initialGroup]);

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
        
        // Clear any existing cached data for new group to ensure fresh data
        try {
          const cacheKeys = [
            `auctions_${group.id}`,
            `trades_${group.id}`,
            `collection_${group.id}`
          ];
          
          // Clear each cache in parallel
          await Promise.all(cacheKeys.map(async (key) => {
            try {
              await AsyncStorage.removeItem(key);
              console.log(`Cleared cache for ${key}`);
            } catch (error) {
              console.error(`Error clearing cache for ${key}:`, error);
            }
          }));
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

  const removeGroup = useCallback((groupId) => {
    setGroups((prevGroups) => prevGroups.filter((group) => group.id !== groupId));
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
  }), [groups, currentGroup, isNewUser, addGroup, removeGroup, updateGroup, refreshGroups, switchGroup]);

  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}; 