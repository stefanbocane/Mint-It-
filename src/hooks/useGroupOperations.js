/**
 * useGroupOperations Hook
 * 
 * Handles all group-related operations including:
 * - Creating groups
 * - Joining groups
 * - Validation
 * - Error handling
 * 
 * Extracted from SocialScreen for better maintainability
 */

import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../config/supabase';
import CacheService from '../services/caching/CacheService';

// UI Constants
const UI_CONSTANTS = {
  AUTO_ERROR_CLEAR_TIME: 5000,
  GROUP_NAME_MIN_LENGTH: 3,
  GROUP_PASSWORD_MIN_LENGTH: 4,
};

// Error Handler
const ErrorHandler = {
  getErrorMessage(error, context) {
    if (error.code === 'permission-denied') {
      return 'Permission denied. Please check your account permissions.';
    }
    if (error.code === 'unavailable') {
      return 'Service temporarily unavailable. Please try again.';
    }
    if (error.message?.includes('network')) {
      return 'Network error. Please check your connection.';
    }
    return `Operation failed: ${context}. Please try again.`;
  }
};

// Secure password hashing using crypto-safe SHA-256
const secureHash = async (password) => {
  try {
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      password,
      { encoding: Crypto.CryptoEncoding.HEX }
    );
    return hash;
  } catch (error) {
    console.error('Error hashing password:', error);
    throw new Error('Failed to hash password');
  }
};

/**
 * Ensures user profile exists in Supabase users table
 * This is needed because auth.users (Supabase Auth) is separate from users (our custom table)
 * Uses RPC function with SECURITY DEFINER to bypass RLS
 */
const ensureUserProfileExists = async (userId, userEmail) => {
  console.log('🔍 Ensuring user profile exists via RPC...');

  try {
    // Call the RPC function that bypasses RLS
    const { data, error } = await supabase.rpc('ensure_user_profile', {
      p_user_id: userId,
      p_email: userEmail
    });

    if (error) {
      console.error('RPC error:', error);
      throw error;
    }

    if (data && data.success) {
      if (data.created) {
        console.log('✅ User profile created:', data.username);
      } else {
        console.log('✅ User profile already exists');
      }
    } else {
      console.error('Failed to ensure user profile:', data);
      throw new Error(data?.message || 'Failed to ensure user profile exists');
    }
  } catch (error) {
    console.error('Error ensuring user profile:', error);
    throw new Error('Failed to initialize user profile. Please try again.');
  }
};

/**
 * Custom hook for group operations
 *
 * @param {Object} user - Current user object
 * @param {Function} fetchGroups - Function to refresh groups list
 * @param {Function} addGroup - Function to add group to context
 * @param {Function} switchGroup - Function to switch to a group
 * @returns {Object} Group operation functions and states
 */
