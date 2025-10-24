import * as Crypto from 'expo-crypto';
import { arrayUnion, collection, doc, getDocs, limit, query, runTransaction, updateDoc, where, writeBatch } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Dialog, IconButton, Modal, Portal, Text, TextInput } from 'react-native-paper';
import DailyGemsSection from '../components/DailyGemsSection';
import ScreenBackground from '../components/ScreenBackground';
import SettingsContent from '../components/SettingsContent';
import StoreContent from '../components/StoreContent';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import { useTheme } from '../contexts/ThemeContext';
import { useBalance } from '../hooks/useBackwardCompatibility';
import CacheService from '../services/caching/CacheService';
import OptimizedSocialFeedService from '../services/OptimizedSocialFeedService';
import useInitialStore from '../store/useInitialStore';
import RefreshCoordinator from '../utils/RefreshCoordinator';
import LeaderboardScreen from './LeaderboardScreen';

// STEP 3.A.1: Import optimized social feed service

// React Native Error Boundary Class Component
class SocialScreenErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('SocialScreen Error Boundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 16, textAlign: 'center' }}>
            Something went wrong
          </Text>
          <Text style={{ fontSize: 14, marginBottom: 16, textAlign: 'center', color: '#666' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </Text>
          <Button 
            onPress={() => this.setState({ hasError: false, error: null })} 
            mode="contained" 
            style={{ marginTop: 16 }}
          >
            Try Again
          </Button>
        </View>
      );
    }

    return this.props.children;
  }
}

// Constants for pagination and caching (reduced - DataManager handles most caching now)
const GROUPS_PER_PAGE = 10;

