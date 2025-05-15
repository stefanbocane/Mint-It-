import { collection, getDocs, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { FlatList, Linking, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Surface, Text } from 'react-native-paper';
import { db } from '../config/firebase';
import { useGroup } from '../contexts/GroupContext';
import { RARITY_COLORS, RARITY_TYPES } from '../utils/rarity';

const RARITY_WEIGHTS = {
  [RARITY_TYPES.COMMON]: 1,
  [RARITY_TYPES.UNCOMMON]: 3,
  [RARITY_TYPES.RARE]: 5,
  [RARITY_TYPES.EPIC]: 10,
  [RARITY_TYPES.LEGENDARY]: 20,
  [RARITY_TYPES.MYTHIC]: 50,
  [RARITY_TYPES.MYSTERY]: 0, // Mystery cards are worth 0 points
};

const LeaderboardScreen = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [indexError, setIndexError] = useState(null);
  const { currentGroup } = useGroup();

  useEffect(() => {
    fetchLeaderboardData();
  }, [currentGroup]);

  const fetchLeaderboardData = async () => {
    if (!currentGroup?.id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setIndexError(null);
      
      // 1. Get all cards in this group first
      const cardsRef = collection(db, 'cards');
      const cardsQuery = query(
        cardsRef,
        where('groupId', '==', currentGroup.id)
      );
      
      const cardsSnapshot = await getDocs(cardsQuery);
      const allCards = cardsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      console.log(`Found ${allCards.length} total cards in group ${currentGroup.id}`);
      
      // 2. Group cards by owner
      const cardsByOwner = {};
      allCards.forEach(card => {
        const ownerId = card.ownerId || card.userId; // Support both field names
        if (ownerId) {
          if (!cardsByOwner[ownerId]) {
            cardsByOwner[ownerId] = [];
          }
          cardsByOwner[ownerId].push(card);
        }
      });
      
      // 3. Get all users in this group
      const usersRef = collection(db, 'users');
      const usersQuery = query(
        usersRef,
        where('groups', 'array-contains', currentGroup.id)
      );
      
      const usersSnapshot = await getDocs(usersQuery);
      console.log(`Found ${usersSnapshot.docs.length} users in group ${currentGroup.id}`);
      
      // 4. Prepare user data with card information
      const userData = usersSnapshot.docs.map(userDoc => {
        const user = userDoc.data();
        const userCards = cardsByOwner[userDoc.id] || [];
        
        console.log(`User ${userDoc.id} has ${userCards.length} cards`);
        
        // Calculate rarity score
        const rarityScore = userCards.reduce((score, card) => {
          const rarityWeight = RARITY_WEIGHTS[card.rarity] || RARITY_WEIGHTS[RARITY_TYPES.COMMON];
          return score + rarityWeight;
        }, 0);
        
        // Count cards by rarity
        const cardCountByRarity = {};
        Object.values(RARITY_TYPES).forEach(rarity => {
          cardCountByRarity[rarity] = userCards.filter(card => card.rarity === rarity).length;
        });
        
        return {
          id: userDoc.id,
          displayName: user.displayName,
          username: user.username,
          score: rarityScore,
          totalCards: userCards.length,
          cardCountByRarity
        };
      });
      
      // 5. Sort by rarity score and assign ranks
      userData.sort((a, b) => b.score - a.score);
      userData.forEach((user, index) => {
        user.rank = index + 1;
      });
      
      setUsers(userData);
    } catch (error) {
      console.error('Error fetching leaderboard data:', error);
      
      // Check if it's an index error
      if (error.message && error.message.includes('requires an index')) {
        const indexUrl = error.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
        if (indexUrl) {
          setIndexError(indexUrl[0]);
        } else {
          setIndexError("Firebase index required. Please create a composite index for users collection on 'groups' and 'totalPoints' fields.");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item, index }) => (
    <Surface style={styles.userCard}>
      <View style={styles.rankContainer}>
        <Text style={styles.rankText}>{index + 1}</Text>
      </View>
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.displayName || item.username || 'Anonymous User'}</Text>
        <View style={styles.statsRow}>
          <Text style={styles.userStats}>Cards: {item.totalCards || 0}</Text>
          <Text style={styles.userStats}>Score: {Math.round(item.score) || 0}</Text>
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
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <Text>Loading leaderboard...</Text>
      </View>
    );
  }

  if (indexError) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Database Index Required</Text>
        <Text style={styles.errorText}>
          A Firebase index needs to be created for the leaderboard to work correctly.
        </Text>
        {typeof indexError === 'string' && indexError.startsWith('https://') ? (
          <Button 
            mode="contained" 
            onPress={() => Linking.openURL(indexError)}
            style={styles.indexButton}
          >
            Create Index Now
          </Button>
        ) : (
          <Text style={styles.errorText}>{indexError}</Text>
        )}
      </View>
    );
  }

  if (!currentGroup) {
    return (
      <View style={styles.noGroupContainer}>
        <Text>Please select a group to view the leaderboard</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {users.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text>No users found in this group</Text>
        </View>
      ) : (
        <FlatList
          data={users}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContainer}
        />
      )}
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
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    fontFamily: 'Inter-Bold',
  },
  listContainer: {
    paddingBottom: 20,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  rankContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  rankText: {
    color: 'white',
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
    fontFamily: 'Inter-Bold',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  userStats: {
    fontSize: 14,
    color: '#666',
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
  noGroupContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    color: '#F44336',
    fontFamily: 'Inter-Bold',
  },
  errorText: {
    textAlign: 'center',
    marginBottom: 20,
  },
  indexButton: {
    marginTop: 10,
  },
});

export default LeaderboardScreen; 