export const useGroupOperations = (user, fetchGroups, addGroup, switchGroup) => {
  const [createGroupLoading, setCreateGroupLoading] = useState(false);
  const [joinGroupLoading, setJoinGroupLoading] = useState(false);
  const [leaveGroupLoading, setLeaveGroupLoading] = useState(false);
  const [error, setError] = useState(null);

  // RACE CONDITION FIX: Track component mount state
  const mountedRef = useRef(true);
  const errorTimeoutRef = useRef(null);

  // Cleanup on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
        errorTimeoutRef.current = null;
      }
    };
  }, []);

  // Validation helper function
  const validateGroupInput = useCallback((groupName, groupPassword) => {
    console.log('🔍 Validating group input:', { groupName: groupName?.trim(), groupPassword: '***', hasUser: !!user, userId: user?.id });

    // TEMP: Password is shown in UI but not stored in Supabase schema
    // Only validate groupName and user
    if (!groupName?.trim() || !user?.id) {
      console.log('❌ Validation failed: missing group name or user');
      Alert.alert('Validation Error', 'Please enter a group name.');
      return false;
    }

    if (groupName.length < UI_CONSTANTS.GROUP_NAME_MIN_LENGTH) {
      console.log('❌ Validation failed: group name too short');
      Alert.alert('Validation Error', `Group name must be at least ${UI_CONSTANTS.GROUP_NAME_MIN_LENGTH} characters long.`);
      return false;
    }

    // Skip password validation - not used in Supabase

    console.log('✅ Validation passed');
    return true;
  }, [user]);

  const handleError = useCallback((error, context) => {
    if (!mountedRef.current) return; // RACE CONDITION FIX
    
    console.error(`Group operation error in ${context}:`, error);
    setError({ context, message: ErrorHandler.getErrorMessage(error, context) });
    
    // Auto-clear error with proper cleanup
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
    }
    
    errorTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setError(null);
        errorTimeoutRef.current = null;
      }
    }, UI_CONSTANTS.AUTO_ERROR_CLEAR_TIME);
  }, []);

  const createGroup = useCallback(async (groupName, groupPassword) => {
    console.log('🔵 ========== CREATE GROUP STARTED ==========');
    console.log('📝 Input:', { groupName, hasPassword: !!groupPassword, userId: user?.id, userEmail: user?.email });

    if (!validateGroupInput(groupName, groupPassword)) return false;

    try {
      setCreateGroupLoading(true);
      setError(null);

      console.log('📡 Step 1: Ensuring user profile exists...');
      // CRITICAL: Ensure user profile exists in users table before creating group
      await ensureUserProfileExists(user.id, user.email);
      console.log('✅ User profile verified');

      // Check if group name already exists
      console.log('📡 Step 2: Checking if group name already exists...');
      const { data: existingGroups, error: checkError } = await supabase
        .from('groups')
        .select('id')
        .eq('name', groupName.trim())
        .limit(1);

      if (checkError) {
        console.error('❌ Error checking existing groups:', checkError);
        throw checkError;
      }

      if (existingGroups && existingGroups.length > 0) {
        console.warn('⚠️ Group with this name already exists');
        Alert.alert('Error', 'A group with this name already exists. Please choose a different name.');
        return false;
      }
      console.log('✅ Group name is available');

      // Create the group in Supabase
      console.log('📡 Step 3: Creating group in database...');
      const groupData = {
        name: groupName.trim(),
        description: null,
        is_private: false,
        created_by: user.id,
        members: [user.id],
        admin_ids: [user.id],
        code: groupName.trim().toLowerCase(),
        member_count: 1
      };
      console.log('   Group data:', groupData);

      const { data: newGroup, error: groupError } = await supabase
        .from('groups')
        .insert(groupData)
        .select()
        .single();

      if (groupError) {
        console.error('❌ Error creating group:', groupError);
        console.error('   Error details:', {
          code: groupError.code,
          message: groupError.message,
          details: groupError.details,
          hint: groupError.hint
        });
        throw groupError;
      }

      console.log('✅ Group created:', { id: newGroup.id, name: newGroup.name });

      // Award initial coins (100) using Supabase function
      const { data: balanceResult, error: balanceError } = await supabase.rpc('update_balance', {
        p_user_id: user.id,
        p_group_id: newGroup.id,
        p_amount: 100
      });

      if (balanceError) {
        console.error('Error awarding initial coins:', balanceError);
      } else {
        console.log('✅ Initial coins awarded');
      }

      // Invalidate caches
      await CacheService.invalidate(`groups:${user.id}`);
      await CacheService.invalidate(`all_groups_names`);

      if (mountedRef.current) {
        // Format group for GroupContext
        const formattedGroup = {
          id: newGroup.id,
          name: newGroup.name,
          description: newGroup.description,
          isPrivate: newGroup.is_private,
          createdBy: newGroup.created_by,
          createdAt: newGroup.created_at,
          memberCount: newGroup.member_count,
          members: newGroup.members,
          adminIds: newGroup.admin_ids,
          code: newGroup.code
        };

        // Add group to context and switch to it
        if (addGroup && switchGroup) {
          console.log('➕ Adding group to context and switching to it...');
          addGroup(formattedGroup);
          switchGroup(formattedGroup);
          console.log('✅ Group added to context and selected');
        }

        // Refresh groups list
        if (fetchGroups) {
          await fetchGroups();
        }

        Alert.alert('Success', 'Group created successfully!');
      }

      return true;
    } catch (error) {
      if (mountedRef.current) {
        handleError(error, 'createGroup');
      }
      return false;
    } finally {
      if (mountedRef.current) {
        setCreateGroupLoading(false);
      }
    }
  }, [user, validateGroupInput, fetchGroups, handleError, addGroup, switchGroup]);

  const joinGroup = useCallback(async (groupName, groupPassword) => {
    console.log('🔵 ========== JOIN GROUP STARTED ==========');
    console.log('📝 Input:', { groupName, hasPassword: !!groupPassword, userId: user?.id, userEmail: user?.email });

    // Validate just group name (password not used in Supabase)
    if (!groupName?.trim() || !user?.id) {
      console.error('❌ Validation failed: missing group name or user ID');
      Alert.alert('Validation Error', 'Please enter a group name.');
      return false;
    }

    if (groupName.length < UI_CONSTANTS.GROUP_NAME_MIN_LENGTH) {
      console.error('❌ Validation failed: group name too short');
      Alert.alert('Validation Error', `Group name must be at least ${UI_CONSTANTS.GROUP_NAME_MIN_LENGTH} characters long.`);
      return false;
    }

    console.log('✅ Validation passed');

    try {
      setJoinGroupLoading(true);
      setError(null);

      console.log('📡 Step 1: Ensuring user profile exists...');
      // CRITICAL: Ensure user profile exists in users table before joining group
      await ensureUserProfileExists(user.id, user.email);
      console.log('✅ User profile verified');

      // Find the group by name
      console.log(`📡 Step 2: Searching for group "${groupName.trim()}"...`);
      const { data: groups, error: fetchError } = await supabase
        .from('groups')
        .select('*')
        .eq('name', groupName.trim())
        .limit(1);

      if (fetchError) {
        console.error('❌ Database error searching for group:', fetchError);
        throw fetchError;
      }

      console.log('📦 Search result:', groups);

      if (!groups || groups.length === 0) {
        console.error('❌ Group not found');

        // Debug: Check if ANY groups exist
        console.log('🔍 DEBUG: Checking if any groups exist in database...');
        const { data: allGroups, error: allError } = await supabase
          .from('groups')
          .select('id, name, is_private')
          .limit(10);

        if (allError) {
          console.error('❌ Error checking all groups:', allError);
        } else {
          console.log(`📊 Total groups in database: ${allGroups?.length || 0}`);
          if (allGroups && allGroups.length > 0) {
            console.log('📋 Available groups:');
            allGroups.forEach(g => console.log(`   - "${g.name}" (${g.is_private ? 'private' : 'public'})`));
            Alert.alert(
              'Group Not Found',
              `The group "${groupName.trim()}" was not found.\n\nAvailable groups:\n${allGroups.map(g => `• ${g.name}`).join('\n')}`,
              [{ text: 'OK' }]
            );
          } else {
            console.log('⚠️ No groups exist in the database!');
            Alert.alert(
              'No Groups Found',
              'No groups exist yet in the database. Please create a group first using the "Create Group" button.',
              [{ text: 'OK' }]
            );
          }
        }

        return false;
      }

      const group = groups[0];
      console.log('✅ Found group:', {
        id: group.id,
        name: group.name,
        members: group.members?.length || 0,
        memberCount: group.member_count
      });

      // Check if user is already a member
      console.log('📡 Step 3: Checking membership...');
      if (group.members?.includes(user.id)) {
        console.warn('⚠️ User is already a member');
        Alert.alert('Info', 'You are already a member of this group.');
        return false;
      }
      console.log('✅ User is not yet a member');

      // Add user to group members
      console.log('📡 Step 4: Adding user to group members...');
      const updatedMembers = [...(group.members || []), user.id];
      console.log(`   Members: ${group.members?.length || 0} → ${updatedMembers.length}`);

      const { error: updateError } = await supabase
        .from('groups')
        .update({
          members: updatedMembers,
          member_count: updatedMembers.length,
          updated_at: new Date().toISOString()
        })
        .eq('id', group.id);

      if (updateError) {
        console.error('❌ Error updating group:', updateError);
        console.error('   Error details:', {
          code: updateError.code,
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint
        });
        throw updateError;
      }

      console.log('✅ Successfully added to group members');

      // Verify the update actually happened
      console.log('🔍 Step 4.5: Verifying user was added to group...');
      const { data: verifyGroup, error: verifyError } = await supabase
        .from('groups')
        .select('members, member_count')
        .eq('id', group.id)
        .single();

      if (verifyError) {
        console.warn('⚠️ Could not verify group update:', verifyError);
      } else {
        console.log('✅ Verification result:', {
          members: verifyGroup.members?.length,
          includes_user: verifyGroup.members?.includes(user.id),
          member_count: verifyGroup.member_count
        });

        if (!verifyGroup.members?.includes(user.id)) {
          console.error('❌ CRITICAL: User was NOT added to members array!');
          throw new Error('Failed to add user to group members array');
        }
      }

      // Invalidate caches
      console.log('📡 Step 5: Invalidating caches...');
      await CacheService.invalidate(`groups:${user.id}`);
      await CacheService.invalidate(`all_groups_names`);
      console.log('✅ Caches invalidated');

      if (mountedRef.current) {
        // Format group for GroupContext
        console.log('📡 Step 6: Formatting group for context...');
        const formattedGroup = {
          id: group.id,
          name: group.name,
          description: group.description,
          isPrivate: group.is_private,
          createdBy: group.created_by,
          createdAt: group.created_at,
          memberCount: updatedMembers.length,
          members: updatedMembers,
          adminIds: group.admin_ids,
          code: group.code
        };
        console.log('✅ Group formatted:', formattedGroup);

        // Add group to context and switch to it
        console.log('📡 Step 7: Adding to GroupContext...');
        if (addGroup && switchGroup) {
          console.log('   addGroup function:', typeof addGroup);
          console.log('   switchGroup function:', typeof switchGroup);
          addGroup(formattedGroup);
          console.log('   ✅ addGroup() called');
          switchGroup(formattedGroup);
          console.log('   ✅ switchGroup() called');
        } else {
          console.warn('   ⚠️ addGroup or switchGroup function not available');
        }

        // Refresh groups list
        console.log('📡 Step 8: Refreshing groups list...');
        if (fetchGroups) {
          await fetchGroups();
          console.log('   ✅ Groups refreshed');
        } else {
          console.warn('   ⚠️ fetchGroups function not available');
        }

        console.log('✅ ========== JOIN GROUP SUCCESSFUL ==========');
        Alert.alert('Success', 'Successfully joined the group!');
      } else {
        console.warn('⚠️ Component unmounted, skipping context update');
      }

      return true;
    } catch (error) {
      console.error('❌ ========== JOIN GROUP FAILED ==========');
      console.error('Error type:', error.constructor.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      console.error('Error details:', {
        code: error.code,
        details: error.details,
        hint: error.hint
      });

      if (mountedRef.current) {
        handleError(error, 'joinGroup');
      }
      return false;
    } finally {
      if (mountedRef.current) {
        setJoinGroupLoading(false);
      }
    }
  }, [user, fetchGroups, handleError, addGroup, switchGroup]);

  // Return hook interface
  return {
    createGroup,
    joinGroup,
    createGroupLoading,
    joinGroupLoading,
    leaveGroupLoading,
    error
  };
};