// UI Constants
const UI_CONSTANTS = {
  DAILY_CLAIM_COINS: 50,
  AUTO_ERROR_CLEAR_TIME: 5000,
  FETCH_THROTTLE_TIME: 30000,
  GROUP_NAME_MIN_LENGTH: 3,
  GROUP_PASSWORD_MIN_LENGTH: 4,
  MAX_GROUP_NAME_LENGTH: 30,
  MAX_GROUP_PASSWORD_LENGTH: 20,
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

// OPTIMIZATION 1: CacheManager replaced with centralized DataManager for better efficiency

// OPTIMIZATION 2: Enhanced error handling utility
const ErrorHandler = {
  handleGroupOperation(error, context, onError = null) {
    console.error(`Group operation error in ${context}:`, error);
    
    const errorMessage = this.getErrorMessage(error, context);
    
    if (onError) {
      onError({ context, message: errorMessage });
    }
    
    Alert.alert('Error', errorMessage);
  },

  getErrorMessage(error, context) {
    if (error.code === 'permission-denied') {
      return 'You do not have permission to perform this action.';
    }
    if (error.code === 'not-found') {
      return 'The requested data was not found.';
    }
    if (error.code === 'network-error') {
      return 'Network error. Please check your connection and try again.';
    }
    if (error.message?.includes('index')) {
      return 'Database index required. Please contact support.';
    }
    
    return `Failed to ${context.replace(/([A-Z])/g, ' $1').toLowerCase()}. Please try again.`;
  }
};

// OPTIMIZATION 3: Fixed useGroupOperations with race condition protection
const useGroupOperations = (user, fetchGroups, notifyGroupCreated) => {
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
    if (!groupName?.trim() || !groupPassword?.trim() || !user) {
      Alert.alert('Validation Error', 'Please fill in all fields.');
      return false;
    }

    if (groupName.length < UI_CONSTANTS.GROUP_NAME_MIN_LENGTH) {
      Alert.alert('Validation Error', `Group name must be at least ${UI_CONSTANTS.GROUP_NAME_MIN_LENGTH} characters long.`);
      return false;
    }

    if (groupPassword.length < UI_CONSTANTS.GROUP_PASSWORD_MIN_LENGTH) {
      Alert.alert('Validation Error', `Password must be at least ${UI_CONSTANTS.GROUP_PASSWORD_MIN_LENGTH} characters long.`);
      return false;
    }

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
    if (!validateGroupInput(groupName, groupPassword)) return false;

    try {
      setCreateGroupLoading(true);
      setError(null);
      
      // OPTIMIZATION: Use centralized cache checking
      const cachedGroups = await CacheService.getValue('all_groups_names');
      const groupNameLower = groupName.trim().toLowerCase();
      
      if (cachedGroups?.includes(groupNameLower)) {
        Alert.alert('Error', 'A group with this name already exists. Please choose a different name.');
        return false;
      }
      
      // Fallback database check
      const existingGroupQuery = query(
        collection(db, 'groups'),
        where('name', '==', groupName.trim()),
        limit(1)
      );
      const existingGroupSnapshot = await getDocs(existingGroupQuery);
      
      if (!existingGroupSnapshot.empty) {
        Alert.alert('Error', 'A group with this name already exists. Please choose a different name.');
        return false;
      }

      // Create group with batch operations
      const batch = writeBatch(db);
      const groupRef = doc(collection(db, 'groups'));
      const timestamp = new Date().toISOString();
      
      batch.set(groupRef, {
        name: groupName.trim(),
        password: await secureHash(groupPassword.trim()),
        ownerId: user.uid,
        members: [user.uid],
        memberCount: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      // Update user's groups array
      const userRef = doc(db, 'users', user.uid);
      batch.update(userRef, {
        groups: arrayUnion(groupRef.id),
        updatedAt: timestamp,
      });

      await batch.commit();
      
      // OPTIMIZATION: Use centralized cache invalidation
      await CacheService.invalidate(`groups:${user.uid}`);
      await CacheService.invalidate(`all_groups_names`);
      
      if (mountedRef.current) {
        // Force refresh groups list with cache busting
        console.log('🔄 Force refreshing groups list after group creation...');
        await fetchGroups(true); // Force refresh = true
        
        // Also invalidate additional cache keys that might be stale
        await Promise.allSettled([
          CacheService.invalidate(`user_groups_${user.uid}`),
          CacheService.invalidate(`users:${user.uid}`)
        ]);
        
        // Notify about group creation for auction screen refresh
        if (notifyGroupCreated) {
          const newGroupData = {
            id: groupRef.id,
            name: groupName.trim(),
            ownerId: user.uid,
            members: [user.uid],
            memberCount: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          notifyGroupCreated(newGroupData);
        }
        
        console.log('✅ Group created and groups list refreshed successfully');
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
  }, [user, validateGroupInput, fetchGroups, handleError]);

  const joinGroup = useCallback(async (groupName, groupPassword) => {
    if (!validateGroupInput(groupName, groupPassword)) return false;

    try {
      setJoinGroupLoading(true);
      setError(null);
      
      // Single optimized query
      const groupsRef = collection(db, 'groups');
      const q = query(
        groupsRef,
        where('name', '==', groupName.trim()),
        where('password', '==', await secureHash(groupPassword.trim())),
        limit(1)
      );
      
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) {
        Alert.alert('Error', 'Invalid group name or password. Please check your credentials.');
        return false;
      }

      const groupDoc = querySnapshot.docs[0];
      const groupData = groupDoc.data();
      
      // Check if user is already a member
      if (groupData.members?.includes(user.uid)) {
        Alert.alert('Info', 'You are already a member of this group.');
        return false;
      }

      // Batch operations for atomicity
      const batch = writeBatch(db);
      const timestamp = new Date().toISOString();
      
      // Update group members
      const groupRef = doc(db, 'groups', groupDoc.id);
      batch.update(groupRef, {
        members: arrayUnion(user.uid),
        memberCount: (groupData.memberCount || groupData.members.length) + 1,
        updatedAt: timestamp,
      });

      // Update user's groups array
      const userRef = doc(db, 'users', user.uid);
      batch.update(userRef, {
        groups: arrayUnion(groupDoc.id),
        updatedAt: timestamp,
      });

      await batch.commit();
      
      // OPTIMIZATION: Use centralized cache invalidation
      await Promise.allSettled([
        CacheService.invalidate(`groups:${user.uid}`),
        CacheService.invalidate(`all_groups_names`),
        CacheService.invalidate(`user_groups_${user.uid}`),
        CacheService.invalidate(`users:${user.uid}`)
      ]);
      
      if (mountedRef.current) {
        console.log('🔄 Force refreshing groups list after joining group...');
        await fetchGroups(true); // Force refresh = true
        console.log('✅ Groups list refreshed successfully after join');
        Alert.alert('Success', 'Successfully joined the group!');
      }
      
      return true;
    } catch (error) {
      if (mountedRef.current) {
        handleError(error, 'joinGroup');
      }
      return false;
    } finally {
      if (mountedRef.current) {
        setJoinGroupLoading(false);
      }
    }
  }, [user, validateGroupInput, handleError, fetchGroups]);

  return {
    createGroup,
    joinGroup,
    createGroupLoading,
    joinGroupLoading,
    leaveGroupLoading,
    setLeaveGroupLoading,
    error,
    clearError: useCallback(() => {
      if (mountedRef.current) setError(null);
    }, [])
  };
};

// Tab configuration for cleaner code
const TAB_CONFIG = [
  { key: 'leaderboard', icon: 'trophy', label: 'Leaderboard' },
  { key: 'groups', icon: 'account-group', label: 'Groups' },
  { key: 'store', icon: 'store', label: 'Store' },
  { key: 'settings', icon: 'cog', label: 'Settings' }
];

// Custom hook for daily claims functionality
const useDailyClaims = (user, currentGroup, addCoins) => {
  const [dailyClaimLoading, setDailyClaimLoading] = useState(false);
  const [lastClaimTimes, setLastClaimTimes] = useState({});

  // Check last claim times with caching
  const checkLastClaimTimes = useCallback(async () => {
    if (!user) return;
    
    try {
      const userData = await CacheService.getDocument('users', user.uid, {
        ttl: 5 * 60 * 1000 // 5 minutes cache
      });
      
      if (userData) {
        setLastClaimTimes(userData.lastDailyClaim || {});
      }
    } catch (error) {
      console.error('Error checking last claim times:', error);
    }
  }, [user]);
  
  const canClaimDailyCoins = useCallback((groupId) => {
    if (!groupId || !lastClaimTimes[groupId]) return true;
    
    const lastClaim = new Date(lastClaimTimes[groupId]);
    const now = new Date();
    const hoursSinceLastClaim = (now - lastClaim) / (1000 * 60 * 60);
    
    return hoursSinceLastClaim >= 24;
  }, [lastClaimTimes]);
  
  const claimDailyCoins = useCallback(async () => {
    if (!user || !currentGroup) {
      Alert.alert('Error', 'You need to select a group first');
      return;
    }
    
    try {
      setDailyClaimLoading(true);
      
      if (!canClaimDailyCoins(currentGroup.id)) {
        const lastClaim = new Date(lastClaimTimes[currentGroup.id]);
        const nextClaim = new Date(lastClaim.getTime() + 24 * 60 * 60 * 1000);
        const timeRemaining = nextClaim - new Date();
        const hoursRemaining = Math.ceil(timeRemaining / (1000 * 60 * 60));
        
        Alert.alert(
          'Already Claimed',
          `You've already claimed your daily coins for this group. You can claim again in ${hoursRemaining} hours.`
        );
        return;
      }
      
      const success = await addCoins(UI_CONSTANTS.DAILY_CLAIM_COINS);
      
      if (success) {
        const updatedClaimTimes = {
          ...lastClaimTimes,
          [currentGroup.id]: new Date().toISOString()
        };
        
        setLastClaimTimes(updatedClaimTimes);
        
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          lastDailyClaim: updatedClaimTimes,
          updatedAt: new Date().toISOString()
        });
        
        await CacheService.invalidate(`users:${user.uid}`);
        
        Alert.alert('Success', `You claimed ${UI_CONSTANTS.DAILY_CLAIM_COINS} coins!`);
      } else {
        Alert.alert('Error', 'Failed to claim daily coins');
      }
    } catch (error) {
      console.error('Error claiming daily coins:', error);
      Alert.alert('Error', 'Something went wrong while claiming coins');
    } finally {
      setDailyClaimLoading(false);
    }
  }, [user, currentGroup, lastClaimTimes, canClaimDailyCoins, addCoins]);

  return {
    dailyClaimLoading,
    lastClaimTimes,
    checkLastClaimTimes,
    canClaimDailyCoins,
    claimDailyCoins
  };
};

// OPTIMIZATION 6: Consolidated reusable components to reduce code duplication

// Component for login prompt when user is not authenticated
const LoginPrompt = ({ onSignIn, theme, styles }) => (
  <View style={styles.emptyContainer}>
    <Text style={styles.modalTitle}>Please sign in to access social features</Text>
    <Button
      mode="contained"
      onPress={onSignIn}
      style={styles.loginButton}
      accessibilityLabel="Sign in to access social features"
    >
      Sign In
    </Button>
  </View>
);

// Reusable group input modal component
const GroupModal = ({ 
  visible, 
  onDismiss, 
  onSubmit, 
  title, 
  submitText, 
  loading,
  groupName, 
  setGroupName, 
  groupPassword, 
  setGroupPassword, 
  styles 
}) => (
  <Modal
    visible={visible}
    onDismiss={() => !loading && onDismiss()}
    contentContainerStyle={styles.modal}
    accessibilityViewIsModal
  >
    <Text style={styles.modalTitle}>{title}</Text>
    <TextInput
      label="Group Name"
      value={groupName}
      onChangeText={setGroupName}
      style={styles.input}
      disabled={loading}
      maxLength={UI_CONSTANTS.MAX_GROUP_NAME_LENGTH}
      accessibilityLabel="Enter group name"
      accessibilityHint={title.includes('Create') ? 
        "Name for your new group, minimum 3 characters" : 
        "Name of the group you want to join"
      }
    />
    <TextInput
      label="Group Password"
      value={groupPassword}
      onChangeText={setGroupPassword}
      secureTextEntry
      style={styles.input}
      disabled={loading}
      maxLength={UI_CONSTANTS.MAX_GROUP_PASSWORD_LENGTH}
      accessibilityLabel="Enter group password"
      accessibilityHint={title.includes('Create') ? 
        "Password for your new group, minimum 4 characters" : 
        "Password for the group you want to join"
      }
    />
    <View style={styles.modalButtonContainer}>
      <Button
        mode="outlined"
        onPress={() => {
          onDismiss();
          setGroupName('');
          setGroupPassword('');
        }}
        disabled={loading}
        style={styles.modalCancelButton}
        accessibilityLabel={`Cancel ${title.toLowerCase()}`}
      >
        Cancel
      </Button>
      <Button
        mode="contained"
        onPress={async () => {
          const success = await onSubmit(groupName, groupPassword);
          if (success) {
            onDismiss();
            setGroupName('');
            setGroupPassword('');
          }
        }}
        disabled={!groupName?.trim() || !groupPassword?.trim() || loading}
        loading={loading}
        style={styles.modalButton}
        accessibilityLabel={submitText}
      >
        {loading ? `${submitText.split(' ')[0]}ing...` : submitText}
      </Button>
    </View>
  </Modal>
);

// Component for group action buttons
const GroupActionButtons = ({ 
  onCreateGroup, 
  onJoinGroup, 
  createGroupLoading, 
  joinGroupLoading, 
  theme,
  styles
}) => (
  <View style={styles.buttonContainer}>
    <Button
      mode="contained"
      onPress={onCreateGroup}
      style={styles.button}
      disabled={createGroupLoading}
      loading={createGroupLoading}
      icon="plus"
      accessibilityLabel="Create a new group"
    >
      Create Group
    </Button>
    <Button
      mode="contained"
      onPress={onJoinGroup}
      style={styles.button}
      disabled={joinGroupLoading}
      loading={joinGroupLoading}
      icon="account-plus"
      accessibilityLabel="Join an existing group"
    >
      Join Group
    </Button>
  </View>
);

// Component for displaying error messages
const ErrorMessage = ({ error, onClearError, theme, styles }) => {
  if (!error) return null;
  
  return (
    <Card style={[styles.errorCard, { backgroundColor: theme.colors.errorContainer }]}>
      <Card.Content>
        <Text style={{ color: theme.colors.onErrorContainer }}>
          Error in {error.context}: {error.message}
        </Text>
        <Button 
          mode="text" 
          onPress={onClearError}
          style={{ alignSelf: 'flex-end' }}
          textColor={theme.colors.onErrorContainer}
          accessibilityLabel="Dismiss error message"
        >
          Dismiss
        </Button>
      </Card.Content>
    </Card>
  );
};

// Component for loading indicator
const LoadingIndicator = ({ loading, theme, styles }) => {
  if (!loading) return null;
  
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text style={styles.loadingText}>Loading groups...</Text>
    </View>
  );
};

