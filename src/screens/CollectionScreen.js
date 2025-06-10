/**
 * CollectionScreen - Ultra-Optimized card collection management
 * 
 * OPTIMIZATION TARGET: Reduce from 30+ reads per session to <5 reads
 * 
 * Key optimizations implemented:
 * - Single consolidated query with denormalized data
 * - Aggressive client-side caching with 30-minute TTL
 * - Eliminated separate user/group/balance queries
 * - Cursor-based pagination with smart prefetching
 * - Status verification only on user action (not automatic)
 * - Consolidated real-time listener with throttling
 * 
 * @version 4.0.0 - ULTRA READ OPTIMIZATION
 * @author Database Optimization Team
 * @updated Ultra-aggressive read reduction, denormalization strategy
 */

import { deleteDoc, doc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo } from 'react';
import {
    Alert,
    Animated,
    Platform,
    RefreshControl,
    StyleSheet,
    Text,
    View
} from 'react-native';
import { ActivityIndicator, Button, Dialog, Portal, useTheme } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import CardPreviewModal from '../components/CardPreviewModal';
import CardRenderer from '../components/CardRenderer';
import CollectionHeader from '../components/CollectionHeader';
import ErrorBoundary from '../components/ErrorBoundary';
import ScreenBackground from '../components/ScreenBackground';
import { db } from '../config/firebase';
import {
    COLLECTION_CONFIG
} from '../constants/collectionConstants';
import { FILTER_CONFIG, PERFORMANCE_LABELS, RARITY_CONFIG } from '../constants/filterConstants';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import { useUnifiedUserData } from '../contexts/UnifiedUserDataContext';
import { useCardAnimations } from '../hooks/useCardAnimations';
import { useCollectionState } from '../hooks/useCollectionState';
import { useUltraOptimizedCollectionData } from '../hooks/useUltraOptimizedCollectionData';
import { useVirtualizedList } from '../hooks/useVirtualizedList';
import CacheService from '../services/caching/CacheService';
import { clearExpiredCache } from '../utils/cacheUtils';

// Performance monitoring utilities with production optimization
const PerformanceMonitor = {
  start: (label) => ({
    label,
    startTime: __DEV__ ? performance.now() : 0
  }),
  end: (measurement) => {
    if (!__DEV__) return 0;
    const duration = performance.now() - measurement.startTime;
    if (duration > COLLECTION_CONFIG.PERFORMANCE.SLOW_RENDER_THRESHOLD) {
      console.warn(`⚠️ Slow operation: ${measurement.label} took ${duration.toFixed(2)}ms`);
    }
    return duration;
  },
  measure: (label, fn) => {
    if (!__DEV__) return fn();
    
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    
    if (duration > COLLECTION_CONFIG.PERFORMANCE.SLOW_RENDER_THRESHOLD) {
      console.warn(`⚠️ Slow operation: ${label} took ${duration.toFixed(2)}ms`);
    }
    
    return result;
  }
};

// Memoized components
const MemoizedCardRenderer = React.memo(CardRenderer);
const MemoizedCollectionHeader = React.memo(CollectionHeader);

/**
 * ULTRA-OPTIMIZED Collection screen content component
 * 
 * READ REDUCTION STRATEGY:
 * 1. Single compound query for cards with embedded user data
 * 2. 30-minute aggressive caching to avoid re-reads
 * 3. Cursor-based pagination (no offset queries)
 * 4. No real-time listeners - user-initiated refresh only
 * 5. Consolidated user data in a single document read
 * 6. Status verification only on explicit user action
 * 
 * TARGET: <5 Firestore reads per normal session
 */
