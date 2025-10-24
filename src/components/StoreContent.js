import { useFocusEffect } from '@react-navigation/native';
import { doc } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Animated, Easing, FlatList, Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Button, Card, Modal, Portal, Surface, Text, useTheme } from 'react-native-paper';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import { useBalance, useGems } from '../hooks/useBackwardCompatibility';
import CacheService from '../services/caching/CacheService';
import { BORDER_OPTIONS, getBorderAnimationStyle } from '../utils/borderOptions';
import { batchUpdateWithCache } from '../utils/dbOptimizationUtils';
import { getRarityColor } from '../utils/rarity';
import { storeOptimizer } from '../utils/storeScreenOptimizer';

// Removed DataManager dependency - using CacheService and storeOptimizer directly


// Optimized store configuration with consolidated cache strategy
const STORE_CONFIG = {
  CACHE: {
    USER_DATA_TTL: 10 * 60 * 1000, // 10 minutes for user data
    CARDS_TTL: 5 * 60 * 1000, // 5 minutes for cards
    STORE_STATE_TTL: 15 * 60 * 1000, // 15 minutes for store state
  },
  PERFORMANCE: {
    PREFETCH_DELAY: 500,
    MAX_CARDS_DISPLAY: 30,
    ANIMATION_ENABLED: true,
    DEBOUNCE_DELAY: 300, // Prevent rapid API calls
  },
  DATABASE: {
    BORDER_FIELD: 'cardBorders', // Unified field name
    BATCH_SIZE: 10, // For batch operations
  }
};

// Cache key generation utility
const getCacheKeys = (userId, groupId) => ({
  userData: `store_user_${userId}`,
  userCards: `store_cards_${userId}_${groupId}`,
  storeState: `store_state_${userId}_${groupId}`,
});

// Database field normalization utility
const normalizeBorderFields = (userData) => {
  const borders = userData[STORE_CONFIG.DATABASE.BORDER_FIELD] || userData.borders || ['default'];
  return {
    ...userData,
    [STORE_CONFIG.DATABASE.BORDER_FIELD]: borders,
    borders: borders, // Keep for backward compatibility during transition
  };
};

