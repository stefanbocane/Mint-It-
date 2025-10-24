import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Dimensions,
    RefreshControl,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';
import {
    Badge,
    Button,
    Card,
    ProgressBar,
    Surface,
    Text
} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { doc, getDoc } from 'firebase/firestore';
import ScreenBackground from '../components/ScreenBackground';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import { claimSetReward, getSetsProgress } from '../services/SetsService';
import CacheService from '../services/caching/CacheService';

// Component to resolve photographer ID to display name
const PhotographerName = ({ photographerId, count, style }) => {
  const [photographerName, setPhotographerName] = useState(null);
  
  useEffect(() => {
    const loadPhotographerName = async () => {
      try {
        // STEP 3.F.1: Use enhanced cache-aside pattern for user profiles
        const userData = await CacheService.getUserProfileCacheAside(
          photographerId, 
          () => getDoc(doc(db, 'users', photographerId, 'sessions', 'main'))
        );
        
        if (userData) {
          const displayName = userData.displayName || userData.username || userData.name || `User ${photographerId.slice(-4)}`;
          setPhotographerName(displayName);
        } else {
          setPhotographerName(`User ${photographerId.slice(-4)}`);
        }
      } catch (error) {
        console.warn(`Could not load photographer name for ${photographerId}:`, error);
        setPhotographerName(`User ${photographerId.slice(-4)}`);
      }
    };
    
    loadPhotographerName();
  }, [photographerId]);
  
  return (
    <Text style={style}>
      • {count} cards from {photographerName || 'Loading...'}
    </Text>
  );
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const SetsScreen = () => {
  const [setsData, setSetsData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claimingRewards, setClaimingRewards] = useState({});

  const { user } = useAuth();
  const { currentGroup } = useGroup();

  const loadSetsData = useCallback(async () => {
    if (!user || !currentGroup) return;

    try {
      setLoading(true);
      const data = await getSetsProgress(user.uid, currentGroup.id);
      setSetsData(data);
    } catch (error) {
      console.error('Error loading sets data:', error);
      Alert.alert('Error', 'Failed to load sets data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [user, currentGroup]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSetsData();
    setRefreshing(false);
  }, [loadSetsData]);

  useFocusEffect(
    useCallback(() => {
      loadSetsData();
    }, [loadSetsData])
  );

  const handleClaimReward = async (setId) => {
    if (claimingRewards[setId]) return;

    try {
      setClaimingRewards(prev => ({ ...prev, [setId]: true }));
      
      const result = await claimSetReward(user.uid, currentGroup.id, setId);
      
      if (result.success) {
        Alert.alert(
          'Reward Claimed!',
          `You've earned ${result.gemsAwarded} gems for completing "${result.setName}"!`,
          [{ text: 'Awesome!', style: 'default' }]
        );
        // Refresh data to show updated status
        await loadSetsData();
      } else {
        Alert.alert('Error', result.error || 'Failed to claim reward');
      }
    } catch (error) {
      console.error('Error claiming reward:', error);
      Alert.alert('Error', 'Failed to claim reward. Please try again.');
    } finally {
      setClaimingRewards(prev => ({ ...prev, [setId]: false }));
    }
  };

  const renderProgressItem = (item, index, total) => {
    const isCompleted = item.completed || item.owned;
    const progressColor = isCompleted ? '#4CAF50' : '#E0E0E0';
    
    return (
      <View key={index} style={styles.progressItem}>
        <Icon
          name={isCompleted ? 'check-circle' : 'circle-outline'}
          size={20}
          color={progressColor}
        />
        <View style={styles.progressTextContainer}>
          <Text style={[
            styles.progressText,
            isCompleted && styles.progressTextCompleted
          ]}>
            {item.name || item.label}
          </Text>
          {item.progress && (
            <Text style={styles.progressSubtext}>
              {item.progress}
            </Text>
          )}
        </View>
      </View>
    );
  };

  const renderSet = (set) => {
    const completionPercentage = set.total > 0 ? (set.progress / set.total) : 0;
    const isCompleted = set.isCompleted || completionPercentage >= 1;
    const canClaim = isCompleted && !set.claimed;

    return (
      <Card key={set.id} style={styles.setCard}>
        <Card.Content>
          <View style={styles.setHeader}>
            <View style={styles.setTitleContainer}>
              <Text style={styles.setTitle}>{set.name}</Text>
              {set.claimed && (
                <Badge style={styles.completedBadge}>Completed</Badge>
              )}
              {canClaim && (
                <Badge style={styles.claimableBadge}>Ready to Claim!</Badge>
              )}
            </View>
            <Text style={styles.setReward}>
              <Icon name="diamond-stone" size={16} color="#FFD700" />
              {set.gemRewardRange 
                ? ` ${set.gemRewardRange.min}-${set.gemRewardRange.max} gems`
                : ` ${set.gemReward || 'Unknown'} gems`
              }
            </Text>
          </View>

          <Text style={styles.setDescription}>{set.description}</Text>

          <View style={styles.progressContainer}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>
                {set.progressDetails?.description || `Progress: ${set.progress}/${set.total}`}
              </Text>
              <Text style={styles.progressPercentage}>
                {Math.round(completionPercentage * 100)}%
              </Text>
            </View>
            <ProgressBar
              progress={completionPercentage}
              color={isCompleted ? '#4CAF50' : '#2196F3'}
              style={styles.progressBar}
            />
          </View>

          {set.requirements && (
            <View style={styles.requirementsContainer}>
              <Text style={styles.requirementsTitle}>Requirements:</Text>
              <View style={styles.requirementsList}>
                {set.requirements.map((req, index) => 
                  renderProgressItem(req, index, set.requirements.length)
                )}
              </View>
              
              {/* Show additional progress details if available */}
              {set.progressDetails && (
                <View style={styles.detailsContainer}>
                  <Text style={styles.detailsText}>
                    {set.progressDetails.description}
                  </Text>
                  
                  {/* Show specific progress for photographer sets */}
                  {set.id === 'photographers_dedication' && set.progressDetails.photographerCounts && (
                    <View style={styles.photographerProgress}>
                      <Text style={styles.subDetailsTitle}>Top photographers in your collection:</Text>
                      {Object.entries(set.progressDetails.photographerCounts)
                        .sort(([,a], [,b]) => b - a)
                        .slice(0, 3)
                        .map(([photographerId, count], index) => (
                          <PhotographerName 
                            key={photographerId} 
                            photographerId={photographerId} 
                            count={count}
                            style={styles.photographerCount}
                          />
                        ))}
                    </View>
                  )}
                  
                  {/* Show rarity progress for rarity spectrum set */}
                  {set.id === 'rarity_spectrum' && set.progressDetails.ownedRarities && (
                    <View style={styles.rarityProgress}>
                      <Text style={styles.subDetailsTitle}>Rarities collected:</Text>
                      <View style={styles.rarityList}>
                        {set.progressDetails.requiredRarities.map(rarity => (
                          <Text 
                            key={rarity} 
                            style={[
                              styles.rarityItem,
                              set.progressDetails.ownedRarities.includes(rarity) && styles.rarityItemCompleted
                            ]}
                          >
                            {set.progressDetails.ownedRarities.includes(rarity) ? '✓' : '○'} {rarity}
                          </Text>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {canClaim && (
            <Button
              mode="contained"
              onPress={() => handleClaimReward(set.id)}
              loading={claimingRewards[set.id]}
              disabled={claimingRewards[set.id]}
              style={styles.claimButton}
              icon="gift"
            >
              Claim Reward
            </Button>
          )}
        </Card.Content>
      </Card>
    );
  };

  if (loading) {
    return (
      <ScreenBackground>
        <View style={styles.loadingContainer}>
          <Text>Loading sets...</Text>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScrollView
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Surface style={styles.headerSurface}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Card Collection Sets</Text>
            <Text style={styles.headerSubtitle}>
              Complete sets to earn gem rewards
            </Text>
          </View>
        </Surface>

        <View style={styles.setsContainer}>
          {setsData.map(renderSet)}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            More sets coming soon! Keep collecting cards to unlock new achievements.
          </Text>
        </View>
      </ScrollView>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSurface: {
    margin: 16,
    borderRadius: 12,
    elevation: 2,
  },
  header: {
    padding: 20,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    opacity: 0.7,
    textAlign: 'center',
  },
  setsContainer: {
    padding: 16,
    paddingTop: 0,
  },
  setCard: {
    marginBottom: 16,
    borderRadius: 12,
    elevation: 3,
  },
  setHeader: {
    marginBottom: 12,
  },
  setTitleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  setTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    flex: 1,
  },
  completedBadge: {
    backgroundColor: '#4CAF50',
    color: 'white',
  },
  claimableBadge: {
    backgroundColor: '#FF9800',
    color: 'white',
  },
  setReward: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFD700',
  },
  setDescription: {
    fontSize: 14,
    opacity: 0.8,
    marginBottom: 16,
    lineHeight: 20,
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  progressPercentage: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
  },
  requirementsContainer: {
    marginBottom: 16,
  },
  requirementsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  requirementsList: {
    paddingLeft: 8,
  },
  progressItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressText: {
    marginLeft: 8,
    fontSize: 14,
    opacity: 0.7,
  },
  progressTextContainer: {
    flex: 1,
    marginLeft: 8,
  },
  progressSubtext: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 2,
  },
  progressTextCompleted: {
    opacity: 1,
    fontWeight: '600',
    color: '#4CAF50',
  },
  claimButton: {
    marginTop: 8,
    backgroundColor: '#4CAF50',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    opacity: 0.6,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  detailsContainer: {
    marginBottom: 16,
  },
  detailsText: {
    fontSize: 14,
    opacity: 0.7,
  },
  photographerProgress: {
    marginBottom: 8,
  },
  subDetailsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  photographerCount: {
    fontSize: 14,
    opacity: 0.7,
  },
  rarityProgress: {
    marginBottom: 8,
  },
  rarityList: {
    paddingLeft: 8,
  },
  rarityItem: {
    fontSize: 14,
    opacity: 0.7,
  },
  rarityItemCompleted: {
    opacity: 1,
    fontWeight: '600',
    color: '#4CAF50',
  },
});

export default SetsScreen; 