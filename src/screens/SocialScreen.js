// 🚀 TRACKED: Automatic read monitoring
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Dialog, IconButton, Modal, Portal, Text, TextInput } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import SettingsContent from '../components/SettingsContent';
import StoreContent from '../components/StoreContentSupabase';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import { useTheme } from '../contexts/ThemeContext';
import { useBalance } from '../hooks/useBackwardCompatibility';
import { useDailyClaims } from '../hooks/useDailyClaims';
import { useGroupOperations } from '../hooks/useGroupOperations';
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

// OPTIMIZATION 3: useGroupOperations hook now imported from ../hooks/useGroupOperations.js

// Tab configuration for cleaner code
const TAB_CONFIG = [
  { key: 'leaderboard', icon: 'trophy', label: 'Leaderboard' },
  { key: 'groups', icon: 'account-group', label: 'Groups' },
  { key: 'store', icon: 'store', label: 'Store' },
  { key: 'settings', icon: 'cog', label: 'Settings' }
];

// OPTIMIZATION 4: useDailyClaims hook now imported from ../hooks/useDailyClaims.js

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
  const [error, setError] = useState(null);

  // Loading states for group operations (now managed by useGroupOperations hook)
  const [leaveGroupLoading, setLeaveGroupLoading] = useState(false);
  
  // Refs for better performance
  const mountedRef = useRef(true);
  const lastFetchRef = useRef(0);
  
  // Get data from contexts - MUST be called before using their values
  const { user, logout } = useAuth();
  const { groups: contextGroups, currentGroup, setCurrentGroup, removeGroup, addGroup, switchGroup, refreshGroups } = useGroup();
  const { addCoins } = useBalance();

  // Use groups from GroupContext - NOW contextGroups is defined
  const groups = contextGroups || [];
  const { theme } = useTheme();

  // Group operations hook
  const {
    createGroup: createGroupOp,
    joinGroup: joinGroupOp,
    createGroupLoading: createGroupOpLoading,
    joinGroupLoading: joinGroupOpLoading,
    error: groupOpError
  } = useGroupOperations(user, fetchGroups, addGroup, switchGroup);

  // Use loading states from hook
  const createGroupLoading = createGroupOpLoading;
  const joinGroupLoading = joinGroupOpLoading;

  // Daily claims hook
  const {
    canClaimDailyCoins,
    claimDailyCoins,
    dailyClaimLoading,
    checkLastClaimTimes
  } = useDailyClaims(user, currentGroup, addCoins);

  // Load last claim times when user or current group changes
  useEffect(() => {
    if (user && currentGroup) {
      checkLastClaimTimes();
    }
  }, [user, currentGroup, checkLastClaimTimes]);

  // OPTIMIZATION 4: Memoize styles for performance - MUST be before any component that uses styles
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Performance monitoring hook
  const { trackOperation } = usePerformanceTracking(user);

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
      // Groups are now managed by GroupContext, no need to set local state
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
      
      console.log(`✅ OPTIMIZED: ${forceRefresh ? 'Force fetched' : 'Loaded'} ${groupsData.groups?.length || 0} groups`);
      console.log(`📊 Groups Optimization Metrics:`, groupsData.metrics);
      
      if (forceRefresh) {
        console.log('🔍 Optimized refresh complete - groups:', groupsData.groups?.map(g => g.name).join(', '));
      }
      
      // NOTE: Don't call refreshGroups() here - it causes infinite loop
      // GroupContext already loads groups on mount and handles updates
      
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
        
        // Groups are now managed by GroupContext, no need to set local state
        console.log(`✅ Fallback: Loaded ${groups.length} groups for user ${user.uid}`);
      } catch (fallbackError) {
        if (mountedRef.current) {
          console.error('Error in fallback fetchGroups:', fallbackError);
          ErrorHandler.handleGroupOperation(fallbackError, 'fetchGroups');
          // Groups are now managed by GroupContext, no need to set local state
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
      
      // Refresh the groups list from GroupContext to show any newly joined groups
      console.log('🔄 [SocialScreen] Refreshing groups list via GroupContext');
      await refreshGroups();
      console.log('✅ [SocialScreen] Groups list refreshed');
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
  }, [user, currentGroup?.id, refreshGroups]);

  // Group operation handlers
  const handleCreateGroup = useCallback(() => {
    setCreateGroupModal(true);
  }, []);

  const handleJoinGroup = useCallback(() => {
    setJoinGroupModal(true);
  }, []);

  const handleCreateGroupSubmit = useCallback(async (name, password) => {
    if (!user) return false;

    console.log('🔵 handleCreateGroupSubmit called with:', { name, password: '***' });
    // Loading state is managed by useGroupOperations hook
    try {
      // createGroupOp expects (groupName, groupPassword)
      const success = await createGroupOp(name, password);
      if (success) {
        console.log('Group created successfully');
        await refreshGroups();
      }
      return success;
    } catch (error) {
      console.error('Error creating group:', error);
      setError({ context: 'createGroup', message: error.message || 'Failed to create group' });
      return false;
    }
  }, [user, createGroupOp, refreshGroups]);

  const handleJoinGroupSubmit = useCallback(async (name, password) => {
    if (!user) return false;

    // Loading state is managed by useGroupOperations hook
    try {
      // joinGroupOp expects (groupName, groupPassword)
      const success = await joinGroupOp(name, password);
      if (success) {
        console.log('Joined group successfully');
        await refreshGroups();
      }
      return success;
    } catch (error) {
      console.error('Error joining group:', error);
      setError({ context: 'joinGroup', message: error.message || 'Failed to join group' });
      return false;
    }
  }, [user, joinGroupOp, refreshGroups]);

  const handleSelectGroup = useCallback(async (group) => {
    if (!user) return;

    try {
      await switchGroup(group);
      console.log('Group selected successfully');
    } catch (error) {
      console.error('Error selecting group:', error);
      setError({ context: 'selectGroup', message: error.message || 'Failed to select group' });
    }
  }, [user, switchGroup]);

  const handleLeaveGroup = useCallback((groupId) => {
    setGroupToLeave(groupId);
    setLeaveGroupDialog(true);
  }, []);

  const handleLeaveGroupConfirm = useCallback(async () => {
    if (!user || !groupToLeave) return;

    setLeaveGroupLoading(true);
    try {
      // Find the group
      const { data: groups, error: fetchError } = await supabase
        .from('groups')
        .select('*')
        .eq('id', groupToLeave)
        .limit(1);

      if (fetchError) throw fetchError;

      if (!groups || groups.length === 0) {
        Alert.alert('Error', 'Group not found.');
        return;
      }

      const group = groups[0];

      // Remove user from group members
      const updatedMembers = (group.members || []).filter(id => id !== user.id);
      const { error: updateError } = await supabase
        .from('groups')
        .update({
          members: updatedMembers,
          member_count: updatedMembers.length,
          updated_at: new Date().toISOString()
        })
        .eq('id', groupToLeave);

      if (updateError) throw updateError;

      console.log('✅ Left group successfully');

      // Invalidate caches
      await CacheService.invalidate(`groups:${user.id}`);

      // Remove group from local state
      removeGroup(groupToLeave);

      // If we left the current group, switch to another group or null
      if (currentGroup?.id === groupToLeave) {
        const otherGroups = groups.filter(g => g.id !== groupToLeave);
        if (otherGroups.length > 0) {
          await switchGroup(otherGroups[0]);
        } else {
          await switchGroup(null);
        }
      }

      await refreshGroups();
      setLeaveGroupDialog(false);
      setGroupToLeave(null);
      Alert.alert('Success', 'Successfully left the group!');
    } catch (error) {
      console.error('Error leaving group:', error);
      setError({ context: 'leaveGroup', message: error.message || 'Failed to leave group' });
    } finally {
      setLeaveGroupLoading(false);
    }
  }, [user, groupToLeave, refreshGroups, removeGroup, currentGroup, switchGroup]);

  // Daily coin claim handler
  const onClaimCoins = useCallback(async () => {
    if (!user || !currentGroup) return;

    try {
      const success = await claimDailyCoins();
      if (success) {
        console.log('Daily coins claimed successfully');
        addCoins(UI_CONSTANTS.DAILY_CLAIM_COINS);
      }
    } catch (error) {
      console.error('Error claiming daily coins:', error);
      setError({ context: 'claimCoins', message: error.message || 'Failed to claim daily coins' });
    }
  }, [user, currentGroup, claimDailyCoins, addCoins]);

  // Main render
  return (
    <SocialScreenErrorBoundary>
      <ScreenBackground>
        <View style={styles.container}>
          {/* Tab Navigation */}
          <View style={styles.tabContainer}>
            {TAB_CONFIG.map((tab) => (
              <IconButton
                key={tab.key}
                icon={tab.icon}
                mode={activeTab === tab.key ? 'contained' : 'outlined'}
                onPress={() => setActiveTab(tab.key)}
                style={styles.iconButton}
                accessibilityLabel={`Switch to ${tab.label} tab`}
              />
            ))}
          </View>

          {/* Tab Content */}
          <View style={{ flex: 1 }}>
            {activeTab === 'leaderboard' && (
              <LeaderboardScreen navigation={navigation} />
            )}

            {activeTab === 'groups' && (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={true}
                keyboardShouldPersistTaps="handled"
              >
                {/* Error Display */}
                <ErrorMessage
                  error={error}
                  onClearError={() => setError(null)}
                  theme={theme}
                  styles={styles}
                />

                {/* Loading Indicator */}
                <LoadingIndicator
                  loading={loading}
                  theme={theme}
                  styles={styles}
                />

                {/* Current Group Display */}
                <CurrentGroupCard
                  currentGroup={currentGroup}
                  theme={theme}
                  styles={styles}
                />

                {/* Daily Coin Claim */}
                <DailyClaimCard
                  currentGroup={currentGroup}
                  canClaimDailyCoins={canClaimDailyCoins}
                  onClaimCoins={onClaimCoins}
                  dailyClaimLoading={dailyClaimLoading}
                  theme={theme}
                  styles={styles}
                />

                {/* Group Actions */}
                <GroupActionButtons
                  onCreateGroup={handleCreateGroup}
                  onJoinGroup={handleJoinGroup}
                  createGroupLoading={createGroupLoading}
                  joinGroupLoading={joinGroupLoading}
                  theme={theme}
                  styles={styles}
                />

                {/* Groups List */}
                {groups.length === 0 ? (
                  <EmptyGroupsState styles={styles} />
                ) : (
                  groups.map((group) => (
                    <GroupCard
                      key={group.id}
                      group={group}
                      user={user}
                      currentGroup={currentGroup}
                      onSelectGroup={handleSelectGroup}
                      onLeaveGroup={handleLeaveGroup}
                      leaveGroupLoading={leaveGroupLoading}
                      theme={theme}
                      styles={styles}
                    />
                  ))
                )}
              </ScrollView>
            )}

            {activeTab === 'store' && (
              <StoreContent navigation={navigation} />
            )}

            {activeTab === 'settings' && (
              <SettingsContent navigation={navigation} />
            )}
          </View>

          {/* Modals */}
          <GroupModal
            visible={createGroupModal}
            onDismiss={() => {
              setCreateGroupModal(false);
              setNewGroupName('');
              setNewGroupPassword('');
            }}
            onSubmit={handleCreateGroupSubmit}
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
            onDismiss={() => {
              setJoinGroupModal(false);
              setJoinGroupName('');
              setJoinGroupPassword('');
            }}
            onSubmit={handleJoinGroupSubmit}
            title="Join Group"
            submitText="Join Group"
            loading={joinGroupLoading}
            groupName={joinGroupName}
            setGroupName={setJoinGroupName}
            groupPassword={joinGroupPassword}
            setGroupPassword={setJoinGroupPassword}
            styles={styles}
          />

          {/* Leave Group Dialog */}
          <Portal>
            <Dialog
              visible={leaveGroupDialog}
              onDismiss={() => setLeaveGroupDialog(false)}
            >
              <Dialog.Title>Leave Group</Dialog.Title>
              <Dialog.Content>
                <Text>Are you sure you want to leave this group? This action cannot be undone.</Text>
              </Dialog.Content>
              <Dialog.Actions>
                <Button onPress={() => setLeaveGroupDialog(false)}>Cancel</Button>
                <Button
                  onPress={handleLeaveGroupConfirm}
                  textColor={theme.colors.error}
                  loading={leaveGroupLoading}
                >
                  Leave
                </Button>
              </Dialog.Actions>
            </Dialog>
          </Portal>
        </View>
      </ScreenBackground>
    </SocialScreenErrorBoundary>
  );
};

export default SocialScreen;
