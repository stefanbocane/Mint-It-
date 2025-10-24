import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Linking, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Button, Surface, Text, useTheme } from 'react-native-paper';
import { useGroup } from '../contexts/GroupContextSupabase';
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

  // 🚀 ULTRA-OPTIMIZED: Always show all group members ranked by weighted card rarity
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

      const { supabase } = await import('../config/supabase');

      // STEP 1: Get group and its members
      const { data: groupData, error: groupError } = await supabase
        .from('groups')
        .select('members')
        .eq('id', activeGroupId)
        .single();

      if (groupError || !groupData) {
        console.log('Group not found:', groupError);
        if (mountedRef.current) {
          setUsers([]);
          setLastRefresh(new Date());
          setLoading(false);
        }
        return;
      }

      const memberIds = groupData.members || [];

      console.log('🔍 DEBUG: Group data:', groupData);
      console.log('🔍 DEBUG: memberIds type:', typeof memberIds, 'isArray:', Array.isArray(memberIds));
      console.log('🔍 DEBUG: memberIds raw:', memberIds);

      if (memberIds.length === 0) {
        console.log('⚠️ No members in group - memberIds is empty!');
        if (mountedRef.current) {
          setUsers([]);
          setLastRefresh(new Date());
          setLoading(false);
        }
        return;
      }

      console.log(`📊 Found ${memberIds.length} group members:`, memberIds);

      // STEP 2: Fetch user profiles for all members
      const { data: userProfiles, error: usersError } = await supabase
        .from('users')
        .select('id, username, display_name, email, avatar_url')
        .in('id', memberIds);

      if (usersError) {
        console.error('❌ Error fetching user profiles:', usersError);
      }

      const profiles = userProfiles || [];
      console.log(`👥 Fetched ${profiles.length} user profiles out of ${memberIds.length} members`);
      console.log('🔍 DEBUG: User profiles:', profiles.map(p => ({ id: p.id, username: p.username || p.email })));

      // Debug: Show which members are missing profiles
      if (profiles.length < memberIds.length) {
        const profileIds = new Set(profiles.map(p => p.id));
        const missingIds = memberIds.filter(id => !profileIds.has(id));
        console.error('⚠️ MISSING PROFILES for member IDs:', missingIds);
        console.error('⚠️ This means these users in the group DO NOT have entries in the users table');
      }

      // Check for missing profiles and warn
      const profileIds = profiles.map(p => p.id);
      const missingProfileIds = memberIds.filter(id => !profileIds.includes(id));
      if (missingProfileIds.length > 0) {
        console.warn(`⚠️ ${missingProfileIds.length} group member(s) have no user profile:`, missingProfileIds);
        console.warn('This may indicate incomplete user registration or orphaned group memberships');
      }

      // STEP 3: Calculate scores for each member based on their cards
      const userScores = {};
      const userCardCounts = {};
      const userCardCountByRarity = {};

      // Query all cards for this group (only available cards, not in auction/trade)
      const { data: cards, error: cardsError } = await supabase
        .from('cards')
        .select('owner_id, rarity, name, status, in_auction, in_trade')
        .eq('group_id', activeGroupId)
        .eq('in_auction', false)
        .eq('in_trade', false)
        .eq('status', 'available');

      if (cardsError) {
        console.error('❌ Error fetching cards:', cardsError);
      }

      const groupCards = cards || [];
      console.log(`🔍 Found ${groupCards.length} available cards in group ${activeGroupId}`);

      // Debug: Show unique owner IDs from cards
      const uniqueOwnerIds = [...new Set(groupCards.map(c => c.owner_id).filter(Boolean))];
      console.log(`🔍 DEBUG: Unique owner IDs from cards (${uniqueOwnerIds.length}):`, uniqueOwnerIds);

      groupCards.forEach(card => {
        const userId = card.owner_id;

        if (userId && memberIds.includes(userId)) {
          if (!userScores[userId]) {
            userScores[userId] = 0;
            userCardCounts[userId] = 0;
            userCardCountByRarity[userId] = {};
          }

          const rarityWeight = RARITY_WEIGHTS[card.rarity] || 1;
          userScores[userId] += rarityWeight;
          userCardCounts[userId] += 1;

          // Track cards by rarity
          const rarity = card.rarity || 'common';
          userCardCountByRarity[userId][rarity] = (userCardCountByRarity[userId][rarity] || 0) + 1;
        }
      });

      console.log('🔍 DEBUG: User scores summary:', Object.entries(userScores).map(([uid, score]) =>
        `${uid.slice(0, 8)}...: ${score} pts, ${userCardCounts[uid]} cards`
      ));

      // STEP 4: Build leaderboard entries for ALL members (even those with 0 cards or no profile)
      const leaderboardEntries = memberIds
        .map(memberId => {
          // Find the user profile if it exists
          const userProfile = profiles.find(p => p.id === memberId);

          // If no profile exists, create a minimal entry
          if (!userProfile) {
            return {
              id: memberId,
              displayName: `User (${memberId.slice(0, 8)})`,
              username: memberId.slice(0, 8),
              score: userScores[memberId] || 0,
              totalCards: userCardCounts[memberId] || 0,
              cardCountByRarity: userCardCountByRarity[memberId] || {},
              profilePicture: null,
              isMissingProfile: true
            };
          }

          // Normal entry with profile
          return {
            id: userProfile.id,
            displayName: userProfile.display_name || userProfile.username || userProfile.email || 'Unknown',
            username: userProfile.username || userProfile.email?.split('@')[0] || 'user',
            score: userScores[userProfile.id] || 0,
            totalCards: userCardCounts[userProfile.id] || 0,
            cardCountByRarity: userCardCountByRarity[userProfile.id] || {},
            profilePicture: userProfile.avatar_url || null,
            isMissingProfile: false
          };
        })
        .sort((a, b) => b.score - a.score); // Sort by score descending

      console.log(`✅ Leaderboard computed with ${leaderboardEntries.length} users:`,
        leaderboardEntries.map((u, i) => `${i+1}. ${u.displayName} (${u.score} pts, ${u.totalCards} cards)`));

      if (mountedRef.current) {
        setUsers(leaderboardEntries);
        setLastRefresh(new Date());
        setLoading(false);
      }

    } catch (error) {
      console.error('LeaderboardScreen: Error fetching leaderboard data:', error);

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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.userName, { color: theme.colors.onSurface }]}>
              {item.displayName || item.username || 'Anonymous User'}
            </Text>
            {item.isMissingProfile && (
              <Text style={[styles.missingProfileBadge, { backgroundColor: theme.colors.errorContainer, color: theme.colors.onErrorContainer }]}>
                Incomplete
              </Text>
            )}
          </View>
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



  console.log('🔍 LeaderboardScreen: Rendering with users:', users.length, 'Loading:', loading, 'Error:', error);
  
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
  missingProfileBadge: {
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
});

// Wrap LeaderboardScreen with error boundary
const LeaderboardScreenWithErrorBoundary = (props) => (
  <LeaderboardErrorBoundary>
    <LeaderboardScreen {...props} />
  </LeaderboardErrorBoundary>
);

export default LeaderboardScreenWithErrorBoundary;