// Component for current group display
const CurrentGroupCard = ({ currentGroup, theme, styles }) => {
  if (!currentGroup) return null;
  
  return (
    <Card style={styles.currentGroupCard}>
      <Card.Content>
        <Text style={styles.currentGroupTitle}>Current Group</Text>
        <Text style={styles.currentGroupName}>{currentGroup.name}</Text>
        <Text style={styles.currentGroupMembers}>
          {currentGroup.members?.length || 0} members
        </Text>
      </Card.Content>
    </Card>
  );
};

// Component for daily coin claim functionality
const DailyClaimCard = ({ 
  currentGroup, 
  canClaimDailyCoins, 
  onClaimCoins, 
  dailyClaimLoading, 
  theme,
  styles
}) => {
  if (!currentGroup) return null;
  
  return (
    <Card style={styles.dailyClaimCard}>
      <Card.Content>
        <Text style={styles.dailyClaimTitle}>Daily Reward</Text>
        <Text style={styles.dailyClaimDescription}>
          Claim {UI_CONSTANTS.DAILY_CLAIM_COINS} coins for free every 24 hours in each group!
        </Text>
      </Card.Content>
      <Card.Actions style={styles.dailyClaimActions}>
        <Button
          mode="contained"
          onPress={onClaimCoins}
          loading={dailyClaimLoading}
          disabled={dailyClaimLoading || !canClaimDailyCoins(currentGroup?.id)}
          style={[
            styles.dailyClaimButton,
            !canClaimDailyCoins(currentGroup?.id) && styles.dailyClaimButtonDisabled
          ]}
          icon="currency-usd"
          accessibilityLabel={canClaimDailyCoins(currentGroup?.id) ? 
            `Claim ${UI_CONSTANTS.DAILY_CLAIM_COINS} coins` : 
            'Daily coins already claimed'
          }
        >
          {canClaimDailyCoins(currentGroup?.id) ? `Claim ${UI_CONSTANTS.DAILY_CLAIM_COINS} Coins` : 'Already Claimed'}
        </Button>
      </Card.Actions>
    </Card>
  );
};

