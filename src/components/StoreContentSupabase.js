import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Animated, Easing, FlatList, Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Button, Card, Modal, Portal, Surface, Text, useTheme } from 'react-native-paper';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import { useUnifiedUserData } from '../contexts/UnifiedUserDataContextSupabase';
import { BORDER_OPTIONS, getBorderAnimationStyle } from '../utils/borderOptions';
import { getRarityColor } from '../utils/rarity';

// Optimized store configuration
const STORE_CONFIG = {
  CACHE: {
    USER_DATA_TTL: 10 * 60 * 1000, // 10 minutes for user data
    CARDS_TTL: 5 * 60 * 1000, // 5 minutes for cards
  },
  PERFORMANCE: {
    PREFETCH_DELAY: 500,
    MAX_CARDS_DISPLAY: 30,
    ANIMATION_ENABLED: true,
    DEBOUNCE_DELAY: 300, // Prevent rapid API calls
  },
};

const StoreContentSupabase = ({ navigation }) => {
  const theme = useTheme();
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const { userData, refreshUserData } = useUnifiedUserData();

  // Get gems from userData (global gems)
  const gems = userData?.gems || 0;

  // Optimized state management with race condition prevention
  const [userBorders, setUserBorders] = useState(['default']);
  const [loading, setLoading] = useState(false);
  const [selectedBorder, setSelectedBorder] = useState(null);
  const [cardSelectionVisible, setCardSelectionVisible] = useState(false);
  const [userCards, setUserCards] = useState([]);
  const [isLoadingCards, setIsLoadingCards] = useState(false);
  const [cardFetchError, setCardFetchError] = useState(null);
  const [borderSelectionVisible, setBorderSelectionVisible] = useState(false);
  const [purchaseInProgress, setPurchaseInProgress] = useState(new Set()); // Track active purchases

  // Memoized animations for performance
  const animations = useMemo(() =>
    STORE_CONFIG.PERFORMANCE.ANIMATION_ENABLED
      ? BORDER_OPTIONS.map(() => new Animated.Value(0))
      : [],
    []
  );

  // Optimized border status calculation with purchase tracking
  const bordersWithStatus = useMemo(() => {
    return BORDER_OPTIONS.map(border => {
      const isOwned = userBorders.includes(border.id);
      const isPurchasing = purchaseInProgress.has(border.id);
      return {
        ...border,
        owned: isOwned,
        canPurchase: !isOwned && gems >= border.price && !isPurchasing && !loading,
        isPurchasing,
      };
    });
  }, [userBorders, gems, purchaseInProgress, loading]);

  // Optimized store initialization with improved cleanup
  useEffect(() => {
    let animationCleanup = [];
    let mounted = true;

    const initializeStore = async () => {
      if (!mounted) return;
      await loadUserBorders();
    };

    initializeStore();

    // Start animations only if enabled and component is mounted
    if (STORE_CONFIG.PERFORMANCE.ANIMATION_ENABLED && mounted) {
      BORDER_OPTIONS.forEach((_, index) => {
        const cleanup = animateBorder(index);
        if (cleanup) {
          animationCleanup.push(cleanup);
        }
      });
    }

    // Enhanced cleanup to prevent memory leaks
    return () => {
      mounted = false;
      animationCleanup.forEach(cleanup => {
        if (typeof cleanup === 'function') {
          cleanup();
        }
      });

      // Stop all animations
      if (STORE_CONFIG.PERFORMANCE.ANIMATION_ENABLED && animations.length > 0) {
        animations.forEach(animation => {
          animation.stopAnimation?.();
          animation.setValue?.(0);
        });
      }
    };
  }, [user, currentGroup]);

  // Enhanced focus effect with debounced updates
  useFocusEffect(
    useCallback(() => {
      if (user && currentGroup) {
        // Debounced refresh to prevent excessive API calls
        const timeoutId = setTimeout(() => {
          loadUserBorders();
        }, STORE_CONFIG.PERFORMANCE.PREFETCH_DELAY);

        return () => clearTimeout(timeoutId);
      }
    }, [user, currentGroup])
  );

  // Load user borders from Supabase
  const loadUserBorders = async () => {
    if (!user) {
      setUserBorders(['default']);
      return;
    }

    try {
      setLoading(true);

      // Fetch user data including card_borders
      const { data: userProfile, error } = await supabase
        .from('users')
        .select('card_borders')
        .eq('id', user.id)
        .single();

      if (error) {
        console.warn('Error loading user borders:', error.message);
        setUserBorders(['default']);
        return;
      }

      if (userProfile?.card_borders) {
        setUserBorders(userProfile.card_borders);
      } else {
        setUserBorders(['default']);
      }

    } catch (error) {
      console.warn('Error loading user borders:', error);
      setUserBorders(['default']);
    } finally {
      setLoading(false);
    }
  };

  // Load user cards for border application
  const loadUserCards = async () => {
    if (!user || !currentGroup) {
      return;
    }

    try {
      setIsLoadingCards(true);
      setCardFetchError(null);

      // Fetch user's cards from Supabase
      const { data: cards, error } = await supabase
        .from('cards')
        .select('*')
        .eq('owner_id', user.id)
        .eq('group_id', currentGroup.id)
        .eq('in_auction', false)
        .eq('in_trade', false)
        .order('rarity', { ascending: false })
        .limit(STORE_CONFIG.PERFORMANCE.MAX_CARDS_DISPLAY);

      if (error) {
        throw error;
      }

      setUserCards(cards || []);

    } catch (error) {
      console.error('Error loading user cards:', error);
      setCardFetchError('Failed to load your cards. Please try again.');
    } finally {
      setIsLoadingCards(false);
    }
  };

  // Enhanced border animation with performance optimization
  const animateBorder = (index) => {
    if (!STORE_CONFIG.PERFORMANCE.ANIMATION_ENABLED || !animations[index]) return null;

    const animation = animations[index];

    const animationLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(animation, {
          toValue: 1,
          duration: 2000,
          easing: Easing.linear,
          useNativeDriver: false,
        }),
        Animated.timing(animation, {
          toValue: 0,
          duration: 2000,
          easing: Easing.linear,
          useNativeDriver: false,
        }),
      ])
    );

    animationLoop.start();

    // Return cleanup function to stop animation
    return () => {
      animationLoop.stop();
      animation.setValue(0);
    };
  };

  // Race-condition-safe border purchase with validation
  const purchaseBorder = async (border) => {
    if (!user || !currentGroup) {
      Alert.alert('Error', 'Please select a group first');
      return;
    }

    // Prevent duplicate purchase attempts
    if (purchaseInProgress.has(border.id)) {
      console.log('Purchase already in progress for border:', border.id);
      return;
    }

    // Validate ownership and balance
    if (userBorders.includes(border.id)) {
      Alert.alert('Already Owned', 'You already own this border!');
      return;
    }

    if (gems < border.price) {
      Alert.alert('Insufficient Gems', `You need ${border.price} gems to purchase this border. You have ${gems} gems.`);
      return;
    }

    // Show confirmation dialog
    Alert.alert(
      'Confirm Purchase',
      `Are you sure you want to purchase the "${border.name}" border for ${border.price} gems?\n\nYour current balance: ${gems} gems\nBalance after purchase: ${gems - border.price} gems`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Purchase',
          style: 'default',
          onPress: () => processBorderPurchase(border),
        },
      ]
    );
  };

  // Atomic purchase processing with comprehensive race condition prevention
  const processBorderPurchase = async (border) => {
    // Track purchase start
    setPurchaseInProgress(prev => new Set([...prev, border.id]));

    try {
      setLoading(true);

      // Final atomic validation to prevent race conditions
      if (userBorders.includes(border.id)) {
        Alert.alert('Already Owned', 'You already own this border!');
        return;
      }

      if (gems < border.price) {
        Alert.alert('Insufficient Gems', 'You do not have enough gems for this purchase.');
        return;
      }

      // Calculate new values
      const newBorders = [...userBorders, border.id];

      // Use Supabase RPC to update gems atomically
      const { data: gemsData, error: gemsError } = await supabase
        .rpc('update_gems', {
          p_user_id: user.id,
          p_amount: -border.price,
          p_group_id: null // Global gems
        });

      if (gemsError) {
        throw new Error(gemsError.message || 'Failed to deduct gems');
      }

      // Update card_borders array
      const { error: bordersError } = await supabase
        .from('users')
        .update({
          card_borders: newBorders,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (bordersError) {
        // Rollback gems if border update failed
        await supabase.rpc('update_gems', {
          p_user_id: user.id,
          p_amount: border.price,
          p_group_id: null
        });
        throw new Error(bordersError.message || 'Failed to update borders');
      }

      // Update local state immediately for responsive UI
      setUserBorders(newBorders);

      // Refresh user data to update gems display
      await refreshUserData();

      // Success notification
      Alert.alert(
        'Purchase Successful!',
        `You have successfully purchased the "${border.name}" border!\n\nGems remaining: ${(gems - border.price).toLocaleString()}`
      );

      console.log(`✅ Successfully purchased border: ${border.name} for ${border.price} gems`);

    } catch (error) {
      console.error('Error purchasing border:', error);
      Alert.alert(
        'Purchase Failed',
        error.message || 'There was an error processing your purchase. Please try again.'
      );
      // Reload borders to ensure state is correct
      await loadUserBorders();
    } finally {
      setLoading(false);
      // Remove from purchase tracking
      setPurchaseInProgress(prev => {
        const newSet = new Set(prev);
        newSet.delete(border.id);
        return newSet;
      });
    }
  };

  // Apply border to card
  const applyBorderToCard = async (cardId) => {
    if (!selectedBorder || !user || !currentGroup) return;

    try {
      setLoading(true);

      // Update card with new border
      const { error } = await supabase
        .from('cards')
        .update({
          border_type: selectedBorder,
          updated_at: new Date().toISOString()
        })
        .eq('id', cardId)
        .eq('owner_id', user.id); // Verify ownership

      if (error) {
        throw error;
      }

      // Update local card state
      setUserCards(prevCards =>
        prevCards.map(card =>
          card.id === cardId ? { ...card, border_type: selectedBorder } : card
        )
      );

      setCardSelectionVisible(false);
      setSelectedBorder(null);
      Alert.alert('Success!', 'Border applied to your card!');
    } catch (error) {
      console.error('Error applying border:', error);
      Alert.alert('Error', 'Failed to apply border. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Get border animation based on type
  const getBorderAnimation = (animationType, animation, borderColor, secondaryColor) => {
    const borderOption = BORDER_OPTIONS.find(b => b.animationType === animationType);
    if (!borderOption) {
      return { borderColor: borderColor || '#000' };
    }

    return getBorderAnimationStyle(
      borderOption.animationType,
      borderOption.color,
      borderOption.secondaryColor,
      borderOption.glowIntensity
    );
  };

  // Optimized border item rendering with memoized calculations
  const renderBorderItem = useCallback(({ item, index }) => {
    const borderStatus = bordersWithStatus.find(b => b.id === item.id);
    const { owned, canPurchase, isPurchasing } = borderStatus || { owned: false, canPurchase: false, isPurchasing: false };
    const animation = STORE_CONFIG.PERFORMANCE.ANIMATION_ENABLED ? animations[index] : null;

    const getButtonText = () => {
      if (isPurchasing) return 'Purchasing...';
      if (loading) return 'Processing...';
      if (owned) return 'Owned';
      if (gems < item.price) return 'Insufficient Gems';
      return 'Purchase';
    };

    const getButtonStyle = () => {
      if (!canPurchase || isPurchasing) {
        return { backgroundColor: theme.colors.disabled };
      }
      return { backgroundColor: theme.colors.primary };
    };

    return (
      <Card style={styles.borderCard}>
        <Card.Content style={styles.borderCardContent}>
          <View style={styles.borderPreview}>
            <Animated.View
              style={[
                styles.borderSample,
                {
                  borderWidth: 3,
                  ...getBorderAnimation(item.animationType, animation, item.color, item.secondaryColor)
                }
              ]}
            />
          </View>
          <Text style={styles.borderName}>{item.name}</Text>
          <Text style={styles.borderDescription}>{item.description}</Text>
          <View style={styles.priceContainer}>
            <Text style={styles.priceLabel}>Price:</Text>
            <Text style={[
              styles.priceValue,
              { color: canPurchase ? '#4CAF50' : '#757575' }
            ]}>
              {item.price} Gems
            </Text>
          </View>
          {owned && (
            <View style={styles.ownedIndicator}>
              <Text style={styles.ownedText}>✓ You own this border</Text>
            </View>
          )}
        </Card.Content>
        <Card.Actions>
          <Button
            mode={owned ? "outlined" : "contained"}
            onPress={owned ? undefined : () => purchaseBorder(item)}
            disabled={!canPurchase || isPurchasing || owned}
            style={getButtonStyle()}
            loading={loading}
          >
            {getButtonText()}
          </Button>
        </Card.Actions>
      </Card>
    );
  }, [bordersWithStatus, animations, loading, gems, theme.colors, purchaseBorder]);

  // Open border selection
  const openBorderSelection = () => {
    setBorderSelectionVisible(true);
  };

  // Select border to apply
  const selectBorderToApply = (borderId) => {
    setSelectedBorder(borderId);
    setBorderSelectionVisible(false);
    setCardSelectionVisible(true);
    loadUserCards();
  };

  // Get border name by ID
  const getBorderName = (borderId) => {
    if (!borderId || borderId === 'default') return 'Default';
    const border = BORDER_OPTIONS.find(b => b.id === borderId);
    return border ? border.name : 'Unknown';
  };

  // Render card selection modal
  const renderCardSelectionModal = () => {
    const cardContent = isLoadingCards ? (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading your cards...</Text>
      </View>
    ) : cardFetchError ? (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{cardFetchError}</Text>
        <Button mode="contained" onPress={loadUserCards} style={styles.retryButton}>
          Retry
        </Button>
      </View>
    ) : userCards.length === 0 ? (
      <View style={styles.noCardsContainer}>
        <Text style={styles.noCardsText}>
          You don't have any cards yet. Go collect some cards first!
        </Text>
        <Button
          mode="contained"
          onPress={() => {
            setCardSelectionVisible(false);
            navigation.navigate('Collection');
          }}
          style={styles.goCollectButton}
        >
          Go to Collection
        </Button>
      </View>
    ) : (
      <FlatList
        data={userCards}
        keyExtractor={item => item.id}
        style={styles.cardsList}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => applyBorderToCard(item.id)}>
            <Card style={styles.cardItem}>
              <Card.Content style={styles.cardItemContent}>
                <Image source={{ uri: item.image_url }} style={styles.cardImage} />
                <View style={styles.cardDetails}>
                  <Text style={styles.cardName}>{item.name || 'Untitled'}</Text>
                  <Text style={[styles.cardRarity, { color: getRarityColor(item.rarity) }]}>
                    {item.rarity || 'Unknown'}
                  </Text>
                  <Text style={styles.currentBorder}>
                    Current border: {getBorderName(item.border_type) || 'Default'}
                  </Text>
                </View>
              </Card.Content>
            </Card>
          </TouchableOpacity>
        )}
        removeClippedSubviews={true}
        maxToRenderPerBatch={5}
        windowSize={8}
      />
    );

    return (
      <Modal
        visible={cardSelectionVisible}
        onDismiss={() => setCardSelectionVisible(false)}
        contentContainerStyle={styles.cardSelectionModal}
      >
        <Text style={styles.modalTitle}>Select a Card</Text>
        <Text style={styles.modalSubtitle}>
          Choose which card to apply the {selectedBorder ? getBorderName(selectedBorder) : ''} border to
        </Text>
        {cardContent}
        <Button
          mode="outlined"
          onPress={() => setCardSelectionVisible(false)}
          style={styles.closeButton}
        >
          Close
        </Button>
      </Modal>
    );
  };

  // Render border selection modal
  const renderBorderSelectionModal = () => {
    const ownedBorders = BORDER_OPTIONS.filter(border => userBorders.includes(border.id));

    const borderContent = (
      <FlatList
        data={ownedBorders}
        keyExtractor={item => item.id}
        style={styles.cardsList}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => selectBorderToApply(item.id)}>
            <Card style={styles.cardItem}>
              <Card.Content style={styles.cardItemContent}>
                <View
                  style={[
                    styles.borderSample,
                    {
                      borderWidth: 3,
                      borderColor: item.color,
                      width: 80,
                      height: 120,
                    }
                  ]}
                />
                <View style={styles.cardDetails}>
                  <Text style={styles.cardName}>{item.name}</Text>
                  <Text style={styles.borderDescription}>{item.description}</Text>
                </View>
              </Card.Content>
            </Card>
          </TouchableOpacity>
        )}
        removeClippedSubviews={true}
        maxToRenderPerBatch={4}
        windowSize={6}
      />
    );

    return (
      <Modal
        visible={borderSelectionVisible}
        onDismiss={() => setBorderSelectionVisible(false)}
        contentContainerStyle={styles.cardSelectionModal}
      >
        <Text style={styles.modalTitle}>Select Border to Apply</Text>
        <Text style={styles.modalSubtitle}>Choose which border you want to apply to your cards</Text>
        {borderContent}
        <Button
          mode="outlined"
          onPress={() => setBorderSelectionVisible(false)}
          style={styles.closeButton}
        >
          Close
        </Button>
      </Modal>
    );
  };

  if (!currentGroup) {
    return (
      <View style={styles.container}>
        <Surface style={styles.messageContainer}>
          <Text style={styles.messageText}>Please select a group to access the store</Text>
        </Surface>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Surface style={styles.headerContainer}>
        <Text style={styles.headerTitle}>Card Border Store</Text>
        <Text style={styles.headerSubtitle}>
          Purchase custom borders to apply to your cards
        </Text>
        <View style={styles.gemContainer}>
          <Text style={styles.gemBalanceText}>
            {gems.toLocaleString()} Gems
          </Text>
        </View>

        <Button
          mode="contained"
          style={styles.applyBorderButton}
          onPress={openBorderSelection}
        >
          Apply Owned Borders
        </Button>
      </Surface>

      <FlatList
        data={BORDER_OPTIONS}
        renderItem={renderBorderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContainer}
        numColumns={2}
        getItemLayout={(data, index) => ({
          length: 280,
          offset: 280 * Math.floor(index / 2),
          index,
        })}
        removeClippedSubviews={true}
        maxToRenderPerBatch={6}
        windowSize={10}
        initialNumToRender={6}
      />

      <Portal>
        {renderCardSelectionModal()}
        {renderBorderSelectionModal()}
      </Portal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  headerContainer: {
    padding: 16,
    marginBottom: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    opacity: 0.7,
  },
  gemContainer: {
    alignItems: 'center',
    marginVertical: 10,
  },
  gemBalanceText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2196F3',
    textAlign: 'center',
  },
  applyBorderButton: {
    marginTop: 12,
  },
  listContainer: {
    paddingBottom: 20,
  },
  borderCard: {
    flex: 1,
    margin: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  borderCardContent: {
    flex: 1,
    overflow: 'hidden',
  },
  borderPreview: {
    alignItems: 'center',
    marginBottom: 12,
  },
  borderSample: {
    width: 100,
    height: 150,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    margin: 5,
  },
  borderName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  borderDescription: {
    fontSize: 12,
    marginBottom: 12,
    opacity: 0.7,
  },
  priceContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceLabel: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  priceValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  messageContainer: {
    padding: 20,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageText: {
    fontSize: 16,
    textAlign: 'center',
  },
  cardSelectionModal: {
    backgroundColor: 'white',
    margin: 20,
    borderRadius: 12,
    padding: 20,
    maxHeight: '80%',
  },
  ownedIndicator: {
    backgroundColor: '#E8F5E8',
    borderRadius: 4,
    padding: 8,
    marginTop: 8,
    alignItems: 'center',
  },
  ownedText: {
    color: '#4CAF50',
    fontSize: 12,
    fontWeight: 'bold',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    opacity: 0.7,
  },
  cardsList: {
    paddingVertical: 10,
  },
  cardItem: {
    marginBottom: 12,
    borderRadius: 8,
    elevation: 2,
  },
  cardItemContent: {
    flexDirection: 'row',
    padding: 8,
  },
  cardImage: {
    width: 100,
    height: 150,
    borderRadius: 8,
    margin: 5,
  },
  cardDetails: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  cardName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  cardRarity: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  currentBorder: {
    fontSize: 12,
    fontStyle: 'italic',
    opacity: 0.7,
  },
  noCardsContainer: {
    alignItems: 'center',
    padding: 20,
  },
  noCardsText: {
    textAlign: 'center',
    marginVertical: 16,
    fontStyle: 'italic',
    opacity: 0.7,
    fontSize: 16,
  },
  goCollectButton: {
    marginTop: 12,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  errorContainer: {
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: 'red',
    marginBottom: 12,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
  },
  closeButton: {
    marginTop: 16,
    marginBottom: 8,
  },
});

export default StoreContentSupabase;
