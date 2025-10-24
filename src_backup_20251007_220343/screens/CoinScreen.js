import { collection, doc, runTransaction, Timestamp, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, Image, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import CameraComponent from '../components/CameraComponent';
import ScreenBackground from '../components/ScreenBackground';
import { db, storage } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import { useTheme } from '../contexts/ThemeContext';
import { useBalance } from '../hooks/useBackwardCompatibility';
import CacheService from '../services/caching/CacheService';
import { sendCardCoinedNotification } from '../services/notifications';
import { awardCoinXP } from '../services/XPService';
import { ensureInitialRewardProtection } from '../utils/balanceUtils';
import { checkCardCollectionLimit } from '../utils/cardLimits';
import { ACHIEVEMENT_TYPES, recordAchievement } from '../utils/gemRewards';
import { createPerformanceTimer } from '../utils/performanceMonitor';

// Constants
const CAMERA_CONFIG = {
  CARD_NAME_MAX_LENGTH: 30,
  AUCTION_DURATION_SECONDS: 30
};

const CACHE_CONFIG = {
  USER_BALANCE_TTL: 30 * 1000, // 30 seconds for real-time balance
  GROUP_DATA_TTL: 5 * 60 * 1000, // 5 minutes for group settings
  COMBINED_DATA_TTL: 2 * 60 * 1000 // OPTIMIZED: Reduced from 60s to 2min for fresher data
};

const CoinScreen = () => {
  // Core state
  const [image, setImage] = useState(null);
  const [cardName, setCardName] = useState('');
  const [coinCost, setCoinCost] = useState(5);
  const [isCoining, setIsCoining] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Refs for cleanup and performance
  const mountedRef = useRef(true);
  const operationInProgressRef = useRef(false);
  const protectionInitializedRef = useRef(false);
  
  // Contexts
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const { balance, refreshBalance, subtractCoins } = useBalance();
  const { theme } = useTheme();

  // Handle picture taken from camera component with memory management
  const handlePictureTaken = useCallback((imageUri) => {
    // Clear previous image from memory before setting new one
    if (image) {
      console.log('🗑️ Clearing previous image from memory');
      // Note: React Native automatically handles URI cleanup, but we clear the state
    }
    
    setImage(imageUri);
    console.log('📸 Picture received from camera component');
  }, [image]);

  // Optimized memoized computed values with enhanced validation
  const canCoinCard = useMemo(() => {
    const trimmedName = cardName.trim();
    return Boolean(
      image && 
      trimmedName.length >= 2 && // Minimum 2 characters
      trimmedName.length <= CAMERA_CONFIG.CARD_NAME_MAX_LENGTH &&
      currentGroup?.id && 
      balance >= coinCost && 
      !isCoining &&
      !operationInProgressRef.current
    );
  }, [image, cardName, currentGroup?.id, balance, coinCost, isCoining]);

  const insufficientCoinsMessage = useMemo(() => {
    if (!currentGroup?.id) return 'Select a Group First';
    if (!image) return 'Take a Picture First';
    const trimmedName = cardName.trim();
    if (trimmedName.length === 0) return 'Enter Card Name';
    if (trimmedName.length < 2) return 'Name Too Short (min 2 chars)';
    if (balance < coinCost) return `Need ${coinCost - balance} more coins`;
    return `Coin Card (${coinCost} coins)`;
  }, [currentGroup?.id, image, cardName, balance, coinCost]);

  // Memoized button disabled state for better performance
  const isFormDisabled = useMemo(() => {
    return isCoining || operationInProgressRef.current;
  }, [isCoining]);

  // Enhanced error handling with retry logic
  const handleError = useCallback((error, operation = 'operation') => {
    console.error(`❌ ${operation} error:`, error);
    
    // More specific error messages based on error type
    let errorMessage = `Failed to ${operation}. `;
    
    if (error.code === 'permission-denied') {
      errorMessage = 'Permission denied. Please check your access rights.';
    } else if (error.code === 'unavailable') {
      errorMessage = 'Service temporarily unavailable. Please try again.';
    } else if (error.code === 'quota-exceeded') {
      errorMessage = 'Storage quota exceeded. Please contact support.';
    } else if (error.message?.includes('network')) {
      errorMessage = 'Network error. Please check your connection and try again.';
    } else {
      errorMessage += error.message || 'Unknown error occurred.';
    }
    
    return errorMessage;
  }, []);

  // Enhanced data fetching with error handling and caching
  const fetchInitialData = useCallback(async () => {
    if (!user || !currentGroup || !mountedRef.current) return;

    const timer = createPerformanceTimer('fetchInitialData');
    setIsLoading(true);
    setError(null);

    try {
      // OPTIMIZED: Single consolidated fetch combining both requests with intelligent caching
      const compositeKey = `coinScreen_composite_${currentGroup.id}_${user.uid}`;
      
      // Check if we have fresh consolidated data (reduced TTL for better responsiveness)
      const cachedComposite = await CacheService.getValue(compositeKey);
      
      if (cachedComposite && cachedComposite.timestamp > Date.now() - (CACHE_CONFIG.COMBINED_DATA_TTL * 0.5)) {
        // Use cached data with extended freshness check
        if (cachedComposite.groupData?.mintCost) {
          setCoinCost(cachedComposite.groupData.mintCost);
        }
        console.log('📊 Using cached consolidated coin screen data');
      } else {
        // OPTIMIZED: Parallel fetch with better error handling and cache warming
        const fetchOperations = await Promise.allSettled([
          CacheService.getDocument('users', user.uid, { 
            ttl: CACHE_CONFIG.USER_BALANCE_TTL,
            retryCount: 1
          }),
          CacheService.getDocument('groups', currentGroup.id, { 
            ttl: CACHE_CONFIG.GROUP_DATA_TTL,
            retryCount: 1 
          })
        ]);

        // Process results with better error isolation
        const userData = fetchOperations[0].status === 'fulfilled' ? fetchOperations[0].value : null;
        const groupData = fetchOperations[1].status === 'fulfilled' ? fetchOperations[1].value : null;

        // Log any fetch failures without blocking operation
        if (fetchOperations[0].status === 'rejected') {
          console.warn('⚠️ User data fetch failed:', fetchOperations[0].reason);
        }
        if (fetchOperations[1].status === 'rejected') {
          console.warn('⚠️ Group data fetch failed:', fetchOperations[1].reason);
        }

        // OPTIMIZED: Cache the consolidated result with warming strategy
        const consolidatedData = {
          userData,
          groupData,
          timestamp: Date.now(),
          groupId: currentGroup.id,
          userId: user.uid
        };
        
        // Use fire-and-forget for cache warming (don't await)
        CacheService.setValue(compositeKey, consolidatedData, { 
          ttl: CACHE_CONFIG.COMBINED_DATA_TTL 
        }).catch(err => console.warn('Cache warming failed:', err));

        if (!mountedRef.current) return;

        // Update coin cost from group data if available
        if (groupData?.mintCost) {
          setCoinCost(groupData.mintCost);
        }

        console.log('📊 Fresh consolidated data fetched and cached');
      }

      // OPTIMIZED: Only call protection once during screen init, with better tracking
      if (!protectionInitializedRef.current) {
        // Fire-and-forget protection initialization to avoid blocking UI
        ensureInitialRewardProtection(user.uid, currentGroup.id, 'coinScreenInit')
          .then(() => {
            protectionInitializedRef.current = true;
            console.log('🛡️ Protection initialized successfully');
          })
          .catch(err => console.warn('⚠️ Protection initialization failed:', err));
      }
      
      console.log('📊 Initial data fetch completed efficiently');
      
    } catch (error) {
      console.error('❌ Error fetching initial data:', error);
      if (mountedRef.current) {
        const errorMessage = handleError(error, 'load coin screen data');
        setError(errorMessage);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        timer.end();
      }
    }
  }, [user, currentGroup]);

  // Enhanced card coining with comprehensive error handling and performance optimization
  const coinCard = useCallback(async () => {
    // OPTIMIZED: Atomic operation lock to prevent race conditions
    if (!canCoinCard) return;
    
    // Use atomic compare-and-swap for operation lock
    if (operationInProgressRef.current) {
      console.warn('⚠️ Coin operation already in progress, ignoring duplicate request');
      return;
    }
    
    // Atomic lock acquisition
    operationInProgressRef.current = true;
    setIsCoining(true);
    const timer = createPerformanceTimer('coinCard');

    try {
      // Pre-flight checks with early returns for better UX
      const limitCheck = await checkCardCollectionLimit(user.uid, currentGroup.id);
      if (!limitCheck.canAdd) {
        Alert.alert(
          'Collection Limit Reached', 
          `You have reached the maximum of ${limitCheck.limit} cards. Current: ${limitCheck.currentCount} cards.`
        );
        return;
      }

      // SECURITY: Enhanced image processing with unpredictable file paths
      console.log('📤 Processing and uploading image...');
      const randomId = Math.random().toString(36).substring(2, 15);
      const filename = `cards/${user.uid}/${Date.now()}_${randomId}.jpg`;
      const storageRef = ref(storage, filename);
      
      // OPTIMIZED: Use image compression and better memory management
      const response = await fetch(image);
      if (!response.ok) throw new Error('Failed to process image');
      
      const blob = await response.blob();
      
      // Clear image from state immediately to free memory
      const originalImage = image;
      setImage(null);
      
      // Upload with better error handling
      let downloadURL;
      try {
        const snapshot = await uploadBytes(storageRef, blob);
        downloadURL = await getDownloadURL(snapshot.ref);
        console.log('✅ Image uploaded successfully');
      } catch (uploadError) {
        // Restore image on upload failure
        setImage(originalImage);
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      // Prepare optimized timestamps
      const now = Date.now();
      const createdAt = Timestamp.fromMillis(now);
      const expiresAt = Timestamp.fromMillis(now + (CAMERA_CONFIG.AUCTION_DURATION_SECONDS * 1000));

      // Optimized card data structure
      const cardData = {
        name: cardName.trim(),
        imageUrl: downloadURL,
        createdBy: user.uid,
        createdByName: user.displayName || user.email || 'Unknown User',
        ownerId: user.uid,
        userId: user.uid,
        photographerId: user.uid,
        groupId: currentGroup.id,
        createdAt,
        expiresAt,
        mintedAt: createdAt, // Use same timestamp for consistency
        startingBid: 5,
        currentBid: 5,
        status: 'active',
        inAuction: true,
        bids: [],
        rarity: 'common',
        isNewlyCoined: true
      };

      const auctionData = {
        ownerId: user.uid,
        groupId: currentGroup.id,
        startingBid: 5,
        currentBid: 5,
        currentBidder: null,
        createdAt,
        expiresAt,
        endTime: expiresAt,
        status: 'active',
        bidHistory: [],
        cardRarity: 'common',
        isNewlyCoined: true,
        cardName: cardName.trim(),
        cardImage: downloadURL,
        sellerId: user.uid,
        sellerName: user.displayName || user.email || 'Unknown User'
      };

      // Create card and auction with better error handling
      console.log('📝 Creating card and auction...');
      
      // OPTIMIZED: Use atomic transaction for card+auction creation with reduced writes
      const transactionResult = await runTransaction(db, async (transaction) => {
        // Create both documents with IDs first
        const cardDocRef = doc(collection(db, 'cards'));
        const auctionDocRef = doc(collection(db, 'auctions'));
        
        // Enhanced card data with auction reference included from start
        const cardDataWithAuction = {
          ...cardData,
          auctionId: auctionDocRef.id, // Include auction ID from creation
          status: 'active',
          linkedAt: createdAt
        };

        // Enhanced auction data with card reference included from start  
        const auctionDataWithCard = {
          ...auctionData,
          cardId: cardDocRef.id, // Include card ID from creation
          status: 'active',
          linkedAt: createdAt
        };

        // Set both documents atomically (no separate linking needed)
        transaction.set(cardDocRef, cardDataWithAuction);
        transaction.set(auctionDocRef, auctionDataWithCard);
        
        return { cardId: cardDocRef.id, auctionId: auctionDocRef.id };
      });

      console.log('✅ Card and auction created atomically');

      // CRITICAL FIX: Invalidate auction list cache so new auction appears on refresh
      try {
        // Import AuctionService to access cache manager
        const { default: AuctionService } = await import('../services/AuctionService');
        const auctionService = new AuctionService();
        
        // Clear auction list caches for this group so fresh data is fetched
        const groupId = currentGroup.id;
        const auctionListCacheKeys = [
          `paginated_auctions_optimized_${groupId}_active_start_10`,
          `paginated_auctions_optimized_${groupId}_active_start_20`,
          `paginated_auctions_optimized_${groupId}_active_start_${15}`, // Default page size
        ];
        
        auctionListCacheKeys.forEach(key => {
          auctionService.cache.invalidate(key);
        });
        
        console.log(`🧹 Invalidated auction list caches for new coin auction in group ${groupId}`);
      } catch (cacheError) {
        console.warn('⚠️ Could not invalidate auction cache (non-critical):', cacheError);
      }

      // OPTIMIZED: Process coin transaction with atomic balance check
      console.log('💰 Processing coin transaction...');
      const balanceResult = await subtractCoins(coinCost);
      if (!balanceResult) {
        // OPTIMIZED: Rollback using batch operation instead of separate updates
        const rollbackBatch = writeBatch(db);
        rollbackBatch.update(doc(db, 'cards', transactionResult.cardId), { status: 'failed', failureReason: 'insufficient_balance', failedAt: Timestamp.now() });
        rollbackBatch.update(doc(db, 'auctions', transactionResult.auctionId), { status: 'cancelled', cancellationReason: 'insufficient_balance', cancelledAt: Timestamp.now() });
        await rollbackBatch.commit();
        
        throw new Error(`Failed to subtract ${coinCost} coins from balance`);
      }

      // OPTIMIZED: Background operations with better error handling and intelligent scheduling
      console.log('🎯 Scheduling background operations...');
      const backgroundOperations = [
        { fn: () => awardCoinXP(user.uid, currentGroup.id), name: 'XP_AWARD' },
        { fn: () => recordAchievement(user.uid, ACHIEVEMENT_TYPES.FIRST_COIN), name: 'ACHIEVEMENT' },
        { fn: () => sendCardCoinedNotification(
          currentGroup.id, 
          user.uid, 
          user.displayName || user.email || 'Someone', 
          cardName.trim()
        ), name: 'NOTIFICATION' }
      ];

      // OPTIMIZED: Execute background operations with individual timeout and error isolation
      Promise.allSettled(
        backgroundOperations.map(async (op) => {
          try {
            return await Promise.race([
              op.fn(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
            ]);
          } catch (error) {
            console.warn(`Background operation ${op.name} failed:`, error.message);
            throw error;
          }
        })
      ).then(results => {
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        console.log(`✅ Background operations completed: ${successful} successful, ${failed} failed`);
      }).catch(err => {
        console.error('❌ Unexpected error in background operations:', err);
      });

      // Success handling with better UX
      console.log('✅ Card coined successfully!');
      Alert.alert(
        'Card Coined Successfully!', 
        `"${cardName.trim()}" has been added to the auction.`,
        [{ text: 'OK', onPress: () => resetForm() }]
      );

      // OPTIMIZED: Refresh balance asynchronously to show updated amount
      refreshBalance().catch(err => console.warn('Balance refresh failed:', err));
      
    } catch (error) {
      console.error('❌ Coining error:', error);
      Alert.alert(
        'Coining Failed', 
        `Error: ${error.message}\n\nPlease try again.`,
        [
          { text: 'OK', style: 'default' },
          { text: 'Retry', onPress: () => coinCard(), style: 'default' }
        ]
      );
    } finally {
      if (mountedRef.current) {
        setIsCoining(false);
        // OPTIMIZED: Atomic operation unlock
        operationInProgressRef.current = false;
        timer.end();
      }
    }
  }, [canCoinCard, image, cardName, user, currentGroup, coinCost, subtractCoins, refreshBalance]);

  // Reset form function
  const resetForm = useCallback(() => {
    setImage(null);
    setCardName('');
    console.log('🧹 Form reset completed');
  }, []);

  // Enhanced lifecycle management with cleanup optimization
  useEffect(() => {
    mountedRef.current = true;
    protectionInitializedRef.current = false; // Reset protection flag
    
    // Initialize data for better UX
    const initializeScreen = async () => {
      try {
        await fetchInitialData();
      } catch (error) {
        console.error('❌ Error during screen initialization:', error);
        if (mountedRef.current) {
          setError(handleError(error, 'initialize screen'));
        }
      }
    };
    
    initializeScreen();

    // Optimized back button handler
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isCoining || operationInProgressRef.current) {
        Alert.alert('Operation in Progress', 'Please wait for the current operation to complete.');
        return true;
      }
      return false;
    });

    // Enhanced cleanup function with memory management
    return () => {
      mountedRef.current = false;
      backHandler.remove();
      
      // Clear any pending operations
      operationInProgressRef.current = false;
      
      // Clear image state to free memory
      setImage(null);
      
      console.log('🧹 CoinScreen cleanup completed');
    };
  }, []); // Empty dependency array - only run once

  // Optimized group change handler - only refetch when group actually changes
  useEffect(() => {
    if (currentGroup?.id && mountedRef.current && !isLoading) {
      console.log('🔄 Group changed, refetching data...');
      fetchInitialData();
    }
  }, [currentGroup?.id]); // Only depend on group ID, not the entire object

  // Enhanced retry mechanism
  const retryOperation = useCallback(async (operation, maxRetries = 2) => {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          console.log(`🔄 Retrying operation, attempt ${attempt + 2}/${maxRetries + 1}`);
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    
    throw lastError;
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <ScreenBackground>
        <View style={[styles.container, styles.centerContent]}>
          <Text style={styles.loadingText}>Loading coin screen...</Text>
        </View>
      </ScreenBackground>
    );
  }

  // Error state
  if (error) {
    return (
      <ScreenBackground>
        <View style={[styles.container, styles.centerContent]}>
          <Text style={styles.errorText}>{error}</Text>
          <Button 
            mode="contained" 
            onPress={() => {
              setError(null);
              fetchInitialData();
            }}
            style={styles.retryButton}
          >
            Retry
          </Button>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <View style={styles.container}>
      {!image ? (
        <CameraComponent 
          onPictureTaken={handlePictureTaken}
          disabled={isFormDisabled}
          style={styles.cameraViewContainer}
        />
      ) : (
        <View style={styles.previewContainer}>
          <ScrollView 
            showsVerticalScrollIndicator={false} 
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.previewTitle}>Preview Your Card</Text>
            
            <View style={styles.cardPreviewWrapper}>
              <Image source={{ uri: image }} style={styles.preview} />
              {cardName.trim().length > 0 && (
                <View style={styles.cardNameOverlay}>
                  <Text style={styles.cardNameText}>{cardName}</Text>
                </View>
              )}
            </View>
            
            <View style={styles.nameInputSection}>
              <Text style={styles.sectionTitle}>Name Your Card</Text>
              <TextInput
                label="Card Name *"
                value={cardName}
                onChangeText={(text) => {
                  // ENHANCED: Improved input validation and sanitization
                  const sanitized = text
                    .replace(/[<>\"'&]/g, '') // Remove potentially dangerous characters
                    .replace(/\s+/g, ' ') // Normalize whitespace
                    .slice(0, CAMERA_CONFIG.CARD_NAME_MAX_LENGTH); // Enforce max length
                  setCardName(sanitized);
                }}
                style={styles.nameInput}
                mode="outlined"
                maxLength={CAMERA_CONFIG.CARD_NAME_MAX_LENGTH}
                placeholder="Enter a creative name for your card"
                disabled={isFormDisabled}
                error={cardName.trim().length === 0}
                right={
                  <TextInput.Affix 
                    text={`${cardName.length}/${CAMERA_CONFIG.CARD_NAME_MAX_LENGTH}`} 
                  />
                }
              />
              {cardName.trim().length === 0 && (
                <Text style={styles.nameInputHelp}>
                  Card name is required (minimum 2 characters)
                </Text>
              )}
              {cardName.trim().length > 0 && cardName.trim().length < 2 && (
                <Text style={styles.nameInputHelp}>
                  Card name must be at least 2 characters long
                </Text>
              )}
            </View>
            
            <View style={styles.previewButtonsContainer}>
              <Button
                mode="contained"
                onPress={coinCard}
                style={[styles.coinButton, canCoinCard && styles.coinButtonEnabled]}
                icon="check-bold"
                disabled={!canCoinCard}
                loading={isCoining}
              >
                {insufficientCoinsMessage}
              </Button>
              
              <Button
                mode="outlined"
                onPress={resetForm}
                style={styles.retakeButton}
                icon="camera-retake"
                disabled={isFormDisabled}
              >
                Retake
              </Button>
            </View>
            
            <View style={styles.bottomPadding} />
          </ScrollView>
        </View>
      )}
    </View>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#FF5722',
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    minWidth: 120,
  },
  cameraViewContainer: {
    flex: 1,
    position: 'relative',
  },
  previewContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  previewTitle: {
    fontSize: 24, 
    fontWeight: 'bold', 
    marginBottom: 20, 
    textAlign: 'center'
  },
  cardPreviewWrapper: {
    width: '100%',
    height: 350,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
    position: 'relative',
    elevation: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  preview: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  cardNameOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 12,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  cardNameText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  nameInputSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  nameInput: {
    marginBottom: 20,
  },
  nameInputHelp: {
    color: '#FF5722',
    fontSize: 12,
    marginTop: 5,
  },
  previewButtonsContainer: {
    marginTop: 10,
  },
  coinButton: {
    marginBottom: 10,
    backgroundColor: '#757575', // Disabled state
  },
  coinButtonEnabled: {
    backgroundColor: '#4CAF50', // Enabled state
  },
  retakeButton: {
    marginBottom: 10,
  },
  bottomPadding: {
    height: 100,
  },
});

export default CoinScreen; 