// Component for empty groups state
const EmptyGroupsState = ({ styles }) => (
  <View style={styles.emptyContainer}>
    <Text style={styles.emptyTitle}>No Groups Yet</Text>
    <Text style={styles.emptyDescription}>
      You haven't joined any groups yet. Create a new group or join an existing one to get started!
    </Text>
  </View>
);

// Component for individual group card
const GroupCard = ({ 
  group, 
  user, 
  currentGroup, 
  onSelectGroup, 
  onLeaveGroup, 
  leaveGroupLoading, 
  theme,
  styles
}) => (
  <Card key={group.id} style={styles.groupCard}>
    <Card.Content>
      <Text style={styles.groupName}>{group.name}</Text>
      <Text style={styles.groupOwner}>
        Owner: {group.ownerId === user.uid ? 'You' : 'Someone else'}
      </Text>
      <Text style={styles.groupMembers}>
        Members: {group.members?.length || group.memberCount || 0}
      </Text>
      <Text style={styles.groupCreated}>
        Created: {group.createdAt ? new Date(group.createdAt).toLocaleDateString() : 'Unknown'}
      </Text>
      {group.id === currentGroup?.id && (
        <Text style={styles.currentGroup}>✓ Current Group</Text>
      )}
    </Card.Content>
    <Card.Actions>
      {group.id !== currentGroup?.id && (
        <Button 
          onPress={() => onSelectGroup(group)}
          mode="outlined"
          icon="check-circle"
          accessibilityLabel={`Select ${group.name} as current group`}
        >
          Select
        </Button>
      )}
      <Button 
        onPress={() => onLeaveGroup(group.id)}
        mode="text"
        textColor={theme.colors.error}
        icon="exit-to-app"
        disabled={leaveGroupLoading}
        accessibilityLabel={`Leave ${group.name} group`}
      >
        Leave
      </Button>
    </Card.Actions>
  </Card>
);

// Dynamic styles function for better theme integration
const createStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  tabContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'space-around',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  iconButton: {
    margin: 5,
  },
  buttonContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 8,
  },
  button: {
    flex: 1,
    marginHorizontal: 4,
  },
  groupCard: {
    margin: 16,
    backgroundColor: 'rgba(255,255,255,0.95)',
    elevation: 3,
  },
  groupName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    color: theme.colors.onSurface,
  },
  groupOwner: {
    fontSize: 14,
    color: theme.colors.onSurfaceVariant,
    marginBottom: 4,
  },
  groupMembers: {
    fontSize: 14,
    color: theme.colors.onSurfaceVariant,
    marginBottom: 4,
  },
  groupCreated: {
    fontSize: 12,
    color: theme.colors.outline,
    marginBottom: 8,
  },
  currentGroup: {
    color: theme.colors.primary,
    fontWeight: 'bold',
    marginTop: 8,
  },
  modal: {
    backgroundColor: theme.colors.surface,
    padding: 20,
    margin: 20,
    borderRadius: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
    color: theme.colors.onSurface,
  },
  input: {
    marginBottom: 16,
  },
  modalButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    backgroundColor: theme.colors.primary,
  },
  modalCancelButton: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
    color: theme.colors.onSurface,
  },
  emptyDescription: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
    color: theme.colors.onSurfaceVariant,
  },
  loginButton: {
    marginTop: 16,
    width: '50%',
    alignSelf: 'center',
  },
  errorCard: {
    margin: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: theme.colors.onSurface,
  },
  currentGroupCard: {
    margin: 16,
    backgroundColor: theme.colors.primaryContainer,
    borderRadius: 12,
    elevation: 2,
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  currentGroupTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
    color: theme.colors.primary,
  },
  currentGroupName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
    textAlign: 'center',
    color: theme.colors.onPrimaryContainer,
  },
  currentGroupMembers: {
    fontSize: 14,
    textAlign: 'center',
    color: theme.colors.onPrimaryContainer,
  },
  dailyClaimCard: {
    margin: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    elevation: 2,
  },
  dailyClaimTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
    color: theme.colors.onSurface,
  },
  dailyClaimDescription: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
    color: theme.colors.onSurfaceVariant,
  },
  dailyClaimActions: {
    justifyContent: 'center',
    padding: 8,
  },
  dailyClaimButton: {
    width: '80%',
    backgroundColor: theme.colors.primary,
  },
  dailyClaimButtonDisabled: {
    backgroundColor: theme.colors.outline,
  },
  scrollContent: {
    paddingBottom: 100, // Add padding to prevent content from being cut off
  },
  noGroupText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
});

// Performance monitoring hook
const usePerformanceTracking = (user) => {
  const mountTimeRef = useRef(Date.now());
  const operationTimesRef = useRef({});

  const trackOperation = useCallback((operationName, startTime = Date.now()) => {
    return {
      end: () => {
        const duration = Date.now() - startTime;
        operationTimesRef.current[operationName] = duration;
        console.log(`⏱️ ${operationName} took ${duration}ms`);
      }
    };
  }, []);

  useEffect(() => {
    const mountTime = Date.now() - mountTimeRef.current;
    console.log(`📊 SocialScreen mounted in ${mountTime}ms`);
  }, []);

  return { trackOperation };
};

