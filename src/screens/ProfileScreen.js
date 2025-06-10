import { useFocusEffect } from '@react-navigation/native';
import { doc, getDoc } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';
import ProfileLevelSection from '../components/ProfileLevelSection';
import ProfileShowcaseSection from '../components/ProfileShowcaseSection';
import ScreenBackground from '../components/ScreenBackground';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import { useUnifiedUserData } from '../contexts/UnifiedUserDataContext';
import CacheService from '../services/caching/CacheService';
import { getCachedUserCards } from '../utils/firestoreUtils';

const ProfileScreen = ({ route, navigation }) => {
  const { user: currentUser } = useAuth();
  const { currentGroup } = useGroup();
  const { userData: currentUserData, updateUserField } = useUnifiedUserData();
  const theme = useTheme();
  
  // State management
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [profileUserData, setProfileUserData] = useState(null); // Data for the user whose profile we're viewing
  const [userStats, setUserStats] = useState(null); // Stats for the user whose profile we're viewing
  const [showcaseCards, setShowcaseCards] = useState(Array(3).fill(null));
  const [allUserCards, setAllUserCards] = useState([]);
  const [isLoadingCards, setIsLoadingCards] = useState(false);
  const [cardFetchError, setCardFetchError] = useState(null);
  
  // Derived state
  const routeParams = route?.params || {};
  const userId = routeParams?.userId || currentUser?.uid;
  const isCurrentUser = currentUser && (!routeParams?.userId || routeParams?.userId === currentUser.uid);
  
  // Get the user data for the profile being viewed (current user or other user)
  const userData = isCurrentUser ? currentUserData : profileUserData;

  // Load user data (for current user, use context; for others, fetch from database)
  const loadUserData = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    if (isCurrentUser) {
      // For current user, we already have data from UnifiedUserDataContext
      setProfileUserData(currentUserData);
      console.log('ProfileScreen: Using current user data from context');
      return;
    }

    // For other users, fetch their data from database
    try {
      console.log('ProfileScreen: Fetching other user data for:', userId);
      // STEP 3.F.1: Use enhanced cache-aside pattern for user profiles
      const otherUserData = await CacheService.getUserProfileCacheAside(
        userId, 
        () => getDoc(doc(db, 'users', userId))
      );

      if (otherUserData) {
        setProfileUserData({ id: userId, ...otherUserData });
        console.log('ProfileScreen: Loaded other user data:', {
          id: userId,
          username: otherUserData.username,
          displayName: otherUserData.displayName
        });
      } else {
        console.warn('ProfileScreen: Other user data not found for:', userId);
        setProfileUserData(null);
        setError('User profile not found.');
      }
    } catch (error) {
      console.error('ProfileScreen: Error loading other user data:', error);
      setError('Failed to load user profile.');
    }
  }, [userId, isCurrentUser, currentUserData]);

  // Load user stats (for the user whose profile we're viewing)
  const loadUserStats = useCallback(async () => {
    if (!userId) return;

    try {
      console.log('ProfileScreen: Loading stats for user:', userId);
      
      // Use the proper StatsService to get stats
      const StatsService = (await import('../services/StatsService')).default;
      let stats = null;
      
      try {
        // First try to get enhanced stats with derived metrics
        stats = await StatsService.getCachedStats(userId, currentGroup?.id, {
          ttl: 2 * 60 * 1000, // 2 minute cache
          includeMetrics: ['recentActivity', 'rarityBreakdown']
        });
        console.log('ProfileScreen: Loaded enhanced stats:', stats);
      } catch (enhancedError) {
        console.log('ProfileScreen: Enhanced stats failed, trying basic stats:', enhancedError.message);
        
        // Fallback to basic stats
        try {
          stats = await StatsService.getUserStats(userId);
          console.log('ProfileScreen: Loaded basic stats:', stats);
        } catch (basicError) {
          console.log('ProfileScreen: Basic stats also failed:', basicError.message);
        }
      }
      
      // If we still don't have stats, try to get from user data or use defaults
      if (!stats || (!stats.tradesCompleted && !stats.auctionsWon)) {
        console.log('ProfileScreen: No stats found, checking userData or using defaults');
        
        // Check if userData has stats
        if (userData?.stats) {
          stats = userData.stats;
          console.log('ProfileScreen: Using stats from userData:', stats);
        } else {
          // Use default stats
          stats = {
            tradesCompleted: 0,
            auctionsWon: 0,
            totalCards: userData?.totalCards || 0,
            derived: {
              auctionWinRate: 0,
              activityScore: 0,
              totalAuctionsParticipated: 0
            }
          };
          console.log('ProfileScreen: Using default stats');
        }
      }
      
      // Ensure we have derived stats
      if (!stats.derived) {
        const totalAuctionsParticipated = stats.auctionsByRarity ? 
          Object.values(stats.auctionsByRarity).reduce((sum, rarity) => sum + (rarity.completed || 0), 0) : 0;
        
        stats.derived = {
          auctionWinRate: totalAuctionsParticipated > 0 ? 
            ((stats.auctionsWon || 0) / totalAuctionsParticipated * 100).toFixed(1) : 0,
          activityScore: ((stats.tradesCompleted || 0) * 2) + ((stats.auctionsWon || 0) * 3),
          totalAuctionsParticipated
        };
      }

      console.log('ProfileScreen: Final stats to display:', stats);
      setUserStats(stats);
    } catch (error) {
      console.error('ProfileScreen: Error loading user stats:', error);
      // Set default stats on error
      setUserStats({
        tradesCompleted: 0,
        auctionsWon: 0,
        totalCards: 0,
        derived: {
          auctionWinRate: 0,
          activityScore: 0,
          totalAuctionsParticipated: 0
        }
      });
    }
  }, [userId, userData, currentGroup?.id]);

  // Load profile data
  const loadProfileData = useCallback(async () => {
    if (!userId || !userData) {
      console.log('ProfileScreen: Waiting for userId and userData to be available');
      return;
    }
    
    try {
      setError(null);
      
      console.log('ProfileScreen: Loading profile data for user:', userId);
      console.log('ProfileScreen: Current userData:', userData);
      
      // Load showcase cards from user data
      if (userData?.showcase && Array.isArray(userData.showcase)) {
        console.log('ProfileScreen: Loading showcase cards:', userData.showcase);
        
        const showcasePromises = userData.showcase.map(async (cardId, index) => {
          // Convert cardId to string and validate
          const cardIdString = cardId ? String(cardId).trim() : null;
          
          if (!cardIdString || cardIdString === 'null' || cardIdString === 'undefined') {
            console.log(`ProfileScreen: Showcase slot ${index} is empty or invalid`);
            return null;
          }
          
          try {
            console.log(`ProfileScreen: Loading card ${cardIdString} for slot ${index}`);
            const cardData = await CacheService.getDocument('cards', cardIdString, { ttl: 5 * 60 * 1000 });
            
            if (!cardData) {
              console.warn(`ProfileScreen: Showcase card ${cardIdString} not found in database`);
              return null;
            }
            
            console.log(`ProfileScreen: Loaded card data for slot ${index}:`, {
              id: cardData.id,
              name: cardData.name,
              imageUrl: cardData.imageUrl,
              rarity: cardData.rarity
            });
            
            // Ensure card has required properties
            const processedCard = {
              id: cardData.id || cardIdString,
              name: cardData.name || 'Unknown Card',
              imageUrl: cardData.imageUrl || cardData.image || null,
              rarity: cardData.rarity || 'common',
              ...cardData
            };
            
            console.log(`ProfileScreen: Processed card for slot ${index}:`, processedCard);
            return processedCard;
          } catch (error) {
            console.error(`ProfileScreen: Error fetching showcase card ${cardIdString}:`, error);
            return null;
          }
        });
        
        const showcaseCardsData = await Promise.all(showcasePromises);
        console.log('ProfileScreen: All showcase cards loaded:', showcaseCardsData);
        
        // Ensure we have exactly 3 slots
        while (showcaseCardsData.length < 3) {
          showcaseCardsData.push(null);
        }
        
        const finalShowcase = showcaseCardsData.slice(0, 3);
        console.log('ProfileScreen: Final showcase array:', finalShowcase);
        setShowcaseCards(finalShowcase);
      } else {
        console.log('ProfileScreen: No showcase data found, initializing empty showcase');
        setShowcaseCards(Array(3).fill(null));
      }
      
    } catch (error) {
      console.error('ProfileScreen: Error loading profile:', error);
      setError('Failed to load profile. Please try again.');
    }
  }, [userId, userData]);

  // Load user cards for showcase selection
  const loadUserCards = useCallback(async () => {
    if (!isCurrentUser || !currentGroup?.id) {
      return;
    }

    try {
      setIsLoadingCards(true);
      setCardFetchError(null);
      
      const cards = await getCachedUserCards(currentUser.uid, currentGroup.id, {
        ttl: 5 * 60 * 1000,
        sortBy: 'name'
      });
      
      if (cards && cards.length > 0) {
        setAllUserCards(cards);
      } else {
        setCardFetchError('No cards found in your collection.');
      }
      
    } catch (error) {
      console.error('Error loading user cards:', error);
      setCardFetchError('Failed to load your cards. Please try again.');
    } finally {
      setIsLoadingCards(false);
    }
  }, [isCurrentUser, currentGroup?.id, currentUser?.uid]);

  // Handle card selection for showcase
  const handleSelectCard = async (card, slotIndex) => {
    if (slotIndex === null || slotIndex === undefined) return;

    try {
      // Optimistic update
      const newShowcase = [...showcaseCards];
      newShowcase[slotIndex] = card;
      setShowcaseCards(newShowcase);
      
      // Update in database
      await updateUserField('showcase', newShowcase.map(c => c?.id || null));
      
    } catch (error) {
      console.error('Error selecting card:', error);
      
      // Revert optimistic update
      if (userData?.showcase) {
        const revertedShowcase = Array(3).fill(null);
        if (userData.showcase) {
          userData.showcase.forEach((cardId, index) => {
            if (index < 3 && showcaseCards[index]) {
              revertedShowcase[index] = showcaseCards[index];
            }
          });
        }
        setShowcaseCards(revertedShowcase);
      }
      
      alert('Failed to update showcase. Please try again.');
    }
  };

  // Focus effect to refresh data
  useFocusEffect(
    useCallback(() => {
      loadUserData();
    }, [loadUserData])
  );

  // Load user data when user or route changes
  useEffect(() => {
    setLoading(true);
    loadUserData();
  }, [loadUserData]);

  // Load profile data when userData becomes available
  useEffect(() => {
    if (userData) {
      Promise.all([
        loadProfileData(),
        loadUserStats()
      ]).finally(() => {
        setLoading(false);
      });
    }
  }, [userData, loadProfileData, loadUserStats]);

  // Update profileUserData when currentUserData changes (for current user)
  useEffect(() => {
    if (isCurrentUser && currentUserData) {
      setProfileUserData(currentUserData);
    }
  }, [isCurrentUser, currentUserData]);

  // Loading state
  if (loading) {
    return (
      <ScreenBackground>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.loadingText, { color: theme.colors.onSurface }]}>
            Loading profile...
          </Text>
        </View>
      </ScreenBackground>
    );
  }

  // Error state
  if (error) {
    return (
      <ScreenBackground>
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: theme.colors.error }]}>
            {error}
          </Text>
          <Button 
            mode="contained" 
            onPress={loadProfileData}
            style={styles.retryButton}
          >
            Retry
          </Button>
        </View>
      </ScreenBackground>
    );
  }

  const displayName = userData?.username || userData?.displayName || 'Anonymous User';

  return (
    <ScreenBackground>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.colors.onSurface }]}>
          {isCurrentUser ? 'Your Profile' : `${displayName}'s Profile`}
        </Text>
        
        <ProfileShowcaseSection
          showcaseCards={showcaseCards}
          isCurrentUser={isCurrentUser}
          onCardSlotPress={loadUserCards}
          allUserCards={allUserCards}
          isLoadingCards={isLoadingCards}
          cardFetchError={cardFetchError}
          onRetryLoadCards={loadUserCards}
          onSelectCard={handleSelectCard}
        />

        <ProfileLevelSection userId={userId} />
        
        {userStats && (
          <View style={[styles.statsContainer, { 
            backgroundColor: `${theme.colors.surface}DD`, // Even more translucent (87% opacity)
            borderColor: `${theme.colors.primary}60`, // More visible border
          }]}>
            <View style={[styles.statsHeader, { borderBottomColor: `${theme.colors.primary}30` }]}>
              <Text style={[styles.statsTitle, { color: theme.colors.primary }]}>
                ⚡ TRADING STATISTICS ⚡
              </Text>
              <Text style={[styles.statsSubtitle, { color: theme.colors.onSurface }]}>
                Performance Overview
              </Text>
            </View>
            
            <View style={styles.statsGrid}>
              <View style={[styles.statCard, { 
                backgroundColor: `${theme.colors.primary}20`,
                borderColor: `${theme.colors.primary}40`,
              }]}>
                <View style={[styles.statIconContainer, { backgroundColor: theme.colors.primary }]}>
                  <Text style={styles.statIcon}>🤝</Text>
                </View>
                <Text style={[styles.statNumber, { color: theme.colors.primary }]}>
                  {userStats.tradesCompleted || 0}
                </Text>
                <Text style={[styles.statLabel, { color: theme.colors.onSurface }]}>
                  Trades Completed
                </Text>
                <View style={[styles.statProgress, { backgroundColor: `${theme.colors.primary}30` }]}>
                  <View style={[
                    styles.statProgressBar, 
                    { 
                      backgroundColor: theme.colors.primary,
                      width: `${Math.min((userStats.tradesCompleted || 0) * 10, 100)}%`
                    }
                  ]} />
                </View>
              </View>
              
              <View style={[styles.statCard, { 
                backgroundColor: `${theme.colors.secondary || '#FF6B6B'}20`,
                borderColor: `${theme.colors.secondary || '#FF6B6B'}40`,
              }]}>
                <View style={[styles.statIconContainer, { backgroundColor: theme.colors.secondary || '#FF6B6B' }]}>
                  <Text style={styles.statIcon}>🏆</Text>
                </View>
                <Text style={[styles.statNumber, { color: theme.colors.secondary || '#FF6B6B' }]}>
                  {userStats.auctionsWon || 0}
                </Text>
                <Text style={[styles.statLabel, { color: theme.colors.onSurface }]}>
                  Auctions Won
                </Text>
                <View style={[styles.statProgress, { backgroundColor: `${theme.colors.secondary || '#FF6B6B'}30` }]}>
                  <View style={[
                    styles.statProgressBar, 
                    { 
                      backgroundColor: theme.colors.secondary || '#FF6B6B',
                      width: `${Math.min((userStats.auctionsWon || 0) * 15, 100)}%`
                    }
                  ]} />
                </View>
              </View>
              
              <View style={[styles.statCard, { 
                backgroundColor: `${theme.colors.tertiary || '#4ECDC4'}20`,
                borderColor: `${theme.colors.tertiary || '#4ECDC4'}40`,
              }]}>
                <View style={[styles.statIconContainer, { backgroundColor: theme.colors.tertiary || '#4ECDC4' }]}>
                  <Text style={styles.statIcon}>📚</Text>
                </View>
                <Text style={[styles.statNumber, { color: theme.colors.tertiary || '#4ECDC4' }]}>
                  {userStats.totalCards || 0}
                </Text>
                <Text style={[styles.statLabel, { color: theme.colors.onSurface }]}>
                  Total Cards
                </Text>
                <View style={[styles.statProgress, { backgroundColor: `${theme.colors.tertiary || '#4ECDC4'}30` }]}>
                  <View style={[
                    styles.statProgressBar, 
                    { 
                      backgroundColor: theme.colors.tertiary || '#4ECDC4',
                      width: `${Math.min((userStats.totalCards || 0), 100)}%`
                    }
                  ]} />
                </View>
              </View>
            </View>
            
            {userStats.derived && (
              <View style={[styles.derivedStatsSection, { 
                backgroundColor: `${theme.colors.surfaceVariant || theme.colors.surface}90`,
                borderColor: `${theme.colors.outline}60`
              }]}>
                <Text style={[styles.derivedSectionTitle, { color: theme.colors.primary }]}>
                  🎯 Advanced Metrics
                </Text>
                <View style={styles.derivedStatsGrid}>
                  <View style={[styles.derivedStatCard, { backgroundColor: `${theme.colors.primary}15` }]}>
                    <Text style={styles.derivedStatEmoji}>🎯</Text>
                    <Text style={[styles.derivedStatValue, { color: theme.colors.primary }]}>
                      {userStats.derived.auctionWinRate || 0}%
                    </Text>
                    <Text style={[styles.derivedStatLabel, { color: theme.colors.onSurface }]}>
                      Win Rate
                    </Text>
                  </View>
                  <View style={[styles.derivedStatCard, { backgroundColor: `${theme.colors.secondary || '#FF6B6B'}15` }]}>
                    <Text style={styles.derivedStatEmoji}>⚡</Text>
                    <Text style={[styles.derivedStatValue, { color: theme.colors.secondary || '#FF6B6B' }]}>
                      {userStats.derived.activityScore || 0}
                    </Text>
                    <Text style={[styles.derivedStatLabel, { color: theme.colors.onSurface }]}>
                      Activity Score
                    </Text>
                  </View>
                  <View style={[styles.derivedStatCard, { backgroundColor: `${theme.colors.tertiary || '#4ECDC4'}15` }]}>
                    <Text style={styles.derivedStatEmoji}>📊</Text>
                    <Text style={[styles.derivedStatValue, { color: theme.colors.tertiary || '#4ECDC4' }]}>
                      {userStats.derived.totalAuctionsParticipated || 0}
                    </Text>
                    <Text style={[styles.derivedStatLabel, { color: theme.colors.onSurface }]}>
                      Auctions Joined
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    marginTop: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  divider: {
    marginVertical: 15,
    height: 1,
    opacity: 0.1,
  },
  statsContainer: {
    marginTop: 20,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    // Glass morphism effect
    backdropFilter: 'blur(10px)',
  },
  statsHeader: {
    borderBottomWidth: 1,
    paddingBottom: 10,
  },
  statsTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  statsSubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
    paddingHorizontal: 5,
  },
  statCard: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    flex: 1,
    marginHorizontal: 4,
    minWidth: 0,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  statIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statIcon: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  statNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  statLabel: {
    fontSize: 14,
    marginTop: 4,
    fontWeight: '500',
  },
  statProgress: {
    width: '100%',
    height: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 5,
    overflow: 'hidden',
  },
  statProgressBar: {
    height: '100%',
    borderRadius: 5,
  },
  derivedStatsSection: {
    marginTop: 15,
    paddingTop: 15,
    paddingHorizontal: 15,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  derivedSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  derivedStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 5,
  },
  derivedStatCard: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    flex: 1,
    marginHorizontal: 4,
    minWidth: 0,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  derivedStatEmoji: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  derivedStatValue: {
    fontSize: 28,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  derivedStatLabel: {
    fontSize: 14,
    marginTop: 4,
    fontWeight: '500',
  },
});

export default ProfileScreen;
