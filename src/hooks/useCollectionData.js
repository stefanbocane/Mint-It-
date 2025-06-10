import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { COLLECTION_CONFIG, ERROR_CONFIG } from '../constants/collectionConstants';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import OptimizedStatusVerificationService from '../services/OptimizedStatusVerificationService';
import UltraBatchService from '../services/UltraBatchService';
import CacheService from '../services/caching/CacheService';
import GlobalListenerCoordinator from '../utils/GlobalListenerCoordinator';

const CACHE_CLEANUP_INTERVAL = COLLECTION_CONFIG.CACHE_CLEANUP_INTERVAL;

// DEPRECATED: This hook has been replaced by useUltraOptimizedCollectionData
// for maximum read reduction. This version is kept for backward compatibility.
// TODO: Remove this hook after migrating all screens to the ultra-optimized version
export const useCollectionData = () => {
  console.warn('⚠️ DEPRECATED: useCollectionData is deprecated. Use useUltraOptimizedCollectionData for better performance.');
  
  // Core state
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [initialized, setInitialized] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Auth and group context
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  
  const unsubscribeRef = useRef(null);
  const maxRetries = COLLECTION_CONFIG.DATABASE.MAX_RETRY_ATTEMPTS;

  // Track user activity for smart optimizations
  const lastUserActivity = useRef(Date.now());

  // Track user activity
  const trackUserActivity = useCallback(() => {
    lastUserActivity.current = Date.now();
  }, []);

  // STEP 3.A.2: Batch enrich cards with owner details to eliminate N+1 problem
  const batchEnrichCardsWithOwners = useCallback(async (cards) => {
    try {
      console.log(`🔄 OPTIMIZED: Batch enriching ${cards.length} cards with owner details`);
      
      // Extract unique owner IDs from cards
      const uniqueOwnerIds = [...new Set(
        cards
          .map(card => card.ownerId || card.userId)
          .filter(id => id && typeof id === 'string')
      )];

      if (uniqueOwnerIds.length === 0) {
        console.log('⚠️ No owner IDs found in cards, returning cards as-is');
        return cards;
      }

      console.log(`📊 OPTIMIZED: Batch fetching ${uniqueOwnerIds.length} unique owners instead of ${cards.length} individual requests`);

      // Batch fetch all unique owner profiles using UltraBatchService
      const ownersMap = await UltraBatchService.batchGetUsers(uniqueOwnerIds);
      
      console.log(`✅ OPTIMIZED: Fetched ${ownersMap.size} owner profiles in batch`);

      // Map owner details back to cards
      const enrichedCards = cards.map(card => {
        const ownerId = card.ownerId || card.userId;
        const ownerDetails = ownersMap.get(ownerId);
        
        return {
          ...card,
          ownerDetails: ownerDetails ? {
            id: ownerDetails.id,
            displayName: ownerDetails.displayName || ownerDetails.username || 'Unknown',
            username: ownerDetails.username || ownerDetails.displayName || 'Unknown',
            profilePicture: ownerDetails.profilePicture || null
          } : null
        };
      });

      console.log(`🎯 OPTIMIZED: Enriched ${enrichedCards.length} cards with owner details - eliminated ${cards.length - uniqueOwnerIds.length} redundant fetches`);
      
      return enrichedCards;
    } catch (error) {
      console.error('🚨 Failed to batch enrich cards with owners:', error);
      // Return original cards if enrichment fails
      return cards;
    }
  }, []);

  // Enhanced error handling
  const handleError = useCallback((error, operation = 'unknown') => {
    trackUserActivity();
    
    console.error(`🚨 Collection ${operation} error:`, error);
    
    if (retryCount < ERROR_CONFIG.MAX_RETRIES) {
      setRetryCount(prev => prev + 1);
      setError({
        message: `Failed to ${operation}. Retrying...`,
        canRetry: true,
        operation
      });
    } else {
      setError({
        message: ERROR_CONFIG.getMessage(error) || `Failed to ${operation}`,
        canRetry: false,
        operation
      });
    }
  }, [retryCount]);

  // OPTIMIZED: Status verification using OptimizedStatusVerificationService
  const verifyAndCorrectStatus = useCallback(async (cardsToVerify) => {
    if (!cardsToVerify || cardsToVerify.length === 0) return;

    try {
      console.log(`🔍 OPTIMIZED: Verifying status for ${cardsToVerify.length} cards using OptimizedStatusVerificationService`);
      
      // Use the optimized status verification service
      const verificationResults = await OptimizedStatusVerificationService.verifyCardStatuses(cardsToVerify);
      
      // Process results and update cards that need correction
      const cardsToUpdate = [];
      verificationResults.forEach((result, cardId) => {
        if (result.needsUpdate) {
          cardsToUpdate.push({
            id: cardId,
            updates: result.updates
          });
        }
      });

      if (cardsToUpdate.length > 0) {
        console.log(`✅ OPTIMIZED: Found ${cardsToUpdate.length} cards needing status correction`);
        
        // Batch update cards using UltraBatchService
        const { writeBatch, doc } = await import('firebase/firestore');
        const { db } = await import('../config/firebase');
        
        const batch = writeBatch(db);
        cardsToUpdate.forEach(({ id, updates }) => {
          const cardRef = doc(db, 'cards', id);
          batch.update(cardRef, updates);
        });
        
        await batch.commit();
        console.log(`🔄 OPTIMIZED: Updated ${cardsToUpdate.length} card statuses in batch`);
        
        // Update local state optimistically
        setCards(prevCards => 
          prevCards.map(card => {
            const update = cardsToUpdate.find(u => u.id === card.id);
            return update ? { ...card, ...update.updates } : card;
          })
        );
      }
    } catch (error) {
      console.error('🚨 Status verification failed:', error);
      handleError(error, 'status_verification');
    }
  }, [handleError]);

  // OPTIMIZED: Initialize data using GlobalListenerCoordinator with owner batch fetching
  const initializeData = useCallback(async () => {
    if (!user || !currentGroup || initialized) return;

    try {
      setLoading(true);
      setError(null);
      
      console.log('🚀 OPTIMIZED: Initializing collection data with GlobalListenerCoordinator + batch owner fetching');

      // Cleanup any existing listeners
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }

      // Use GlobalListenerCoordinator for consolidated real-time updates
      const unsubscribe = GlobalListenerCoordinator.subscribeToUserCards(
        user.uid,
        currentGroup.id,
        'collection-screen',
        async (cardsData) => {
          try {
            console.log(`📡 OPTIMIZED: Received ${cardsData.length} cards from GlobalListenerCoordinator`);
            
            // Step 3.A.2: Batch fetch owner details to eliminate N+1 problem
            let enrichedCards = cardsData;
            if (cardsData.length > 0) {
              enrichedCards = await batchEnrichCardsWithOwners(cardsData);
            }
            
            // Set enriched cards immediately for fast UI update
            setCards(enrichedCards);
            setLoading(false);
            setRefreshing(false);
            
            // Run status verification in background WITHOUT awaiting (non-blocking)
            if (enrichedCards.length > 0) {
              // Use smart verification based on user activity
              const timeSinceLastActivity = Date.now() - lastUserActivity.current;
              const userIsActive = timeSinceLastActivity < COLLECTION_CONFIG.DATABASE.RECENT_TRANSFER_WINDOW;
              
              if (userIsActive) {
                // Run in background without blocking UI
                Promise.resolve().then(() => verifyAndCorrectStatus(enrichedCards)).catch(error => {
                  console.warn('⚠️ Background status verification failed:', error);
                });
              } else {
                console.log('⏸️ OPTIMIZED: Skipping status verification - user inactive');
              }
            }
          } catch (error) {
            console.error('🚨 Error processing cards data:', error);
            handleError(error, 'data_processing');
          }
        },
        {
          enableThrottling: true,
          throttleMs: 30000, // 30 second throttle for non-critical updates
          enableCaching: true,
          cacheExpiryMs: 5 * 60 * 1000 // 5 minute cache
        }
      );

      unsubscribeRef.current = unsubscribe;
      setInitialized(true);
      setRetryCount(0);
      
      console.log('✅ OPTIMIZED: Collection data initialized with consolidated listener + batch owner enrichment');

    } catch (error) {
      console.error('🚨 Failed to initialize collection data:', error);
      handleError(error, 'initialization');
      setLoading(false);
    }
  }, [user, currentGroup, initialized, handleError, verifyAndCorrectStatus, lastUserActivity]);

  // OPTIMIZED: Refresh using batch operations
  const onRefresh = useCallback(async () => {
    if (!user || !currentGroup) return;

    try {
      setRefreshing(true);
      trackUserActivity();
      
      console.log('🔄 OPTIMIZED: Refreshing collection data');

      // Force refresh through GlobalListenerCoordinator
      // This will invalidate cache and fetch fresh data
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }

      // Re-initialize with fresh data
      setInitialized(false);
      await initializeData();
      
    } catch (error) {
      console.error('🚨 Refresh failed:', error);
      handleError(error, 'refresh');
    } finally {
      setRefreshing(false);
    }
  }, [user, currentGroup, initializeData, trackUserActivity, handleError]);

  // OPTIMIZED: Remove card with batch operations
  const removeCard = useCallback(async (cardId) => {
    if (!cardId) return;

    try {
      trackUserActivity();
      
      // Optimistic update - remove card immediately from UI
      setCards(prevCards => prevCards.filter(card => card.id !== cardId));
      
      console.log(`🗑️ OPTIMIZED: Removing card ${cardId}`);
      
      // Use Firebase delete operation
      const { deleteDoc, doc } = await import('firebase/firestore');
      const { db } = await import('../config/firebase');
      
      await deleteDoc(doc(db, 'cards', cardId));
      
      // Invalidate relevant caches
      await Promise.allSettled([
        CacheService.invalidate(`user_cards_${user.uid}_${currentGroup.id}`),
        CacheService.invalidateDocument('cards', cardId)
      ]);
      
      console.log(`✅ OPTIMIZED: Card ${cardId} removed successfully`);
      
    } catch (error) {
      console.error('🚨 Failed to remove card:', error);
      handleError(error, 'card_removal');
      
      // Revert optimistic update on error
      onRefresh();
    }
  }, [user, currentGroup, trackUserActivity, handleError, onRefresh]);

  // Retry operation
  const retryOperation = useCallback(async () => {
    setError(null);
    setRetryCount(0);
    setInitialized(false);
    await initializeData();
  }, [initializeData]);

  // Activate listener only when screen is focused
  useFocusEffect(
    React.useCallback(() => {
      if (user && currentGroup) {
        initializeData();
      }
      return () => {
        if (unsubscribeRef.current) {
          unsubscribeRef.current();
          unsubscribeRef.current = null;
          setInitialized(false);
        }
      };
    }, [user, currentGroup, initializeData])
  );

  // Activity tracking - update activity on state changes
  useEffect(() => {
    if (cards.length > 0) {
      trackUserActivity();
    }
  }, [cards, trackUserActivity]);

  return {
    cards,
    loading,
    refreshing,
    error,
    retryCount,
    maxRetries,
    handleError,
    onRefresh,
    retryOperation,
    removeCard,
    // Additional optimized methods
    trackUserActivity,
    verifyAndCorrectStatus
  };
}; 