const SocialScreen = ({ navigation }) => {
  // Header is now handled by the TabNavigator
  const [activeTab, setActiveTab] = useState('leaderboard');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [createGroupModal, setCreateGroupModal] = useState(false);
  const [joinGroupModal, setJoinGroupModal] = useState(false);
  const [leaveGroupDialog, setLeaveGroupDialog] = useState(false);
  const [groupToLeave, setGroupToLeave] = useState(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupPassword, setNewGroupPassword] = useState('');
  const [joinGroupName, setJoinGroupName] = useState('');
  const [joinGroupPassword, setJoinGroupPassword] = useState('');
  
  // Refs for better performance
  const mountedRef = useRef(true);
  const lastFetchRef = useRef(0);
  
  const { user, logout } = useAuth();
  const { currentGroup, setCurrentGroup, removeGroup, notifyGroupCreated } = useGroup();
  const { addCoins } = useBalance();
  const { theme } = useTheme();
  
  // OPTIMIZATION 4: Memoize styles for performance - MUST be before any component that uses styles
  const styles = useMemo(() => createStyles(theme), [theme]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 🚀 STEP 3.A.1: ULTRA-OPTIMIZED social feed using OptimizedSocialFeedService
  const fetchGroups = useCallback(async (forceRefresh = false) => {
    if (!user) return;
    
    // 1️⃣ Try to hydrate from initial boot payload (0 reads)
    const initialPayload = useInitialStore?.getState?.()?.payload;
    if (!forceRefresh && initialPayload?.profile?.groups) {
      const groupsArr = initialPayload.profile.groups.map(id => ({ id }));
      if (mountedRef.current) {
        setGroups(groupsArr);
      }
      return;
    }
    
    // RACE CONDITION FIX: Check if component is still mounted
    if (!mountedRef.current) return;
    
    const operation = trackOperation('fetchGroups');
    
    try {
      setLoading(true);
      
      console.log(`🚀 OPTIMIZED: Fetching social feed for user ${user.uid} (forceRefresh: ${forceRefresh})`);
      
      // STEP 3.A.1: Use OptimizedSocialFeedService for groups (not posts)
      // Note: This is actually groups management, not social posts
      const groupsData = await OptimizedSocialFeedService.fetchUserGroups(
        user.uid, 
        {
          forceRefresh,
          includeMetrics: true
        }
      );
      
      // RACE CONDITION FIX: Only update state if component is still mounted
      if (mountedRef.current) {
        setGroups(groupsData.groups || []);
        
        console.log(`✅ OPTIMIZED: ${forceRefresh ? 'Force fetched' : 'Loaded'} ${groupsData.groups?.length || 0} groups`);
        console.log(`📊 Groups Optimization Metrics:`, groupsData.metrics);
        
        if (forceRefresh) {
          console.log('🔍 Optimized refresh complete - groups:', groupsData.groups?.map(g => g.name).join(', '));
        }
      }
      
      operation.end();
    } catch (error) {
      console.error('❌ OptimizedSocialFeedService failed, using fallback:', error);
      
      // FALLBACK: Use original implementation if optimized service fails
      try {
        const userData = await CacheService.getDocument('users', user.uid, {
          ttl: forceRefresh ? 0 : 2 * 60 * 1000,
          forceRefresh
        });
        
        let groups = [];
        if (userData?.groups && userData.groups.length > 0) {
          const groupsData = await CacheService.getDocuments('groups', userData.groups, {
            ttl: forceRefresh ? 0 : 10 * 60 * 1000,
            forceRefresh
          });
          
          groups = groupsData
            .map((group, index) => group ? { id: userData.groups[index], ...group } : null)
            .filter(Boolean);
        }
        
        if (mountedRef.current) {
          setGroups(groups);
          console.log(`✅ Fallback: Loaded ${groups.length} groups for user ${user.uid}`);
        }
      } catch (fallbackError) {
        if (mountedRef.current) {
          console.error('Error in fallback fetchGroups:', fallbackError);
          ErrorHandler.handleGroupOperation(fallbackError, 'fetchGroups');
          setGroups([]);
        }
      }
      
      operation.end();
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [user, trackOperation]);

  // 🚀 ULTRA-OPTIMIZED: Smart refresh with centralized cache management
  const handleRefresh = useCallback(async () => {
    if (!user || !mountedRef.current) return;

    setRefreshing(true);

    try {
      console.log('🔄 [SocialScreen] Delegating refresh to RefreshCoordinator');
      await RefreshCoordinator.refreshAll(user.uid, currentGroup?.id || null);
      console.log('✅ [SocialScreen] RefreshCoordinator completed');
    } catch (error) {
      if (mountedRef.current) {
        console.error('Error in RefreshCoordinator:', error);
        Alert.alert('Refresh Error', 'Data may be slightly outdated. Please try again later.');
      }
    } finally {
      if (mountedRef.current) {
        setRefreshing(false);
      }
    }
  }, [user, currentGroup?.id]);

  // 🚀 OPTIMIZED: Fix memory leaks and race conditions
  useEffect(() => {
    let isMounted = true; // Track component mount state
    
    const initializeData = async () => {
      if (!user || !isMounted) return;
      
      try {
        // Prevent excessive API calls
        const now = Date.now();
        if (now - lastFetchRef.current > UI_CONSTANTS.FETCH_THROTTLE_TIME) {
          lastFetchRef.current = now;
          
          // OPTIMIZATION: Parallel initialization with race condition protection
          const initPromises = [
            fetchGroups(),
            checkLastClaimTimes()
          ];
          
          // Only update state if component is still mounted
          await Promise.all(initPromises);
          
          if (isMounted) {
            console.log('✅ SocialScreen data initialization completed');
          }
        }
      } catch (error) {
        if (isMounted) {
          console.error('Error initializing SocialScreen data:', error);
        }
      }
    };
    
    initializeData();
    
    // Cleanup function to prevent memory leaks
    return () => {
      isMounted = false;
    };
  }, [user, fetchGroups, checkLastClaimTimes]);

  const { createGroup, joinGroup, createGroupLoading, joinGroupLoading, leaveGroupLoading, setLeaveGroupLoading, error, clearError } = useGroupOperations(user, fetchGroups, notifyGroupCreated);

  // Helper functions for cleaning up user data when leaving a group
  const deleteUserCardsInGroup = async (userId, groupId) => {
    try {
      // OPTIMIZATION: Check cache first to avoid unnecessary DB calls
      const userCardsKey = `user_cards_${userId}_${groupId}`;
      const cachedCards = await CacheService.getValue(userCardsKey);
      
      if (cachedCards && Array.isArray(cachedCards) && cachedCards.length === 0) {
        console.log('✅ Cache indicates no cards to delete');
        return;
      }
      
      // Use both userId and ownerId for comprehensive deletion
      const cardsQuery = query(
        collection(db, 'cards'),
        where('groupId', '==', groupId)
      );
      
      const cardsSnapshot = await getDocs(cardsQuery);
      const userCards = cardsSnapshot.docs.filter(doc => {
        const data = doc.data();
        return data.ownerId === userId || data.userId === userId;
      });
      
      if (userCards.length === 0) {
        console.log('ℹ️ No cards found to delete');
        // Update cache to reflect empty state
        await CacheService.setValue(userCardsKey, [], { ttl: 60000 });
        return;
      }
      
      // Delete cards in batches (Firestore batch limit is 500 operations)
      const batch = writeBatch(db);
      let deleteCount = 0;
      
      userCards.forEach(cardDoc => {
        batch.delete(cardDoc.ref);
        deleteCount++;
      });
      
      await batch.commit();
      console.log(`✅ Deleted ${deleteCount} cards for user ${userId} in group ${groupId}`);
      
      // Invalidate related caches
      await Promise.allSettled([
        CacheService.invalidate(userCardsKey),
        CacheService.invalidate(`leaderboard_precomputed_${groupId}`),
        CacheService.invalidate(`user_leaderboard_stats_${userId}_${groupId}`)
      ]);
      
    } catch (error) {
      console.error('❌ Error deleting user cards:', error);
      throw error;
    }
  };

  const deleteUserAuctionsInGroup = async (userId, groupId) => {
    try {
      // OPTIMIZATION: Check cache first to avoid unnecessary DB calls
      const userAuctionsKey = `user_auctions_${userId}_${groupId}`;
      const cachedAuctions = await CacheService.getValue(userAuctionsKey);
      
      if (cachedAuctions && Array.isArray(cachedAuctions) && cachedAuctions.length === 0) {
        console.log('✅ Cache indicates no auctions to delete');
        return;
      }
      
      // Use comprehensive query to catch all auction fields
      const auctionsQuery = query(
        collection(db, 'auctions'),
        where('groupId', '==', groupId)
      );
      
      const auctionsSnapshot = await getDocs(auctionsQuery);
      const userAuctions = auctionsSnapshot.docs.filter(doc => {
        const data = doc.data();
        return data.ownerId === userId || data.sellerId === userId || data.currentBidder === userId;
      });
      
      if (userAuctions.length === 0) {
        console.log('ℹ️ No auctions found to delete');
        // Update cache to reflect empty state
        await CacheService.setValue(userAuctionsKey, [], { ttl: 60000 });
        return;
      }
      
      const batch = writeBatch(db);
      let deleteCount = 0;
      
      userAuctions.forEach(auctionDoc => {
        batch.delete(auctionDoc.ref);
        deleteCount++;
      });
      
      await batch.commit();
      console.log(`✅ Deleted ${deleteCount} auctions for user ${userId} in group ${groupId}`);
      
      // Invalidate related caches
      await Promise.allSettled([
        CacheService.invalidate(userAuctionsKey),
        CacheService.invalidate(`group_auctions_${groupId}`),
        CacheService.invalidate(`user_active_auctions_${userId}`)
      ]);
      
    } catch (error) {
      console.error('❌ Error deleting user auctions:', error);
      throw error;
    }
  };

  const deleteUserTradesInGroup = async (userId, groupId) => {
    try {
      // OPTIMIZATION: Check cache first to avoid unnecessary DB calls
      const userTradesKey = `user_trades_${userId}_${groupId}`;
      const cachedTrades = await CacheService.getValue(userTradesKey);
      
      if (cachedTrades && Array.isArray(cachedTrades) && cachedTrades.length === 0) {
        console.log('✅ Cache indicates no trades to delete');
        return;
      }
      
      // OPTIMIZATION: Single query instead of two parallel queries
      const allTradesQuery = query(
        collection(db, 'trades'),
        where('groupId', '==', groupId)
      );
      
      const allTradesSnapshot = await getDocs(allTradesQuery);
      const userTrades = allTradesSnapshot.docs.filter(doc => {
        const data = doc.data();
        return data.senderId === userId || data.receiverId === userId;
      });
      
      if (userTrades.length === 0) {
        console.log('ℹ️ No trades found to delete');
        // Update cache to reflect empty state
        await CacheService.setValue(userTradesKey, [], { ttl: 60000 });
        return;
      }
      
      const batch = writeBatch(db);
      let deleteCount = 0;
      
      userTrades.forEach(tradeDoc => {
        batch.delete(tradeDoc.ref);
        deleteCount++;
      });
      
      await batch.commit();
      console.log(`✅ Deleted ${deleteCount} trades for user ${userId} in group ${groupId}`);
      
      // Invalidate related caches
      await Promise.allSettled([
        CacheService.invalidate(userTradesKey),
        CacheService.invalidate(`group_trades_${groupId}`),
        CacheService.invalidate(`user_active_trades_${userId}`)
      ]);
      
    } catch (error) {
      console.error('❌ Error deleting user trades:', error);
      throw error;
    }
  };

  // 🚀 ULTRA-OPTIMIZED: Enhanced leaveGroup with proper backend synchronization
  const leaveGroup = async (groupId) => {
    if (!user || !groupId || !mountedRef.current) return;
    
    // Store original state for rollback if needed
    let originalGroups = groups;
    let originalCurrentGroup = currentGroup;
    
    try {
      setLeaveGroupLoading(true);
      
      console.log(`🚀 Starting leave group operation for user ${user.uid}, group ${groupId}`);
      
      // OPTIMIZATION 1: Optimistic UI update for better UX
      if (mountedRef.current) {
        setGroups(prevGroups => {
          const filteredGroups = prevGroups.filter(group => group.id !== groupId);
          console.log(`⚡ Optimistically removed group ${groupId} from UI. Groups remaining: ${filteredGroups.length}`);
          return filteredGroups;
        });
        
        // Clear current group if this was it (optimistic)
        if (currentGroup?.id === groupId) {
          setCurrentGroup(null);
          console.log(`⚡ Optimistically cleared current group`);
        }
        
        removeGroup(groupId);
        console.log(`⚡ Optimistically removed group ${groupId} from global GroupContext state`);
      }
      
      // ACTUAL BACKEND UPDATE: Remove group from user's groups array
      console.log('📝 Removing group from user\'s groups array in Firestore...');
      
      const userData = await CacheService.getDocument('users', user.uid);
      if (userData?.groups?.includes(groupId)) {
        // Update user document to remove group ID
        const updatedGroups = userData.groups.filter(id => id !== groupId);
        
                 // STEP 1: Delete all user's cards, auctions, and trades in this group
         console.log('🗑️ Deleting all user cards, auctions, and trades in group...');
         
         await Promise.allSettled([
           deleteUserCardsInGroup(user.uid, groupId),
           deleteUserAuctionsInGroup(user.uid, groupId),
           deleteUserTradesInGroup(user.uid, groupId)
         ]);
         
         console.log('✅ User data cleanup completed');

         // STEP 2: Update user and group membership atomically
         await runTransaction(db, async (transaction) => {
           const userRef = doc(db, 'users', user.uid);
           const groupRef = doc(db, 'groups', groupId);
           
           // IMPORTANT: All reads must happen before any writes in Firestore transactions
           const groupData = await transaction.get(groupRef);
           
           // Now perform all writes
           // Remove group from user's groups list
           transaction.update(userRef, {
             groups: updatedGroups,
             lastOperation: 'leave_group',
             lastOperationTimestamp: new Date(),
           });
           
           // Remove user from group's members list
           if (groupData.exists()) {
             const groupMembers = groupData.data().members || [];
             const updatedMembers = groupMembers.filter(memberId => memberId !== user.uid);
             
             transaction.update(groupRef, {
               members: updatedMembers,
               memberCount: updatedMembers.length,
               lastUpdated: new Date(),
             });
           }
         });
        
        console.log('✅ Successfully updated Firestore - removed group from user and user from group');
        
                 // Clear relevant caches to force fresh data next time
         console.log('🧹 Clearing all relevant caches...');
         await Promise.allSettled([
           CacheService.invalidate(`users:${user.uid}`),
           CacheService.invalidate(`groups:${groupId}`),
           CacheService.invalidate(`user_groups_${user.uid}`),
           CacheService.invalidate(`group_members_${groupId}`),
           // Clear card, auction, and trade related caches
           CacheService.invalidate(`cards_${groupId}`),
           CacheService.invalidate(`auctions_${groupId}`),
           CacheService.invalidate(`trades_${groupId}`),
           CacheService.invalidate(`user_cards_${user.uid}_${groupId}`),
           CacheService.invalidate(`user_auctions_${user.uid}_${groupId}`),
           CacheService.invalidate(`user_trades_${user.uid}_${groupId}`)
         ]);
        
        console.log('✅ Cleared all relevant caches');
        
        // ENHANCED: Wait for cache clearing to complete, then force a comprehensive refresh
        if (mountedRef.current) {
          console.log('🔄 Starting comprehensive state refresh after leave...');
          
          // Add a small delay to ensure cache invalidation has propagated
          await new Promise(resolve => setTimeout(resolve, 500));
          
          try {
            // Force refresh from server with cache bypass
            console.log('📡 Fetching fresh groups data from server...');
            const userData = await CacheService.getDocument('users', user.uid, { 
              ttl: 0, // Force fresh fetch
              forceRefresh: true 
            });
            
            let freshGroups = [];
            if (userData?.groups && userData.groups.length > 0) {
              const groupsData = await CacheService.getDocuments('groups', userData.groups, {
                ttl: 0, // Force fresh fetch
                forceRefresh: true
              });
              
              freshGroups = groupsData
                .map((group, index) => group ? { id: userData.groups[index], ...group } : null)
                .filter(Boolean);
            }
            
            // Update local state with fresh data
            console.log(`🔄 Updating local state with ${freshGroups.length} fresh groups`);
            setGroups(freshGroups);
            
            // Verify the left group is not in the fresh data
            const leftGroupStillExists = freshGroups.some(group => group.id === groupId);
            if (leftGroupStillExists) {
              console.warn(`⚠️ Warning: Left group ${groupId} still appears in fresh data - this shouldn't happen`);
            } else {
              console.log(`✅ Confirmed: Left group ${groupId} successfully removed from groups list`);
            }
            
            // Additional fallback - call regular fetchGroups to ensure consistency
            await fetchGroups(true);
            console.log('✅ Groups refreshed successfully after leave');
            
          } catch (refreshError) {
            console.error('❌ Error refreshing groups after leave:', refreshError);
            // Fallback: just call regular fetchGroups
            try {
              await fetchGroups(true);
              console.log('✅ Fallback refresh completed successfully');
            } catch (fallbackError) {
              console.error('❌ Fallback refresh also failed:', fallbackError);
            }
          }
          
          Alert.alert(
            'Successfully Left Group', 
            'You have left the group and all your cards, auctions, and trades in this group have been removed.'
          );
        }
      } else {
        console.log('ℹ️ User was not a member of this group - cleaning up UI only');
        if (mountedRef.current) {
          Alert.alert('Info', 'You are no longer a member of this group.');
        }
      }
      
    } catch (error) {
      console.error('❌ Error leaving group:', error);
      
      if (mountedRef.current) {
        // ROLLBACK: Restore optimistic updates on error
        console.log('🔄 Rolling back optimistic updates due to error');
        try {
          // Restore original local state immediately
          setGroups(originalGroups);
          setCurrentGroup(originalCurrentGroup);
          
          // Also try to refresh from server, but don't wait for it
          fetchGroups(true).catch(fetchError => {
            console.error('Error refreshing groups during rollback:', fetchError);
          });
          
          console.log('✅ Successfully reverted to original group state');
        } catch (rollbackError) {
          console.error('Error during rollback:', rollbackError);
          // If rollback fails, try to refresh from server as fallback
          fetchGroups(true).catch(fetchError => {
            console.error('Fallback refresh also failed:', fetchError);
          });
        }
        
        Alert.alert(
          'Error', 
          error.message || 'Failed to leave group. Please try again.',
          [{ text: 'OK', onPress: () => console.log('Leave group error acknowledged') }]
        );
      }
    } finally {
      if (mountedRef.current) {
        setLeaveGroupLoading(false);
      }
    }
  };

  const handleSignIn = () => {
    // The AuthGuard will automatically redirect to Login when logout() is called
    logout();
  };

  // OPTIMIZATION: Enhanced renderGroups with better error handling and refresh control
  const renderGroups = () => {
    // If not logged in, show login prompt
    if (!user) {
      return <LoginPrompt onSignIn={handleSignIn} theme={theme} styles={styles} />;
    }

    const handleLeaveGroupDialog = (groupId) => {
      setLeaveGroupDialog(true);
      setGroupToLeave(groupId);
    };
    
    return (
      <ScrollView 
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
          />
        }
      >
        <ErrorMessage error={error} onClearError={clearError} theme={theme} styles={styles} />

        <GroupActionButtons 
          onCreateGroup={() => setCreateGroupModal(true)}
          onJoinGroup={() => setJoinGroupModal(true)}
          createGroupLoading={createGroupLoading}
          joinGroupLoading={joinGroupLoading}
          theme={theme}
          styles={styles}
        />

        <LoadingIndicator loading={loading} theme={theme} styles={styles} />

        {currentGroup && !loading && (
          <>
            <CurrentGroupCard currentGroup={currentGroup} theme={theme} styles={styles} />

            <DailyClaimCard 
              currentGroup={currentGroup}
              canClaimDailyCoins={canClaimDailyCoins}
              onClaimCoins={claimDailyCoins}
              dailyClaimLoading={dailyClaimLoading}
              theme={theme}
              styles={styles}
            />
            
            {/* Daily Gems Section */}
            <DailyGemsSection groupId={currentGroup.id} />
          </>
        )}

        {!loading && groups.length === 0 ? (
          <EmptyGroupsState styles={styles} />
        ) : (
          !loading && groups.map(group => (
            <GroupCard 
              key={group.id}
              group={group}
              user={user}
              currentGroup={currentGroup}
              onSelectGroup={(selectedGroup) => setCurrentGroup(selectedGroup)}
              onLeaveGroup={handleLeaveGroupDialog}
              leaveGroupLoading={leaveGroupLoading}
              theme={theme}
              styles={styles}
            />
          ))
        )}
        
        {/* Debug info for development - can be removed in production */}
        {__DEV__ && !loading && (
          <Text style={{ fontSize: 10, color: 'gray', textAlign: 'center', marginTop: 10 }}>
            Debug: {groups.length} groups loaded • Last refresh: {new Date().toLocaleTimeString()}
          </Text>
        )}
      </ScrollView>
    );
  };

  // OPTIMIZATION 5: Memoize tab buttons to prevent unnecessary re-renders
  const tabButtons = useMemo(() => 
    TAB_CONFIG.map(tab => (
      <IconButton
        key={tab.key}
        icon={tab.icon}
        size={24}
        mode={activeTab === tab.key ? 'contained' : 'outlined'}
        onPress={() => setActiveTab(tab.key)}
        iconColor={activeTab === tab.key ? 'white' : theme.colors.primary}
        containerColor={activeTab === tab.key ? theme.colors.primary : 'transparent'}
        style={styles.iconButton}
        accessibilityLabel={`Switch to ${tab.label} tab`}
        accessibilityRole="tab"
        accessibilityState={{ selected: activeTab === tab.key }}
      />
    )), [activeTab, theme.colors.primary, styles.iconButton]
  );

  const { dailyClaimLoading, lastClaimTimes, checkLastClaimTimes, canClaimDailyCoins, claimDailyCoins } = useDailyClaims(user, currentGroup, addCoins);

  // Performance monitoring
  const { trackOperation } = usePerformanceTracking(user);
  
  // CacheService performance metrics
  useEffect(() => {
    const logMetrics = () => {
      try {
        const metrics = CacheService.getCacheMetrics();
        if (metrics && metrics.totalHits > 0) {
          console.log(`📊 CacheService Performance Metrics:
            Cache Hit Rate: ${((metrics.totalHits / (metrics.totalHits + metrics.totalMisses)) * 100).toFixed(1)}%
            Total Hits: ${metrics.totalHits}
            Total Misses: ${metrics.totalMisses}
            Memory Cache Size: ${metrics.memoryCacheSize}
            Storage Cache Size: ${metrics.storageCacheSize}`);
        }
      } catch (error) {
        console.warn('⚠️ Could not retrieve CacheService metrics:', error.message);
      }
    };
    
    // Log metrics every minute when the screen is active
    const interval = setInterval(logMetrics, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <SocialScreenErrorBoundary>
      <ScreenBackground>
        <View style={styles.container}>
          <View style={styles.tabContainer}>
            {tabButtons}
          </View>

          {/* 🚀 OPTIMIZED: Lazy-loaded tab content for better performance */}
          {activeTab === 'leaderboard' && currentGroup?.id && (
            <LeaderboardScreen key={currentGroup.id} groupId={currentGroup.id} />
          )}
          {activeTab === 'leaderboard' && !currentGroup?.id && (
            <View style={styles.container}>
              <Text style={[styles.noGroupText, { color: theme.colors.onSurface }]}>
                Please select a group to view the leaderboard
              </Text>
            </View>
          )}
          {activeTab === 'groups' && renderGroups()}
          {activeTab === 'store' && <StoreContent navigation={navigation} />}
          {activeTab === 'settings' && <SettingsContent navigation={navigation} />}

          {user && (
            <Portal>
              {/* OPTIMIZATION 7: Use consolidated GroupModal component */}
              <GroupModal
                visible={createGroupModal}
                onDismiss={() => setCreateGroupModal(false)}
                onSubmit={createGroup}
                title="Create New Group"
                submitText="Create Group"
                loading={createGroupLoading}
                groupName={newGroupName}
                setGroupName={setNewGroupName}
                groupPassword={newGroupPassword}
                setGroupPassword={setNewGroupPassword}
                styles={styles}
              />

              <GroupModal
                visible={joinGroupModal}
                onDismiss={() => setJoinGroupModal(false)}
                onSubmit={joinGroup}
                title="Join Group"
                submitText="Join Group"
                loading={joinGroupLoading}
                groupName={joinGroupName}
                setGroupName={setJoinGroupName}
                groupPassword={joinGroupPassword}
                setGroupPassword={setJoinGroupPassword}
                styles={styles}
              />

              <Dialog
                visible={leaveGroupDialog}
                onDismiss={() => !leaveGroupLoading && setLeaveGroupDialog(false)}
                accessibilityViewIsModal
              >
                <Dialog.Title>Confirm Leave Group</Dialog.Title>
                <Dialog.Content>
                  <Text>Are you sure you want to leave this group? This will permanently delete all your data in this group including cards, auctions, and trades.</Text>
                </Dialog.Content>
                <Dialog.Actions>
                  <Button 
                    onPress={() => setLeaveGroupDialog(false)}
                    disabled={leaveGroupLoading}
                    mode="outlined"
                    accessibilityLabel="Cancel leaving group"
                  >
                    Cancel
                  </Button>
                  <Button 
                    onPress={() => {
                      setLeaveGroupDialog(false);
                      leaveGroup(groupToLeave);
                    }}
                    disabled={leaveGroupLoading}
                    loading={leaveGroupLoading}
                    mode="contained"
                    buttonColor={theme.colors.error}
                    accessibilityLabel="Confirm leave group"
                  >
                    {leaveGroupLoading ? 'Leaving...' : 'Leave Group'}
                  </Button>
                </Dialog.Actions>
              </Dialog>
            </Portal>
          )}
        </View>
      </ScreenBackground>
    </SocialScreenErrorBoundary>
  );
};

export default SocialScreen; 