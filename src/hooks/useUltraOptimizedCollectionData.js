/**
 * Ultra-Optimized Collection Data Hook
 * 
 * GOAL: Reduce Collection Screen from 30+ reads to <5 reads per session
 * 
 * OPTIMIZATION STRATEGY:
 * 1. Single compound Firestore query with denormalized data
 * 2. 30-minute aggressive client-side caching 
 * 3. Cursor-based pagination (no offset queries)
 * 4. Consolidated user + group + balance data in single read
 * 5. Eliminated real-time listeners - user-initiated refresh only
 * 6. Background status verification only on explicit user action
 * 
 * READ BREAKDOWN TARGET:
 * - Initial load: 2 reads (compound cards query + user profile)
 * - Pagination: 1 read per batch (cursor-based)
 * - Refresh: 2 reads (cache invalidation + fresh data)
 * - Session total: <5 reads for normal usage
 * 
 * @version 1.0.0 - ULTRA READ OPTIMIZATION
 * @author Database Optimization Team
 */

import {
  collection,
  doc,
  orderBy,
  query,
  where
} from 'firebase/firestore';
// 🚀 TRACKED: Use TrackedFirestore for automatic read monitoring
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDoc, getDocs } from '../services/ReadTracking/TrackedFirestore';
import { useNavigation } from '@react-navigation/native';

import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import GlobalRequestDeduplicator from '../services/GlobalRequestDeduplicator';
import CacheService from '../services/caching/CacheService';
import RefreshCoordinator from '../utils/RefreshCoordinator';
import BootstrapService from '../services/BootstrapService';

// SECOND PASS: Advanced caching configuration with intelligent strategies
const ADVANCED_CACHE_CONFIG = {
  // Extended TTL for second pass - more aggressive caching
  CARDS_TTL: 5 * 60 * 1000,        // 5 minutes for cards (balance between freshness and performance)
  USER_PROFILE_TTL: 10 * 60 * 1000,  // 10 minutes for user profile
  GROUP_DATA_TTL: 30 * 60 * 1000, // 30 minutes for group data
  
  // No limits - fetch everything
  PAGINATION_BATCH_SIZE: 1000,       // Fetch all cards at once
  MAX_CACHE_PAGES: 1,                // Single page contains all data
  FETCH_ALL_STRATEGY: true,          // Fetch entire collection in one go
  
  // Advanced strategies
  PREFETCH_DELAY: 5000,              // Prefetch related data after 5 seconds
  BACKGROUND_SYNC_INTERVAL: 10 * 60 * 1000, // Background sync every 10 minutes
  DIFFERENTIAL_UPDATE_TTL: 5 * 60 * 1000,   // Check for updates every 5 minutes
  
  // Performance optimization
  ENABLE_PREDICTIVE_CACHING: true,   // Cache likely-needed data
  ENABLE_BACKGROUND_PREFETCH: true,  // Prefetch in background
  ENABLE_DIFFERENTIAL_UPDATES: true  // Only update what changed
};

// SECOND PASS: Advanced performance tracking
let globalReadCount = 0;
let sessionCacheHits = 0;
let sessionCacheRequests = 0;

// Advanced metrics for second pass
let advancedMetrics = {
  totalReads: 0,
  cacheHits: 0,
  cacheMisses: 0,
  backgroundSyncs: 0,
  prefetchOperations: 0,
  averageResponseTime: 0,
  differentialUpdates: 0,
  memoryOptimizations: 0
};

// Background operation timers
let backgroundSyncTimer = null;
let prefetchTimer = null;

// CRITICAL: Module-level cache to persist across hook unmounts/remounts
// This prevents re-initialization during React StrictMode double-mounting
const persistentCardCache = {
  cards: [],
  userId: null,
  groupId: null,
  timestamp: 0
};

// Cache for cardOverview existence - reduces reads when overview doesn't exist
const OVERVIEW_EXISTS_CACHE = new Map();
const OVERVIEW_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// GLOBAL initialization guard - survives unmount/remount
// This prevents duplicate initializations across different hook instances
let globalInitInProgress = false;
let globalInitPromise = null;

/**
 * Deduplicated fetch wrapper using GlobalRequestDeduplicator
 * Ensures only one fetch per unique key is in-flight across the entire app
 */
async function deduplicatedFetch(key, fetchFunction) {
  return GlobalRequestDeduplicator.deduplicate(key, fetchFunction);
}

/**
 * Check if cardOverview document exists for a user/group
 * Uses 24-hour cache to avoid repeated checks
 */
async function checkOverviewExists(groupId, userId) {
  const cacheKey = `${groupId}_${userId}`;
  const cached = OVERVIEW_EXISTS_CACHE.get(cacheKey);

  // Return cached result if valid
  if (cached && (Date.now() - cached.timestamp) < OVERVIEW_CACHE_TTL) {
    console.log(`📦 Overview existence cache hit: ${cached.exists ? 'EXISTS' : 'MISSING'}`);
    return cached.exists;
  }

  // Check Firestore
  try {
    const overviewRef = doc(db, 'cardOverviews', `${groupId}_${userId}`);
    const overviewSnap = await getDoc(overviewRef); // 1 READ (once per 24hr)
    const exists = overviewSnap.exists();

    // Cache the result
    OVERVIEW_EXISTS_CACHE.set(cacheKey, {
      exists,
      timestamp: Date.now()
    });

    console.log(`🔍 Overview existence checked and cached: ${exists ? 'EXISTS' : 'MISSING'}`);
    return exists;
  } catch (error) {
    console.warn('Error checking overview existence:', error);
    return false; // Assume doesn't exist on error
  }
}