const CollectionScreenContent = () => {
  // ULTRA-OPTIMIZED: Single hook that consolidates ALL data needs
  const {
    // Consolidated data - no separate hooks needed
    cards,              // Cards with embedded owner details  
    userProfile,        // User profile with balance, gems, stats
    groupInfo,          // Current group info
    
    // State flags
    loading,
    refreshing,
    error,
    retryCount,
    maxRetries,
    hasMoreCards,
    
    // Advanced state (second pass)
    backgroundSyncing,
    prefetchInProgress,
    dataFreshness,
    lastSyncTime,
    
    // Optimized operations
    onRefresh,          // Smart refresh with differential updates
    loadMoreCards,      // No-op since we load all cards
    removeCard,         // Optimistic removal
    handleError,
    retryOperation,
    
    // Advanced operations (second pass)
    forceBackgroundSync,
    intelligentPrefetch,
    
    // Enhanced performance metrics
    readCount,          // Track actual Firestore reads
    cacheHitRate,       // Monitor cache effectiveness
    averageResponseTime,
    backgroundSyncs,
    prefetchOperations,
    differentialUpdates
  } = useUltraOptimizedCollectionData();

  // Consolidated state using reducer pattern
  const { state, actions } = useCollectionState();

  // Hooks
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const { addCoins: unifiedAddCoins, subtractCoins: unifiedSubtractCoins } = useUnifiedUserData();
  const theme = useTheme();
  const { startPreviewAnimation, cleanupAnimations } = useCardAnimations();

  // Memoized platform-specific utilities
  const platformUtils = useMemo(() => ({
    isAndroid: Platform.OS === 'android',
    showToast: Platform.OS === 'android' ? 
      (message, duration = 'SHORT') => {
        const { ToastAndroid } = require('react-native');
        ToastAndroid.show(message, ToastAndroid[duration]);
      } : 
      null,
    showAlert: (title, message, buttons = [{ text: 'OK' }]) => {
      Alert.alert(title, message, buttons);
    }
  }), []);

  // Memoized utility functions - use consolidated data
  const isUserAdmin = useMemo(() => {
    return user && groupInfo && groupInfo.adminIds && 
      groupInfo.adminIds.includes(user.uid);
  }, [user, groupInfo]);

  // Extract user data from consolidated userProfile
  const { balance = 0, gems: userGems = 0 } = userProfile || {};

  // Use unified user operations that actually update the database
  const subtractCoins = useCallback(async (amount) => {
    // Use the unified context method that returns a boolean
    return await unifiedSubtractCoins(amount, currentGroup?.id);
  }, [unifiedSubtractCoins, currentGroup?.id]);

  const addCoins = useCallback(async (amount) => {
    // Use the unified context method that returns a boolean  
    return await unifiedAddCoins(amount, currentGroup?.id);
  }, [unifiedAddCoins, currentGroup?.id]);

  // Consolidated state update functions using the existing actions
  const showDeleteConfirmation = useCallback((card) => {
    actions.updateUI({
      cardToDelete: card,
      confirmDialog: true
    });
  }, [actions]);

  const hideDeleteConfirmation = useCallback(() => {
    actions.updateUI({
      confirmDialog: false,
      cardToDelete: null
    });
  }, [actions]);

  const showCardPreview = useCallback((card) => {
    try {
      actions.updateUI({
        selectedCard: card,
        cardPreviewVisible: true
      });
      startPreviewAnimation();
    } catch (error) {
      handleError(error, 'card_preview_validation');
    }
  }, [actions, startPreviewAnimation, handleError]);

  const closeCardPreview = useCallback(() => {
    actions.updateUI({
      cardPreviewVisible: false,
      selectedCard: null
    });
  }, [actions]);

  const setDownloadingCard = useCallback((downloading) => {
    actions.updateUI({ downloadingCard: downloading });
  }, [actions]);

  // Optimized menu visibility handlers
  const menuHandlers = useMemo(() => ({
    setSortByMenuVisible: (visible) => actions.updateUI({ sortByMenuVisible: visible }),
    setSortOrderMenuVisible: (visible) => actions.updateUI({ sortOrderMenuVisible: visible }),
    setFilterStatusMenuVisible: (visible) => actions.updateUI({ filterStatusMenuVisible: visible })
  }), [actions]);

  // OPTIMIZED: Consolidated sort and filter logic using shared constants
  const sortComparators = useMemo(() => ({
    [FILTER_CONFIG.SORT_OPTIONS.NAME]: (a, b) => (a.name || '').localeCompare(b.name || ''),
    [FILTER_CONFIG.SORT_OPTIONS.RARITY]: (a, b) => {
      const aRarity = RARITY_CONFIG.ORDER[a.rarity?.toLowerCase()] ?? 0;
      const bRarity = RARITY_CONFIG.ORDER[b.rarity?.toLowerCase()] ?? 0;
      return aRarity - bRarity;
    },
    [FILTER_CONFIG.SORT_OPTIONS.DATE_ADDED]: (a, b) => {
      const aTime = a.createdAt?.toDate?.()?.getTime() || new Date(a.createdAt || 0).getTime();
      const bTime = b.createdAt?.toDate?.()?.getTime() || new Date(b.createdAt || 0).getTime();
      return bTime - aTime;
    }
  }), []);

  const sortedAndFilteredCards = useMemo(() => {
    return PerformanceMonitor.measure(PERFORMANCE_LABELS.SORT_AND_FILTER, () => {
      const { sortBy, sortOrder, filterStatus } = state;
      
      // Apply filters efficiently using shared predicates
      let result = filterStatus === FILTER_CONFIG.STATUSES.ALL 
        ? cards 
        : cards.filter(FILTER_CONFIG.PREDICATES[filterStatus] || (() => true));
      
      // Apply sorting with optimized comparisons
      if (result.length <= 1) return result;
      
      result = [...result]; // Shallow copy to avoid mutation
      
      // Use pre-defined comparator functions
      const comparator = sortComparators[sortBy];
      if (comparator) {
        result.sort(sortOrder === FILTER_CONFIG.SORT_ORDERS.ASC ? comparator : (a, b) => -comparator(a, b));
      }
      
      return result;
    });
  }, [cards, state.sortBy, state.sortOrder, state.filterStatus, sortComparators]);

  // ALL CARDS DISPLAYED - NO SLICING NEEDED
  const displayedCards = useMemo(() => {
    // Display all sorted and filtered cards at once
    return sortedAndFilteredCards;
  }, [sortedAndFilteredCards]);

  // Optimized virtualized list hook
  const {
    flatListRef,
    virtualizationConfig,
    scrollToTop,
    scrollToIndex,
  } = useVirtualizedList(displayedCards, 2);

  // Enhanced virtualization config using centralized constants
  const optimizedVirtualizationConfig = useMemo(() => ({
    ...virtualizationConfig,
    initialNumToRender: COLLECTION_CONFIG.VIRTUALIZATION.INITIAL_NUM_TO_RENDER,
    maxToRenderPerBatch: COLLECTION_CONFIG.VIRTUALIZATION.MAX_TO_RENDER_PER_BATCH,
    windowSize: COLLECTION_CONFIG.VIRTUALIZATION.WINDOW_SIZE,
    updateCellsBatchingPeriod: COLLECTION_CONFIG.VIRTUALIZATION.UPDATE_CELLS_BATCHING_PERIOD,
    scrollEventThrottle: COLLECTION_CONFIG.VIRTUALIZATION.SCROLL_EVENT_THROTTLE,
    removeClippedSubviews: true,
    getItemLayout: (_, index) => ({
      length: COLLECTION_CONFIG.VIRTUALIZATION.CARD_HEIGHT,
      offset: COLLECTION_CONFIG.VIRTUALIZATION.CARD_HEIGHT * Math.floor(index / 2),
      index,
    }),
  }), [virtualizationConfig]);

  // Stable key extractor
  const keyExtractor = useCallback((item, index) => {
    return item?.id || `card-${index}`;
  }, []);

  // Optimized refresh control with centralized colors
  const refreshControl = useMemo(() => (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      colors={[COLLECTION_CONFIG.UI.COLORS.PRIMARY]}
      progressBackgroundColor="#ffffff"
      tintColor={COLLECTION_CONFIG.UI.COLORS.PRIMARY}
    />
  ), [refreshing, onRefresh]);

  // Enhanced card deletion with better error handling
  const handleCardDeleted = useCallback((cardId, action = 'remove') => {
    try {
      if (action === 'delete') {
        const card = cards.find(c => c.id === cardId);
        if (card) {
          showDeleteConfirmation(card);
        } else {
          // Card not found, may have been deleted already
          removeCard(cardId);
          if (platformUtils.showToast) {
            platformUtils.showToast('Card was already removed');
          }
        }
      } else {
        removeCard(cardId);
      }
    } catch (error) {
      console.error('Error handling card deletion:', error);
      handleError(error, 'card_deletion_handler');
    }
  }, [cards, removeCard, showDeleteConfirmation, handleError, platformUtils]);

  // Enhanced confirm delete with rollback capability
  const confirmDeleteCard = useCallback(async () => {
    const { cardToDelete } = state;
    if (!cardToDelete) return;
    
    try {
      // Optimistic update
      removeCard(cardToDelete.id);
      hideDeleteConfirmation();
      
      // Show immediate feedback
      if (platformUtils.showToast) {
        platformUtils.showToast('Deleting card...');
      }
      
      try {
        await deleteDoc(doc(db, 'cards', cardToDelete.id));
        
        // Success feedback
        if (platformUtils.showToast) {
          platformUtils.showToast('Card deleted successfully');
        } else {
          platformUtils.showAlert('Success', 'Card deleted successfully');
        }
      } catch (deleteError) {
        // Rollback optimistic update
        console.error('Error deleting card from database:', deleteError);
        
        // Restore the card in the UI by refreshing
        onRefresh();
        
        // Show error feedback
        platformUtils.showAlert(
          'Delete Failed', 
          'Could not delete the card. It has been restored to your collection.',
          [{ text: 'OK', style: 'default' }]
        );
      }
    } catch (validationError) {
      hideDeleteConfirmation();
      console.error('Card deletion validation error:', validationError);
      
      platformUtils.showAlert(
        'Delete Error',
        'Unable to delete the card at this time. Please try again.',
        [{ text: 'OK', style: 'default' }]
      );
    }
  }, [state.cardToDelete, removeCard, hideDeleteConfirmation, onRefresh, platformUtils]);

  // NO LOAD MORE NEEDED - ALL CARDS LOADED AT ONCE
  const handleLoadMore = useCallback(() => {
    // No-op since we load all cards at once
    console.log('📦 All cards already loaded - no load more needed');
  }, []);

  // Performance-optimized render function
  const renderCard = useCallback(({ item }) => {
    return <MemoizedCardRenderer item={item} onPress={showCardPreview} />;
  }, [showCardPreview]);

  // SIMPLE FOOTER - NO LOAD MORE NEEDED
  const ListFooterComponent = useMemo(() => {
    return () => (
      <View style={{ height: COLLECTION_CONFIG.UI.SPACING.MEDIUM }}>
        {__DEV__ && (
          <Text style={styles.debugText}>
            🎯 All {cards.length} cards loaded in single fetch
          </Text>
        )}
      </View>
    );
  }, [cards.length]);

  // ULTRA-OPTIMIZED empty component with read count display
  const ListEmptyComponent = useMemo(() => (
    <View style={styles.emptyContainer}>
      <Icon name="cards" size={60} color="#ccc" />
      <Text style={styles.emptyText}>
        {refreshing ? 'Refreshing collection...' : 'No cards found'}
      </Text>
      <Text style={styles.emptySubtext}>
        {refreshing 
          ? 'Fetching latest data...' 
          : 'Pull to refresh or adjust your filters'
        }
      </Text>
      {/* READ OPTIMIZATION METRICS - Development only */}
      {__DEV__ && (
        <View style={styles.metricsContainer}>
          <Text style={styles.metricsText}>
            Firestore Reads: {readCount} | Cache Hit Rate: {(cacheHitRate * 100).toFixed(1)}%
            Background Syncs: {backgroundSyncs} | Prefetch Ops: {prefetchOperations}
            Data Freshness: {dataFreshness} | Avg Response: {averageResponseTime.toFixed(0)}ms
          </Text>
        </View>
      )}
      {!refreshing && (
        <Button 
          mode="contained" 
          onPress={onRefresh}
          icon="refresh"
          style={{ marginTop: COLLECTION_CONFIG.UI.SPACING.MEDIUM }}
        >
          Refresh Collection
        </Button>
      )}
      {refreshing && (
        <ActivityIndicator 
          size="small" 
          color={COLLECTION_CONFIG.UI.COLORS.PRIMARY}
          style={{ marginTop: COLLECTION_CONFIG.UI.SPACING.MEDIUM }}
        />
      )}
    </View>
  ), [onRefresh, refreshing, readCount, cacheHitRate, backgroundSyncs, prefetchOperations, dataFreshness, averageResponseTime]);

  // Consolidated effects for better performance
  useEffect(() => {
    // Cache cleanup interval
    const cacheCleanupInterval = setInterval(() => {
      clearExpiredCache();
    }, COLLECTION_CONFIG.CACHE_CLEANUP_INTERVAL);

    // Auto-scroll to top when filters change
    const handleFilterChange = () => {
      if (scrollToTop) {
        scrollToTop();
      }
    };

    // Trigger scroll when filters change
    handleFilterChange();

    return () => {
      clearInterval(cacheCleanupInterval);
      cleanupAnimations();
      
      // Clear cache for this component (synchronous operation)
      try {
        CacheService.clearMemoryCache('general', 'CollectionScreen');
      } catch (error) {
        console.warn('Error clearing memory cache:', error);
      }
    };
  }, [state.sortBy, state.sortOrder, state.filterStatus, scrollToTop, cleanupAnimations, cards.length]);

  return (
    <ScreenBackground>
      {/* ULTRA-OPTIMIZED: Header using consolidated data */}
      <MemoizedCollectionHeader
        balance={balance}
        userGems={userGems}
        cards={cards}
        sortBy={state.sortBy}
        setSortBy={actions.setSortBy}
        sortOrder={state.sortOrder}
        setSortOrder={actions.setSortOrder}
        filterStatus={state.filterStatus}
        setFilterStatus={actions.setFilterStatus}
        sortByMenuVisible={state.sortByMenuVisible}
        setSortByMenuVisible={menuHandlers.setSortByMenuVisible}
        sortOrderMenuVisible={state.sortOrderMenuVisible}
        setSortOrderMenuVisible={menuHandlers.setSortOrderMenuVisible}
        filterStatusMenuVisible={state.filterStatusMenuVisible}
        setFilterStatusMenuVisible={menuHandlers.setFilterStatusMenuVisible}
      />
      
      {/* READ OPTIMIZATION METRICS - Development only */}
      {__DEV__ && (
        <View style={styles.debugContainer}>
          <Text style={styles.debugText}>
            🔥 Reads: {readCount} | 📊 Cache: {(cacheHitRate * 100).toFixed(1)}% | 📦 Cards: {cards.length}
            {backgroundSyncing && ' | 🔄 Syncing'}
            {prefetchInProgress && ' | 🧠 Prefetching'}
            | 📈 BG Syncs: {backgroundSyncs} | 🚀 Prefetch: {prefetchOperations}
            | 🎯 Data: {dataFreshness} | ⚡ Avg: {averageResponseTime.toFixed(0)}ms
          </Text>
        </View>
      )}
      
      {/* Error display */}
      {error && (
        <View style={styles.errorContainer}>
          <View style={styles.errorContent}>
            <Icon name="alert-circle" size={24} color="crimson" />
            <Text style={styles.errorText}>{error.message}</Text>
            {error.canRetry && (
              <Button 
                mode="contained" 
                onPress={retryOperation}
                icon="refresh"
                style={styles.retryButton}
              >
                Retry ({maxRetries - retryCount} attempts left)
              </Button>
            )}
          </View>
        </View>
      )}
      
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading your collection...</Text>
          {__DEV__ && (
            <Text style={styles.debugText}>
              Firestore reads: {readCount}
            </Text>
          )}
          {retryCount > 0 && (
            <Text style={styles.retryText}>Attempt {retryCount + 1} of {maxRetries + 1}</Text>
          )}
        </View>
      ) : (
        <Animated.FlatList
          ref={flatListRef}
          data={displayedCards}
          renderItem={renderCard}
          contentContainerStyle={styles.cardGrid}
          numColumns={2}
          {...optimizedVirtualizationConfig}
          keyExtractor={keyExtractor}
          refreshControl={refreshControl}
          onEndReached={handleLoadMore}
          ListEmptyComponent={ListEmptyComponent}
          ListFooterComponent={ListFooterComponent}
        />
      )}
      
      <CardPreviewModal
        visible={state.cardPreviewVisible}
        card={state.selectedCard}
        onClose={closeCardPreview}
        onCardDeleted={handleCardDeleted}
        isUserAdmin={isUserAdmin}
        downloadingCard={state.downloadingCard}
        setDownloadingCard={setDownloadingCard}
        balance={balance}
        subtractCoins={subtractCoins}
        addCoins={addCoins}
        handleError={handleError}
      />
      
      <Portal>
        <Dialog
          visible={state.confirmDialog}
          onDismiss={hideDeleteConfirmation}
          style={styles.dialog}
        >
          <Dialog.Title style={styles.dialogTitle}>Delete Card</Dialog.Title>
          <Dialog.Content>
            <Text>Are you sure you want to delete "{state.cardToDelete?.name}"? This action cannot be undone.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={hideDeleteConfirmation}>Cancel</Button>
            <Button onPress={confirmDeleteCard} textColor="red">Delete</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScreenBackground>
  );
};

