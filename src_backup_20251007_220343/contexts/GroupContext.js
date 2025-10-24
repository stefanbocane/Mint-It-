import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { db } from '../config/firebase';
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
  const hasLoadedLastGroupRef = React.useRef(false);
  const { user } = useAuth();

  // FIXED: Stabilize initialGroup reference to prevent infinite loops
  const stableInitialGroup = React.useMemo(() => initialGroup, [initialGroup?.id]);

  // Load the last selected group from AsyncStorage when component mounts or user changes
  useEffect(() => {
    // Skip only if we've already attempted loading. If an initialGroup is provided,
    // we'll still compare it against any locally-stored value to ensure consistency.
    if (hasLoadedLastGroupRef.current) {
      return;
    }
    
    const loadLastGroup = async () => {
      if (!user) {
        setCurrentGroup(null);
        return;
      }
      
      try {
        // Get last selected group from AsyncStorage using user ID as part of the key
        const newKey = `${LAST_GROUP_KEY}_${user.uid}`;
        const legacyKey = LAST_GROUP_KEY; // old format without uid
        let savedGroup = await AsyncStorage.getItem(newKey);
        if (!savedGroup) {
          savedGroup = await AsyncStorage.getItem(legacyKey);
          if (savedGroup) {
            // migrate to new per-user key
            await AsyncStorage.setItem(newKey, savedGroup);
            await AsyncStorage.removeItem(legacyKey);
          }
        }
        
        if (savedGroup) {
          const parsedGroup = JSON.parse(savedGroup);

          // Only update if it's different from the initial or current group
          setCurrentGroup(prevGroup => {
            const refGroup = prevGroup || stableInitialGroup;
            if (refGroup?.id === parsedGroup.id) {
              return refGroup; // already correct
            }
            return parsedGroup;
          });
        } else {
          // No previous group found - this might be a new user
          setIsNewUser(true);
          setCurrentGroup(null);
        }
      } catch (error) {
        console.error('Error loading last selected group:', error);
      } finally {
        hasLoadedLastGroupRef.current = true; // ensure we don't load again for this user
      }
    };
    
    loadLastGroup().finally(() => {
      hasLoadedLastGroupRef.current = true; // ensure we don't load again for this user
    });
  }, [user?.uid, stableInitialGroup]); // FIXED: Use stable references to prevent loops

  // Enhanced setCurrentGroup to also save to AsyncStorage and trigger data refresh
  const switchGroup = useCallback(async (group) => {
    setCurrentGroup(group);
    
    if (user && group) {
      try {
        // Persist locally for quick future access
        const newKey = `${LAST_GROUP_KEY}_${user.uid}`;
        await AsyncStorage.setItem(newKey, JSON.stringify(group));
        // Write legacy key as well for backward compatibility
        await AsyncStorage.setItem(LAST_GROUP_KEY, JSON.stringify(group));

        // Persist remotely so the lastActiveGroup is accurate across devices/sessions
        try {
          const userRef = doc(db, 'users', user.uid);
          await updateDoc(userRef, {
            lastActiveGroup: group.id,
            lastGroupUpdatedAt: serverTimestamp(),
          });
        } catch (firestoreErr) {
          console.error('Error updating lastActiveGroup in Firestore:', firestoreErr);
        }

        // Notify other listeners about the change
        EventManager.emit(GROUP_CHANGED_EVENT, { groupId: group.id });

        // Selectively clear group-specific caches so fresh data is fetched
        try {
          const cacheKeys = [
            `auctions_${group.id}`,
            `trades_${group.id}`,
            `collection_${group.id}`,
            `shared_group_trades_${group.id}`,
            `shared_user_cards_${user.uid}_${group.id}`,
          ];

          for (const key of cacheKeys) {
            try {
              await AsyncStorage.removeItem(key);
            } catch (error) {
              console.error(`Error clearing cache for ${key}:`, error);
            }
          }

          // Tiny delay to reduce race conditions with subsequent reads
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          console.error('Error clearing caches:', error);
        }
      } catch (error) {
        console.error('Error saving selected group locally:', error);
      }
    }
  }, [user]);

  // Memoize all handlers to prevent unnecessary re-renders
  const addGroup = useCallback((group) => {
    setGroups((prevGroups) => [...prevGroups, group]);
  }, []);

  // Enhanced addGroup that also emits group creation event
  const notifyGroupCreated = useCallback((group) => {
    EventManager.emit(GROUP_CREATED_EVENT, { group, groupId: group.id });
  }, []);

  const removeGroup = useCallback((groupId) => {
    setGroups((prevGroups) => {
      const filteredGroups = prevGroups.filter((group) => group.id !== groupId);
      return filteredGroups;
    });
    
    // If the removed group was the current group, clear it
    setCurrentGroup(prevCurrentGroup => {
      if (prevCurrentGroup?.id === groupId) {
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