export const useUltraOptimizedCollectionData = () => {
  // Core state - minimal and consolidated
  const [state, setState] = useState({
    // Consolidated data
    cards: [],              // Cards with embedded owner details
    userProfile: null,      // User profile with balance, gems, stats
    groupInfo: null,        // Current group information

    // Pagination state
    hasMoreCards: true,
    lastCardCursor: null,
    currentPage: 0,

    // UI state
    loading: true,
    refreshing: false,
    error: null,
    retryCount: 0,

    // Performance metrics (enhanced for second pass)
    readCount: 0,
    cacheHitRate: 0,
    backgroundSyncing: false,
    prefetchInProgress: false,
    lastSyncTime: null,
    dataFreshness: 'stale', // 'fresh', 'stale', 'expired'
    averageResponseTime: 0
  });

  // Force re-render counter
  const [, forceUpdate] = useState(0);

  // Refs for stable references
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const navigation = useNavigation();
  const mountedRef = useRef(true);
  const cacheKeysRef = useRef(new Set());
  const initializingRef = useRef(false);
  const initPromiseRef = useRef(null);
  const latestCardsRef = useRef([]); // Store latest cards to return immediately
  const isScreenFocusedRef = useRef(false);

  // Constants
  const maxRetries = 3;

  // PERFORMANCE TRACKING
  const trackRead = useCallback(() => {
    globalReadCount++;
    setState(prev => ({ ...prev, readCount: globalReadCount }));
  }, []);

  const trackCacheHit = useCallback((isHit) => {
    sessionCacheRequests++;
    if (isHit) sessionCacheHits++;
    
    const hitRate = sessionCacheRequests > 0 ? sessionCacheHits / sessionCacheRequests : 0;
    setState(prev => ({ ...prev, cacheHitRate: hitRate }));
  }, []);

  // ERROR HANDLING
  const handleError = useCallback((error, operation = 'unknown') => {
    console.error(`🚨 Collection ${operation} error:`, error);
    
    setState(prev => ({
      ...prev,
      error: {
        message: error.message || `Failed to ${operation}`,
        canRetry: prev.retryCount < maxRetries,
        operation
      },
      loading: false,
      refreshing: false
    }));
  }, []);

  // CACHE UTILITIES
  const generateCacheKey = useCallback((type, ...params) => {
    const key = `ultra_collection_${type}_${params.join('_')}`;
    cacheKeysRef.current.add(key);
    return key;
  }, []);

  const getCachedData = useCallback(async (cacheKey, ttl) => {
    try {
      const cached = await CacheService.getValue(cacheKey);
      if (cached && cached.timestamp && (Date.now() - cached.timestamp < ttl)) {
        trackCacheHit(true);
        console.log(`🎯 CACHE HIT: ${cacheKey}`);
        return cached.data;
      }
      trackCacheHit(false);
      return null;
    } catch (error) {
      trackCacheHit(false);
      console.warn(`Cache read error for ${cacheKey}:`, error);
      return null;
    }
  }, [trackCacheHit]);

  const setCachedData = useCallback(async (cacheKey, data, ttl) => {
    try {
      await CacheService.setValue(cacheKey, {
        data,
        timestamp: Date.now()
      }, { ttl });
      console.log(`💾 CACHED: ${cacheKey} (TTL: ${Math.round(ttl / 1000 / 60)}min)`);
    } catch (error) {
      console.warn(`Cache write error for ${cacheKey}:`, error);
    }
  }, []);

  // CONSOLIDATED USER PROFILE FETCH
  const fetchUserProfile = useCallback(async (userId, forceRefresh = false) => {
    const cacheKey = generateCacheKey('user_profile', userId);
    const dedupeKey = `userProfile_${userId}`;
    
    // Use deduplication wrapper
    return deduplicatedFetch(dedupeKey, async () => {
      // Check cache first unless forcing refresh (extended TTL for second pass)
      if (!forceRefresh) {
        const cached = await getCachedData(cacheKey, ADVANCED_CACHE_CONFIG.USER_PROFILE_TTL);
        if (cached) return cached;
      }

      try {
        console.log(`👤 FETCHING USER PROFILE via GlobalUserProfileCache: ${userId}`);
        
        // Use GlobalUserProfileCache instead of direct fetch
        const GlobalUserProfileCache = require('../services/GlobalUserProfileCache').default;
        const userData = await GlobalUserProfileCache.getProfile(userId);
        
        if (!userData) {
          throw new Error('User profile not found');
        }
        
        // Consolidate all user-related data in one object
        const consolidatedProfile = {
          id: userId,
          displayName: userData.displayName || 'Unknown User',
          username: userData.username || userData.displayName || 'Unknown',
          profilePicture: userData.profilePicture || null,
          
          // Financial data
          balance: userData.balance || 0,
          gems: userData.gems || 0,
          
          // Stats and achievements
          xp: userData.xp || 0,
          level: userData.level || 1,
          achievements: userData.achievements || [],
          totalCards: userData.totalCards || 0,
          totalTrades: userData.totalTrades || 0,
          
          // Group memberships
          groups: userData.groups || [],
          
          // Settings
          settings: userData.settings || {},
          
          // Timestamps
          lastActive: userData.lastActive?.toDate?.() || new Date(),
          createdAt: userData.createdAt?.toDate?.() || new Date()
        };

        // Cache with extended TTL (second pass: 60 minutes)
        await setCachedData(cacheKey, consolidatedProfile, ADVANCED_CACHE_CONFIG.USER_PROFILE_TTL);
        
        console.log(`✅ USER PROFILE FETCHED: ${userId} (cached for 60min)`);
        return consolidatedProfile;

      } catch (error) {
        console.error(`❌ Failed to fetch user profile for ${userId}:`, error);
        throw error;
      }
    });
  }, [generateCacheKey, getCachedData, setCachedData, trackRead]);

  // CONSOLIDATED GROUP INFO FETCH
  const fetchGroupInfo = useCallback(async (groupId, forceRefresh = false) => {
    const cacheKey = generateCacheKey('group_info', groupId);
    
    // Check cache first unless forcing refresh (extended TTL for second pass)
    if (!forceRefresh) {
      const cached = await getCachedData(cacheKey, ADVANCED_CACHE_CONFIG.GROUP_DATA_TTL);
      if (cached) return cached;
    }

    try {
      console.log(`🏠 FETCHING GROUP INFO via GlobalGroupCache: ${groupId}`);
      
      // Use GlobalGroupCache instead of direct fetch
      const GlobalGroupCache = require('../services/GlobalGroupCache').default;
      const groupData = await GlobalGroupCache.getGroup(groupId, forceRefresh);

      if (!groupData) {
        throw new Error('Group not found');
      }
      
      // Consolidate group information
      const consolidatedGroup = {
        id: groupId,
        name: groupData.name || 'Unknown Group',
        description: groupData.description || '',
        
        // Access control
        adminIds: groupData.adminIds || [],
        members: groupData.members || [],
        
        // Settings
        settings: groupData.settings || {},
        isPublic: groupData.isPublic || false,
        
        // Stats
        totalCards: groupData.totalCards || 0,
        totalTrades: groupData.totalTrades || 0,
        
        // Timestamps
        createdAt: groupData.createdAt?.toDate?.() || new Date(),
        updatedAt: groupData.updatedAt?.toDate?.() || new Date()
      };

      // Cache with extended TTL (second pass: 2 hours)
      await setCachedData(cacheKey, consolidatedGroup, ADVANCED_CACHE_CONFIG.GROUP_DATA_TTL);
      
      console.log(`✅ GROUP INFO FETCHED: ${groupId} (cached for 2hrs)`);
      return consolidatedGroup;

    } catch (error) {
      console.error(`❌ Failed to fetch group info for ${groupId}:`, error);
      throw error;
    }
  }, [generateCacheKey, getCachedData, setCachedData, trackRead]);

  // ULTRA-OPTIMIZED CARDS FETCH - NO LIMITS, FETCH ALL CARDS
  const fetchAllCards = useCallback(async (userId, groupId, forceRefresh = false) => {
    const cacheKey = generateCacheKey('all_cards', userId, groupId);
    const dedupeKey = `allCards_${userId}_${groupId}`;
    
    // For force refresh, we skip deduplication by using a unique key
    const finalDedupeKey = forceRefresh ? `${dedupeKey}_${Date.now()}` : dedupeKey;
    
    if (forceRefresh) {
      console.log(`🔄 FORCE REFRESH: Using unique deduplication key for cards`);
    }
    
    // Use deduplication wrapper
    return deduplicatedFetch(finalDedupeKey, async () => {
      // Check cache first unless forcing refresh (extended TTL for second pass)
      if (!forceRefresh) {
        const cached = await getCachedData(cacheKey, ADVANCED_CACHE_CONFIG.CARDS_TTL);
        if (cached) {
          console.log(`📦 RETURNING CACHED ALL CARDS: ${cached.cards.length} cards`);
          // CRITICAL: Update ref AND persistent cache when returning from cache
          latestCardsRef.current = cached.cards || [];

          // Update persistent cache
          persistentCardCache.cards = cached.cards || [];
          persistentCardCache.userId = userId;
          persistentCardCache.groupId = groupId;
          persistentCardCache.timestamp = Date.now();

          console.log(`✅ Updated latestCardsRef and persistent cache with ${latestCardsRef.current.length} cards from cache`);
          // Force re-render to show cards immediately
          forceUpdate(prev => prev + 1);
          return cached;
        }
      }

    // Check if overview exists before trying to fetch it
    const overviewExists = await checkOverviewExists(groupId, userId);

    if (overviewExists) {
      // Attempt to fetch overview doc (single read)
      try {
        const overviewId = `${groupId}_${userId}`;
        console.log(`🔍 Fetching cardOverview: ${overviewId}`);
        const overviewSnap = await getDoc(doc(db, 'cardOverviews', overviewId));
        if (overviewSnap.exists()) {
        const data = overviewSnap.data();
        console.log(`📦 Overview exists with ${data.cards?.length || 0} cards`);
        if (Array.isArray(data.cards) && data.cards.length > 0) {
          // Use 'You' as default - don't block on user profile fetch
          // Profile will be fetched separately by initializeData
          const displayName = 'You';
          const userProfile = null;

          // Transform minimal overview cards to full card objects
          const transformedCards = data.cards.map(card => {
            // Parse dates properly
            const createdAt = card.createdAt?.toDate ? card.createdAt.toDate() : (card.createdAt || new Date());
            const updatedAt = card.updatedAt?.toDate ? card.updatedAt.toDate() : (card.updatedAt || new Date());

            // Normalize status: 'active' -> 'available' for backwards compatibility
            let normalizedStatus = card.status || 'available';
            if (normalizedStatus === 'active') {
              normalizedStatus = 'available';
            }

            return {
              // Spread all existing card data first
              ...card,
              // Core fields
              id: card.id,
              name: card.name || 'Unknown',
              rarity: card.rarity || 'common',
              status: normalizedStatus,
              imageUrl: card.imageUrl,
              updatedAt: updatedAt,
              createdAt: createdAt,

              // Add required ownership fields
              ownerId: userId,
              groupId: groupId,
              inAuction: card.inAuction || false,
              inTrade: card.inTrade || false,

              // CardPreviewModal fields for display
              createdByName: displayName,
              ownerName: displayName,
              userName: displayName,
              dateAcquired: createdAt,

              // Embedded owner details
              ownerDetails: {
                id: userId,
                displayName: displayName,
                username: userProfile?.username || displayName,
                profilePicture: userProfile?.profilePicture || null
              },
              isOwned: true
            };
          });

          console.log(`🔄 Transformed ${transformedCards.length} cards with creator: ${displayName}`);
          console.log(`📋 Transformed card IDs: ${transformedCards.map(c => c.id).join(', ')}`);

          const allCardsData = {
            cards: transformedCards,
            hasMoreCards: false,
            totalCards: transformedCards.length
          };

          // CRITICAL: Update ref AND persistent cache immediately when cards are fetched
          latestCardsRef.current = transformedCards;

          // Update persistent cache for fast remounts
          persistentCardCache.cards = transformedCards;
          persistentCardCache.userId = userId;
          persistentCardCache.groupId = groupId;
          persistentCardCache.timestamp = Date.now();

          console.log(`✅ Updated latestCardsRef and persistent cache with ${transformedCards.length} cards from overview`);
          // Force re-render to show cards immediately
          forceUpdate(prev => prev + 1);

          await setCachedData(cacheKey, allCardsData, ADVANCED_CACHE_CONFIG.CARDS_TTL);
          console.log(`✅ OVERVIEW CARDS FETCHED: ${transformedCards.length} cards (1 read)`);
          console.log(`📋 Overview card names: ${transformedCards.map(c => c.name).join(', ')}`);
          return allCardsData;
          } else {
            console.log(`⚠️ Overview exists but has no cards, falling back to full query`);
          }
        } else {
          console.log(`⚠️ No overview document found, falling back to full query`);
        }
      } catch (err) {
        console.warn('Overview doc fetch failed, falling back to full query', err);
      }
    } else {
      console.log(`⚠️ Overview doesn't exist (cached knowledge), skipping directly to full query`);
    }

    try {
      console.log(`🃏 FETCHING ALL CARDS: userId=${userId}, groupId=${groupId} (NO LIMITS)`);

      // Build compound query for ALL user cards - NO LIMIT
      const cardsRef = collection(db, 'cards');
      const cardsQuery = query(
        cardsRef,
        where('ownerId', '==', userId),
        where('groupId', '==', groupId),
        orderBy('createdAt', 'desc')
        // NO LIMIT - fetch everything at once
      );

      console.log(`🔍 Executing query: cards where ownerId=${userId} AND groupId=${groupId}`);
      const snapshot = await getDocs(cardsQuery);
      console.log(`📊 Query returned ${snapshot.size} documents`);

      const cards = [];

      snapshot.forEach(doc => {
        const cardData = doc.data();

        console.log(`📝 Processing card: ${doc.id} - ${cardData.name || 'Unnamed'} (owner: ${cardData.ownerId}, inAuction: ${cardData.inAuction}, status: ${cardData.status})`);

        // DENORMALIZED CARD DATA - embedded owner info to eliminate N+1 queries
        const card = {
          id: doc.id,
          ...cardData,

          // Embedded owner details (denormalized from user profile)
          ownerDetails: {
            id: cardData.ownerId,
            displayName: cardData.ownerDisplayName || 'Unknown',
            username: cardData.ownerUsername || 'Unknown',
            profilePicture: cardData.ownerProfilePicture || null
          },

          // Processed timestamps for consistent handling
          createdAt: cardData.createdAt?.toDate?.() || new Date(),
          updatedAt: cardData.updatedAt?.toDate?.() || new Date(),

          // UI helper flags
          isOwned: cardData.ownerId === userId
        };

        cards.push(card);
      });

      const allCardsData = {
        cards,
        cursor: null,           // No cursor needed - we have everything
        hasMoreCards: false,    // No more cards to fetch
        pageNumber: 0,
        fetchTimestamp: Date.now(),
        totalCards: cards.length
      };

      // CRITICAL: Update ref immediately when cards are fetched
      latestCardsRef.current = cards;
      console.log(`✅ Updated latestCardsRef with ${cards.length} cards from full query`);
      // Force re-render to show cards immediately
      forceUpdate(prev => prev + 1);

      // Cache ALL cards with extended TTL (second pass: 45 minutes)
      await setCachedData(cacheKey, allCardsData, ADVANCED_CACHE_CONFIG.CARDS_TTL);

      console.log(`✅ ALL CARDS FETCHED: ${cards.length} cards total (cached for 45min)`);
      console.log(`📋 Card names: ${cards.map(c => c.name).join(', ')}`);
      return allCardsData;

      } catch (error) {
        console.error(`❌ Failed to fetch all cards:`, error);
        throw error;
      }
    });
  }, [generateCacheKey, getCachedData, setCachedData, trackRead]);

  /**
   * INCREMENTAL CARD FETCH – only fetch cards updated after a given timestamp
   * Falls back to full fetch if sinceTimestamp is not provided or query fails.
   */
  const fetchUpdatedCards = useCallback(
    async (userId, groupId, sinceTimestamp) => {
      if (!sinceTimestamp) {
        // Fallback to full fetch (forceRefresh=false so cache may be reused)
        return fetchAllCards(userId, groupId, false);
      }

      try {
        console.log(`🃏 FETCHING UPDATED CARDS SINCE ${new Date(sinceTimestamp).toISOString()}`);

        const cardsRef = collection(db, 'cards');
        const cardsQuery = query(
          cardsRef,
          where('ownerId', '==', userId),
          where('groupId', '==', groupId),
          where('updatedAt', '>', new Date(sinceTimestamp))
        );

        const snapshot = await getDocs(cardsQuery);

        const updatedCards = [];
        snapshot.forEach(docSnap => {
          updatedCards.push({ id: docSnap.id, ...docSnap.data() });
        });

        console.log(`✅ FETCHED ${updatedCards.length} UPDATED CARDS`);

        // Merge with cached cards if available
        const cacheKey = generateCacheKey('all_cards', userId, groupId);
        const cached = await getCachedData(cacheKey, ADVANCED_CACHE_CONFIG.CARDS_TTL);
        let mergedCards = updatedCards;
        if (cached && Array.isArray(cached.cards)) {
          const cardMap = new Map(cached.cards.map(c => [c.id, c]));
          updatedCards.forEach(c => cardMap.set(c.id, c));
          mergedCards = Array.from(cardMap.values());
        }

        const mergedData = {
          cards: mergedCards,
          totalCards: mergedCards.length,
          hasMoreCards: false,
          fetchTimestamp: Date.now()
        };

        await setCachedData(cacheKey, mergedData, ADVANCED_CACHE_CONFIG.CARDS_TTL);
        return mergedData;
      } catch (err) {
        console.warn('⚠️ Incremental card fetch failed, falling back to full fetch', err);
        return fetchAllCards(userId, groupId, true);
      }
    }, [fetchAllCards, generateCacheKey, getCachedData, setCachedData, trackRead]);

  // INITIAL DATA LOAD - CONSOLIDATES ALL REQUIRED DATA
  const initializeData = useCallback(async (forceRefresh = false) => {
    if (!user?.uid || !currentGroup?.id) {
      setState(prev => ({ ...prev, loading: false }));
      return;
    }

    // GLOBAL GUARD: Prevent ALL duplicate initializations across all hook instances
    if (globalInitInProgress && !forceRefresh) {
      console.log('⏸️ GLOBAL init already in progress, returning existing promise');
      return globalInitPromise || Promise.resolve();
    }

    // LOCAL GUARD: Also check instance-level guard
    if (initializingRef.current && !forceRefresh) {
      console.log('⏸️ Instance init already in progress, returning existing promise');
      return initPromiseRef.current || Promise.resolve();
    }

    // Mark as initializing at BOTH levels
    globalInitInProgress = true;
    initializingRef.current = true;
    console.log('🔒 GLOBAL + Instance initialization guard set');

    const initPromise = (async () => {
      try {
        setState(prev => ({
          ...prev,
          loading: true,
          error: null,
          retryCount: forceRefresh ? 0 : prev.retryCount
        }));

        console.log('🚀 ULTRA-OPTIMIZED INITIALIZATION STARTING...');
        console.log(`Target: 1-2 reads (bootstrap or minimal fetch)`);

        // Set timeout to ensure loading is set to false even if fetches hang
        // CRITICAL: Always set loading=false, even if unmounted, to prevent infinite loading
        const loadTimeout = setTimeout(() => {
          console.log('⏰ Init timeout reached (10s), forcing loading=false');
          setState(prev => ({ ...prev, loading: false }));
        }, 10000); // 10 seconds timeout

        // Try bootstrap first (1 read for everything!)
        let userProfile, groupInfo, allCardsData;

        if (!forceRefresh) {
          const bootstrap = await BootstrapService.getBootPayload(user.uid, currentGroup.id);

          if (bootstrap) {
            console.log(`✅ Bootstrap successful (${bootstrap.reads} read)`);
            userProfile = bootstrap.userProfile;
            groupInfo = bootstrap.groupInfo;
            allCardsData = { cards: bootstrap.cards || [], hasMoreCards: false };

            // Fetch missing data with caching (likely 0 additional reads)
            if (!userProfile) {
              const GlobalUserProfileCache = require('../services/GlobalUserProfileCache').default;
              userProfile = await GlobalUserProfileCache.getProfile(user.uid);
            }
            if (!groupInfo) {
              const GlobalGroupCache = require('../services/GlobalGroupCache').default;
              groupInfo = await GlobalGroupCache.getGroup(currentGroup.id);
            }
          }
        }

        // Fallback: Normal fetch if no bootstrap or force refresh
        if (!allCardsData) {
          console.log('📦 No bootstrap, using normal fetch');
          const [profile, group, cards] = await Promise.all([
            fetchUserProfile(user.uid, forceRefresh),
            fetchGroupInfo(currentGroup.id, forceRefresh),
            fetchAllCards(user.uid, currentGroup.id, forceRefresh)
          ]);
          userProfile = profile;
          groupInfo = group;
          allCardsData = cards;
        }

        clearTimeout(loadTimeout);

        // Update state with all consolidated data
        console.log(`🔄 Init: About to update state with ${allCardsData.cards.length} cards`);
        console.log(`🔄 Init: Card IDs from allCardsData:`, allCardsData.cards.map(c => c.id).join(', '));

        // CRITICAL: Store cards in ref AND persistent cache FIRST (before mount check)
        // This ensures data persists even if component unmounts
        latestCardsRef.current = allCardsData.cards || [];

        // Update persistent cache for instant remounts
        persistentCardCache.cards = allCardsData.cards || [];
        persistentCardCache.userId = user.uid;
        persistentCardCache.groupId = currentGroup.id;
        persistentCardCache.timestamp = Date.now();

        console.log(`✅ Stored ${latestCardsRef.current.length} cards in ref and persistent cache`);

        // Check if component is still mounted AFTER storing in cache
        // If unmounted, the next mount will use the persistent cache
        if (!mountedRef.current) {
          console.log('⚠️ Component unmounted, but data saved to persistent cache for next mount');
          return;
        }

        // CRITICAL FIX: Direct synchronous setState (no spread, no callback)
        // This ensures the state update happens immediately and isn't lost
        const newState = {
          // Consolidated data
          cards: allCardsData.cards || [],
          userProfile,
          groupInfo,

          // Pagination state
          hasMoreCards: false,
          lastCardCursor: null,
          currentPage: 0,

          // UI state
          loading: false,
          refreshing: false,
          error: null,
          retryCount: 0,

          // Performance metrics
          readCount: globalReadCount,
          cacheHitRate: sessionCacheRequests > 0 ? sessionCacheHits / sessionCacheRequests : 0,
          backgroundSyncing: false,
          prefetchInProgress: false,
          lastSyncTime: null,
          dataFreshness: 'fresh',
          averageResponseTime: 0
        };

        console.log(`🔄 Init: Setting state with ${newState.cards.length} cards`);
        setState(newState);

        console.log(`✅ ULTRA-OPTIMIZED INITIALIZATION COMPLETE`);
        console.log(`📊 Firestore reads: ${globalReadCount} | Cache hit rate: ${(sessionCacheHits / Math.max(sessionCacheRequests, 1) * 100).toFixed(1)}%`);

        // Verify after short delay
        setTimeout(() => {
          console.log(`🔍 Init verification: State should now have ${allCardsData.cards.length} cards`);
        }, 100);

      } catch (error) {
        console.error('🚨 Initialization failed:', error);
        if (mountedRef.current) {
          handleError(error, 'initialization');
        }
      } finally {
        // Clear the initialization flags at BOTH levels
        globalInitInProgress = false;
        globalInitPromise = null;
        initializingRef.current = false;
        initPromiseRef.current = null;
        console.log('🔓 GLOBAL + Instance initialization guard released');
      }
    })();

    // Store the promise for deduplication at BOTH levels
    globalInitPromise = initPromise;
    initPromiseRef.current = initPromise;
    return initPromise;
  }, [user?.uid, currentGroup?.id, fetchUserProfile, fetchGroupInfo, fetchAllCards, handleError]);

  // INTELLIGENT BACKGROUND PREFETCH (SECOND PASS)
  const intelligentPrefetch = useCallback(async () => {
    if (!user?.uid || !currentGroup?.id || state.prefetchInProgress) return;
    
    setState(prev => ({ ...prev, prefetchInProgress: true }));
    advancedMetrics.prefetchOperations++;
    
    try {
      console.log('🧠 INTELLIGENT PREFETCH: Starting background data loading...');
      
      // Prefetch likely-needed data in background
      const prefetchPromises = [];
      
      // Prefetch user's other groups if they're in multiple groups
      if (state.userProfile?.groups?.length > 1) {
        const otherGroupIds = state.userProfile.groups
          .filter(id => id !== currentGroup.id)
          .slice(0, 2); // Max 2 other groups
        
        prefetchPromises.push(
          ...otherGroupIds.map(groupId => 
            fetchGroupInfo(groupId).catch(() => null)
          )
        );
      }
      
      await Promise.allSettled(prefetchPromises);
      
      console.log(`✅ INTELLIGENT PREFETCH: Completed ${prefetchPromises.length} background operations`);
      
    } catch (error) {
      console.warn('⚠️ Intelligent prefetch failed:', error);
    } finally {
      setState(prev => ({ ...prev, prefetchInProgress: false }));
    }
  }, [user?.uid, currentGroup?.id, state.prefetchInProgress, state.userProfile, fetchGroupInfo]);

  // BACKGROUND SYNC MANAGER (SECOND PASS)
  const backgroundSync = useCallback(async () => {
    if (!user?.uid || !currentGroup?.id || state.backgroundSyncing) return;
    
    setState(prev => ({ ...prev, backgroundSyncing: true }));
    advancedMetrics.backgroundSyncs++;
    
    try {
      console.log('🔄 BACKGROUND SYNC: Checking for data updates...');
      
      // Check if we need to update any cached data
      const cacheKeys = Array.from(cacheKeysRef.current);
      const staleKeys = [];
      
      for (const key of cacheKeys) {
        const cached = await CacheService.getValue(key);
        if (cached && cached.timestamp) {
          const age = Date.now() - cached.timestamp;
          if (age > ADVANCED_CACHE_CONFIG.DIFFERENTIAL_UPDATE_TTL) {
            staleKeys.push(key);
          }
        }
      }
      
      console.log(`🔍 Found ${staleKeys.length} stale cache entries for background sync`);
      
      // Only sync if we have stale data and user is likely active
      if (staleKeys.length > 0 && document.visibilityState === 'visible') {
        // Differential update - only fetch what's stale
        advancedMetrics.differentialUpdates++;
        const updates = await Promise.allSettled([
          fetchUserProfile(user.uid, true),
          fetchUpdatedCards(user.uid, currentGroup.id, state.lastSyncTime)
        ]);
        
        console.log(`✅ BACKGROUND SYNC: Updated ${updates.length} data sources`);
        
        setState(prev => ({ 
          ...prev, 
          lastSyncTime: Date.now(),
          dataFreshness: 'fresh' 
        }));
      }
      
    } catch (error) {
      console.warn('⚠️ Background sync failed:', error);
    } finally {
      setState(prev => ({ ...prev, backgroundSyncing: false }));
    }
  }, [user?.uid, currentGroup?.id, state.backgroundSyncing, fetchUserProfile, fetchUpdatedCards]);

  // REPLACED: zero-read manual refresh via RefreshCoordinator
  const onRefresh = useCallback(async () => {
    if (!user?.uid || !currentGroup?.id) return;

    console.log('🔄 Manual refresh - invalidating cache and fetching fresh data');

    setState(prev => ({ ...prev, refreshing: true, error: null }));

    // Set timeout to ensure refreshing is set to false even if it hangs
    const refreshTimeout = setTimeout(() => {
      setState(prev => ({ ...prev, refreshing: false }));
    }, 10000); // 10 seconds timeout

    try {
      // Step 1: Invalidate all relevant caches including cardOverview
      await RefreshCoordinator.refreshAll(user.uid, currentGroup.id);

      // Step 2: Clear ALL card-related caches to force a fresh fetch
      const cacheKeys = [
        generateCacheKey('all_cards', user.uid, currentGroup.id),
        `user_cards_${user.uid}_${currentGroup.id}`,
        `shared_user_cards_${user.uid}_${currentGroup.id}`,
        `collection_${user.uid}_${currentGroup.id}`,
        `ultra_collection_all_cards_${user.uid}_${currentGroup.id}`
      ];

      await Promise.all(cacheKeys.map(key => CacheService.invalidate(key)));
      console.log(`🧹 Invalidated ${cacheKeys.length} card caches`);

      // Step 3: Force fresh fetch with bypass of deduplication
      const freshCardsData = await fetchAllCards(user.uid, currentGroup.id, true);
      const freshUserProfile = await fetchUserProfile(user.uid, true);

      console.log(`📊 Fresh data fetched: ${freshCardsData.cards?.length || 0} cards`);
      console.log(`🔍 Card IDs:`, freshCardsData.cards?.map(c => c.id).join(', ') || 'none');
      console.log(`🔍 Card owners:`, freshCardsData.cards?.map(c => `${c.name}: ${c.ownerId}`).join(', ') || 'none');

      // Step 4: DIRECTLY update state with fresh data to ensure UI updates
      // Force a new array reference to trigger React re-render
      const newCards = Array.isArray(freshCardsData.cards) ? [...freshCardsData.cards] : [];

      console.log(`🔄 About to update state with ${newCards.length} cards`);

      // CRITICAL: Update ref first so it's available immediately
      latestCardsRef.current = newCards;
      console.log(`✅ Stored ${latestCardsRef.current.length} cards in ref after refresh`);

      setState(prev => {
        console.log(`🔄 Previous state had ${prev.cards.length} cards`);
        return {
          ...prev,
          cards: newCards,
          userProfile: freshUserProfile,
          refreshing: false,
          error: null,
          lastSyncTime: Date.now()
        };
      });

      console.log(`✅ Refresh complete: ${newCards.length} cards loaded and state updated`);
    } catch (error) {
      console.error('🚨 Refresh failed:', error);
      handleError(error, 'refresh_coordinator');
    } finally {
      clearTimeout(refreshTimeout);
      setState(prev => ({ ...prev, refreshing: false }));
    }
  }, [user?.uid, currentGroup?.id, fetchAllCards, fetchUserProfile, generateCacheKey, handleError]);

  // NO PAGINATION NEEDED - ALL CARDS LOADED AT ONCE
  const loadMoreCards = useCallback(async () => {
    console.log('📦 NO MORE CARDS TO LOAD - All cards already fetched');
    // No-op since we fetch all cards at once
    return;
  }, []);

  // OPTIMISTIC CARD REMOVAL
  const removeCard = useCallback((cardId) => {
    setState(prev => ({
      ...prev,
      cards: prev.cards.filter(card => card.id !== cardId)
    }));
    
    // Invalidate relevant caches in background
    setTimeout(() => {
      const cacheKey = generateCacheKey('all_cards', user?.uid, currentGroup?.id);
      CacheService.setValue(cacheKey, null).catch(() => {});
    }, 0);
  }, [user?.uid, currentGroup?.id, generateCacheKey]);

  // RETRY OPERATION
  const retryOperation = useCallback(async () => {
    setState(prev => ({ 
      ...prev, 
      error: null, 
      retryCount: prev.retryCount + 1 
    }));
    
    await initializeData();
  }, [initializeData]);

  // SETUP BACKGROUND SYNC TIMER (SECOND PASS) - ONLY WHEN SCREEN IS FOCUSED
  useEffect(() => {
    if (!user?.uid || !currentGroup?.id || !ADVANCED_CACHE_CONFIG.ENABLE_BACKGROUND_PREFETCH) {
      return;
    }

    const startBackgroundOperations = () => {
      // CRITICAL FIX: Only start background operations AFTER initialization completes
      // This prevents premature reads during app startup
      if (!state.loading && state.cards.length > 0) {
        // Setup background sync interval
        if (backgroundSyncTimer) clearInterval(backgroundSyncTimer);
        backgroundSyncTimer = setInterval(backgroundSync, ADVANCED_CACHE_CONFIG.BACKGROUND_SYNC_INTERVAL);

        console.log('⏰ Background sync timer started (10min intervals)');

        // Start intelligent prefetch after delay
        if (prefetchTimer) clearTimeout(prefetchTimer);
        prefetchTimer = setTimeout(intelligentPrefetch, ADVANCED_CACHE_CONFIG.PREFETCH_DELAY);
      } else if (__DEV__) {
        console.log('⏸️ Background operations deferred until initialization completes');
      }
    };

    const stopBackgroundOperations = () => {
      if (backgroundSyncTimer) {
        clearInterval(backgroundSyncTimer);
        backgroundSyncTimer = null;
        console.log('🛑 Background sync timer stopped (screen unfocused)');
      }
      if (prefetchTimer) {
        clearTimeout(prefetchTimer);
        prefetchTimer = null;
      }
    };

    // Listen to screen focus/blur events
    const unsubscribeFocus = navigation?.addListener('focus', () => {
      console.log('👀 Collection screen focused - enabling background sync');
      isScreenFocusedRef.current = true;
      startBackgroundOperations();
    });

    const unsubscribeBlur = navigation?.addListener('blur', () => {
      console.log('😴 Collection screen blurred - disabling background sync');
      isScreenFocusedRef.current = false;
      stopBackgroundOperations();
    });

    // Start operations if screen is already focused
    if (navigation?.isFocused?.()) {
      isScreenFocusedRef.current = true;
      startBackgroundOperations();
    }

    return () => {
      stopBackgroundOperations();
      unsubscribeFocus?.();
      unsubscribeBlur?.();
    };
  }, [user?.uid, currentGroup?.id, state.loading, state.cards.length, backgroundSync, intelligentPrefetch, navigation]);

  // INITIALIZE ON MOUNT AND DEPENDENCY CHANGE
  useEffect(() => {
    // Reset mounted flag
    mountedRef.current = true;

    if (!user?.uid || !currentGroup?.id) {
      console.log('⏸️ No user or group, skipping initialization');
      return;
    }

    // Check persistent cache first (survives unmounts)
    const cacheAge = Date.now() - persistentCardCache.timestamp;
    const isCacheValid = persistentCardCache.userId === user.uid &&
                         persistentCardCache.groupId === currentGroup.id &&
                         persistentCardCache.cards.length > 0 &&
                         cacheAge < 60000; // 1 minute

    if (isCacheValid) {
      console.log(`⚡ INSTANT LOAD: Using persistent cache with ${persistentCardCache.cards.length} cards (${Math.round(cacheAge/1000)}s old)`);

      // Restore from persistent cache with DIRECT state update
      latestCardsRef.current = persistentCardCache.cards;
      setState(prev => ({
        ...prev,
        cards: persistentCardCache.cards,
        loading: false
      }));

      console.log('✅ Cache loaded, skipping initialization');
      return; // CRITICAL: Stop here
    }

    // STRICT: Only initialize if NOT already initializing
    if (initializingRef.current) {
      console.log('⏸️ Initialization already running, skipping duplicate call');
      return;
    }

    console.log('🆕 No cache, starting initialization');
    initializeData().catch(err => {
      console.error('Initialization error in useEffect:', err);
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, currentGroup?.id]); // Only re-run when user or group changes

  // CLEANUP ON UNMOUNT
  useEffect(() => {
    return () => {
      mountedRef.current = false;

      // Cleanup timers
      if (backgroundSyncTimer) clearInterval(backgroundSyncTimer);
      if (prefetchTimer) clearTimeout(prefetchTimer);

      // DON'T clear latestCardsRef - keep it for fast remount
      if (__DEV__) {
        console.log('🧹 Cleanup: Timers cleared, keeping cards in ref for fast remount');
      }
    };
  }, []);

  // RETURN ENHANCED API WITH SECOND PASS FEATURES
  // CRITICAL FIX: Use ref if state is empty but ref has cards (async setState issue)
  const cardsToReturn = state.cards.length > 0 ? state.cards : latestCardsRef.current;

  // Log what we're returning to help debug
  if (__DEV__) {
    console.log(`🎁 useUltraOptimizedCollectionData returning ${cardsToReturn.length} cards to component (state: ${state.cards.length}, ref: ${latestCardsRef.current.length})`);
  }

  return {
    // Consolidated data
    cards: cardsToReturn,
    userProfile: state.userProfile,
    groupInfo: state.groupInfo,
    
    // State flags
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
    retryCount: state.retryCount,
    maxRetries,
    hasMoreCards: false, // Always false since we load everything
    
    // Advanced state (second pass)
    backgroundSyncing: state.backgroundSyncing,
    prefetchInProgress: state.prefetchInProgress,
    dataFreshness: state.dataFreshness,
    lastSyncTime: state.lastSyncTime,
    
    // Optimized operations
    onRefresh,
    loadMoreCards,
    removeCard,
    handleError,
    retryOperation,
    
    // Advanced operations (second pass)
    forceBackgroundSync: backgroundSync,
    intelligentPrefetch,
    
    // Enhanced performance metrics
    readCount: state.readCount,
    cacheHitRate: state.cacheHitRate,
    averageResponseTime: state.averageResponseTime,
    backgroundSyncs: advancedMetrics.backgroundSyncs,
    prefetchOperations: advancedMetrics.prefetchOperations,
    differentialUpdates: advancedMetrics.differentialUpdates,
    memoryOptimizations: advancedMetrics.memoryOptimizations
  };
};