// Main component wrapped with Error Boundary
const CollectionScreen = () => {
  // Enhanced error boundary error handler
  const handleErrorBoundaryError = useCallback((error, retry, retryCount) => {
    // Log error for debugging
    console.error('Collection Screen Error Boundary:', {
      error: error.message,
      stack: error.stack,
      retryCount,
      timestamp: new Date().toISOString()
    });

    return (
      <ScreenBackground>
        <View style={styles.errorBoundaryContainer}>
          <Icon name="alert-circle-outline" size={64} color="#e74c3c" />
          <Text style={styles.errorBoundaryTitle}>Collection Error</Text>
          <Text style={styles.errorBoundaryMessage}>
            {retryCount === 0 
              ? 'Something went wrong loading your card collection. This usually resolves itself with a retry.'
              : `Retry attempt ${retryCount} failed. ${retryCount < 3 ? 'Please try again.' : 'You may need to restart the app.'}`
            }
          </Text>
          
          {/* Detailed error info for debugging (only in development) */}
          {__DEV__ && (
            <Text style={styles.errorDetails}>
              Error: {error.message}
            </Text>
          )}
          
          {retryCount < 3 && (
            <Button
              mode="contained"
              onPress={retry}
              icon="refresh"
              style={styles.errorBoundaryButton}
            >
              Try Again ({3 - retryCount} attempts left)
            </Button>
          )}
          
          {retryCount >= 2 && (
            <Button
              mode="outlined"
              onPress={() => {
                // Clear cache and force full refresh
                CacheService.clearAll()
                  .then(() => retry())
                  .catch(console.error);
              }}
              icon="cached"
              style={[styles.errorBoundaryButton, { marginTop: 8 }]}
            >
              Clear Cache & Retry
            </Button>
          )}
        </View>
      </ScreenBackground>
    );
  }, []);

  return (
    <ErrorBoundary 
      fallback={handleErrorBoundaryError}
      maxRetries={3}
    >
      <CollectionScreenContent />
    </ErrorBoundary>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: COLLECTION_CONFIG.UI.SPACING.MEDIUM,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    opacity: 0.7,
  },
  retryText: {
    color: '#666',
    marginTop: 10,
  },
  cardGrid: {
    padding: COLLECTION_CONFIG.UI.SPACING.SMALL,
    paddingBottom: 100,
    justifyContent: 'space-between',
  },
  emptyContainer: {
    padding: COLLECTION_CONFIG.UI.SPACING.MEDIUM,
    alignItems: 'center',
    justifyContent: 'center',
    height: 300,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: COLLECTION_CONFIG.UI.SPACING.SMALL,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.7,
  },
  errorContainer: {
    margin: COLLECTION_CONFIG.UI.SPACING.MEDIUM,
    padding: COLLECTION_CONFIG.UI.SPACING.MEDIUM,
    backgroundColor: '#ffebee',
    borderRadius: COLLECTION_CONFIG.UI.SPACING.SMALL,
    borderWidth: 1,
    borderColor: '#ffcdd2',
  },
  errorContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: {
    flex: 1,
    marginLeft: 12,
    color: '#c62828',
    fontSize: 14,
  },
  retryButton: {
    marginLeft: 12,
  },
  loadMoreContainer: {
    padding: COLLECTION_CONFIG.UI.SPACING.MEDIUM,
    alignItems: 'center',
    width: '100%',
  },
  loadMoreText: {
    marginTop: COLLECTION_CONFIG.UI.SPACING.SMALL,
    color: '#666',
  },
  loadMoreButton: {
    marginVertical: 10,
    alignSelf: 'center',
  },
  loadMoreButtonText: {
    fontWeight: 'bold',
  },
  dialog: {
    borderRadius: COLLECTION_CONFIG.UI.SPACING.MEDIUM,
  },
  dialogTitle: {
    textAlign: 'center',
  },
  errorBoundaryContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: COLLECTION_CONFIG.UI.SPACING.EXTRA_LARGE,
  },
  errorBoundaryTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginTop: COLLECTION_CONFIG.UI.SPACING.MEDIUM,
    marginBottom: 12,
    textAlign: 'center',
  },
  errorBoundaryMessage: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
    marginBottom: COLLECTION_CONFIG.UI.SPACING.LARGE,
    lineHeight: 24,
  },
  errorBoundaryButton: {
    marginTop: COLLECTION_CONFIG.UI.SPACING.MEDIUM,
  },
  errorDetails: {
    marginTop: COLLECTION_CONFIG.UI.SPACING.MEDIUM,
    color: '#7f8c8d',
    textAlign: 'center',
  },
  // READ OPTIMIZATION DEBUG STYLES
  debugContainer: {
    backgroundColor: '#e8f5e8',
    padding: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 4,
    borderLeftWidth: 4,
    borderLeftColor: '#4caf50',
  },
  debugText: {
    fontSize: 12,
    color: '#2e7d32',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  metricsContainer: {
    marginTop: 16,
    padding: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 4,
  },
  metricsText: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
    fontFamily: 'monospace',
  },
});

export default CollectionScreen; 