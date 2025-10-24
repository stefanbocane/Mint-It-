import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Linking, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Button, Surface, Text, useTheme } from 'react-native-paper';
import { useGroup } from '../contexts/GroupContext';
import CacheService from '../services/caching/CacheService';
import { RARITY_COLORS, RARITY_TYPES } from '../utils/rarity';

// Error Boundary for LeaderboardScreen
class LeaderboardErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('LeaderboardScreen Error Boundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 16, textAlign: 'center' }}>
            Leaderboard Error
          </Text>
          <Text style={{ fontSize: 14, marginBottom: 16, textAlign: 'center', color: '#666' }}>
            {this.state.error?.message || 'Failed to load leaderboard'}
          </Text>
          <Button 
            onPress={() => this.setState({ hasError: false, error: null })} 
            mode="contained" 
            style={{ marginTop: 16 }}
          >
            Retry
          </Button>
        </View>
      );
    }

    return this.props.children;
  }
}

const RARITY_WEIGHTS = {
  [RARITY_TYPES.COMMON]: 1,
  [RARITY_TYPES.UNCOMMON]: 3,
  [RARITY_TYPES.RARE]: 5,
  [RARITY_TYPES.EPIC]: 10,
  [RARITY_TYPES.LEGENDARY]: 20,
  [RARITY_TYPES.MYTHIC]: 50
};

// Optimized cache TTL for better performance
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes instead of 2
const LEADERBOARD_CACHE_TTL = 10 * 60 * 1000; // 10 minutes for computed leaderboard

