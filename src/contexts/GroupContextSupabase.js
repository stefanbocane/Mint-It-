import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../config/supabase';
import EventManager from '../utils/eventManager';
import { useAuth } from './AuthContextSupabase';

// Define constants for group events
export const GROUP_CHANGED_EVENT = 'GROUP_CHANGED';
export const GROUP_CREATED_EVENT = 'GROUP_CREATED';

const GroupContext = createContext();
const LAST_GROUP_KEY = 'CARDMATES_LAST_SELECTED_GROUP';

/**
 * Validate if ID is a valid UUID (Supabase format)
 * Firebase IDs are 20 alphanumeric chars, UUIDs are 36 with hyphens
 */
const isValidUUID = (id) => {
  if (!id || typeof id !== 'string') return false;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(id);
};

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
  const hasLoadedGroupsRef = React.useRef(false);
  const { user } = useAuth();

  // Stabilize initialGroup reference
  const stableInitialGroup = React.useMemo(() => initialGroup, [initialGroup?.id]);

  // Load the last selected group from AsyncStorage
  useEffect(() => {
    if (hasLoadedLastGroupRef.current) return;

    const loadLastGroup = async () => {
      if (!user) {
        setCurrentGroup(null);
        return;
      }

      try {
        // Supabase uses user.id instead of user.uid
        const newKey = `${LAST_GROUP_KEY}_${user.id}`;
        const legacyKey = LAST_GROUP_KEY;
        let savedGroup = await AsyncStorage.getItem(newKey);

        if (!savedGroup) {
          savedGroup = await AsyncStorage.getItem(legacyKey);
          if (savedGroup) {
            // Check if it's a valid UUID before migrating
            const parsed = JSON.parse(savedGroup);
            if (isValidUUID(parsed.id)) {
              await AsyncStorage.setItem(newKey, savedGroup);
            } else {
              console.warn('⚠️ Clearing old Firebase group from AsyncStorage:', parsed.id);
            }
            await AsyncStorage.removeItem(legacyKey);
          }
        }

        if (savedGroup) {
          const parsedGroup = JSON.parse(savedGroup);

          // Validate that it's a Supabase UUID, not a Firebase ID
          if (!isValidUUID(parsedGroup.id)) {
            console.warn('⚠️ Detected Firebase group ID, clearing:', parsedGroup.id);
            await AsyncStorage.removeItem(newKey);
            await AsyncStorage.removeItem(legacyKey);
            setIsNewUser(true);
            setCurrentGroup(null);
          } else {
            setCurrentGroup(prevGroup => {
              const refGroup = prevGroup || stableInitialGroup;
              if (refGroup?.id === parsedGroup.id) return refGroup;
              return parsedGroup;
            });
          }
        } else {
          setIsNewUser(true);
          setCurrentGroup(null);
        }
      } catch (error) {
        console.error('Error loading last selected group:', error);
      } finally {
        hasLoadedLastGroupRef.current = true;
      }
    };

    loadLastGroup();
  }, [user?.id, stableInitialGroup]);

  // Load groups when user changes
  useEffect(() => {
    if (user?.id && !hasLoadedGroupsRef.current) {
      console.log('🔄 Loading groups for user on GroupContext mount');
      refreshGroups().then(() => {
        hasLoadedGroupsRef.current = true;
        console.log('✅ Groups loaded successfully on mount');
      });
    } else if (!user?.id) {
      setGroups([]);
      hasLoadedGroupsRef.current = false;
    }
  }, [user?.id]);

  // Switch group and save to AsyncStorage
  const switchGroup = useCallback(async (group) => {
    console.log(`🔄 Switching to group: ${group?.name || 'null'} (${group?.id || 'null'})`);
    setCurrentGroup(group);

    if (user && group) {
      try {
        // Persist locally
        const newKey = `${LAST_GROUP_KEY}_${user.id}`;
        await AsyncStorage.setItem(newKey, JSON.stringify(group));
        await AsyncStorage.setItem(LAST_GROUP_KEY, JSON.stringify(group));

        // Update last_active_group in Supabase
        try {
          const { error: updateError } = await supabase
            .from('users')
            .update({ last_active_group: group.id })
            .eq('id', user.id);

          if (updateError) {
            console.error('Error updating last active group:', updateError);
          }
        } catch (err) {
          console.error('Error updating remote lastActiveGroup:', err);
        }

        // Emit event for listeners
        EventManager.emit(GROUP_CHANGED_EVENT, group);
      } catch (error) {
        console.error('Error switching group:', error);
      }
    }
  }, [user]);

  // Refresh groups from Supabase
  const refreshGroups = useCallback(async () => {
    if (!user?.id) {
      console.log('⚠️ refreshGroups: No user ID, clearing groups');
      setGroups([]);
      return;
    }

    try {
      console.log('🔄 Refreshing groups from Supabase...');
      console.log(`   User ID: ${user.id}`);

      // Query groups where user is a member
      const { data: groupsData, error } = await supabase
        .from('groups')
        .select('*')
        .contains('members', [user.id])
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Error querying groups:', error);
        throw error;
      }

      console.log(`📦 Query returned ${groupsData?.length || 0} groups`);
      if (groupsData && groupsData.length > 0) {
        console.log('📋 Groups found:');
        groupsData.forEach(g => {
          console.log(`   - "${g.name}" (members: ${g.members?.length || 0}, includes user: ${g.members?.includes(user.id)})`);
        });
      }

      // Format groups for compatibility
      const formattedGroups = (groupsData || []).map(g => ({
        id: g.id,
        name: g.name,
        description: g.description,
        isPrivate: g.is_private,
        createdBy: g.created_by,
        createdAt: g.created_at,
        memberCount: g.member_count,
        members: g.members,
        adminIds: g.admin_ids,
        code: g.code
      }));

      setGroups(formattedGroups);
      console.log(`✅ Loaded ${formattedGroups.length} groups into GroupContext`);
      return formattedGroups;
    } catch (error) {
      console.error('❌ Error refreshing groups:', error);
      console.error('   Error details:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      return [];
    }
  }, [user?.id]);

  // Add group to local state
  const addGroup = useCallback((group) => {
    setGroups((prevGroups) => {
      const exists = prevGroups.find(g => g.id === group.id);
      if (exists) return prevGroups;
      return [group, ...prevGroups];
    });
    EventManager.emit(GROUP_CREATED_EVENT, group);
  }, []);

  // Remove group from local state
  const removeGroup = useCallback((groupId) => {
    setGroups((prevGroups) => prevGroups.filter(g => g.id !== groupId));
    if (currentGroup?.id === groupId) {
      setCurrentGroup(null);
    }
  }, [currentGroup]);

  const value = useMemo(
    () => ({
      groups,
      currentGroup,
      isNewUser,
      switchGroup,
      refreshGroups,
      addGroup,
      removeGroup,
      setIsNewUser
    }),
    [groups, currentGroup, isNewUser, switchGroup, refreshGroups, addGroup, removeGroup]
  );

  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
};