const StoreContent = ({ navigation }) => {
  const theme = useTheme();
  const { user } = useAuth();
  const { balance, subtractCoins, refreshBalance } = useBalance();
  const { gems, isLoading: isLoadingGems, refreshGems } = useGems();
  const { currentGroup } = useGroup();
  
  // Optimized state management with race condition prevention
  const [userBorders, setUserBorders] = useState(['default']);
  const [loading, setLoading] = useState(false);
  const [selectedBorder, setSelectedBorder] = useState(null);
  const [cardSelectionVisible, setCardSelectionVisible] = useState(false);
  const [userCards, setUserCards] = useState([]);
  const [isLoadingCards, setIsLoadingCards] = useState(false);
  const [cardFetchError, setCardFetchError] = useState(null);
  const [selectingExistingBorder, setSelectingExistingBorder] = useState(false);
  const [borderSelectionVisible, setBorderSelectionVisible] = useState(false);
  const [storeDataCache, setStoreDataCache] = useState(null);
  const [purchaseInProgress, setPurchaseInProgress] = useState(new Set()); // Track active purchases
  
  // Memoized animations for performance with selective rendering
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
    let mounted = true; // Prevent state updates after unmount
    
    const initializeStore = async () => {
      if (!mounted) return;
      await initializeStaticStore();
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
          refreshStoreDataIfNeeded();
        }, STORE_CONFIG.PERFORMANCE.PREFETCH_DELAY);
        
        return () => clearTimeout(timeoutId);
      }
    }, [user, currentGroup])
  );

  // Optimized store initialization with consolidated caching
  const initializeStaticStore = async () => {
    if (!user || !currentGroup) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const cacheKeys = getCacheKeys(user.uid, currentGroup.id);
      
      // Check consolidated cache first
      const cachedData = await CacheService.getValue(cacheKeys.userData);
      
      if (cachedData && Date.now() - cachedData.timestamp < STORE_CONFIG.CACHE.USER_DATA_TTL) {
        console.log('📦 Using cached store data for initialization');
        const normalizedData = normalizeBorderFields(cachedData);
        setUserBorders(normalizedData[STORE_CONFIG.DATABASE.BORDER_FIELD]);
        setStoreDataCache(normalizedData);
        setLoading(false);
        return;
      }
      
      // Only fetch if cache is stale or missing
      await loadUserBordersOptimized();
      
    } catch (error) {
      console.error('Error initializing store:', error);
      // Graceful fallback with default state
      setUserBorders(['default']);
      setStoreDataCache({ 
        [STORE_CONFIG.DATABASE.BORDER_FIELD]: ['default'],
        timestamp: Date.now() 
      });
    } finally {
      setLoading(false);
    }
  };

  // Consolidated user data loading with field normalization
  const loadUserBordersOptimized = async () => {
    try {
      const cacheKeys = getCacheKeys(user.uid, currentGroup.id);
      
      // Try storeOptimizer first for best performance
      const storeData = await storeOptimizer.getStoreUserData(user.uid, {
        ttl: STORE_CONFIG.CACHE.USER_DATA_TTL,
        forceRefresh: false
      });
      
      if (storeData) {
        const normalizedData = normalizeBorderFields(storeData);
        const bordersList = normalizedData[STORE_CONFIG.DATABASE.BORDER_FIELD];
        
        setUserBorders(bordersList);
        setStoreDataCache({
          ...normalizedData,
          timestamp: Date.now()
        });
        
        // Update consolidated cache
        await CacheService.setValue(cacheKeys.userData, normalizedData, { 
          ttl: STORE_CONFIG.CACHE.USER_DATA_TTL 
        });
        
        console.log('📦 Loaded store data efficiently', { borderCount: bordersList.length });
      } else {
        // Fallback: direct database fetch
        const userDoc = await CacheService.getDocument('users', user.uid, {
          ttl: STORE_CONFIG.CACHE.USER_DATA_TTL
        });
        
        if (userDoc) {
          const normalizedData = normalizeBorderFields(userDoc);
          const bordersList = normalizedData[STORE_CONFIG.DATABASE.BORDER_FIELD];
          
          setUserBorders(bordersList);
          setStoreDataCache({
            ...normalizedData,
            timestamp: Date.now()
          });
          
          // Update cache for future use
          await CacheService.setValue(cacheKeys.userData, normalizedData, { 
            ttl: STORE_CONFIG.CACHE.USER_DATA_TTL 
          });
          
          console.log('📦 Fallback: Fetched user data from database', { borderCount: bordersList.length });
        } else {
          setUserBorders(['default']);
        }
      }
    } catch (error) {
      // Silenced: Firebase not available, store needs Supabase migration
      if (__DEV__) {
        console.warn('Store borders unavailable (Firebase → Supabase migration pending)');
      }
      setUserBorders(['default']);
    }
  };

  // Intelligent refresh with adaptive caching
  const refreshStoreDataIfNeeded = async () => {
    if (!storeDataCache) {
      await loadUserBordersOptimized();
      return;
    }
    
    const dataAge = Date.now() - (storeDataCache.timestamp || 0);
    if (dataAge > STORE_CONFIG.CACHE.USER_DATA_TTL) {
      console.log('🔄 Store data is stale, refreshing...');
      await loadUserBordersOptimized();
    } else {
      console.log('📦 Store data is fresh, skipping refresh');
    }
  };

  // Streamlined card loading with consolidated caching
  const loadUserCardsOptimized = async () => {
    if (!user || !currentGroup) {
      return;
    }

    try {
      setIsLoadingCards(true);
      setCardFetchError(null);
      
      const cacheKeys = getCacheKeys(user.uid, currentGroup.id);
      const cachedCards = await CacheService.getValue(cacheKeys.userCards);
      
      // Use cached data if fresh
      if (cachedCards && Date.now() - cachedCards.timestamp < STORE_CONFIG.CACHE.CARDS_TTL) {
        console.log('📦 Using cached user cards');
        setUserCards(cachedCards.cards.slice(0, STORE_CONFIG.PERFORMANCE.MAX_CARDS_DISPLAY));
        setIsLoadingCards(false);
        return;
      }
      
      // Fetch fresh data
      const cards = await storeOptimizer.preloadUserCardsForStore(user.uid, currentGroup.id, {
        limit: STORE_CONFIG.PERFORMANCE.MAX_CARDS_DISPLAY,
        ttl: STORE_CONFIG.CACHE.CARDS_TTL,
        sortBy: 'rarity'
      });
      
      setUserCards(cards);
      
      // Update cache
      await CacheService.setValue(cacheKeys.userCards, {
        cards,
        timestamp: Date.now()
      }, { ttl: STORE_CONFIG.CACHE.CARDS_TTL });
      
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
  const purchaseBorderOptimized = async (border) => {
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

    // Show confirmation dialog with purchase tracking
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
      const newGemBalance = gems - border.price;
      const newBorders = [...userBorders, border.id];

      // Create normalized update data
      const updateData = {
        gems: newGemBalance,
        [STORE_CONFIG.DATABASE.BORDER_FIELD]: newBorders,
        borders: newBorders, // Keep for backward compatibility
        updatedAt: new Date().toISOString(),
        purchaseHistory: (user.purchaseHistory || []).concat([{
          type: 'border',
          itemId: border.id,
          itemName: border.name,
          gemsSpent: border.price,
          timestamp: new Date().toISOString(),
          groupId: currentGroup.id
        }])
      };

      // Atomic database update
      await batchUpdateWithCache([{
        collection: 'users',
        id: user.uid,
        data: updateData
      }]);

      // Update local state immediately for responsive UI
      setUserBorders(newBorders);
      
      // Refresh gems and invalidate relevant caches
      await Promise.all([
        refreshGems(),
        CacheService.invalidate(`users:${user.uid}`),
        CacheService.invalidate(getCacheKeys(user.uid, currentGroup.id).userData)
      ]);

      // Update store cache with normalized data
      const updatedCacheData = normalizeBorderFields({
        ...storeDataCache,
        ...updateData,
        timestamp: Date.now()
      });
      setStoreDataCache(updatedCacheData);
      
      const cacheKeys = getCacheKeys(user.uid, currentGroup.id);
      await CacheService.setValue(cacheKeys.userData, updatedCacheData, { 
        ttl: STORE_CONFIG.CACHE.USER_DATA_TTL 
      });

      // Success notification
      Alert.alert(
        'Purchase Successful!', 
        `You have successfully purchased the "${border.name}" border!\n\nGems remaining: ${newGemBalance.toLocaleString()}`
      );

      console.log(`✅ Successfully purchased border: ${border.name} for ${border.price} gems`);
      
    } catch (error) {
      console.error('Error purchasing border:', error);
      Alert.alert(
        'Purchase Failed', 
        'There was an error processing your purchase. Please try again. If the problem persists, please contact support.'
      );
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

      const cardRef = doc(db, 'cards', cardId);
      await batchUpdateWithCache([{
        collection: 'cards',
        id: cardId,
        data: {
          borderType: selectedBorder,
          updatedAt: new Date().toISOString(),
        }
      }]);

      // Update local card state
      setUserCards(prevCards =>
        prevCards.map(card =>
          card.id === cardId ? { ...card, borderType: selectedBorder } : card
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
    // Use the enhanced border system for consistency
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
    // Use pre-calculated status from bordersWithStatus
    const borderStatus = bordersWithStatus.find(b => b.id === item.id);
    const { owned, canPurchase, isPurchasing } = borderStatus || { owned: false, canPurchase: false, isPurchasing: false };
    const animation = STORE_CONFIG.PERFORMANCE.ANIMATION_ENABLED ? animations[index] : null;

    // Memoized button text calculation
    const getButtonText = () => {
      if (isPurchasing) return 'Purchasing...';
      if (loading) return 'Processing...';
      if (owned) return 'Owned';
      if (gems < item.price) return 'Insufficient Gems';
      return 'Purchase';
    };

    // Optimized button style calculation
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
          {/* Show ownership status more clearly */}
          {owned && (
            <View style={styles.ownedIndicator}>
              <Text style={styles.ownedText}>✓ You own this border</Text>
            </View>
          )}
        </Card.Content>
        <Card.Actions>
          <Button
            mode={owned ? "outlined" : "contained"}
            onPress={owned ? undefined : () => purchaseBorderOptimized(item)}
            disabled={!canPurchase || isPurchasing || owned}
            style={getButtonStyle()}
            loading={loading}
          >
            {getButtonText()}
          </Button>
        </Card.Actions>
      </Card>
    );
  }, [bordersWithStatus, STORE_CONFIG.PERFORMANCE.ANIMATION_ENABLED, animations, loading, gems, theme.colors, purchaseBorderOptimized]);

  // Consolidated modal component for better reusability
  const renderModal = useCallback((config) => (
    <Modal
      visible={config.visible}
      onDismiss={config.onDismiss}
      contentContainerStyle={styles.cardSelectionModal}
    >
      <Text style={styles.modalTitle}>{config.title}</Text>
      <Text style={styles.modalSubtitle}>{config.subtitle}</Text>
      {config.content}
      <Button
        mode="outlined"
        onPress={config.onDismiss}
        style={styles.closeButton}
      >
        Close
      </Button>
    </Modal>
  ), [styles]);

  // Optimized card selection modal using consolidated component
  const renderCardSelectionModal = useCallback(() => {
    const cardContent = isLoadingCards ? (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading your cards...</Text>
      </View>
    ) : cardFetchError ? (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{cardFetchError}</Text>
        <Button mode="contained" onPress={loadUserCardsOptimized} style={styles.retryButton}>
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
                <Image source={{ uri: item.imageUrl }} style={styles.cardImage} />
                <View style={styles.cardDetails}>
                  <Text style={styles.cardName}>{item.name || 'Untitled'}</Text>
                  <Text style={[styles.cardRarity, { color: getRarityColor(item.rarity) }]}>
                    {item.rarity || 'Unknown'}
                  </Text>
                  <Text style={styles.currentBorder}>
                    Current border: {getBorderName(item.borderType) || 'Default'}
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

    return renderModal({
      visible: cardSelectionVisible,
      onDismiss: () => setCardSelectionVisible(false),
      title: "Select a Card",
      subtitle: `Choose which card to apply the ${selectedBorder ? getBorderName(selectedBorder) : ''} border to`,
      content: cardContent
    });
  }, [cardSelectionVisible, isLoadingCards, cardFetchError, userCards, selectedBorder, renderModal, loadUserCardsOptimized, navigation, applyBorderToCard, getBorderName, styles]);

  // Open border selection
  const openBorderSelection = () => {
    setSelectingExistingBorder(true);
    setBorderSelectionVisible(true);
  };

  // Select border to apply
  const selectBorderToApply = (borderId) => {
    setSelectedBorder(borderId);
    setBorderSelectionVisible(false);
    setCardSelectionVisible(true);
    loadUserCardsOptimized();
  };

  // Optimized border selection modal using consolidated component
  const renderBorderSelectionModal = useCallback(() => {
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

    return renderModal({
      visible: borderSelectionVisible,
      onDismiss: () => setBorderSelectionVisible(false),
      title: "Select Border to Apply",
      subtitle: "Choose which border you want to apply to your cards",
      content: borderContent
    });
  }, [borderSelectionVisible, userBorders, renderModal, selectBorderToApply, styles]);

  // Get border name by ID
  const getBorderName = (borderId) => {
    if (!borderId || borderId === 'default') return 'Default';
    const border = BORDER_OPTIONS.find(b => b.id === borderId);
    return border ? border.name : 'Unknown';
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
        {!isLoadingGems && (
          <View style={styles.gemContainer}>
            <Text style={styles.gemBalanceText}>
              {gems.toLocaleString()} Gems
            </Text>
          </View>
        )}
        
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
          length: 280, // Approximate item height
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
  balanceText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 16,
    textAlign: 'center',
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

export default StoreContent; 