const LeaderboardScreen = ({ groupId: propGroupId }) => {
  const navigation = useNavigation();
  const theme = useTheme();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [indexError, setIndexError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const { currentGroup } = useGroup();
  
  // Use prop groupId if provided, otherwise fall back to context
  const activeGroupId = propGroupId || currentGroup?.id;
  
  // Race condition protection
  const mountedRef = useRef(true);
  
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 🚀 ULTRA-OPTIMIZED: Pre-computed leaderboard with massive read reduction
  const fetchLeaderboardData = useCallback(async (forceRefresh = false) => {
    if (!activeGroupId) {
      console.log('No group ID available for leaderboard');
      setLoading(false);
      setUsers([]);
      return;
    }

    setLoading(true);
    setError(null);
    setIndexError(null);

    try {
      console.log(`🚀 Ultra-Optimized Leaderboard: Fetching for group ${activeGroupId}...`);
      
      // OPTIMIZATION: Fetch pre-computed leaderboard overview doc (ONE READ)
      const { db } = await import('../config/firebase');
      const { getDoc, doc } = await import('firebase/firestore');

      const lbRef = doc(db, 'leaderboard', activeGroupId);
      const lbSnap = await getDoc(lbRef);

      if (!lbSnap.exists()) {
        console.warn('Leaderboard overview missing; falling back to empty list');
        if (mountedRef.current) {
          setUsers([]);
          setLastRefresh(new Date());
          setLoading(false);
        }
        return;
      }

      const leaderboardData = lbSnap.data().entries || [];

      // Cache the fetched leaderboard for next time
      await CacheService.setValue(`leaderboard_precomputed_${activeGroupId}`, leaderboardData, { ttl: LEADERBOARD_CACHE_TTL });

      if (mountedRef.current) {
        setUsers(leaderboardData);
        setLastRefresh(new Date());
        setLoading(false);
      }
      
    } catch (error) {
      console.error('LeaderboardScreen: Error fetching optimized leaderboard data:', error);
      
      if (mountedRef.current) {
        setError('Failed to load leaderboard data. Please try again.');
        
        // Handle Firebase index error
        if (error.message && error.message.includes('requires an index')) {
          const indexUrl = error.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
          if (indexUrl) {
            setIndexError(indexUrl[0]);
          } else {
            setIndexError("Firebase index required. Please create a composite index for the cards collection.");
          }
        }
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [activeGroupId]);

  const refreshLeaderboard = useCallback(async () => {
    console.log('Manual leaderboard refresh triggered');
    await fetchLeaderboardData(true); // Force refresh
  }, [fetchLeaderboardData]);

  useEffect(() => {
    fetchLeaderboardData();
  }, [fetchLeaderboardData]);

  // Auto-refresh when group changes
  useEffect(() => {
    if (activeGroupId) {
      console.log(`Group changed to ${activeGroupId}, refreshing leaderboard...`);
      fetchLeaderboardData(true); // Force refresh when group changes
    }
  }, [activeGroupId]);

  const handleUserPress = useCallback((user) => {
    navigation.navigate('Profile', {
      userId: user.id,
      viewMode: 'otherUser',
      userName: user.displayName || user.username || 'User'
    });
  }, [navigation]);

  // OPTIMIZATION: Memoized render function for better performance
  const renderUserCard = useCallback(({ item, index }) => (
    <TouchableOpacity 
      onPress={() => handleUserPress(item)}
      activeOpacity={0.7}
    >
      <Surface style={[styles.userCard, { backgroundColor: theme.colors.surface }]}>
        <View style={[styles.rankContainer, { backgroundColor: getRankColor(index) }]}>
          <Text style={styles.rankText}>{index + 1}</Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={[styles.userName, { color: theme.colors.onSurface }]}>
            {item.displayName || item.username || 'Anonymous User'}
          </Text>
          <View style={styles.statsRow}>
            <Text style={[styles.userStats, { color: theme.colors.onSurfaceVariant }]}>
              Cards: {item.totalCards || 0}
            </Text>
            <Text style={[styles.userStats, { color: theme.colors.onSurfaceVariant }]}>
              Score: {Math.round(item.score) || 0}
            </Text>
          </View>
          
          {/* Show rarity distribution */}
          <View style={styles.rarityDistribution}>
            {Object.entries(item.cardCountByRarity || {})
              .filter(([rarity, count]) => count > 0)
              .map(([rarity, count]) => (
                <View 
                  key={rarity} 
                  style={[
                    styles.rarityBadge, 
                    { backgroundColor: RARITY_COLORS[rarity] || '#888' }
                  ]}
                >
                  <Text style={styles.rarityCount}>{count}</Text>
                </View>
              ))}
          </View>
        </View>
      </Surface>
    </TouchableOpacity>
  ), [handleUserPress, theme.colors.surface, theme.colors.onSurface, theme.colors.onSurfaceVariant]);

  const getRankColor = useCallback((index) => {
    switch (index) {
      case 0: return '#FFD700'; // Gold
      case 1: return '#C0C0C0'; // Silver
      case 2: return '#CD7F32'; // Bronze
      default: return '#4CAF50'; // Green
    }
  }, []);

  // Loading state
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.onSurface }]}>
          Loading leaderboard...
        </Text>
      </View>
    );
  }

  // Index error state
  if (indexError) {
    return (
      <View style={styles.errorContainer}>
        <Text style={[styles.errorTitle, { color: theme.colors.error }]}>
          Database Index Required
        </Text>
        <Text style={[styles.errorText, { color: theme.colors.onSurface }]}>
          A Firebase index is needed to display the leaderboard.
        </Text>
        <Button 
          mode="contained" 
          onPress={() => Linking.openURL(indexError)}
          style={styles.actionButton}
        >
          Create Index
        </Button>
        <Button 
          mode="outlined" 
          onPress={refreshLeaderboard}
          style={[styles.actionButton, styles.buttonSpacing]}
        >
          Retry
        </Button>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={[styles.errorText, { color: theme.colors.error }]}>
          {error}
        </Text>
        <Button 
          mode="contained" 
          onPress={refreshLeaderboard}
          style={styles.actionButton}
        >
          Retry
        </Button>
      </View>
    );
  }

  // Empty state
  if (users.length === 0) {
    return (
      <View style={styles.errorContainer}>
        <Text style={[styles.errorText, { color: theme.colors.onSurface }]}>
          No users found in this group.
        </Text>
        {activeGroupId && (
          <Text style={[styles.debugText, { color: theme.colors.onSurfaceVariant }]}>
            Current group: {activeGroupId}
          </Text>
        )}
        <Button 
          mode="outlined" 
          onPress={refreshLeaderboard}
          style={styles.actionButton}
        >
          Refresh
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Last refresh indicator */}
      {lastRefresh && !loading && (
        <View style={styles.refreshIndicator}>
          <Text style={[styles.refreshText, { color: theme.colors.onSurfaceVariant }]}>
            Last updated: {lastRefresh.toLocaleTimeString()}
          </Text>
          <TouchableOpacity onPress={refreshLeaderboard}>
            <Text style={[styles.refreshLink, { color: theme.colors.primary }]}>
              Refresh
            </Text>
          </TouchableOpacity>
        </View>
      )}
      
      <FlatList
        data={users}
        renderItem={renderUserCard}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContainer}
        refreshing={loading}
        onRefresh={refreshLeaderboard}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        maxToRenderPerBatch={15}
        windowSize={10}
        initialNumToRender={15}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 16,
    paddingTop: 30,
  },
  listContainer: {
    paddingBottom: 20,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginVertical: 4,
    marginHorizontal: 8,
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  rankContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  rankText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  userStats: {
    fontSize: 14,
  },
  rarityDistribution: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  rarityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 24,
    alignItems: 'center',
  },
  rarityCount: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  actionButton: {
    marginTop: 10,
    minWidth: 120,
  },
  buttonSpacing: {
    marginTop: 8,
  },
  refreshIndicator: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  refreshText: {
    fontSize: 14,
  },
  refreshLink: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  debugText: {
    fontSize: 14,
    marginTop: 10,
  },
});

// Wrap LeaderboardScreen with error boundary
const LeaderboardScreenWithErrorBoundary = (props) => (
  <LeaderboardErrorBoundary>
    <LeaderboardScreen {...props} />
  </LeaderboardErrorBoundary>
);

export default LeaderboardScreenWithErrorBoundary; 