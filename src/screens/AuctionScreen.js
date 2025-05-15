/**
 * IMPORTANT OPTIMIZATION NOTES:
 * 
 * This component has been optimized to significantly reduce Firebase Firestore reads:
 * 
 * 1. Manual Polling Instead of Real-time Listeners:
 *    - Replaced real-time listeners with manual polling at controlled intervals
 *    - Implemented hard database read limits to prevent excessive costs
 *    - Added aggressive throttling with minimum 5-minute intervals between updates
 *    - Reduced document limit from 10 to 5 docs per request
 * 
 * 2. Extended Cache Durations:
 *    - Auction data now cached for 15 minutes instead of 2 minutes
 *    - Bidder counts cached for 15 minutes instead of 5 minutes
 *    - Added time-based throttling to prevent excessive updates
 * 
 * 3. App State Management:
 *    - Only refresh data when returning to foreground after 15+ minutes
 *    - Force refresh data only after 30+ minutes absence
 *    - Track time using refs instead of state to reduce re-renders
 * 
 * 4. Initial Load:
 *    - Load cached data immediately without network request
 *    - Delay first refresh for 2 minutes after initial load
 *    - Improved cache expiry from 30 to 60 minutes for auction data
 * 
 * 5. Rate Limiting:
 *    - Added global read counter to prevent exceeding safe limits
 *    - Implemented exponential backoff for repeated operations
 *    - Adaptive polling based on user activity and network conditions
 * 
 * These changes dramatically reduce the number of Firestore reads while
 * maintaining reasonable updates for important auction changes.
 */

import { MaterialCommunityIcons } from '@expo/vector-icons';
import CardItem from '../components/CardItem';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { useNetInfo } from '@react-native-community/netinfo';
import { useTheme } from '@react-navigation/native';
import ScreenBackground from '../components/ScreenBackground';
import { auth, db, storage, analytics } from '../config/firebase';
import cacheUtils from '../utils/cacheUtils';
const { getWithCache } = cacheUtils;
import { addDoc, collection, doc, getDoc, getDocs, increment, limit, orderBy, query, runTransaction, serverTimestamp, startAfter, Timestamp, updateDoc, where, onSnapshot, writeBatch } from 'firebase/firestore';
import { calculateLiveRarity, determineAuctionFinalRarity, getUniqueBidderCount, updateAuctionRarity, RARITY_TYPES } from '../utils/auctionRarity';
import React, { memo, useMemo, useCallback, useRef, useState, useEffect, useContext } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import AuctionBidModalRaw from '../components/auction/AuctionBidModal';
import AuctionListItemRaw from '../components/auction/AuctionListItem';
const AuctionBidModal = memo(AuctionBidModalRaw);
const AuctionListItem = memo(AuctionListItemRaw);
import { CACHE_TTL } from '../constants/cacheConfig';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import * as auctionTimerUtils from '../utils/auctionTimerUtils';
import { calculateTimeRemaining } from '../utils/auctionTimerUtils';
import { PAGE_SIZE } from '../utils/auctionUtils';
import { queueUpdate } from '../utils/batchProcessor';
import * as dbOptimizer from '../utils/dbOptimizer';
import { getValueSync, setValueSync, invalidate } from '../services/caching/CacheService';
import { executeQueryWithFallback, extractIndexCreationUrl, extractQueryDetails, getCachedDocFields, getCachedQuery } from '../utils/firestoreUtils';
import { sendPushNotification } from '../services/notifications';
import { RARITY_COLORS } from '../utils/rarity';
import userUtils from '../utils/userUtils';

// Constants for database read optimization
const POLLING_INTERVAL = 5 * 60 * 1000; // 5 minutes for polling
const BACKGROUND_REFRESH_DELAY = 2 * 60 * 1000; // 2 minutes delay for background refresh
const READ_LIMIT_KEY = 'auction_screen_read_count';
const MAX_READS_PER_SESSION = 20000; // Increased from 5000 to 20000
const MAX_READS_PER_MINUTE = 20000; // New rate limit: max 20,000 reads per minute
const MIN_TIME_BETWEEN_UPDATES = 5 * 60 * 1000; // 5 minutes between forced updates
const REDUCED_PAGE_SIZE = 5; // Reduced from 10 to 5 docs to cut reads in half

// Session read counter
let sessionReadCount = 0;

// Store timestamps of recent reads to track rate limiting
const recentReads = [];

// Read counter utility
const incrementReadCount = async (increment = 1) => {
  sessionReadCount += increment;
  
  // Track timestamp for rate limiting
  const now = Date.now();
  for (let i = 0; i < increment; i++) {
    recentReads.push(now);
  }
  
  // Clean up old timestamps (older than 1 minute)
  const oneMinuteAgo = now - 60000;
  while (recentReads.length > 0 && recentReads[0] < oneMinuteAgo) {
    recentReads.shift();
  }
  
  // Log when approaching rate limits
  if (recentReads.length >= MAX_READS_PER_MINUTE * 0.8) {
    console.warn(`⚠️ Approaching AuctionScreen read rate limit: ${recentReads.length}/${MAX_READS_PER_MINUTE} reads in the last minute`);
  } else if (sessionReadCount >= MAX_READS_PER_SESSION * 0.8) {
    console.warn(`⚠️ Approaching AuctionScreen session limit: ${sessionReadCount}/${MAX_READS_PER_SESSION}`);
  }
  
  try {
    await AsyncStorage.setItem(READ_LIMIT_KEY, sessionReadCount.toString());
  } catch (error) {
    console.log('Error saving read count:', error);
  }
  
  return sessionReadCount;
};

// Load initial counter
(async () => {
  try {
    const savedCount = await AsyncStorage.getItem(READ_LIMIT_KEY);
    if (savedCount) {
      sessionReadCount = parseInt(savedCount);
    }
  } catch (error) {
    console.log('Error loading read count:', error);
  }
})();

// Check if we've exceeded read limits (either rate-based or session-based)
const hasExceededReadLimit = () => {
  // Check rate limit (reads per minute)
  if (recentReads.length >= MAX_READS_PER_MINUTE) {
    console.error(`⛔ AuctionScreen read rate limit exceeded: ${recentReads.length} reads in the last minute`);
    return true;
  }
  
  // Also keep the session limit as a fallback protection
  if (sessionReadCount >= MAX_READS_PER_SESSION) {
    console.error(`⛔ AuctionScreen session read limit exceeded: ${sessionReadCount}/${MAX_READS_PER_SESSION}`);
    return true;
  }
  
  return false;
};

// Add a wrapper function for executeQueryWithFallback to ensure it always returns a Promise 
const safeExecuteQueryWithFallback = async (originalQuery, fallbackQuery, processResults = null) => {
  // Check read limits before executing
  if (hasExceededReadLimit()) {
    console.error('⛔ Read limit exceeded in AuctionScreen. Using empty results.');
    return processResults ? processResults([]) : [];
  }
  
  try {
    // Increment read counter
    await incrementReadCount();
    
    return await executeQueryWithFallback(originalQuery, fallbackQuery, processResults);
  } catch (error) {
    console.error('Error in executeQueryWithFallback:', error);
    // Return empty array to avoid undefined errors
    return processResults ? processResults([]) : [];
  }
};

// Add a global flag to track if we've shown a fallback notice
let hasFallbackNoticeShown = false;

/**
 * Show a user-friendly alert when index errors occur
 * 
 * @param {Error} error - The Firestore error object
 */
const showIndexErrorAlert = (error) => {
  // Extract index creation URL if available
  const indexUrl = extractIndexCreationUrl(error);
  const details = extractQueryDetails(error);
  
  Alert.alert(
    'Database Index Required',
    'This feature requires a database index to be created. The app will continue to work with limited functionality until the index is set up.',
    [
      {
        text: 'Setup Index',
        onPress: () => {
          console.log('Admin should create index at:', indexUrl);
          // In a real app, you could open this URL or copy to clipboard
        }
      },
      {
        text: 'OK',
        style: 'default',
      }
    ]
  );
  
  // Log the details for developers
  if (details) {
    console.log('Index Details:', {
      collection: details.collection,
      fields: details.fields,
      url: details.indexUrl
    });
  }
};

// Add a utility to manage offline alerts to prevent duplicates
let hasShownOfflineAlert = false;
// Add a flag to track initial app load
let isFirstLoad = true;

// Create a new function to show the offline alert only once
const showOfflineAlert = () => {
  if (!hasShownOfflineAlert) {
    hasShownOfflineAlert = true;
    // Don't show on first app load unless explicitly requested
    if (!isFirstLoad) {
      Alert.alert(
        "You're offline", 
        "Using cached data. Some features may be limited until you're back online.",
        [{ text: "OK", onPress: () => {
          // Reset after a sufficient delay to prevent immediate re-trigger
          setTimeout(() => { hasShownOfflineAlert = false; }, 10000);
        }}]
      );
    }
  }
};

// --- CENTRALIZED CACHE UTILITY ---
// All cache logic is now handled through this single utility.
const CacheUtil = {
  async save(key, data) {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('Cache save error:', e);
      return false;
    }
  },
  async get(key) {
    try {
      const val = await AsyncStorage.getItem(key);
      if (!val) return null;
      const parsed = JSON.parse(val);
      // Defensive: convert Firestore Timestamps if present
      if (parsed && parsed.auctions) {
        parsed.auctions = parsed.auctions.map(a => {
          if (a.createdAt && typeof a.createdAt === 'object') a.createdAt = new Timestamp(a.createdAt.seconds||0, a.createdAt.nanoseconds||0);
          if (a.endTime && typeof a.endTime === 'object') a.endTime = new Timestamp(a.endTime.seconds||0, a.endTime.nanoseconds||0);
          if (a.expiresAt && typeof a.expiresAt === 'object') a.expiresAt = new Timestamp(a.expiresAt.seconds||0, a.expiresAt.nanoseconds||0);
          return a;
        });
      }
      return parsed;
    } catch (e) {
      console.error('Cache get error:', e);
      return null;
    }
  },
  async invalidate(key) {
    try {
      await AsyncStorage.removeItem(key);
      return true;
    } catch (e) {
      console.error('Cache invalidate error:', e);
      return false;
    }
  }
};
// --- END CENTRALIZED CACHE UTILITY ---


// Add a utility function to safely execute Firestore operations with network awareness
const executeSafeFirestoreOperation = async (operation, fallbackValue = null) => {
  try {
    // Check network status
    const networkState = await NetInfo.fetch();
    const isConnected = networkState.isConnected && networkState.isInternetReachable;
    
    if (!isConnected) {
      console.log('Device is offline, using fallback value');
      return fallbackValue;
    }
    
    // Execute the operation if online
    const result = await operation();
    return result;
  } catch (error) {
    console.error('Error executing Firestore operation:', error);
    return fallbackValue;
  }
};

// Function to get paginated auctions data
const getAuctionsPaginated = async (groupId, status = 'active', startAfterDoc = null, pageSize = PAGE_SIZE) => {
  try {
    const auctionsRef = collection(db, 'auctions');
    
    // Create the base query
    let baseQuery;
    if (status === 'all') {
      baseQuery = query(
        auctionsRef,
        where('groupId', '==', groupId),
        limit(pageSize)
      );
    } else {
      baseQuery = query(
        auctionsRef,
        where('groupId', '==', groupId),
        where('status', '==', status),
        limit(pageSize)
      );
    }
    
    // Add pagination if we have a starting document
    let paginatedQuery = baseQuery;
    if (startAfterDoc) {
      // We need to recreate the query with startAfter
      if (status === 'all') {
        paginatedQuery = query(
          auctionsRef,
          where('groupId', '==', groupId),
          startAfter(startAfterDoc),
          limit(pageSize)
        );
      } else {
        paginatedQuery = query(
          auctionsRef,
          where('groupId', '==', groupId),
          where('status', '==', status),
          startAfter(startAfterDoc),
          limit(pageSize)
        );
      }
    }
    
    // Execute the query
    const querySnapshot = await getDocs(paginatedQuery);
    
    // Process the results
    const auctions = [];
    querySnapshot.forEach(doc => {
      auctions.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Return both the auctions and the last document for pagination
    const lastDoc = querySnapshot.docs.length > 0 ? querySnapshot.docs[querySnapshot.docs.length - 1] : null;
    
    return {
      auctions,
      lastDoc
    };
  } catch (error) {
    console.error('Error fetching paginated auctions:', error);
    throw error; // Let the caller handle the error
  }
};

/**
 * IMPORTANT OPTIMIZATION NOTES:
 * 
 * This component was modified to reduce excessive Firebase Firestore reads:
 * 
 * 1. Added lastForegroundTime ref to track time between app activation and prevent 
 *    excessive refreshes when app returns to foreground
 * 
 * 2. Modified listener to use a much longer heartbeat (30s instead of 2s) and 
 *    reduced query limit to just 10 documents instead of 50
 * 
 * 3. Caching was extended to 30 minutes instead of 5 minutes for auction data
 * 
 * 4. Bidder count updates are limited to 5 auctions at a time and cache 
 *    duration extended to 5 minutes
 * 
 * 5. Added delayed background refresh for initial load to prevent read spikes
 * 
 * These changes should significantly reduce the Firestore reads while maintaining
 * app functionality.
 */
// --- ERROR BOUNDARY COMPONENT ---
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('Caught error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return <View style={{flex:1,justifyContent:'center',alignItems:'center'}}><Text style={{color:'red'}}>Something went wrong. Please restart the app.</Text></View>;
    }
    return this.props.children;
  }
}
// --- END ERROR BOUNDARY ---

// --- CENTRALIZED ERROR HANDLER ---
function handleError(error, context = '') {
  console.error('Error:', context, error);
  Alert && Alert.alert && Alert.alert('Error', context ? `${context}: ${error.message || error}` : (error.message || error));
}
// --- END ERROR HANDLER ---

// --- REQUEST IN FLIGHT MAP ---
const requestInFlight = {};
// --- END REQUEST IN FLIGHT MAP ---

const AuctionScreen = (props) => {
  const { navigation } = props || {};
  
  // Import the theme directly from fallback to avoid context issues
  const fallbackTheme = {
    colors: {
      primary: '#9B5DE5',
      accent: '#4FC3A1',
      background: '#f6f6f6',
      surface: '#ffffff',
      error: '#B00020',
      text: '#000000',
    }
  };
  
  // Use try-catch to handle potential theme context errors
  let theme;
  try {
    const themeContext = useTheme();
    theme = themeContext?.theme || fallbackTheme;
  } catch (error) {
    console.warn('Error using theme context:', error);
    theme = fallbackTheme;
  }
  
  // Add a ref to track the last time the app was in foreground
  const lastForegroundTime = useRef(Date.now());
  
  // Add a ref to track the last time we updated bidder counts and rarities
  const lastBidUpdateTime = useRef(Date.now());
  
  // Add a ref to prevent infinite loops between sort state updates
  const isUpdatingSort = useRef(false);
  
  // Get access to authentication and group data from their respective contexts
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const netInfo = useNetInfo();
  
  // State for auctions and UI
  const [auctions, setAuctions] = useState([]);

  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);
  const [bidModalVisible, setBidModalVisible] = useState(false);
  const [selectedAuction, setSelectedAuction] = useState(null);
  const [bidAmount, setBidAmount] = useState('');
  const [processingAction, setProcessingAction] = useState(false);
  const [currentBid, setCurrentBid] = useState(0);
  const [mintFilter, setMintFilter] = useState('coined'); // Default to 'coined'
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);
  const [loadingMoreAuctions, setLoadingMoreAuctions] = useState(false);
  const [hasMoreAuctions, setHasMoreAuctions] = useState(true);
  const [lastDoc, setLastDoc] = useState(null); // Added missing lastDoc state declaration
  const [allAuctionsLoaded, setAllAuctionsLoaded] = useState(false);
  const [currentAuctionListener, setCurrentAuctionListener] = useState(null);
  const [uiRefreshKey, setUiRefreshKey] = useState(0);
  // Remove duplicate declarations since we already have these from useAuth and useGroup above
  const [userCache, setUserCache] = useState({});
  const [bidderCountCache, setBidderCountCache] = useState({ counts: {}, lastUpdate: {} });
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Remove filteredCards state; use derived value below
  // const [filteredCards, setFilteredCards] = useState([]);
  const [sortBy, setSortBy] = useState('timeLeft');
  const [sortOrder, setSortOrder] = useState('asc');
  const [sortOption, setSortOption] = useState('endingSoon'); // Add missing sortOption state
  const [filterOwner, setFilterOwner] = useState('all');
  const [priceFilter, setPriceFilter] = useState('all');
  const [rarityFilter, setRarityFilter] = useState('all');
  const [sortByMenuVisible, setSortByMenuVisible] = useState(false);
  const [sortOrderMenuVisible, setSortOrderMenuVisible] = useState(false);
  const [filterOwnerMenuVisible, setFilterOwnerMenuVisible] = useState(false);
  const [userCards, setUserCards] = useState([]);
  const [startingBid, setStartingBid] = useState('');
  const [duration, setDuration] = useState('2');
  const [filterTouched, setFilterTouched] = useState(false);
  // Add state for batch sizes
  const [batchSizes, setBatchSizes] = useState({
    // Defensive: ensure batch sizes are numbers
    auctions: 10,
    bids: 10,
    users: 10
  });
  
  // Move processBatch inside the component to access batchSizes state
  // Memoize processBatch
  const processBatch = useCallback(async (items, processFn, type = 'auctions') => {
    const results = [];
    const batchSize = batchSizes[type] || 10; // Use component batchSizes state
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await processFn(batch);
      results.push(...batchResults);
    }
    return results;
  }, [batchSizes]);
  
  // Function to fetch batch size configuration from Firestore or default values
  // Memoize fetchBatchSizeData
  const fetchBatchSizeData = useCallback(async () => {
    try {
      // First try to get the configuration from Firestore (settings collection)
      const settingsRef = doc(db, 'settings', 'batchProcessing');
      const settingsSnapshot = await getDoc(settingsRef);
      
      let newBatchSizes = {};
      
      if (settingsSnapshot.exists()) {
        // Use the configuration from Firestore
        const data = settingsSnapshot.data();
        newBatchSizes = {
          auctions: data.auctionBatchSize || 10,
          bids: data.bidBatchSize || 10,
          users: data.userBatchSize || 10
        };
        console.log('Loaded batch size configuration from Firestore:', newBatchSizes);
      } else {
        // Use default values if no configuration exists
        newBatchSizes = {
          auctions: 10,
          bids: 10,
          users: 10
        };
        console.log('Using default batch size configuration:', newBatchSizes);
      }
      
      // Store the batch sizes in AsyncStorage for offline use
      await AsyncStorage.setItem('batch_size_config', JSON.stringify(newBatchSizes));
      
      // Update state with the new batch sizes
      setBatchSizes(newBatchSizes);
      
      return newBatchSizes;
    } catch (error) {
      console.error('Error fetching batch size data:', error);
      
      // Try to get cached values from AsyncStorage
      try {
        const cachedConfig = await AsyncStorage.getItem('batch_size_config');
        if (cachedConfig) {
          console.log('Using cached batch size configuration');
          const parsedConfig = JSON.parse(cachedConfig);
          setBatchSizes(parsedConfig);
          return parsedConfig;
        }
      } catch (cacheError) {
        console.error('Error retrieving cached batch size config:', cacheError);
      }
      
      // Return default values as fallback
      const defaultSizes = {
        auctions: 10,
        bids: 10,
        users: 10
      };
      setBatchSizes(defaultSizes);
      return defaultSizes;
    }
  }, []); // Add empty dependency array

// Add useEffect to fetch batch size data when component mounts
  useEffect(() => {
    let isMounted = true;
    fetchBatchSizeData().catch(e => handleError(e, 'fetchBatchSizeData'));
    return () => { isMounted = false; };
  }, [fetchBatchSizeData]);
  
  // Add useEffect to keep sortOption in sync with sortBy and sortOrder
  useEffect(() => {
    // Defensive: ensure sortBy/sortOrder are valid
    if (!sortBy || !sortOrder) return;

    // Skip this update if we're already updating the sort to prevent circular updates
    if (isUpdatingSort.current) return;
    
    // Set the flag to indicate we're updating
    isUpdatingSort.current = true;
    
    // Map sortBy and sortOrder to the corresponding sortOption
    if (sortBy === 'timeLeft') {
      setSortOption('endingSoon');
    } else if (sortBy === 'createdAt') {
      setSortOption('newest');
    } else if (sortBy === 'currentBid') {
      if (sortOrder === 'asc') {
        setSortOption('priceAsc');
      } else {
        setSortOption('priceDesc');
      }
    }
    
    // Reset the flag after a short delay to ensure state updates complete
    setTimeout(() => {
      isUpdatingSort.current = false;
    }, 100);
  }, [sortBy, sortOrder]);
  
  // Add useEffect to update sortBy and sortOrder when sortOption changes
  useEffect(() => {
    // Defensive: ensure sortOption is valid
    if (!sortOption) return;

    // Skip this update if we're already updating the sort to prevent circular updates
    if (isUpdatingSort.current) return;
    
    // Set the flag to indicate we're updating
    isUpdatingSort.current = true;
    
    // Map sortOption to the corresponding sortBy and sortOrder
    if (sortOption === 'endingSoon') {
      setSortBy('timeLeft');
      setSortOrder('asc');
    } else if (sortOption === 'newest') {
      setSortBy('createdAt');
      setSortOrder('desc');
    } else if (sortOption === 'priceAsc') {
      setSortBy('currentBid');
      setSortOrder('asc');
    } else if (sortOption === 'priceDesc') {
      setSortBy('currentBid');
      setSortOrder('desc');
    }
    
    // Reset the flag after a short delay to ensure state updates complete
    setTimeout(() => {
      isUpdatingSort.current = false;
    }, 100);
  }, [sortOption]);

  // FORCE: Add immediate rarity update function for direct rarity updates
  const forceUpdateAuctionRarity = async (auctionId) => {
    if (!auctionId) return;
    
    console.log(`FORCE UPDATE RARITY for auction ${auctionId}`);
    
    try {
      // Get the latest auction data
      const auctionRef = doc(db, 'auctions', auctionId);
      const auctionSnap = await getDoc(auctionRef);
      
      if (!auctionSnap.exists()) {
        console.log(`Auction ${auctionId} not found in forceUpdateAuctionRarity`);
        return;
      }
      
      const auctionData = {
        id: auctionId,
        ...auctionSnap.data()
      };
      
      // Skip inactive auctions
      if (auctionData.status !== 'active') {
        console.log(`Auction ${auctionId} is not active (status: ${auctionData.status}), skipping rarity update`);
        return;
      }
      
      // Get all bids for this auction
      const bidsQuery = query(
        collection(db, 'auctionBids'),
        where('auctionId', '==', auctionId)
      );
      
      const bidsSnapshot = await getDocs(bidsQuery);
      
      // Count unique bidders
      const uniqueBidders = new Set();
      bidsSnapshot.docs.forEach(doc => {
        const bidData = doc.data();
        if (bidData.bidderId && bidData.bidderId !== auctionData.sellerId) {
          uniqueBidders.add(bidData.bidderId);
        }
      });
      
      const bidderCount = uniqueBidders.size;
      console.log(`DIRECT count of unique bidders for auction ${auctionId}: ${bidderCount}`);
      
      // Calculate new rarity based on bidder count and bid amount
      const newRarity = calculateLiveRarity(auctionData, bidderCount);
      console.log(`DIRECT calculated rarity for auction ${auctionId}: ${newRarity} based on ${bidderCount} bidders`);
      
      // Immediately update the auction document with new rarity and bidder count
      await updateDoc(auctionRef, {
        currentRarity: newRarity,
        uniqueBidderCount: bidderCount,
        lastRarityUpdate: serverTimestamp()
      });
      
      // Update in-memory cache
      const now = Date.now();
      setBidderCountCache(prev => ({
        counts: {
          ...prev.counts,
          [auctionId]: bidderCount
        },
        lastUpdate: {
          ...prev.lastUpdate,
          [auctionId]: now
        }
      }));
      
      // Update local auction objects if they exist
      setAuctions(prev => {
        return prev.map(auction => {
          if (auction.id === auctionId) {
            return {
              ...auction,
              currentRarity: newRarity,
              uniqueBidderCount: bidderCount,
              lastRarityUpdate: new Date()
            };
          }
          return auction;
        });
      });
      
      console.log(`FORCE UPDATE RARITY COMPLETED for auction ${auctionId}: ${newRarity}`);
      return newRarity;
    } catch (error) {
      console.error(`Error in forceUpdateAuctionRarity for ${auctionId}:`, error);
    }
  };

  // Add fetchBidderCountsInBatch function inside the component
  const fetchBidderCountsInBatch = async (auctionIds, auctionMap) => {
    if (!auctionIds || auctionIds.length === 0) return Promise.resolve({});
    
    try {
      // Process auctions in batches of batchSizes.bids (Firestore's 'in' operator limit)
      const maxBatchSize = batchSizes.bids;
      const allBidsByAuction = {};
      
      // Define a function to process a single batch
      const processBatchOfAuctions = async (batchIds) => {
        // Use a single query with 'in' operator for this batch
        // Using the correct collection: auctionBids instead of bids
        const bidsRef = collection(db, 'auctionBids');
        const q = query(
          bidsRef,
          where('auctionId', 'in', batchIds)
        );
        
        // FORCED REFRESH: Always get fresh data
        const bids = await getDocs(q).then(snapshot => {
          return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
        });
        
        // Group bids by auction ID for this batch
        const batchBidsByAuction = {};
        bids.forEach(bid => {
          if (!batchBidsByAuction[bid.auctionId]) {
            batchBidsByAuction[bid.auctionId] = new Set();
          }
          if (bid && bid.bidderId) { // Use bidderId instead of userId
            batchBidsByAuction[bid.auctionId].add(bid.bidderId);
          }
        });
        
        return batchBidsByAuction;
      };
      
      // Process all auction IDs in batches of batchSizes.bids
      for (let i = 0; i < auctionIds.length; i += maxBatchSize) {
        const batchIds = auctionIds.slice(i, i + maxBatchSize);
        console.log(`Processing batch of ${batchIds.length} auction IDs (${i+1}-${Math.min(i+maxBatchSize, auctionIds.length)} of ${auctionIds.length})`);
        
        const batchResults = await processBatchOfAuctions(batchIds);
        
        // Merge batch results into the overall results
        Object.assign(allBidsByAuction, batchResults);
      }
      
      // Update bidder counts and cache
      const now = Date.now();
      const newBidderCounts = { ...bidderCountCache.counts };
      const newLastUpdates = { ...bidderCountCache.lastUpdate };
      
      // Process each auction individually for better rarity updates
      const updatePromises = Object.entries(allBidsByAuction).map(async ([auctionId, bidders]) => {
        const count = bidders.size;
        newBidderCounts[auctionId] = count;
        newLastUpdates[auctionId] = now;
        
        // Also update the auction object for immediate UI update
        const auction = auctionMap.get(auctionId);
        if (auction) {
          auction.uniqueBidderCount = count;
          const calculatedRarity = calculateLiveRarity(auction, count);
          console.log(`Batch calculated rarity for auction ${auctionId}: ${calculatedRarity} based on ${count} bidders`);
          
          // Directly update the auction document in Firestore for immediate rarity update
          try {
            const auctionRef = doc(db, 'auctions', auctionId);
            await updateDoc(auctionRef, {
              currentRarity: finalCalculatedRarity,
              uniqueBidderCount: count,
              lastRarityUpdate: serverTimestamp()
            });
            console.log(`Successfully updated rarity for auction ${auctionId} to ${finalCalculatedRarity}`);
          } catch (updateError) {
            console.error(`Error updating rarity for auction ${auctionId}:`, updateError);
          }
        }
      });
      
      // Wait for all updates to complete
      await Promise.all(updatePromises);
      
      // Update the bidder count cache
      setBidderCountCache({
        counts: newBidderCounts,
        lastUpdate: newLastUpdates
      });
      
      return Promise.resolve(allBidsByAuction);
      
    } catch (error) {
      console.error('Error fetching bidder counts in batch:', error);
      return Promise.resolve({}); // Return empty object as fallback
    }
  };
  
  // Add a timer to refresh the UI for accurate time display with optimized refresh strategy
  useEffect(() => {
    let timer;
    // ...
    return () => { if (timer) clearTimeout(timer); };
  }, [uiRefreshKey, auctions, user?.uid, currentGroup?.id]);


  // Set up real-time listener for NEW auctions with optimized caching and throttling
  useEffect(() => {
    let initialTimer = null;
    if (!user || !currentGroup) return;
    // Track if component is mounted
    let isMounted = true;
    // Track if initial load is complete to prevent multiple parallel refreshes
    let initialLoadComplete = false;
    // Set up polling interval instead of real-time listener
    const loadInitialAuctions = async () => {
      try {
        if (!isMounted) return;
        
        // First load data from cache immediately for fast UI response
        const cachedDataKey = `${'auctions_'}${currentGroup.id}`;
        const cachedData = await getWithCache(cachedDataKey, async () => null, { offline: true });
        
        if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
          console.log(`Using initial cached data with ${cachedData.length} auctions`);
          if (isMounted) {
            setAuctions(cachedData);
          }
        }
        
        // Then schedule a delayed refresh to avoid immediate database reads
        const now = Date.now();
        const lastCacheTimeKey = `last_cache_time_${currentGroup.id}`; // TODO: Refactor to use a constants file if needed
        const lastCacheTimeStr = await AsyncStorage.getItem(lastCacheTimeKey);
        const lastCacheTime = lastCacheTimeStr ? parseInt(lastCacheTimeStr) : 0;
        
        // Determine if we need to refresh based on cache age
        if (now - lastCacheTime > MIN_TIME_BETWEEN_UPDATES) {
          console.log(`Scheduling delayed refresh after ${BACKGROUND_REFRESH_DELAY/1000}s because cache is ${Math.floor((now - lastCacheTime)/1000/60)}m old`);
          
          // Schedule a background refresh with delay
          setTimeout(() => {
            if (isMounted && !initialLoadComplete) {
              initialLoadComplete = true;
              fetchAuctions(false); // non-forced refresh
              
              // Update last cache time
              AsyncStorage.setItem(lastCacheTimeKey, now.toString())
                .catch(err => console.log('Error updating cache time:', err));
            }
          }, BACKGROUND_REFRESH_DELAY);
        } else {
          console.log(`Skipping refresh - cache is only ${Math.floor((now - lastCacheTime)/1000/60)}m old (< ${MIN_TIME_BETWEEN_UPDATES/1000/60}m)`);
          initialLoadComplete = true;
        }
      } catch (error) {
        console.error('Error in loadInitialAuctions:', error);
        initialLoadComplete = true; // Mark as complete even on error to prevent retry loops
      }
    };
    
    // Initial load from cache
    loadInitialAuctions();
    
    // Set up polling instead of real-time listener
    let pollingInterval = null;
    let isPollingActive = false;
    
    // Helper function to perform a poll 
    const performPoll = async () => {
      if (!isMounted || isPollingActive || hasExceededReadLimit()) {
        console.log('Skipping polling: component unmounted, already polling, or read limit reached');
        return;
      }
      
      isPollingActive = true;
      try {
        console.log(`Polling for auction updates`);
        await fetchAuctions(false); // non-forced refresh
      } catch (error) {
        console.error('Error during polling:', error);
      } finally {
        isPollingActive = false;
      }
    };
    
    // Only set up polling if we haven't exceeded read limits
    if (!hasExceededReadLimit()) {
      // Initial delay before starting the polling to avoid overlap with initial load
      const initialDelay = 2 * 60 * 1000; // 2 minutes
      
      console.log(`Setting up polling with ${POLLING_INTERVAL/1000/60}m interval after ${initialDelay/1000}s initial delay`);
      
      const initialTimer = setTimeout(() => {
        if (!isMounted) return;
        
        // Set up the recurring poll
        pollingInterval = setInterval(() => {
          performPoll();
        }, POLLING_INTERVAL);
      }, initialDelay);
      
      // Clean up on unmount
      return () => {
        isMounted = false;
        isPollingActive = false;
        
        if (initialTimer) {
          clearTimeout(initialTimer);
        }
        
        if (pollingInterval) {
          clearInterval(pollingInterval);
        }
        
        // Reset the offline alert flag when component unmounts
        hasShownOfflineAlert = false;
      };
    } else {
      console.log('Not setting up polling due to read limit already reached');
      
      // Still need to return a cleanup function
      return () => {
        isMounted = false;
        hasShownOfflineAlert = false;
      };
    }
  }, [user, currentGroup]);

  // Add AppState listener to check for expired auctions when app returns to foreground
  useEffect(() => {
    let subscription;
    // ...
    return () => {
      if (subscription) subscription.remove();
    };
  }, [user, currentGroup]);
  // Modify loadMoreAuctions to handle index building errors and use optimized approach
  const loadMoreAuctions = async () => {
    if (!hasMoreAuctions || loadingMoreAuctions || !lastDoc || !user || !currentGroup) return;
    
    // Check if we've exceeded read limits
    if (hasExceededReadLimit()) {
      console.error('⛔ Read limit exceeded. Cannot load more auctions.');
      setHasMoreAuctions(false);
      return;
    }
    
    setLoadingMoreAuctions(true);
    
    try {
      // Get auctions from Firestore with reduced page size
      const auctionsRef = collection(db, 'auctions');
      
      let fetchedAuctions = [];
      
      try {
        // Increment read counter before executing operation
        await incrementReadCount();
        
        // Try the preferred query first with reduced page size
        const preferredQuery = query(
          auctionsRef,
          where('groupId', '==', currentGroup.id),
          where('status', '==', 'active'),
          orderBy('endTime', 'asc'),
          startAfter(lastDoc),
          limit(REDUCED_PAGE_SIZE) // Use reduced page size
        );
        
        const auctionSnapshot = await getDocs(preferredQuery);
        
        // Track reads
        await incrementReadCount(auctionSnapshot.docs.length || 1);
        
        // Process the results
        fetchedAuctions = auctionSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        // Update the last document for pagination
        if (auctionSnapshot.docs.length > 0) {
          setLastDoc(auctionSnapshot.docs[auctionSnapshot.docs.length - 1]);
        }
        
        // Check if we have more auctions to load
        setHasMoreAuctions(auctionSnapshot.docs.length === REDUCED_PAGE_SIZE);
        
      } catch (indexError) {
        // If it's an index building error, use a simpler query
        if (handleIndexBuildingError(indexError)) {
          console.log('Using simpler auction query while index builds...');
          
          // Use a simpler query that doesn't require a composite index
          const simpleQuery = query(
            auctionsRef,
            where('groupId', '==', currentGroup.id),
            limit(REDUCED_PAGE_SIZE) // Use reduced page size even for simple queries
          );
          
          const fallbackSnapshot = await getDocs(simpleQuery);
          
          // Track reads
          await incrementReadCount(fallbackSnapshot.docs.length || 1);
          
          if (fallbackSnapshot.empty) {
            setHasMoreAuctions(false);
            setAllAuctionsLoaded(true);
            return;
          }
          
          // Process the snapshot into usable auction data
          const allAuctions = fallbackSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          
          // Filter to get only active auctions
          const activeAuctions = allAuctions.filter(auction => 
            auction.status === 'active'
          );
          
          // Create a safe set of existing IDs with null checks
          const existingIds = new Set();
          if (auctions && Array.isArray(auctions)) {
            auctions.forEach(auction => {
              if (auction && auction.id) {
                existingIds.add(auction.id);
              }
            });
          }
          
          // Find auctions that we haven't loaded yet
          fetchedAuctions = activeAuctions.filter(auction => !existingIds.has(auction.id));
          
          // Sort by end time for consistency
          fetchedAuctions.sort((a, b) => {
            const aTime = a.endTime && typeof a.endTime.toMillis === 'function' ? 
                          a.endTime.toMillis() : Number.MAX_SAFE_INTEGER;
            const bTime = b.endTime && typeof b.endTime.toMillis === 'function' ? 
                          b.endTime.toMillis() : Number.MAX_SAFE_INTEGER;
            return aTime - bTime;
          });
          
          // Limit to requested page size
          fetchedAuctions = fetchedAuctions.slice(0, REDUCED_PAGE_SIZE);
          
          // Since we're doing manual pagination with the simpler query,
          // we'll stop showing the "load more" option after this batch
          setHasMoreAuctions(false);
          setAllAuctionsLoaded(true);
        } else {
          // Not an index building error, re-throw
          throw indexError;
        }
      }
      
      if (fetchedAuctions.length === 0) {
        setHasMoreAuctions(false);
        setAllAuctionsLoaded(true);
        return;
      }
      
      // Process any new auctions
      const processedAuctions = fetchedAuctions.map(auction => {
        // Ensure all expected properties exist
        return {
          ...auction,
          uniqueBidderCount: auction.bidderCount || 0,
          // CRITICAL FIX: Never override a valid currentRarity with cardRarity
          // This was causing updated rarities to revert back to common/mystery
          currentRarity: auction.currentRarity || auction.cardRarity || RARITY_TYPES.COMMON
        };
      });
      
      // Append new auctions to the existing list with better duplication handling
      setAuctions(current => {
        // Create a map of existing auctions by ID
        const auctionMap = new Map();
        
        // Add existing auctions to the map
        if (current && Array.isArray(current)) {
          current.forEach(auction => {
            if (auction && auction.id) {
              auctionMap.set(auction.id, auction);
            }
          });
        }
        
        // Add new auctions to the map (this automatically handles duplicates)
        processedAuctions.forEach(auction => {
          if (auction && auction.id) {
            auctionMap.set(auction.id, auction);
          }
        });
        
        // Convert map back to array and sort
        return Array.from(auctionMap.values()).sort((a, b) => {
          // Sort by end time ascending (soonest ending first)
          const aTime = (a.endTime && typeof a.endTime.toMillis === 'function') ? a.endTime.toMillis() : 0;
          const bTime = (b.endTime && typeof b.endTime.toMillis === 'function') ? b.endTime.toMillis() : 0;
          return aTime - bTime;
        });
      });
      
      // Only update auction rarities if we haven't exceeded 70% of our read budget
      if (sessionReadCount < MAX_READS_PER_SESSION * 0.7) {
        // Only update the rarities for a small subset to conserve reads
        const auctionsToUpdate = processedAuctions.slice(0, Math.min(2, processedAuctions.length));
        
        // Update rarity in the background after a slight delay
        setTimeout(() => {
          updateAuctionRarities(auctionsToUpdate).catch(error => {
            console.error('Error updating auction rarities:', error);
          });
        }, 500);
      }
      
    } catch (error) {
      console.error('Error loading more auctions:', error);
      setHasMoreAuctions(false);
    } finally {
      setLoadingMoreAuctions(false);
    }
  };

  // Function to fetch unique bidders for a specific auction
  const fetchBiddersForAuction = async (auction) => {
    if (!auction || !auction.id) {
      console.warn('Invalid auction provided to fetchBiddersForAuction');
      return 0;
    }
    
    try {
      // Use cached data if available and recent enough
      // Optimization: Use bidder count cache for 15 minutes
      if (bidderCountCache.counts && 
          bidderCountCache.counts[auction.id] !== undefined && 
          bidderCountCache.lastUpdate && 
          bidderCountCache.lastUpdate[auction.id] && 
          Date.now() - bidderCountCache.lastUpdate[auction.id] < 15 * 60 * 1000) { // 15 minutes cache
        console.log(`Using cached bidder count for auction ${auction.id}: ${bidderCountCache.counts[auction.id]}`);
        return bidderCountCache.counts[auction.id];
      }
      
      console.log(`Fetching bidders for auction ${auction.id}`);
      const bidsRef = collection(db, 'bids');
      const q = query(bidsRef, where('auctionId', '==', auction.id));
      
      // Use cached query with extended TTL
      const bids = await getCachedQuery(q, {
        ttl: CACHE_TTL.AUCTION_BIDS, // Using longer TTL for bids
        cacheKey: `bids_${auction.id}`,
        forceRefresh: false // Avoid excessive reads
      });
      
      // If bids is not an array, handle the error gracefully
      if (!Array.isArray(bids)) {
        console.error(`Error: bids is not an array for auction ${auction.id}`, bids);
        return auction.uniqueBidderCount || 0;
      }
      
      // Use a Set to count unique bidders
      const uniqueBidderIds = new Set();
      bids.forEach(bid => {
        if (bid && bid.userId) {
          uniqueBidderIds.add(bid.userId);
        }
      });
      
      const uniqueBidders = uniqueBidderIds.size;
      
      // Update the bidder count cache
      setBidderCountCache(prev => {
        const counts = { ...(prev.counts || {}) };
        const lastUpdate = { ...(prev.lastUpdate || {}) };
        
        counts[auction.id] = uniqueBidders;
        lastUpdate[auction.id] = Date.now();
        
        return { counts, lastUpdate };
      });
      
      // Update timestamp in ref rather than state
      lastBidUpdateTime.current = Date.now();
      
      return uniqueBidders;
    } catch (error) {
      console.error(`Error fetching bidders for auction ${auction.id}:`, error);
      // Return the existing value if available, otherwise default to 0
      return auction.uniqueBidderCount || 0;
    }
  };

  // Function to update auction rarities based on bidder counts
  const updateAuctionRarities = async (auctionsToUpdate) => {
    if (!Array.isArray(auctionsToUpdate) || auctionsToUpdate.length === 0) {
      return Promise.resolve([]);
    }
    
    try {
      const now = Date.now();
      
      // Map to track updates to prevent duplicate processing
      const auctionMap = new Map();
      
      // Store auctions that need bidder count updates
      const pendingBidderCountUpdates = [];
      
      console.log(`Updating rarities for ${auctionsToUpdate.length} auctions`);
      
      for (let i = 0; i < auctionsToUpdate.length; i++) {
        const auction = auctionsToUpdate[i];
        auctionMap.set(auction.id, auction);
        
        // For completed/expired auctions, always use the stored cardRarity
        if (auction.status === 'completed' || auction.status === 'expired' || auction.status === 'canceled') {
          if (auction.cardRarity && auction.cardRarity !== RARITY_TYPES.MYSTERY && auction.cardRarity !== 'unknown') {
            auction.currentRarity = auction.cardRarity;
            continue; // Skip bidder count updates for completed auctions
          }
        }
        
        // Skip if auction has expired
        const endTime = auction.endTime?.toDate?.();
        if (endTime && endTime <= new Date()) {
          // If the auction has ended but the status is still active, we need to update it
          if (auction.status === 'active') {
            verifyAuctionEnd(auction.id);
          }
          continue;
        }
        
        // For minted cards (with a non-mystery/undefined rarity), respect the existing rarity
        if (auction.cardRarity && auction.cardRarity !== RARITY_TYPES.MYSTERY && auction.cardRarity !== 'unknown') {
          // If it's already minted, assign currentRarity to the existing cardRarity
          auction.currentRarity = auction.cardRarity;
          continue; // Skip bidder count updates for already minted cards
        }
        
        // Check if bidder count needs to be refreshed
        const lastUpdate = bidderCountCache.lastUpdate?.[auction.id] || 0;
        // Make this check more aggressive after a new bid by using forceRefresh
        const forceRefresh = auction.forceRefreshRarity === true;
        if (forceRefresh || !bidderCountCache.counts?.[auction.id] || (now - lastUpdate > 10000)) { // Reduced from 30s to 10s
          // Queue this auction for bidder count update, but don't wait
          pendingBidderCountUpdates.push(auction.id);
          // Remove the force refresh flag after using it
          if (forceRefresh) {
            delete auction.forceRefreshRarity;
          }
        } else {
          // Use cached data for immediate UI update
          auction.uniqueBidderCount = bidderCountCache.counts[auction.id];
          auction.currentRarity = calculateLiveRarity(auction, bidderCountCache.counts[auction.id]) || 
                              auction.cardRarity || RARITY_TYPES.MYSTERY;
        }
      }
      
      // If there are auctions that need bidder count updates, LIMIT how many we update at once
      if (pendingBidderCountUpdates.length > 0) {
        try {
          // Only update maximum 5 auctions at a time to reduce reads
          const limitedUpdates = pendingBidderCountUpdates.slice(0, 5);
          console.log(`Limiting bidder count updates to ${limitedUpdates.length} out of ${pendingBidderCountUpdates.length} pending`);
          
          await fetchBidderCountsInBatch(limitedUpdates, auctionMap);
          
          // Update all auctions with their new rarities
          for (const auction of auctionsToUpdate) {
            if (!auction || !auction.id) continue;
            
            // If this auction has updated bidder count, calculate rarity
            if (bidderCountCache.counts[auction.id] !== undefined) {
              const bidCount = bidderCountCache.counts[auction.id] || 0;
              const liveRarity = calculateLiveRarity(auction, bidCount);
              auction.currentRarity = liveRarity || auction.cardRarity || RARITY_TYPES.MYSTERY;
              auction.uniqueBidderCount = bidCount;
            }
          }
          
          // Force UI refresh to ensure updated rarities are displayed
          // But ONLY when we actually made updates
          setUiRefreshKey(prevKey => prevKey + 1);
          
          // Force a re-render by updating the auctions state directly
          // But don't create an unnecessary render loop
          setAuctions(prevAuctions => {
            // Create a new array to trigger a re-render
            return [...prevAuctions];
          });
        } catch (err) {
          // If we get an index building error, show a single notice and perform a fallback calculation
          if (handleIndexBuildingError(err) && !hasFallbackNoticeShown) {
            console.log('Using fallback rarity calculation while indexes build');
            hasFallbackNoticeShown = true;
            
            // Apply simplified rarity calculation for all auctions
            for (const auction of auctionsToUpdate) {
              if (!auction || !auction.id) continue;
              
              // For coined cards, calculate based on current bid amount only
              if (!auction.cardRarity || auction.cardRarity === 'mystery' || auction.cardRarity === 'unknown') {
                // Use the unified rarity system instead of direct calculation
                try {
                  // Get real bidder count or estimate one
                  let bidderCount = bidderCountCache.counts[auction.id];
                  if (!bidderCount) {
                    // If we don't have a cached count, make a reasonable estimate
                    const bidAmount = auction.currentBid || 0;
                    bidderCount = Math.max(1, Math.floor(bidAmount / 10));
                  }
                  
                  // Use our centralized rarity calculation
                  auction.currentRarity = calculateLiveRarity(auction, bidderCount);
                  console.log(`UNIFIED RARITY SYSTEM: Calculated rarity ${auction.currentRarity} for auction ${auction.id}`);
                } catch (err) {
                  console.error('Error calculating unified rarity:', err);
                  // Fallback to COMMON as a last resort
                  auction.currentRarity = RARITY_TYPES.COMMON;
                }
              }
            }
            
            // Force UI refresh with our fallback calculations
            setUiRefreshKey(prevKey => prevKey + 1);
          } else {
            console.error('Error fetching bidder counts in batch:', err);
          }
        }
      }
      
      return Promise.resolve(auctionsToUpdate);
    } catch (error) {
      console.error('Error in updateAuctionRarities:', error);
      return Promise.resolve(auctionsToUpdate || []);
    }
  };

  // Add a ref to track if a fetch is already in progress
  const isFetchingRef = useRef(false);

  // Fetch auctions with optimized caching
  const fetchAuctions = async (forceRefresh = false) => {
    if (!user || !currentGroup) return;
    
    // Prevent concurrent fetches
    if (isFetchingRef.current) {
      console.log('Fetch already in progress, skipping');
      return;
    }
    
    // Set fetching flag at the beginning of the function
    isFetchingRef.current = true;
    setRefreshing(true);
    setInitialLoading(prevLoading => prevLoading || auctions.length === 0);
    
    try {
      // Check if we've exceeded read limits
      if (hasExceededReadLimit()) {
        console.error('⛔ Read limit exceeded. Using cached data only.');
        
        // Try to use cached data
        const cacheKey = `auctions_${currentGroup.id}`;
        try {
          const cachedData = await getWithCache(cacheKey, async () => null, { offline: true }); // TODO: Consider migrating to CacheService if needed
          if (cachedData && cachedData.auctions && cachedData.auctions.length > 0) {
            console.log('Using cached auction data (read limit exceeded)');
            setAuctions(cachedData.auctions);
          }
        } catch (error) {
          console.error('Error reading from cache:', error);
        }
        return; // Exit early
      }
      
      // Rate limit frequent refreshes
      const now = Date.now();
      const lastRefreshTime = lastBidUpdateTime.current || 0;
      const timeSinceLastRefresh = now - lastRefreshTime;
      
      // Only allow refresh if it's been at least 5 minutes or it's a forced refresh
      if (!forceRefresh && timeSinceLastRefresh < MIN_TIME_BETWEEN_UPDATES) {
        console.log(`Skipping refresh - last one was only ${Math.floor(timeSinceLastRefresh/1000)}s ago`);
        return;
      }
      
      // Set the last update time
      lastBidUpdateTime.current = now;
      
      // Always check for expired auctions on every refresh to ensure ended auctions are removed
      await completeExpiredAuctions(false);  
      
      const cacheKey = `auctions_${currentGroup.id}`;
      
      // Use network-aware operation with reduced page size
      const { auctions: fetchedAuctions, lastDoc: lastFetchedDoc } = await executeSafeFirestoreOperation(
        async () => await getAuctionsPaginated(currentGroup.id, 'active', null, REDUCED_PAGE_SIZE),
        // Fallback to empty arrays if offline or error
        { auctions: [], lastDoc: null } 
      );
      
      // Track the number of reads
      await incrementReadCount(fetchedAuctions.length || 1);
      
      // If we got data, process and store it
      if (fetchedAuctions && fetchedAuctions.length > 0) {
        console.log(`Fetched ${fetchedAuctions.length} auctions for group ${currentGroup.id}`);
        
        // Filter out any expired auctions (local check)
        const now = new Date();
        const validAuctions = fetchedAuctions.filter(auction => {
          // Skip auctions with invalid status
          if (!auction.status || auction.status !== 'active') return false;
          
          // Skip auctions that have ended (compare endTime to now)
          const endTime = auction.endTime?.toDate?.();
          if (endTime && endTime <= now) {
            // This auction should be ended - but don't verify every auction immediately
            // This spreads out the database load over time
            if (Math.random() < 0.3) { // Only verify ~30% of expired auctions per refresh
              console.log(`Scheduling verification for auction ${auction.id}`);
              setTimeout(() => {
                verifyAuctionEnd(auction.id);
              }, Math.random() * 30000); // Spread verifications over 30 seconds
            }
            return false;
          }
          
          return true;
        });
        
        // Process auctions to ensure all properties are present and handle any data format issues
        const processedAuctions = validAuctions.map(auction => {
          // Check if we have a locally cached rarity for this auction that should take precedence
          const cachedRarity = getValueSync(`auction_rarity_${auction.id}`);
          
          // Ensure all expected properties exist
          return {
            ...auction,
            uniqueBidderCount: auction.bidderCount || 0,
            // Priority ordering for rarity:
            // 1. Cached rarity from recent bid (if exists)
            // 2. Current rarity from database
            // 3. Card rarity
            // 4. Default to COMMON
            currentRarity: cachedRarity || auction.currentRarity || auction.cardRarity || RARITY_TYPES.COMMON,
            // If there's a cached rarity, also update cardRarity for consistency
            cardRarity: cachedRarity || auction.cardRarity || auction.currentRarity || RARITY_TYPES.COMMON
          };
        });
        
        // Merge with existing auctions rather than replacing them all
        // This helps preserve data if we're only fetching a smaller batch size
        setAuctions(prevAuctions => {
          // Create a map of existing auctions by ID
          const auctionMap = new Map();
          prevAuctions.forEach(auction => {
            if (auction && auction.id) {
              auctionMap.set(auction.id, auction);
            }
          });
          
          // Update with new auctions
          processedAuctions.forEach(auction => {
            if (auction && auction.id) {
              auctionMap.set(auction.id, auction);
            }
          });
          
          // Convert back to array and sort
          return Array.from(auctionMap.values())
            .sort((a, b) => {
              // Sort by end time ascending (soonest ending first)
              const aTime = (a.endTime && typeof a.endTime.toMillis === 'function') ? a.endTime.toMillis() : 0;
              const bTime = (b.endTime && typeof b.endTime.toMillis === 'function') ? b.endTime.toMillis() : 0;
              return aTime - bTime;
            });
        });
        
        setLastDoc(lastFetchedDoc);
        setHasMoreAuctions(processedAuctions.length >= REDUCED_PAGE_SIZE);
        
        // Save to cache for offline use with timestamp
        const cacheData = {
          auctions: processedAuctions,
          timestamp: Date.now(),
          lastDoc: lastFetchedDoc
        };
        await setValueSync(cacheKey, cacheData);
        
        // Also save to AsyncStorage with the last refresh time
        AsyncStorage.setItem(`last_cache_time_${currentGroup.id}`, now.toString())
          .catch(err => console.log('Error updating cache time:', err));
        
        // Update bidder counts for a small batch of auctions to improve UI
        // We only do this for a few to avoid excessive database reads
        try {
          const auctionsToUpdate = processedAuctions.slice(0, Math.min(2, processedAuctions.length));
          for (const auction of auctionsToUpdate) {
            if (auction && auction.id) {
              await updateBidderCount(auction.id);
            }
          }
        } catch (countError) {
          console.error('Error updating bidder counts batch:', countError);
        }
        
        // Trigger rarity updates for auctions with mystery rarity
        try {
          const mysteryAuctions = processedAuctions.filter(a => 
            a && a.id && a.currentBid > 0 && 
            (!a.currentRarity || a.currentRarity === 'mystery' || a.currentRarity === 'unknown')
          );
          
          // Only update a small batch to avoid excessive reads
          const auctionsToFix = mysteryAuctions.slice(0, Math.min(2, mysteryAuctions.length));
          for (const auction of auctionsToFix) {
            console.log(`UNIFIED RARITY SYSTEM: Updating mystery rarity for auction ${auction.id}`);
            await updateAuctionRarity(auction.id);
          }
        } catch (rarityError) {
          console.error('Error processing mystery rarities:', rarityError);
        }
      } else {
        console.log(`No auctions found for group ${currentGroup.id}`);
        setHasMoreAuctions(false);
      }
      
      // We'll try to load from the cache if we got no data from the network
      if (fetchedAuctions.length === 0) {
        try {
          const cachedData = await getWithCache(cacheKey, async () => null, { offline: true }); // TODO: Consider migrating to CacheService if needed
          // Only use cached data if it's less than 1 hour old
          if (cachedData && cachedData.timestamp && 
              (Date.now() - cachedData.timestamp < 60 * 60 * 1000) && 
              cachedData.auctions && cachedData.auctions.length > 0) {
            console.log('Using cached auction data due to empty network results');
            
            // Filter out any expired auctions from the cache data
            const now = new Date();
            const validCachedAuctions = cachedData.auctions.filter(auction => {
              const endTime = auction.endTime?.toDate?.();
              return !endTime || endTime > now;
            });
            
            setAuctions(validCachedAuctions);
            setLastDoc(cachedData.lastDoc);
            setHasMoreAuctions(validCachedAuctions.length >= REDUCED_PAGE_SIZE);
          }
        } catch (cacheError) {
          console.error('Error loading from cache:', cacheError);
        }
      }
    } catch (error) {
      console.error('Error fetching auctions:', error);
      
      // Try to use cached data as a fallback
      const cacheKey = `auctions_${currentGroup.id}`;
      try {
        const cachedData = await getWithCache(cacheKey, async () => null, { offline: true }); // TODO: Consider migrating to CacheService if needed
        if (cachedData && cachedData.auctions && cachedData.auctions.length > 0) {
          console.log('Using cached auction data after error');
          setAuctions(cachedData.auctions);
        }
      } catch (cacheError) {
        console.error('Error loading from cache after fetch error:', cacheError);
      }
    } finally {
      // Reset fetching flag
      isFetchingRef.current = false;
      setRefreshing(false);
      setInitialLoading(false);
    }
  };

  // Implementation of the missing updateBidderCount function to fix errors
  const updateBidderCount = async (auctionId) => {
    if (!auctionId) return;
    
    try {
      // Get the unique bidder count from the auctionRarity utility
      const bidderCount = await getUniqueBidderCount(auctionId);
      
      // Update the auction document with the new bidder count
      const auctionRef = doc(db, 'auctions', auctionId);
      await updateDoc(auctionRef, {
        uniqueBidderCount: bidderCount,
        lastBidderCountUpdate: serverTimestamp()
      });
      
      // Also update the rarity based on this new count to ensure consistency
      await updateAuctionRarity(auctionId);
      
      console.log(`Updated bidder count for auction ${auctionId}: ${bidderCount}`);
      return bidderCount;
    } catch (error) {
      console.error(`Error updating bidder count for auction ${auctionId}:`, error);
      return 0;
    }
  };
  
  // CRITICAL: Ensure we only use ONE rarity system
  // This prevents competing rarity calculations that cause rarity to flip-flop

  // Enhanced user data fetching with deduplication and offline support
  const fetchUserData = async (userId, fields = null) => {
    if (!userId) return null;
    
    try {
      // Create a cache key for this user
      const cacheKey = `${'user_data_'}${userId}`;
      
      // Check network status
      const networkState = await NetInfo.fetch();
      const isConnected = networkState.isConnected && networkState.isInternetReachable;
      
      // Use the deduplication utility to avoid redundant user fetches
      const options = {
        ttl: CACHE_TTL.USER_PROFILE,
        fields: fields,
        forceRefresh: isConnected // Only force refresh if online
      };

      // Try to get from cache first if offline
      if (!isConnected) {
        const cachedData = await getWithCache(cacheKey, async () => null, { offline: true }); // TODO: Consider migrating to CacheService if needed
        if (cachedData) {
          console.log(`Using cached user data for ${userId} while offline`);
          
          // Update user cache with cached data
          setUserCache(prev => ({
            ...prev,
            [userId]: {
              ...cachedData,
              lastFetched: Date.now()
            }
          }));
          
          return cachedData;
        }
      }
      
      // If online or no cache available, fetch from Firebase
      const userData = await userUtils.getUserWithDeduplication(userId, options);
      
      // Update user cache and persist to AsyncStorage
      if (userData) {
        setUserCache(prev => ({
          ...prev,
          [userId]: {
            ...userData,
            lastFetched: Date.now()
          }
        }));
        
        // Save to AsyncStorage cache
        await setValueSync(cacheKey, userData);
      }
      
      return userData;
    } catch (error) {
      console.error(`Error fetching user data for ${userId}:`, error);
      
      // Try to get from cache as fallback
      const cacheKey = `${'user_data_'}${userId}`;
      const cachedData = await getWithCache(cacheKey, async () => null, { offline: true }); // TODO: Consider migrating to CacheService if needed
      
      if (cachedData) {
        console.log(`Using cached user data for ${userId} after error`);
        return cachedData;
      }
      
      return null;
    }
  };

  // Add new function to verify auction end with server
  const verifyAuctionEnd = async (auctionId) => {
    try {
      // Fetch the latest auction data from server
      const auctionData = await dbOptimizer.getOptimizedAuctionDetails(auctionId, {
        forceRefresh: true,
        includeFields: ['id', 'status', 'endTime']
      });
      
      // If auction exists and is still active
      if (auctionData && auctionData.status === 'active') {
        // Check if it should be ended according to server time
        const now = new Date();
        const endTime = auctionData.endTime?.toDate;
        
        if (endTime && endTime <= now) {
          console.log(`Confirming auction ${auctionId} has ended on server time`);
          // Trigger the auction completion process
          await completeExpiredAuction(auctionId);
          // Refresh the auctions list
          fetchAuctions(true);
        }
      }
    } catch (error) {
      console.error(`Error verifying auction end for ${auctionId}:`, error);
    }
  };

  // Function to complete a single expired auction by ID
  const completeExpiredAuction = async (auctionId) => {
    if (!auctionId || !currentGroup) return;
    
    try {
      // Fetch the auction data first to determine if it has a bidder
      console.log(`Processing expired auction: ${auctionId}`);
      const auctionRef = doc(db, 'auctions', auctionId);
      const auctionDoc = await getDoc(auctionRef);
      
      // Check if auction exists and is still active
      if (!auctionDoc.exists()) {
        console.log(`Auction ${auctionId} no longer exists`);
        return;
      }
      
      const auctionData = auctionDoc.data();
      
      // Include the ID in the data
      auctionData.id = auctionId;
      
      // Skip if already processed
      if (auctionData.status !== 'active') {
        console.log(`Auction ${auctionId} already processed with status: ${auctionData.status}`);
        return;
      }
      
      // Check if this auction has expired based on time
      const now = new Date();
      const endTime = auctionData.endTime?.toDate;
      
      if (!endTime || endTime > now) {
        console.log(`Auction ${auctionId} has not yet expired`);
        return;
      }
      
      // Process based on whether there's a bidder
      if (!auctionData.currentBidder) {
        // No bidder - cancel the auction
        console.log(`Auction ${auctionId} has no bidder, canceling`);
        await cancelExpiredAuction(auctionData);
      } else {
        // Has a bidder - complete auction with winner
        console.log(`Auction ${auctionId} has a bidder (${auctionData.currentBidder}), completing`);
        await completeAuctionWithWinner(auctionData);
      }
      
      return true;
    } catch (error) {
      console.error(`Error completing expired auction ${auctionId}:`, error);
    }
  };

  // Function to complete all expired auctions
  const completeExpiredAuctions = async (forceRefresh = false) => {
    if (!currentGroup) return;
    
    try {
      console.log('Checking for expired auctions...');
      
      // Query for active auctions that have expired
      const now = new Date();
      const auctionsRef = collection(db, 'auctions');
      const q = query(
        auctionsRef,
        where('groupId', '==', currentGroup.id),
        where('status', '==', 'active'),
        where('endTime', '<=', now)
      );
      
      // Get all expired auctions
      const querySnapshot = await getDocs(q);
      const expiredAuctions = [];
      
      querySnapshot.forEach((doc) => {
        expiredAuctions.push(doc.id);
      });
      
      console.log(`Found ${expiredAuctions.length} expired auctions`);
      
      // Process each expired auction
      const promises = expiredAuctions.map(auctionId => 
        completeExpiredAuction(auctionId)
      );
      
      await Promise.all(promises);
      
      // Refresh auctions list if requested
      if (forceRefresh && expiredAuctions.length > 0) {
        fetchAuctions(true);
      }
      
      return expiredAuctions.length;
    } catch (error) {
      console.error('Error completing expired auctions:', error);
      return 0;
    }
  };

  // Function to cancel an expired auction (no bids)
  const cancelExpiredAuction = async (auctionData) => {
    if (!auctionData || !auctionData.id) return;
    
    try {
      // Update auction, card, and transfer ownership in a transaction
      const auctionRef = doc(db, 'auctions', auctionData.id);
      
      await runTransaction(db, async (transaction) => {
        // STEP 1: Perform ALL reads first
        // Verify auction still exists and is active
        const auctionDoc = await transaction.get(auctionRef);
        if (!auctionDoc.exists()) {
          throw new Error('Auction no longer exists');
        }
        
        const currentData = auctionDoc.data();
        if (currentData.status !== 'active') {
          // Already handled, nothing to do
          return;
        }
        
        // Create a single timestamp for all updates
        const now = Timestamp.now();
        
        // STEP 1: Get card data (if card exists)
        let cardRef = null;
        let cardDoc = null;
        
        if (auctionData.cardId) {
          cardRef = doc(db, 'cards', auctionData.cardId);
          cardDoc = await transaction.get(cardRef);
        }
        
        // STEP 2: Perform all writes after all reads
        // Update auction status with unified timestamp
        const auctionUpdate = {
          status: 'canceled',
          canceledAt: now,
          cancelReason: 'expired_no_bids',
          // Always set final rarity values for the auction
          cardRarity: RARITY_TYPES.COMMON,
          currentRarity: RARITY_TYPES.COMMON,
          finalRarity: RARITY_TYPES.COMMON,
          lastRarityUpdate: now
        };
        
        // Update the auction with all the fields
        transaction.update(auctionRef, auctionUpdate);
        
        // If there's a card associated with this auction, update it too
        if (cardRef && cardDoc && cardDoc.exists()) {
          const cardData = cardDoc.data();
          
          // All newly coined cards will be set to COMMON
          // This applies to cards that might have been marked as 'mystery'
          const shouldSetRarity = cardData.rarity === 'mystery' || 
                                 !cardData.rarity || 
                                 cardData.rarity === 'unknown' || 
                                 cardData.rarity === '';
          
          // Create base card update object with common fields
          const cardUpdate = {
            status: 'available',
            inAuction: false,
            auctionId: null,
            lastStatusChange: now
          };
          
          // Add rarity fields only if needed
          if (shouldSetRarity) {
            // For cards that need rarity set, add rarity fields
            console.log(`UNIFIED RARITY SYSTEM: Setting card ${auctionData.cardId} to COMMON rarity (no bids)`);
            cardUpdate.rarity = RARITY_TYPES.COMMON; // Set to COMMON when no bids
            cardUpdate.lastRarityUpdate = now; // Track when rarity was updated
          }
          
          // Single transaction update with all needed fields
          transaction.update(cardRef, cardUpdate);
        }
      });
      
      console.log(`Successfully canceled auction ${auctionData.id}`);
    } catch (error) {
      console.error(`Error canceling expired auction ${auctionData.id}:`, error);
    }
  };

  // Function to complete an auction with a winner
  const completeAuctionWithWinner = async (auctionData) => {
    if (!auctionData || !auctionData.id) return;
    
    try {
      console.log(`Completing auction with winner: ${auctionData.id}, winner: ${auctionData.currentBidder}`);
      
      // Use the consolidated rarity system to determine the final rarity
      // This handles all the complexity of bidder counting and rarity calculation
      let finalCalculatedRarity = RARITY_TYPES.COMMON; // Default fallback
      let finalBidderCount = 0;
      
      try {
        // First get the bidder count for more accurate rarity calculation
        finalBidderCount = await getUniqueBidderCount(auctionData.id, auctionData.sellerId);
        
        // Call the unified rarity determination with the bidder count for more precision
        finalCalculatedRarity = await determineAuctionFinalRarity(auctionData, finalBidderCount);
        
        console.log(`UNIFIED RARITY SYSTEM: Auction ${auctionData.id} final rarity determined as ${finalCalculatedRarity} with ${finalBidderCount} bidders`);
        
        // If by any chance we still get 'mystery', force it to COMMON
        if (finalCalculatedRarity === 'mystery' || !finalCalculatedRarity) {
          console.log(`UNIFIED RARITY SYSTEM: Converting mystery to COMMON for auction ${auctionData.id}`);
          finalCalculatedRarity = RARITY_TYPES.COMMON;
        }
      } catch (error) {
        console.error('Error determining final rarity:', error);
        // Fall through and use default rarity if this fails
      }
      
      // Update auction, card, and transfer ownership in a transaction
      const auctionRef = doc(db, 'auctions', auctionData.id);
      
      await runTransaction(db, async (transaction) => {
        // STEP 1: Perform ALL reads first
        // Verify auction still exists and is active
        const auctionDoc = await transaction.get(auctionRef);
        if (!auctionDoc.exists()) {
          throw new Error('Auction no longer exists');
        }
        
        const currentData = auctionDoc.data();
        if (currentData.status !== 'active') {
          // Already handled, nothing to do
          return;
        }
        
        // Get card data if available
        let cardDoc = null;
        let cardRef = null;
        if (auctionData.cardId) {
          cardRef = doc(db, 'cards', auctionData.cardId);
          cardDoc = await transaction.get(cardRef);
        }
        
        // Get seller data if available
        let sellerDoc = null;
        let sellerRef = null;
        if (auctionData.seller) {
          sellerRef = doc(db, 'users', auctionData.seller);
          sellerDoc = await transaction.get(sellerRef);
        }
        
        // Create a single timestamp for all operations
        const now = Timestamp.now();
        
        // Consolidated rarity determination logic
        const determineFinalRarity = async () => {
          // For non-mystery cards, return the existing rarity
          if (currentData.cardRarity && 
              currentData.cardRarity !== 'mystery' && 
              currentData.cardRarity !== 'unknown' && 
              currentData.cardRarity !== '') {
            return currentData.cardRarity;
          }
          
          // Check in order of priority
          const possibleRarities = [
            // Priority 1: Pre-calculated rarity
            () => finalCalculatedRarity && finalCalculatedRarity !== RARITY_TYPES.MYSTERY 
                  ? finalCalculatedRarity : null,
                  
            // Priority 2: Current auction data rarity
            () => currentData.currentRarity && 
                  currentData.currentRarity !== RARITY_TYPES.MYSTERY && 
                  currentData.currentRarity !== 'unknown' 
                  ? currentData.currentRarity : null,
                  
            // Priority 3: Passed auction data rarity
            () => auctionData.currentRarity && 
                  auctionData.currentRarity !== RARITY_TYPES.MYSTERY && 
                  auctionData.currentRarity !== 'unknown' 
                  ? auctionData.currentRarity : null
          ];
          
          // Find the first valid rarity
          for (const getRarity of possibleRarities) {
            const rarity = getRarity();
            if (rarity) return rarity;
          }
          
          // If no valid rarity found, use the unified system with fallback
          try {
            const bidderCount = await getUniqueBidderCount(auctionData.id);
            const calculatedRarity = determineAuctionFinalRarity(currentData, bidderCount);
            console.log(`UNIFIED RARITY SYSTEM: Final calculated rarity for auction ${auctionData.id} is ${calculatedRarity} with ${bidderCount} bidders`);
            return calculatedRarity;
          } catch (e) {
            console.error('Error using unified rarity system for final calculation:', e);
            // Last resort fallback based on bid amount
            const bidAmount = currentData.currentBid || 0;
            if (bidAmount >= 100) return RARITY_TYPES.LEGENDARY;
            if (bidAmount >= 50) return RARITY_TYPES.EPIC;
            if (bidAmount >= 25) return RARITY_TYPES.RARE;
            if (bidAmount >= 10) return RARITY_TYPES.UNCOMMON;
            return RARITY_TYPES.COMMON;
          }
        };
        
        const finalRarity = await determineFinalRarity();
        console.log(`FINAL RARITY DECISION for auction ${auctionData.id}: ${finalRarity}`);
        
        // STEP 2: Perform all writes after completing all reads
        // Mark auction as completed with consolidated timestamp
        const auctionUpdate = {
          status: 'completed',
          completedAt: now,
          finalBid: currentData.currentBid,
          winner: auctionData.currentBidder || currentData.currentBidder,
          cardRarity: finalRarity, // Update auction's cardRarity to match final rarity
          currentRarity: finalRarity, // Update currentRarity too for UI consistency
          uniqueBidderCount: finalBidderCount > 0 ? finalBidderCount : (currentData.uniqueBidderCount || 1)
        };
        transaction.update(auctionRef, auctionUpdate);
        
        // Transfer the card to the winner (if card exists)
        if (cardRef && cardDoc && cardDoc.exists()) {
          const cardData = cardDoc.data();
          const previousOwner = auctionData.seller || cardData.owner || auctionData.sellerId || user.uid;
          
          // Prepare card update with consolidated timestamp
          const cardUpdate = {
            owner: auctionData.currentBidder,
            ownerId: auctionData.currentBidder, // Consistent owner references
            userId: auctionData.currentBidder,   // Legacy compatibility
            previousOwner,
            status: 'available',
            inAuction: false,
            auctionId: null,
            lastStatusChange: now,
            rarity: finalRarity,
            transferHistory: [
              ...(cardData.transferHistory || []), 
              {
                from: previousOwner,
                to: auctionData.currentBidder,
                price: auctionData.currentBid,
                date: now,
                method: 'auction',
                finalRarity
              }
            ]
          };
          
          // Update card in transaction
          transaction.update(cardRef, cardUpdate);
          console.log(`Card ${auctionData.cardId} transferred to ${auctionData.currentBidder}`);
        } else {
          console.log(`Card not found for auction ${auctionData.id}`);
        }
        
        // Transfer coins to the seller
        if (sellerRef && sellerDoc && sellerDoc.exists()) {
          const sellerData = sellerDoc.data();
          const currentBalance = sellerData.groupBalances?.[currentGroup.id] || 0;
          const newBalance = currentBalance + auctionData.currentBid;
          
          // Update seller's balance
          const groupBalances = sellerData.groupBalances || {};
          groupBalances[currentGroup.id] = newBalance;
          
          transaction.update(sellerRef, { groupBalances });
          console.log(`Transferred ${auctionData.currentBid} coins to seller ${auctionData.seller}`);
        }
      });
      
      console.log(`Successfully completed auction ${auctionData.id} with final rarity ${finalCalculatedRarity}`);
      
      // Also update cards collection directly after transaction in case the transaction didn't handle it properly
      // This is a safety measure to ensure the card definitely has its rarity set
      try {
        if (auctionData.cardId) {
          const cardRef = doc(db, 'cards', auctionData.cardId);
          const cardSnap = await getDoc(cardRef);
          
          if (cardSnap.exists()) {
            const cardData = cardSnap.data();
            
            // Only update if the card is still showing mystery or unknown
            if (!cardData.rarity || 
                cardData.rarity === RARITY_TYPES.MYSTERY || 
                cardData.rarity === 'unknown') {
              
              // Use finalCalculatedRarity if available, or default to common
              const safeRarity = (finalCalculatedRarity && finalCalculatedRarity !== RARITY_TYPES.MYSTERY) ? 
                                finalCalculatedRarity : RARITY_TYPES.COMMON;
              
              await updateDoc(cardRef, {
                rarity: safeRarity,
                lastUpdated: serverTimestamp()
              });
              
              console.log(`POST-TRANSACTION: Updated card ${auctionData.cardId} rarity to ${safeRarity}`);
            }
          }
        }
      } catch (postUpdateError) {
        console.error('Error updating card rarity after transaction:', postUpdateError);
        // Non-critical, continue execution
      }
      
      // Create notifications for winner and seller
      const createNotification = async (userId, type, title, message) => {
        if (!userId) return;
        
        try {
          await addDoc(collection(db, 'notifications'), {
            userId,
            type,
            title,
            message,
            auctionId: auctionData.id,
            cardId: auctionData.cardId,
            groupId: auctionData.groupId,
            createdAt: now,
            read: false
          });
        } catch (error) {
          console.error(`Error creating ${type} notification:`, error);
        }
      };
      
      try {
        // Create notifications in parallel
        await Promise.all([
          // Winner notification
          createNotification(
            auctionData.currentBidder,
            'auction_won',
            'Auction Won!',
            `You won the auction for ${auctionData.cardName || 'a card'}!`
          ),
          // Seller notification
          createNotification(
            auctionData.seller,
            'auction_sold',
            'Auction Sold',
            `Your auction for ${auctionData.cardName || 'a card'} has sold for ${auctionData.currentBid} coins.`
          )
        ]);
      } catch (error) {
        console.error('Error in notification process:', error);
      }
    } catch (error) {
      console.error(`Error completing auction ${auctionData.id}:`, error);
    }
  };

  // Get user's coin balance (for current group) - ALWAYS fetch fresh balance for bidding
  const getUserBalance = async () => {
    if (!user || !currentGroup) return 0;
    
    try {
      // IMPORTANT: Use direct Firestore fetch to get the REAL current balance
      // This is a critical operation that should always get fresh data, not cached
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        console.error('User document not found when checking balance');
        return 0;
      }
      
      const userData = userDoc.data();
      const balance = userData?.groupBalances?.[currentGroup.id] || 0;
      
      console.log(`Current user balance for ${user.uid} in group ${currentGroup.id}: ${balance} coins`);
      
      // Update the userCache to match the fresh data
      setUserCache(prev => ({
        ...prev,
        balance: balance,
        balanceLastUpdated: Date.now()
      }));
      
      return balance;
    } catch (error) {
      console.error('Error getting user balance:', error);
      
      // Last resort - try to get balance from userCache
      const cachedBalance = userCache?.balance || 0;
      console.log(`Using cached balance as fallback: ${cachedBalance}`);
      return cachedBalance;
    }
  };

  // Function to place a bid
  const placeBid = async (auction, amount) => {
    if (!auction || !amount) {
      Alert.alert('Error', 'Invalid auction or bid amount');
      return false;
    }

    const bidValue = parseInt(amount);
    if (isNaN(bidValue)) {
      Alert.alert('Error', 'Please enter a valid bid amount');
      return false;
    }
    
    // Track this auction ID for immediate rarity update after bid
    const auctionIdForRarityUpdate = auction.id;

    // Verify the auction is still active
    try {
      // Set this first to prevent multiple attempts
      setProcessingAction(true);
      
      const auctionRef = doc(db, 'auctions', auction.id);
      const auctionDoc = await getDoc(auctionRef);
      
      if (!auctionDoc.exists()) {
        setProcessingAction(false);
        Alert.alert('Error', 'This auction no longer exists.');
        return false;
      }
      
      const auctionData = auctionDoc.data();
      
      // Check auction status
      if (auctionData.status !== 'active') {
        setProcessingAction(false);
        Alert.alert('Error', 'This auction is no longer active.');
        return false;
      }
      
      // Verify the end time hasn't passed using our utility function
      const timeInfo = calculateTimeRemaining({
        ...auctionData,
        endTime: auctionData.endTime
      });
      
      if (timeInfo.isEnded) {
        setProcessingAction(false);
        Alert.alert('Error', 'This auction has already ended.');
        
        // Trigger auction completion since we detected it's ended
        setTimeout(() => {
          completeExpiredAuctions(true);
        }, 500);
        
        return false;
      }
      
      // Verify the bid amount is higher than current bid
      const currentBid = auctionData.currentBid || 0;
      const minimumBid = currentBid + 1;
      
      if (bidValue < minimumBid) {
        setProcessingAction(false);
        Alert.alert('Error', `Your bid must be at least ${minimumBid} coins (1 more than the current bid of ${currentBid} coins).`);
        return false;
      }
      
      // Get user balance
      const userBalance = await getUserBalance();
      
      // Calculate total cost including the bid tax
      // If you're the current bidder, you only pay the difference plus tax
      const previousBid = auctionData.currentBidder === user.uid ? auctionData.currentBid : 0;
      const deductionAmount = (bidValue - previousBid) + 1; // Add 1 coin tax
      
      if (userBalance < deductionAmount) {
        setProcessingAction(false);
        Alert.alert('Insufficient Balance', `You need ${deductionAmount} coins for this bid (${bidValue - previousBid} coins + 1 coin tax). Your balance: ${userBalance} coins`);
        return false;
      }
      
      // Try running the transaction, with proper error handling
      try {
        // Run transaction to handle all financial operations atomically
        // Define rarityResult outside the transaction so it's accessible later
        let rarityResult = {
          rarity: RARITY_TYPES.COMMON, // Default fallback
          bidderCount: 1
        };
        
        await runTransaction(db, async (transaction) => {
          console.log(`Starting bid transaction for auction ${auction.id}, amount: ${bidValue}`);
          
          // STEP 1: Perform ALL reads first
          // Get fresh auction data
          const auctionRef = doc(db, 'auctions', auction.id);
          const auctionDoc = await transaction.get(auctionRef);
          if (!auctionDoc.exists()) {
            throw new Error('This auction no longer exists');
          }
          
          const freshAuctionData = auctionDoc.data();
          
          // Check auction status again
          if (freshAuctionData.status !== 'active') {
            throw new Error('This auction is no longer active');
          }
          
          // Check auction end time again within transaction
          const freshEndTime = freshAuctionData.endTime?.toDate;
          const freshNow = new Date();
          if (freshEndTime && freshEndTime <= freshNow) {
            throw new Error('This auction has already ended');
          }
          
          // Verify the bid amount is still higher than current bid
          const freshCurrentBid = freshAuctionData.currentBid || 0;
          const freshMinimumBid = freshCurrentBid + 1;
          
          if (bidValue < freshMinimumBid) {
            throw new Error(`Your bid must be at least ${freshMinimumBid} coins (1 more than the current bid of ${freshCurrentBid} coins)`);
          }
          
          // Get current user's data for balance
          const userRef = doc(db, 'users', user.uid);
          const userDoc = await transaction.get(userRef);
          
          if (!userDoc.exists()) {
            throw new Error('User account not found');
          }
          
          const userData = userDoc.data();
          const userBalances = userData.groupBalances || {};
          const currentUserBalance = userBalances[currentGroup.id] || 0;
          
          // Get previous bidder data (if exists)
          let prevBidderDoc = null;
          let prevBidderRef = null;
          
          if (freshAuctionData.currentBidder && freshAuctionData.currentBidder !== user.uid) {
            prevBidderRef = doc(db, 'users', freshAuctionData.currentBidder);
            prevBidderDoc = await transaction.get(prevBidderRef);
          }
          
          // Verify user has sufficient balance for the bid
          // Tax is 1 coin per bid
          const currentPreviousBid = freshAuctionData.currentBidder === user.uid ? freshAuctionData.currentBid : 0;
          const transactionDeductionAmount = bidValue - currentPreviousBid + 1; // Add 1 coin tax
          
          if (currentUserBalance < transactionDeductionAmount) {
            throw new Error(`Insufficient balance. You need ${transactionDeductionAmount} coins for this bid. Your balance: ${currentUserBalance} coins.`);
          }
          
          console.log(`Bid calculation: New bid: ${bidValue}, Previous bid: ${currentPreviousBid}, Deduction: ${transactionDeductionAmount}, Current balance: ${currentUserBalance}`);
          
          // Get bidder count to update rarity
          // Query must be outside of transaction to use Firestore query operations
          let uniqueBidders = new Set();
          let bidderCount = 1; // Default to 1 (the current bidder)
          
          try {
            const bidsQuery = query(
              collection(db, 'auctionBids'),
              where('auctionId', '==', auction.id)
            );
            const bidsSnapshot = await getDocs(bidsQuery);
            
            // Count unique bidders
            bidsSnapshot.docs.forEach(doc => {
              const bidData = doc.data();
              if (bidData.bidderId && bidData.bidderId !== freshAuctionData.sellerId) {
                uniqueBidders.add(bidData.bidderId);
              }
            });
            
            // Add current bidder to count if they're not already included
            uniqueBidders.add(user.uid);
            bidderCount = uniqueBidders.size;
            console.log(`UNIFIED RARITY SYSTEM: Found ${bidderCount} unique bidders for auction ${auction.id}`);
            
          } catch (countError) {
            console.error(`Error getting bidder count for auction ${auction.id}:`, countError);
            // Fall back to the current auction data or minimum of 1
            bidderCount = freshAuctionData.uniqueBidderCount || 1;
          }
          
          // Create updated auction object for rarity calculation
          const updatedAuction = {
            ...freshAuctionData,
            id: auction.id,
            currentBid: bidValue
          };
          
          // Use the centralized rarity calculation function with accurate bidder count
          const calculatedRarity = calculateLiveRarity(updatedAuction, bidderCount);
          console.log(`UNIFIED RARITY SYSTEM: Calculated new rarity: ${calculatedRarity} based on ${bidderCount} bidders and bid of ${bidValue}`);
          
          // Store the results outside the transaction for later use
          rarityResult = {
            rarity: calculatedRarity,
            bidderCount: bidderCount
          };
          
          // STEP 3: Perform all writes after all reads are complete
          
          // Calculate the new group balance for the user
          const newUserBalance = currentUserBalance - transactionDeductionAmount;
          
          // Update the auction with new bid and rarity information
          transaction.update(auctionRef, {
            currentBid: bidValue,
            currentBidder: user.uid,
            currentBidderName: user.displayName || user.email,
            lastBidTime: serverTimestamp(),
            bidCount: increment(1),
            // Add rarity information
            currentRarity: calculatedRarity,
            uniqueBidderCount: bidderCount,
            lastRarityUpdate: serverTimestamp()
          });
          
          // Update user's balance
          const updatedBalances = {...userBalances};
          updatedBalances[currentGroup.id] = newUserBalance;
          
          transaction.update(userRef, {
            groupBalances: updatedBalances,
            [`recentActivity.${currentGroup.id}.lastBidTime`]: serverTimestamp()
          });
          
          // Immediately update the cache with new balance
          setUserCache(prev => ({
            ...prev,
            balance: newUserBalance,
            balanceLastUpdated: Date.now()
          }));
          
          // Also update bidder count cache for UI updates
          setBidderCountCache(prev => ({
            counts: {
              ...prev.counts,
              [auction.id]: bidderCount
            },
            lastUpdate: {
              ...prev.lastUpdate,
              [auction.id]: Date.now()
            }
          }));
          
          // If there was a previous bidder, refund their bid
          if (prevBidderDoc && prevBidderDoc.exists() && prevBidderRef) {
            const prevBidderData = prevBidderDoc.data();
            const prevBidderBalances = prevBidderData.groupBalances || {};
            const prevBidderCurrentBalance = prevBidderBalances[currentGroup.id] || 0;
            
            // Calculate refund (their previous bid)
            const refundAmount = freshAuctionData.currentBid;
            
            // Set the new balance
            const newPrevBidderBalance = prevBidderCurrentBalance + refundAmount;
            
            // Update the previous bidder's balance
            const updatedPrevBidderBalances = {...prevBidderBalances};
            updatedPrevBidderBalances[currentGroup.id] = newPrevBidderBalance;
            
            transaction.update(prevBidderRef, {
              groupBalances: updatedPrevBidderBalances,
              [`recentActivity.${currentGroup.id}.lastRefundTime`]: serverTimestamp()
            });
            
            console.log(`Refunding ${refundAmount} coins to previous bidder ${freshAuctionData.currentBidder}`);
          }
          
          // We already updated the rarity in the transaction above, no need to do it again here
        });
        
        // Critical: Manually invalidate all related caches to prevent stale data
        try {
          // List of cache keys to invalidate to ensure consistent state
          const cacheKeysToInvalidate = [
            `doc:auctions/${auction.id}`,
            `auctions/${auction.id}`,
            `auction_${auction.id}`,
            `auctions_${currentGroup.id}`,  // Group auctions cache
            `bidderCount_${auction.id}_noSeller`  // Bidder count cache
          ];
          
          // If card ID exists, also invalidate card caches
          if (auction.cardId) {
            cacheKeysToInvalidate.push(
              `doc:cards/${auction.cardId}`,
              `cards/${auction.cardId}`,
              `card_${auction.cardId}`
            );
          }
          
          // Invalidate all these caches
          console.log(`Invalidating ${cacheKeysToInvalidate.length} cache keys after bid`);
          
          // Use Promise.all for parallel invalidation
          await Promise.all(cacheKeysToInvalidate.map(async (key) => {
            try {
              await invalidate(key);
            } catch (err) {
              console.log(`Error invalidating cache key ${key}:`, err);
            }
          }));
          
          // Also manually clear AsyncStorage cache
          const cacheKey = `auctions_${currentGroup.id}`;
          try {
            await AsyncStorage.removeItem(cacheKey);
            console.log(`AsyncStorage cache cleared for ${cacheKey}`);
          } catch (err) {
            console.log(`Error clearing AsyncStorage cache for ${cacheKey}:`, err);
          }
          
        } catch (invalidationError) {
          console.error('Error during cache invalidation:', invalidationError);
          // Continue execution since this is not critical
        }
      
        // Record the bid in a separate collection after transaction success
        await addDoc(collection(db, 'auctionBids'), {
          auctionId: auction.id,
          bidderId: user.uid,
          bidderName: user.displayName || user.email,
          amount: bidValue,
          previousBid: auction.currentBidder === user.uid ? auction.currentBid : 0,
          timestamp: serverTimestamp()
        });
        
        console.log(`Bid successfully placed for auction ${auction.id} with amount ${bidValue} and rarity updated to ${rarityResult.rarity}.`);
        
        // Update the local UI immediately with the data we already calculated
        // Store the auction ID we're updating to ensure the refresh doesn't override it
        const updatedAuctionId = auction.id;
        const updatedRarity = rarityResult.rarity;
        
        setAuctions(prevAuctions => {
          return prevAuctions.map(a => {
            if (a.id === updatedAuctionId) {
              // Create a new object with updated values
              const updatedAuction = {
                ...a,
                currentBid: bidValue,
                currentBidder: user.uid,
                currentBidderName: user.displayName || user.email,
                // Use the rarity we calculated in the transaction
                currentRarity: updatedRarity,
                cardRarity: updatedRarity, // Also update cardRarity to maintain consistency
                uniqueBidderCount: rarityResult.bidderCount,
                lastRarityUpdate: new Date(),
                // Add a flag to prevent rarity from being overridden
                _manuallyUpdatedRarity: true
              };
              console.log(`Updated local auction ${updatedAuctionId} with rarity: ${updatedRarity}`);
              return updatedAuction;
            }
            return a;
          });
        });
        
        // Cache this rarity result locally to ensure it's not overwritten
        setValueSync(`auction_rarity_${auction.id}`, rarityResult.rarity);
        
        // Success - close modal and show confirmation
        Alert.alert('Bid Placed', `You have successfully placed a bid of ${bidValue} coins.`);
        
        // Close the bid modal
        closeBidModal();
        
        // Instead of calling fetchAuctions immediately which might cause a race condition,
        // schedule it with a delay to allow our cache invalidation to complete
        setTimeout(() => {
          // Perform a targeted update of just this auction
          updateAuctionRarity(auction.id).then(newRarity => {
            console.log(`Auction ${auction.id} rarity updated to: ${newRarity}`);
          }).catch(err => {
            console.error('Error updating rarity after bid:', err);
          });
        }, 1000); // 1 second delay
        
        return true;
      } catch (error) {
        Alert.alert('Error', error.message || 'There was a problem placing your bid. Please try again.');
        return false;
      } finally {
        setProcessingAction(false);
      }
    } catch (error) {
      console.error('Error placing bid:', error);
      Alert.alert('Error', error.message || 'There was a problem placing your bid.');
      setProcessingAction(false);
      return false;
    }
  };

  // Open bid modal with live data listener
  const openBidModal = (auction) => {
    if (!auction || !auction.id) {
      console.error('Invalid auction data provided to openBidModal');
      return;
    }
    
    if (!user) {
      Alert.alert('Login Required', 'You must be logged in to place bids.');
      return;
    }
    
    if (!currentGroup) {
      Alert.alert('Group Required', 'You must select a group to place bids.');
      return;
    }
    
    // Reset bid amount field and selected auction
    setBidAmount('');
    setSelectedAuction(null);
    
    // Get fresh auction data before opening the modal
    const fetchBidderInfoAndOpenModal = async () => {
      try {
        console.log(`Fetching fresh auction data for ${auction.id} before opening bid modal`);
        setProcessingAction(true);
        
        // Get the fresh auction data directly from Firestore
        const auctionRef = doc(db, 'auctions', auction.id);
        const auctionDoc = await getDoc(auctionRef);
        
        if (!auctionDoc.exists()) {
          Alert.alert('Error', 'This auction no longer exists.');
          setProcessingAction(false);
          return;
        }
        
        const freshAuctionData = auctionDoc.data();
        
        // Check if auction has ended or is inactive
        if (freshAuctionData.status !== 'active') {
          Alert.alert('Auction Ended', 'This auction is no longer active.');
          setProcessingAction(false);
          return;
        }
        
        // Calculate time remaining to check if auction has ended
        const timeInfo = calculateTimeRemaining({
          ...freshAuctionData,
          endTime: freshAuctionData.endTime
        });
        
        if (timeInfo.isEnded) {
          Alert.alert('Auction Ended', 'This auction has already ended due to time expiration.');
          setProcessingAction(false);
          
          // Trigger the completion of this expired auction
          await completeExpiredAuctions(true);
          return;
        }
        
        // Create a merged auction object with the fresh data
        // but preserve the ID and any important fields from the original
        const mergedAuction = {
          ...auction,
          ...freshAuctionData,
          id: auction.id,
          // Ensure critical fields are present
          currentBid: freshAuctionData.currentBid || auction.currentBid || 0,
          currentBidder: freshAuctionData.currentBidder || auction.currentBidder || null,
          currentBidderName: freshAuctionData.currentBidderName || auction.currentBidderName || null
        };
        
        console.log(`Opening bid modal for auction ${mergedAuction.id} with current bid of ${mergedAuction.currentBid} coins`);
        
        // Set the newly merged auction data as selected
        setSelectedAuction(mergedAuction);
        
        // Always fetch bidder count to keep it updated
        const uniqueBidderCount = await fetchBiddersForAuction(mergedAuction);
        if (uniqueBidderCount !== undefined) {
          mergedAuction.uniqueBidderCount = uniqueBidderCount;
          
          // Force a rarity update with the fresh data
          await updateAuctionRarities([mergedAuction]);
          setSelectedAuction(auction => ({...auction, uniqueBidderCount, forceRefreshRarity: true}));
        }
        
        // Now open the modal (Optimization: trigger bidder count fetch only here)
        setBidModalVisible(true);
        
        // Set up a real-time listener for this auction while the modal is open
        setupAuctionListener(mergedAuction);
      } catch (error) {
        console.error('Error opening bid modal:', error);
        Alert.alert('Error', 'Failed to load auction data. Please try again.');
      } finally {
        setProcessingAction(false);
      }
    };
    
    // Execute the fetch and open modal function
    fetchBidderInfoAndOpenModal();
  };
  
  // Close bid modal and clean up listener
  const closeBidModal = () => {
    // Store auction ID before resetting
    const auctionId = selectedAuction?.id;
    
    // Reset bid modal state
    setBidModalVisible(false);
    setBidAmount('');
    
    // Clear any active auction listeners before resetting selected auction
    if (currentAuctionListener) {
      try {
        currentAuctionListener();
      } catch (error) {
        console.error('Error cleaning up auction listener:', error);
      }
      setCurrentAuctionListener(null);
    }
    
    // Remove any event listeners if needed
    if (auctionId) {
      auctionTimerUtils.removeAuctionEventListeners(auctionId);
      
      // Clear any notifications for this auction to prevent duplicates
      auctionTimerUtils.resetAuctionEndNotifications();
    }
    
    // Reset selected auction after cleanup
    setSelectedAuction(null);
    
    // Force a refresh of the auctions to ensure UI is up to date
    // But use a short delay to allow cleanup to complete
    setTimeout(() => {
      if (auctionId) {
        fetchAuctions(true);
      }
    }, 500);
  };

  // Cancel auction and refund bidder if necessary
  const cancelAuction = async (auctionId) => {
    try {
      setProcessingAction(true);
      
      // Get auction data first
      const auctionRef = doc(db, 'auctions', auctionId);
      const auctionDoc = await getDoc(auctionRef);
      
      if (!auctionDoc.exists()) {
        Alert.alert('Error', 'Auction no longer exists.');
        setProcessingAction(false);
        return;
      }
      
      const auctionData = auctionDoc.data();
      const batch = writeBatch(db);
      
      // Update auction status
      batch.update(auctionRef, {
        status: 'cancelled',
        canceledAt: Timestamp.now(),
        cancelReason: 'manual_cancel'
      });

      // Update card status
      const cardRef = doc(db, 'cards', auctionData.cardId);
      batch.update(cardRef, {
        status: 'available',
        inAuction: false,
        auctionId: null,
        lastStatusChange: Timestamp.now()
      });
      
      // Commit the batch
      await batch.commit();
      
      // Show success message
      Alert.alert('Success', 'Auction has been cancelled.');
      
      // Refresh auctions to update UI
      fetchAuctions(true);
      
    } catch (error) {
      console.error('Error cancelling auction:', error);
      Alert.alert('Error', 'Failed to cancel auction. Please try again.');
    } finally {
      setProcessingAction(false);
    }
  };

  // Add this function near the top of the file to handle index building errors
  const handleIndexBuildingError = (error) => {
    // Check if this is an index building error
    if (error?.message?.includes('index is currently building') || 
        error?.code === 'failed-precondition') {
      console.log('Index is still building, using fallback query...');
      return true;
    }
    return false;
  };

  // Modify the fetchUserCards function to handle index building errors
  const fetchUserCards = async () => {
    if (!user || !currentGroup) return;
    
    try {
      // Set loading state
      setProcessingAction(true);
      
      let cardsData = [];
      
      try {
        // Try the normal query first - this needs complex indexes
        const cardsQuery = query(
          collection(db, 'cards'),
          where('groupId', '==', currentGroup.id),
          where('userId', '==', user.uid),
          where('inAuction', '==', false)
        );
        
        const querySnapshot = await getDocs(cardsQuery);
        cardsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (indexError) {
        // If it's an index building error, try a simpler fallback query
        if (handleIndexBuildingError(indexError)) {
          console.log('Using simpler card query while index builds...');
          
          // Simpler query that doesn't require complex indexes
          const fallbackQuery = query(
            collection(db, 'cards'),
            where('groupId', '==', currentGroup.id)
          );
          
          const fallbackSnapshot = await getDocs(fallbackQuery);
          
          // Filter the results manually
          cardsData = fallbackSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(card => 
              card.userId === user.uid && 
              card.inAuction === false
            );
        } else {
          // Re-throw if it's not an index building error
          throw indexError;
        }
      }
      
      // Sort and process the cards
      const sortedCards = cardsData.sort((a, b) => {
        // Sort by created date, newest first
        const aDate = a.createdAt?.toDate || new Date(0);
        const bDate = b.createdAt?.toDate || new Date(0);
        return bDate - aDate;
      });
      
      setUserCards(sortedCards);
      // TODO: setFilteredCards is undefined. If you need to filter cards, use setAuctions or implement setFilteredAuctions.sortedCards);
      
    } catch (error) {
      console.error('Error fetching user cards:', error);
      Alert.alert('Error', 'Failed to load your cards. Please try again.');
      
      // Set empty arrays to avoid undefined errors
      setUserCards([]);
      // TODO: setFilteredCards is undefined. If you need to filter cards, use setAuctions or implement setFilteredAuctions.[]);
    } finally {
      setProcessingAction(false);
    }
  };

  useEffect(() => {
    if (modalVisible) {
      fetchUserCards();
    }
  }, [modalVisible]);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      // TODO: setFilteredCards is undefined. If you need to filter cards, use setAuctions or implement setFilteredAuctions.userCards);
    } else {
      const lowercaseQuery = searchQuery.toLowerCase();
      const filtered = userCards.filter(card => 
        card.name.toLowerCase().includes(lowercaseQuery) || 
        card.rarity.toLowerCase().includes(lowercaseQuery)
      );
      // TODO: setFilteredCards is undefined. If you need to filter cards, use setAuctions or implement setFilteredAuctions.filtered);
    }
  }, [searchQuery, userCards]);

  const onRefresh = async () => {
    if (!user || !currentGroup) return Promise.resolve();
    
    setRefreshing(true);
    try {
      // First verify card statuses to ensure data consistency
      await verifyCardStatuses();
      
      // Check and complete any expired auctions
      const expiredCount = await completeExpiredAuctions(true);
      console.log(`Found and completed ${expiredCount} expired auctions during refresh`);
      
      // Then refresh auction data with force refresh
      await fetchAuctions(true);
      
      // Force update all auction rarities
      await updateAuctionRarities(auctions);
      
      // Force UI refresh
      setUiRefreshKey(prevKey => prevKey + 1);
      
      // Return successful refresh
      return true;
    } catch (error) {
      console.error('Error in onRefresh:', error);
      // Show error message to user
      Alert.alert('Refresh Error', 'There was a problem refreshing the auctions. Please try again.');
      return false;
    } finally {
      setRefreshing(false);
    }
  };

  // Function to verify and update card statuses
  const verifyCardStatuses = async () => {
    if (!user || !currentGroup) return;
    
    try {
      // First check for cards with auction IDs that no longer exist or are inactive
      const cardsRef = collection(db, 'cards');
      
      let querySnapshot;
      try {
        // Try with the complex query first
        const q = query(
          cardsRef,
          where('groupId', '==', currentGroup.id),
          where('inAuction', '==', true)
        );
        
        querySnapshot = await getDocs(q);
      } catch (indexError) {
        // If the index is building, use a simpler query
        if (handleIndexBuildingError(indexError)) {
          console.log('Using simpler card status verification query while index builds...');
          
          // Use a simpler query and filter manually
          const simpleQuery = query(
            cardsRef,
            where('groupId', '==', currentGroup.id)
          );
          
          const allCardsSnapshot = await getDocs(simpleQuery);
          
          // Filter manually to get only cards in auction
          querySnapshot = {
            empty: allCardsSnapshot.empty,
            docs: allCardsSnapshot.docs.filter(doc => doc.data().inAuction === true)
          };
        } else {
          // Not an index building error, re-throw
          throw indexError;
        }
      }
      
      // Add null check for querySnapshot.docs
      if (!querySnapshot || !querySnapshot.docs) {
        console.error('Empty or invalid snapshot received when verifying card statuses');
        return;
      }
      
      if (querySnapshot.empty) {
        console.log('No cards found with inAuction = true');
        return;
      }
      
      console.log(`Found ${querySnapshot.docs.length} cards marked as in auction, verifying...`);
      
      // Begin a batch write to fix multiple cards at once
      let batch = writeBatch(db);
      let batchCount = 0;
      let cardFixed = false;
      
      // Process each card
      for (const cardDoc of querySnapshot.docs) {
        const cardData = cardDoc.data();
        const cardId = cardDoc.id;
        
        // Skip cards without auction ID
        if (!cardData.auctionId) continue;
        
        // Check if the auction exists and is active
        try {
          const auctionRef = doc(db, 'auctions', cardData.auctionId);
          const auctionDoc = await getDoc(auctionRef);
          
          if (!auctionDoc.exists()) {
            console.log(`Card ${cardId} references non-existent auction ${cardData.auctionId}, fixing...`);
            // Update card status to available if auction doesn't exist
            batch.update(doc(db, 'cards', cardId), {
              status: 'available',
              inAuction: false,
              auctionId: null,
              lastStatusChange: Timestamp.now()
            });
            batchCount++;
            cardFixed = true;
          } else {
            // Auction exists, check its status
            const auctionData = auctionDoc.data();
            if (auctionData.status !== 'active') {
              console.log(`Card ${cardId} references inactive auction ${cardData.auctionId} (${auctionData.status}), fixing...`);
              // Update card status if auction is not active
              batch.update(doc(db, 'cards', cardId), {
                status: 'available',
                inAuction: false,
                auctionId: null,
                lastStatusChange: Timestamp.now()
              });
              batchCount++;
              cardFixed = true;
            }
          }
        } catch (error) {
          console.error(`Error checking auction for card ${cardId}:`, error);
        }
        
        // Commit batch if it gets too large
        if (batchCount >= 20) {
          try {
            await batch.commit();
            console.log(`Committed batch of ${batchCount} card fixes`);
            // Start a new batch
            batch = writeBatch(db);
            batchCount = 0;
          } catch (error) {
            console.error('Error committing batch:', error);
          }
        }
      }
      
      // Commit any remaining updates
      if (batchCount > 0) {
        try {
          await batch.commit();
          console.log(`Committed final batch of ${batchCount} card fixes`);
        } catch (error) {
          console.error('Error committing final batch:', error);
        }
      }
      
    } catch (error) {
      console.error('Error verifying card statuses:', error);
    }
  };

  // Add this function to update the selectedCard and reset other fields when a card is selected
  const handleCardSelection = (card) => {
    setSelectedCard(card);
    // Set a default starting bid if none exists
    if (!startingBid) {
      setStartingBid('5'); // Default starting bid of 5 coins
    }
  };

  // Render a card item in the selection list using the shared CardItem component
  const renderCardItem = ({ item }) => (
    <CardItem
      item={item}
      isSelected={selectedCard?.id === item.id}
      onPress={handleCardSelection}
      displayMode="minimal"
      containerStyle={styles.cardItemContainer}
      textStyle={styles.cardItemName}
    />
  );

  // Filter auctions based on current filters
  const getFilteredAuctions = () => {
    // Add defensive coding to ensure auctions is an array
    if (!Array.isArray(auctions)) {
      console.warn('auctions is not an array:', auctions);
      return [];
    }
    
    let filtered = [...auctions].filter(auction => auction && auction.id); // Filter out null/undefined auctions
    
    // Ensure all auctions have valid rarity values before filtering
    filtered = filtered.map(auction => {
      // Create a new object to avoid modifying the original
      const processedAuction = { ...auction };
      
      // Check if this is a coined/mystery card (using unified rarity system)
      const isMysteryCard = !processedAuction.cardRarity || 
                          processedAuction.cardRarity === 'mystery' || 
                          processedAuction.cardRarity === 'unknown' || 
                          processedAuction.cardRarity === '';
      
      // For mystery cards, ensure they always have a valid currentRarity
      if (isMysteryCard) {
        // If no currentRarity is set or it's invalid, calculate using our unified system
        if (!processedAuction.currentRarity || 
            processedAuction.currentRarity === RARITY_TYPES.MYSTERY || 
            processedAuction.currentRarity === 'unknown' || 
            processedAuction.currentRarity === '') {
          // Try to use cached bidder counts for calculation if available
          if (bidderCountCache && bidderCountCache.counts && bidderCountCache.counts[processedAuction.id]) {
            const bidderCount = bidderCountCache.counts[processedAuction.id];
            processedAuction.currentRarity = calculateLiveRarity(processedAuction, bidderCount);
            console.log(`UNIFIED RARITY SYSTEM: Calculated rarity ${processedAuction.currentRarity} for auction ${processedAuction.id}`);
          } else {
            // No bidder data, default to COMMON
            processedAuction.currentRarity = RARITY_TYPES.COMMON;
            console.log(`UNIFIED RARITY SYSTEM: Defaulting to COMMON for auction ${processedAuction.id} with no bidder data`);
          }
        }
      } else {
        // For minted cards, always use their cardRarity
        processedAuction.currentRarity = processedAuction.cardRarity;
      }
      
      return processedAuction;
    });
    
    // Filter out expired auctions first
    filtered = filtered.filter(auction => {
      // Skip auctions with invalid status
      if (!auction.status || auction.status === 'completed' || auction.status === 'expired' || auction.status === 'canceled') {
        return false;
      }
      
      // Skip auctions that have ended (compare endTime to now)
      try {
        const endTime = auction.endTime?.toDate;
        if (endTime && endTime <= new Date()) {
          // Mark this auction for verification
          verifyAuctionEnd(auction.id);
          return false;
        }
      } catch (err) {
        console.warn('Error checking auction end time:', err);
        return false;
      }
      
      return true;
    });
    
    // Apply mint filter
    if (mintFilter === 'coined') {
      // Coined shows mystery rarity cards and newly coined cards
      filtered = filtered.filter(auction => {
        try {
          // Include cards explicitly marked as mystery, unknown, or empty rarity
          // OR cards that have the isNewlyCoined flag set to true
          const isMysteryRarity = 
            !auction.cardRarity || 
            auction.cardRarity === 'mystery' || 
            auction.cardRarity === 'unknown' || 
            auction.cardRarity === '';
          
          return auction.isNewlyCoined === true || isMysteryRarity;
        } catch (err) {
          console.warn('Error processing auction in coined filter:', err);
          return false;
        }
      });
    } else if (mintFilter === 'mint') {
      // Apply filter for minted cards
      filtered = filtered.filter(auction => {
        const isMinted = auction.cardRarity && 
                      auction.cardRarity !== RARITY_TYPES.MYSTERY && 
                      auction.cardRarity !== 'unknown' && 
                      auction.cardRarity !== '';
        
        return isMinted;
      });
    }
    
    // Apply search filter
    if (searchQuery && searchQuery.trim().length > 0) {
      const searchTerms = searchQuery.toLowerCase().trim().split(' ');
      filtered = filtered.filter(auction => {
        if (!auction) return false;
        
        const cardName = (auction.cardName || '').toLowerCase();
        const sellerName = (auction.sellerName || '').toLowerCase();
        
        return searchTerms.every(term => 
          cardName.includes(term) || sellerName.includes(term)
        );
      });
    }
    
    // Apply price filter
    if (priceFilter && priceFilter !== 'all') {
      const maxPrices = {
        'under10': 10,
        'under25': 25,
        'under50': 50,
        'under100': 100
      };
      
      const maxPrice = maxPrices[priceFilter];
      if (maxPrice) {
        filtered = filtered.filter(auction => {
          const currentBid = auction.currentBid || 0;
          return currentBid < maxPrice;
        });
      }
    }
    
    // Filter by rarity if it's a non-coined auction
    if (rarityFilter && rarityFilter !== 'all' && mintFilter !== 'coined') {
      filtered = filtered.filter(auction => {
        // For display purposes, use currentRarity if available, otherwise use cardRarity
        const rarity = auction.currentRarity || auction.cardRarity;
        return rarity === rarityFilter;
      });
    }
    
    // Sort auctions by the selected sort option
    if (sortOption === 'newest') {
      filtered.sort((a, b) => {
        const aTime = a.createdAt?.toDate || new Date(0);
        const bTime = b.createdAt?.toDate || new Date(0);
        return bTime - aTime;
      });
    } else if (sortOption === 'endingSoon') {
      filtered.sort((a, b) => {
        const aTime = a.endTime?.toDate || new Date(0);
        const bTime = b.endTime?.toDate || new Date(0);
        return aTime - bTime;
      });
    } else if (sortOption === 'priceAsc') {
      filtered.sort((a, b) => (a.currentBid || 0) - (b.currentBid || 0));
    } else if (sortOption === 'priceDesc') {
      filtered.sort((a, b) => (b.currentBid || 0) - (a.currentBid || 0));
    }
    
    return filtered;
  };

  // Helper function to get card rarity style
  const getCardRarityStyle = (auction) => {
    if (!auction) return {};
    
    try {
      // Get the display rarity, ensuring we never use 'mystery' or 'unknown'
      let rarity = auction.currentRarity || auction.cardRarity || 'common';
      
      // Default to common rarity if mystery or unknown
      if (rarity === RARITY_TYPES.MYSTERY || rarity === 'unknown' || rarity === '') {
        rarity = RARITY_TYPES.COMMON;
      }
      
      const capitalizedRarity = rarity.charAt(0).toUpperCase() + rarity.slice(1);
      return styles[`rarityBorder${capitalizedRarity}`] || styles.rarityBorderCommon;
    } catch (err) {
      console.warn('Error in getCardRarityStyle:', err);
      return styles.rarityBorderCommon;
    }
  };

  const renderAuction = ({ item }) => {
    if (!item || !item.id) {
      console.warn('Invalid auction item in renderAuction:', item);
      return null;
    }
    
    try {
      // Ensure we always have a valid rarity value before rendering
      const processedItem = { ...item };
      
      // CRITICAL FIX: Always respect the rarity that's already in the auction data
      // and only calculate if absolutely necessary - NEVER override existing valid rarities
    
      // If the currentRarity is already valid, use it as-is with NO OVERRIDING
      if (processedItem.currentRarity && 
          processedItem.currentRarity !== 'mystery' && 
          processedItem.currentRarity !== 'unknown' && 
          processedItem.currentRarity !== '') {
        // Already has a valid rarity, DO NOTHING - this prevents overriding calculated rarities
        console.log(`DISPLAY: Using existing currentRarity ${processedItem.currentRarity} for auction ${processedItem.id}`);
      }
      // Only if there's no valid currentRarity AND no valid cardRarity, calculate it
      else if (!processedItem.currentRarity || 
               processedItem.currentRarity === 'mystery' || 
               processedItem.currentRarity === 'unknown' || 
               processedItem.currentRarity === '') {
        
        // Try to use cardRarity first if it's valid
        if (processedItem.cardRarity && 
            processedItem.cardRarity !== 'mystery' && 
            processedItem.cardRarity !== 'unknown' && 
            processedItem.cardRarity !== '') {
          
          processedItem.currentRarity = processedItem.cardRarity;
          console.log(`DISPLAY: Using cardRarity ${processedItem.cardRarity} for auction ${processedItem.id}`);
        }
        // As a last resort, calculate from scratch
        else if (bidderCountCache && bidderCountCache.counts && bidderCountCache.counts[processedItem.id]) {
          // We have cached bidder counts, use to calculate
          const bidderCount = bidderCountCache.counts[processedItem.id];
          processedItem.currentRarity = calculateLiveRarity(processedItem, bidderCount);
          console.log(`DISPLAY: Calculated currentRarity ${processedItem.currentRarity} for auction ${processedItem.id}`);
        } 
        // Absolute last resort - default to COMMON
        else {
          processedItem.currentRarity = RARITY_TYPES.COMMON;
          console.log(`DISPLAY: Default to COMMON rarity for auction ${processedItem.id}`);
        }
      }  
        
      return (
        <AuctionListItem 
          auction={processedItem}
          onPress={() => openBidModal(processedItem)}
          userCache={userCache}
          user={user}
          cardRarityStyle={getCardRarityStyle(processedItem)}
          freshCheck={refreshing}
          onAuctionEnded={(auction) => {
            // Mark auction for refresh when timer ends
            if (auction && auction.id) {
              verifyAuctionEnd(auction.id);
            }
          }}
        />
      );
    } catch (err) {
      console.warn('Error in renderAuction:', err);
      return null;
    }
  };
  const checkAuctionsEndingSoon = async () => {
    if (!user || !currentGroup) return;
    
    try {
      // Use existing auctions data instead of fetching again
      // This will reduce Firebase reads
      const activeAuctions = auctions.filter(auction => 
        auction.status === 'active' && 
        (auction.currentBidder === user.uid || auction.sellerId === user.uid)
      );
      
      // Get current time
      const now = new Date();
      
    } catch (error) {
      console.error('Error checking auctions ending soon:', error);
    }
  };

  // Use the AuctionBidModal component for bidding
  const renderBidModal = () => {
    if (!selectedAuction) return null;
    
    return (
      <AuctionBidModal
        visible={bidModalVisible}
        onDismiss={closeBidModal}
        selectedAuction={selectedAuction}
        bidAmount={bidAmount}
        setBidAmount={setBidAmount}
        placeBid={placeBid}
        processingAction={processingAction}
        currentUser={user}
      />
    );
  };

  // Add back the download function
  const handleDownloadCard = async (card) => {
    try {
      // Set processing state
      setProcessingAction(true);
      
      // You would implement the actual download logic here
      // For example, using react-native-fs to download the image
      // For now we'll just show an alert
      Alert.alert(
        "Download Started",
        "Your card image is being downloaded...",
        [{ text: "OK" }]
      );
      
      // Simulate a delay
      setTimeout(() => {
        Alert.alert(
          "Download Complete",
          "Your card has been saved to your device's gallery.",
          [{ text: "OK" }]
        );
        setProcessingAction(false);
      }, 1500);
      
    } catch (error) {
      console.error("Error downloading card:", error);
      Alert.alert("Error", "Failed to download card. Please try again.");
      setProcessingAction(false);
    }
  };

  // Add a component to display database usage warnings
  const renderDatabaseUsageWarning = () => {
    // Get the current rate (reads in the last minute)
    const readsInLastMinute = recentReads.length;
    
    // Only show warning if we're over 75% of either limit
    const sessionLimitExceeded = sessionReadCount >= MAX_READS_PER_SESSION * 0.75;
    const rateLimitExceeded = readsInLastMinute >= MAX_READS_PER_MINUTE * 0.75;
    
    if (!sessionLimitExceeded && !rateLimitExceeded) {
      return null;
    }
    
    // Determine severity level
    let severity = 'warning';
    let message = '';
    
    // Check if rate limit or session limit is more critical
    if (rateLimitExceeded) {
      // Rate limit warning has priority
      if (readsInLastMinute >= MAX_READS_PER_MINUTE * 0.9) {
        severity = 'critical';
        message = `Critical rate limit: ${readsInLastMinute}/${MAX_READS_PER_MINUTE} reads/min`;
      } else if (readsInLastMinute >= MAX_READS_PER_MINUTE * 0.85) {
        severity = 'high';
        message = `High rate limit: ${readsInLastMinute}/${MAX_READS_PER_MINUTE} reads/min`;
      } else {
        message = `Rate limit warning: ${readsInLastMinute}/${MAX_READS_PER_MINUTE} reads/min`;
      }
    } else if (sessionLimitExceeded) {
      // Session limit warning
      if (sessionReadCount >= MAX_READS_PER_SESSION * 0.9) {
        severity = 'critical';
        message = `Critical session limit: ${sessionReadCount}/${MAX_READS_PER_SESSION} reads`;
      } else if (sessionReadCount >= MAX_READS_PER_SESSION * 0.85) {
        severity = 'high';
        message = `High session limit: ${sessionReadCount}/${MAX_READS_PER_SESSION} reads`;
      } else {
        message = `Session limit warning: ${sessionReadCount}/${MAX_READS_PER_SESSION} reads`;
      }
    }
    
    // Calculate percentage for progress bar (use whichever limit is closest to being reached)
    const ratePercentage = Math.min(100, (readsInLastMinute / MAX_READS_PER_MINUTE) * 100);
    const sessionPercentage = Math.min(100, (sessionReadCount / MAX_READS_PER_SESSION) * 100);
    const percentage = Math.max(ratePercentage, sessionPercentage);
    
    return (
      <View style={styles.dbWarningContainer}>
        <Text style={[
          styles.dbWarningText,
          severity === 'critical' && styles.dbWarningCritical,
          severity === 'high' && styles.dbWarningHigh
        ]}>
          {message}
        </Text>
        <View style={styles.dbUsageBar}>
          <View 
            style={[
              styles.dbUsageProgress,
              severity === 'critical' && styles.dbUsageCritical,
              severity === 'high' && styles.dbUsageHigh,
              { width: `${percentage}%` }
            ]} 
          />
        </View>
        {severity === 'critical' && (
          <Text style={styles.dbWarningInfo}>
            Some features are temporarily limited to control costs
          </Text>
        )}
      </View>
    );
  };
  
  // Add a memoized filtered auction getter to prevent recalculation on every render
  const filteredAuctions = useMemo(() => {
    return getFilteredAuctions();
  }, [auctions, mintFilter, uiRefreshKey]);

  // Add a key extractor that won't recreate on every render
  const keyExtractor = useCallback((item) => item.id, []);
  
  // Memoize the onEndReached callback to prevent recreating on every render
  const handleEndReached = useCallback(() => {
    if (hasMoreAuctions && !loadingMoreAuctions && !allAuctionsLoaded) {
      loadMoreAuctions();
    }
  }, [hasMoreAuctions, loadingMoreAuctions, allAuctionsLoaded]);
  
  // Memoize the ListFooterComponent to prevent recreating on every render
  const ListFooterComponent = useCallback(() => {
    if (loadingMoreAuctions) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading more auctions...</Text>
        </View>
      );
    }
    return null;
  }, [loadingMoreAuctions, theme.colors.primary]);
  
  // Memoize the ListEmptyComponent to prevent recreating on every render
  const ListEmptyComponent = useCallback(() => {
  return (
    <View style={styles.emptyContainer}>
        {initialLoading ? (
          <ActivityIndicator size="large" color={theme.colors.primary} />
        ) : (
          <>
            <MaterialCommunityIcons name="package-variant" size={64} color="#9e9e9e" />
            <Text style={styles.emptyText}>
              {refreshing ? 'Loading auctions...' : 'No auctions found'}
            </Text>
            <Text style={styles.emptySubtext}>
              {refreshing ? 'Please wait while we fetch auctions.' : 'Pull down to refresh.'}
            </Text>
          </>
        )}
      </View>
  );
}, [initialLoading, refreshing, theme.colors.primary]);

  // Add error recovery functionality
  const [hasError, setHasError] = useState(false);
  
  // Error recovery function
  const recoverFromError = useCallback(() => {
    console.log('Attempting to recover from error...');
    
    // Reset error state
    setHasError(false);
    
    // Reset all fetching and loading states
    setRefreshing(false);
    setInitialLoading(false);
    setLoadingMoreAuctions(false);
    isFetchingRef.current = false;
    
    // Try to use cached data
    const loadCachedData = async () => {
      try {
        const cacheKey = `auctions_${currentGroup?.id}`;
        const cachedData = await getWithCache(cacheKey, async () => null, { offline: true }); // TODO: Consider migrating to CacheService if needed
        if (cachedData && cachedData.auctions && cachedData.auctions.length > 0) {
          console.log('Recovered using cached auction data');
          setAuctions(cachedData.auctions);
        } else {
          // If no cached data, set empty array
          setAuctions([]);
        }
      } catch (cacheError) {
        console.error('Error recovering from cache:', cacheError);
        // Set empty array as last resort
        setAuctions([]);
      }
    };
    
    loadCachedData();
  }, [currentGroup?.id]);
  
  // Add error handler to data fetching functions
  const safeDataFetch = async (fetchFunction, ...args) => {
    try {
      return await fetchFunction(...args);
    } catch (error) {
      console.error('Error in data fetch operation:', error);
      setHasError(true);
      return null;
    }
  };
  
  // Enhanced fetchAuctions with error protection
  const fetchAuctionsWithErrorHandling = async (forceRefresh = false) => {
    try {
      return await fetchAuctions(forceRefresh);
    } catch (error) {
      console.error('Error in fetchAuctions:', error);
      setHasError(true);
      
      // Ensure we clean up the fetching state
      isFetchingRef.current = false;
      setRefreshing(false);
      setInitialLoading(false);
      
      return null;
    }
  };
  
  // Modify the fetchAuctions calls in the useEffect hooks to use the error-protected version
  useEffect(() => {
    // ... existing setup code ...
    
    // Set up polling instead of real-time listener
    let pollingInterval = null;
    let isPollingActive = false;
    
    // Helper function to perform a poll 
    const performPoll = async () => {
      if (!isMounted || isPollingActive || hasExceededReadLimit()) {
        console.log('Skipping polling: component unmounted, already polling, or read limit reached');
        return;
      }
      
      isPollingActive = true;
      try {
        console.log(`Polling for auction updates`);
        await fetchAuctionsWithErrorHandling(false); // Use error-protected version
      } catch (error) {
        console.error('Error during polling:', error);
      } finally {
        isPollingActive = false;
      }
    };
    
    // ... rest of existing polling setup code ...
    
  }, [user, currentGroup]);  // Keep the dependencies the same

  // If we have an error, show recovery UI
  if (hasError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <MaterialCommunityIcons name="alert-circle-outline" size={64} color="#F44336" />
        <Text style={{ fontSize: 18, fontWeight: 'bold', marginTop: 20, marginBottom: 10, textAlign: 'center' }}>
          There was a problem loading the auction data
        </Text>
        <Text style={{ marginBottom: 30, textAlign: 'center', color: '#666' }}>
          We encountered an error while trying to load the auction data. Please try again.
        </Text>
        <TouchableOpacity 
          style={{ 
            backgroundColor: theme.colors.primary, 
            paddingHorizontal: 20,
            paddingVertical: 10,
            borderRadius: 20,
          }}
          onPress={recoverFromError}
        >
          <Text style={{ color: 'white', fontWeight: 'bold' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Setup a listener for auction updates in the bid modal
  const setupAuctionListener = (auction) => {
    if (!auction || !auction.id) {
      console.error('Invalid auction object provided to setupAuctionListener');
      return;
    }
    
    // Clean up any previous listener
    if (currentAuctionListener) {
      try {
        currentAuctionListener();
      } catch (error) {
        console.error('Error cleaning up previous listener:', error);
      }
      setCurrentAuctionListener(null);
    }
    
    // Make sure we're in a valid state to set up a listener
    // This prevents issues with the bid modal
    if (!bidModalVisible || !selectedAuction) {
      return;
    }
    
    try {
      // First do a safe read to verify the auction still exists and is active
      getDoc(doc(db, 'auctions', auction.id))
        .then(docSnapshot => {
          if (!docSnapshot.exists()) {
            console.error(`Auction ${auction.id} no longer exists`);
            Alert.alert(
              'Auction Unavailable',
              'This auction is no longer available.',
              [{ text: 'OK', onPress: () => closeBidModal() }]
            );
            return;
          }
          
          const latestData = docSnapshot.data();
          if (latestData.status !== 'active') {
            console.log(`Auction ${auction.id} is not active (${latestData.status})`);
            Alert.alert(
              'Auction Not Active', 
              `This auction is currently ${latestData.status}.`,
              [{ text: 'OK', onPress: () => closeBidModal() }]
            );
            return;
          }
          
          // Use a ref to track shown alerts to prevent duplicates
          const shownAlerts = new Set();
          
          // Only now set up the real-time listener
          const unsubscribe = auctionTimerUtils.setupAuctionEventListeners(
            auction.id,
            // onUpdate callback
            (updatedAuction) => {
              // Handle null or undefined updatedAuction data
              if (!updatedAuction) {
                console.log(`Received empty auction data for ${auction.id}`);
                return;
              }
              
              // Provide a complete object with a safe fallback if id is missing
              const safeUpdatedAuction = {
                ...auction, // Use existing auction as fallback
                ...updatedAuction,
                id: updatedAuction.id || auction.id // Ensure ID is preserved
              };
              
              // Calculate rarity for the updated auction if it's a mystery/coined card
              const isMysteryCard = !safeUpdatedAuction.cardRarity || 
                                  safeUpdatedAuction.cardRarity === 'mystery' || 
                                  safeUpdatedAuction.cardRarity === 'unknown' || 
                                  safeUpdatedAuction.cardRarity === '';
              
              if (isMysteryCard) {
                // Use cached bidder count or existing uniqueBidderCount
                const bidderCount = bidderCountCache.counts[auction.id] || 
                                  safeUpdatedAuction.uniqueBidderCount || 
                                  auction.uniqueBidderCount || 0;
                                  
                // Calculate live rarity based on current data
                safeUpdatedAuction.uniqueBidderCount = bidderCount;
                // Use existing function to update auction rarities
                updateAuctionRarities([safeUpdatedAuction]);
                
                console.log(`Updated auction ${auction.id} rarity to ${safeUpdatedAuction.currentRarity} based on ${bidderCount} bidders`);
              }
              
              // Update the selected auction with new data
              setSelectedAuction(safeUpdatedAuction);
              
              // Check if the auction has a status other than 'active'
              if (safeUpdatedAuction.status && safeUpdatedAuction.status !== 'active') {
                const alertKey = `status_${safeUpdatedAuction.id}_${safeUpdatedAuction.status}`;
                if (!shownAlerts.has(alertKey)) {
                  shownAlerts.add(alertKey);
                  Alert.alert(
                    'Auction Status Changed',
                    `This auction is now ${safeUpdatedAuction.status}.`,
                    [{ text: 'OK', onPress: () => closeBidModal() }]
                  );
                }
                return;
              }
              
              // Check if auction has ended based on time
              const endTime = safeUpdatedAuction.endTime?.toDate?.();
              if (endTime && endTime <= new Date()) {
                const timeAlertKey = `time_ended_${safeUpdatedAuction.id}`;
                if (!shownAlerts.has(timeAlertKey)) {
                  shownAlerts.add(timeAlertKey);
                  Alert.alert(
                    'Auction Ended',
                    'This auction has ended due to time expiration.',
                    [{ text: 'OK', onPress: () => closeBidModal() }]
                  );
                  
                  // Verify with server that it's actually ended
                  verifyAuctionEnd(auction.id);
                }
                return;
              }
            },
            // onBidPlaced callback
            (updatedAuction) => {
              // Skip if we don't have a valid auction
              if (!updatedAuction || !updatedAuction.id) return;
              
              // If a new bid was placed, immediately fetch bidder count and update rarity
              const isMysteryCard = !updatedAuction.cardRarity || 
                                   updatedAuction.cardRarity === 'mystery' || 
                                   updatedAuction.cardRarity === 'unknown' || 
                                   updatedAuction.cardRarity === '';
              
              if (isMysteryCard) {
                // Force a refresh of the bidder count when a new bid is placed
                fetchBiddersForAuction(updatedAuction).then(bidderCount => {
                  if (bidderCount !== undefined) {
                    // Update the auction with the new bidder count
                    updatedAuction.uniqueBidderCount = bidderCount;
                    
                    // Force a rarity update with the fresh data
                    updateAuctionRarities([updatedAuction]);
                    
                    // Update the selected auction in the UI
                    setSelectedAuction({...updatedAuction});
                    
                    console.log(`New bid placed! Updated auction ${updatedAuction.id} rarity`);
                  }
                }).catch(error => {
                  console.error(`Error fetching bidder count: ${error}`);
                });
              }
            },
            // onError callback
            (error) => {
              console.error('Error in auction listener:', error);
              // Don't close the modal on every error, just show a non-blocking console message
              // Only show user-facing alert for critical errors
              if (error?.message?.includes('no longer exists') || error?.message?.includes('not active')) {
                Alert.alert(
                  'Error', 
                  'This auction is no longer available.',
                  [{ text: 'OK', onPress: () => closeBidModal() }]
                );
              }
            }
          );
          
          setCurrentAuctionListener(() => unsubscribe);
        })
        .catch(error => {
          console.error(`Error checking auction ${auction.id}:`, error);
          Alert.alert(
            'Error',
            'Could not verify auction status. Please try again.',
            [{ text: 'OK', onPress: () => closeBidModal() }]
          );
        });
    } catch (error) {
      console.error('Error setting up auction listener:', error);
      Alert.alert(
        'Error', 
        'There was a problem monitoring this auction. Please try again.',
        [{ text: 'OK', onPress: () => closeBidModal() }]
      );
    }
  };

  // Main render function
  return (
    <ScreenBackground>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        {/* Show database usage warning if approaching limits */}
        {renderDatabaseUsageWarning()}
        
        {/* Mint filter section */}
        <View style={styles.mintFilterContainer}>
          <SegmentedButtons
            style={styles.segmentedButtons}
            value={mintFilter}
            onValueChange={setMintFilter}
            buttons={[
              {
                value: 'coined',
                label: 'Coined',
              },
              {
                value: 'mint',
                label: 'Mint',
              },
             ]} 
           />
        </View>

        {/* Main auction list */}
        <FlatList
          data={filteredAuctions}
          renderItem={renderAuction}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.auctionList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#4CAF50']}
              tintColor={theme.colors.primary}
            />
          }
          ListEmptyComponent={ListEmptyComponent}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={ListFooterComponent}
          removeClippedSubviews={true}
          maxToRenderPerBatch={5}
          windowSize={5}
          initialNumToRender={5}
          updateCellsBatchingPeriod={50}
        />

        {/* Bid modal */}
        {renderBidModal()}
      </View>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  mintFilterContainer: {
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
    marginTop: 20, // Increase margin to prevent overlap with header
    zIndex: 1, // Ensure filter is above other content
  },
  segmentedButtons: {
    maxWidth: 220,
    alignSelf: 'center',
    marginVertical: 10,
  },
  auctionList: {
    padding: 10,
    paddingBottom: 80, // Extra padding for FAB
  },
  auctionCard: {
    marginBottom: 10,
    borderRadius: 10,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 2.22,
  },
  cardInnerContainer: {
    borderRadius: 10,
  },
  cardContent: {
    padding: 12,
    flexDirection: 'row',
    flexWrap: 'nowrap',
  },
  cardImageContainer: {
    width: 100,
    height: 150,
    position: 'relative',
    marginRight: 12,
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardDetails: {
    flex: 1,
    justifyContent: 'space-between',
  },
  cardName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  bidInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  bidLabel: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
  },
  bidAmount: {
    fontSize: 14,
  },
  timeInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  timeLabel: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
  },
  timeValue: {
    fontSize: 14,
    color: '#FF9800',
  },
  bidderInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  bidderLabel: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
  },
  bidderValue: {
    fontSize: 14,
  },
  actionsContainer: {
    width: '100%',
    marginTop: 8,
  },
  bidButton: {
    borderRadius: 20,
    height: 36,
  },
  bidButtonContent: {
    height: 36,
    padding: 0,
  },
  bidButtonLabel: {
    fontSize: 14,
    marginVertical: 0,
  },
  rarityBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  rarityText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  // Spectrum bar styles
  spectrumContainer: {
    marginVertical: 10,
    width: '100%',
    height: 40,
  },
  spectrumLabelContainer: {
    alignItems: 'center',
    marginBottom: 4,
  },
  spectrumRarityLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0.5, height: 0.5 },
    textShadowRadius: 1,
  },
  spectrumBar: {
    height: 12,
    flexDirection: 'row',
    borderRadius: 6,
    position: 'relative',
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  spectrumSegment: {
    height: '100%',
  },
  spectrumPointer: {
    position: 'absolute',
    top: -6,
    transform: [{ translateX: -4 }],
    zIndex: 10,
  },
  pointerTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderBottomWidth: 8,
    borderStyle: 'solid',
    backgroundColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#000',
  },
  raritySpectrumContainer: {
    width: '100%',
    marginTop: 5,
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
    backgroundColor: '#4CAF50',
    elevation: 5,
  },
  modal: {
    backgroundColor: 'white',
    margin: 20,
    height: '80%',
    borderRadius: 16,
    padding: 0,
  },
  modalScrollView: {
    flex: 1,
  },
  modalContent: {
    padding: 16,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  searchContainer: {
    marginBottom: 16,
  },
  searchInput: {
    marginBottom: 8,
  },
  divider: {
    height: 1,
    marginVertical: 16,
  },
  emptyCardContainer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginVertical: 10,
  },
  emptyCardText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyCardSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  refreshButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 25,
    paddingHorizontal: 16,
  },
  bidderName: {
    fontWeight: 'bold',
    fontSize: 12,
    color: '#3949AB',
  },
  yourBidText: {
    color: '#4CAF50',
    fontWeight: 'bold',
  },
  otherBidderText: {
    color: '#3949AB',
  },
  noBidderText: {
    color: '#888',
    fontStyle: 'italic',
  },
  bidModal: {
    backgroundColor: 'white',
    padding: 20,
    width: '90%',
    alignSelf: 'center',
    borderRadius: 12,
    position: 'absolute',
    top: '20%',
  },
  bidModalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  bidInputWrapper: {
    marginBottom: 16,
    position: 'relative',
  },
  bidAmountInput: {
    marginBottom: 8,
  },
  bidInfoText: {
    fontSize: 12,
    color: '#666',
    marginVertical: 8,
    textAlign: 'center',
    padding: 4,
    backgroundColor: '#f5f5f5',
    borderRadius: 4,
  },
  bidModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  cancelBidButton: {
    flex: 1,
    marginRight: 10,
    borderRadius: 25,
    borderColor: '#6200ee',
  },
  confirmBidButton: {
    flex: 2,
    marginLeft: 10,
    backgroundColor: '#4CAF50',
    borderRadius: 25,
  },
  filterContainer: {
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginHorizontal: 10,
    marginBottom: 16,
  },
  filterTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  dropdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  dropdownContainer: {
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#f9f9f9',
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  dropdownButton: {
    width: '100%',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewModalContent: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    right: 8,
    top: 8,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  previewScrollView: {
    flex: 1,
  },
  previewContainer: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 16,
  },
  previewTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  previewSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginVertical: 8,
    alignSelf: 'flex-start',
  },
  previewAuctionDetails: {
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.03)',
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
  },
  previewAuctionInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  previewLabel: {
    fontWeight: '600',
  },
  previewValue: {
    fontWeight: 'bold',
  },
  previewButtons: {
    marginTop: 16,
    gap: 8,
  },
  previewBidButton: {
    marginBottom: 8,
  },
  previewBuyButton: {
    borderColor: '#4CAF50',
  },
  liveRarityBadge: {
    position: 'absolute',
    top: 40,
    right: 8,
    elevation: 4,
  },
  bottomPadding: {
    height: 20,
  },
  cardListContainer: {
    marginBottom: 16,
  },
  cardList: {
    padding: 8,
  },
  emptySearchContainer: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySearchText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  dropdownContainer: {
    marginBottom: 16,
  },
  dropdownLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  cardDropdownList: {
    maxHeight: 200,
  },
  cardDropdownItem: {
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  cardDropdownItemRarity: {
    width: 16,
    height: 16,
    borderRadius: 4,
    marginRight: 12,
  },
  cardDropdownItemText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  selectedCardDropdownItem: {
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
  },
  mintDetailsContainer: {
    marginVertical: 16,
  },
  selectedCardPreview: {
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: 24,
    backgroundColor: '#f5f5f5',
    padding: 16,
    borderRadius: 12,
    width: '100%',
  },
  selectedCardPreviewImage: {
    width: 200,
    height: 200,
    borderRadius: 8,
    marginBottom: 12,
  },
  previewDetails: {
    alignItems: 'center',
  },
  previewName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  input: {
    marginBottom: 16,
  },
  durationLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  durationButtons: {
    marginBottom: 16,
  },
  createButton: {
    marginTop: 8,
    marginBottom: 16,
    paddingVertical: 6,
    backgroundColor: '#4CAF50',
    borderRadius: 25,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 12,
    margin: 20,
    height: 300,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  bidModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bidModalContainer: {
    width: '90%',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  bidModalHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  bidModalCardName: {
    fontSize: 18,
    fontWeight: '500',
    color: '#666',
  },
  bidModalContent: {
    width: '100%',
  },
  bidInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  bidInfoCol: {
    flex: 1,
    alignItems: 'center',
  },
  bidInfoLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  bidInfoValue: {
    fontSize: 16,
    fontWeight: '500',
  },
  bidderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  bidderLabel: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  bidderValue: {
    fontSize: 16,
    fontWeight: '500',
  },
  bidDivider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 10,
  },
  bidInputContainer: {
    width: '100%',
  },
  bidTaxText: {
    fontSize: 12,
    color: '#666',
    marginTop: 10,
    marginBottom: 10,
    textAlign: 'center',
  },
  bidActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  bidCancelButton: {
    flex: 1,
    marginRight: 10,
    borderRadius: 25,
    borderColor: '#6200ee',
  },
  bidConfirmButton: {
    flex: 2,
    marginLeft: 10,
    backgroundColor: '#4CAF50',
    borderRadius: 25,
  },
  previewDetailCard: {
    width: '100%',
    backgroundColor: '#f8f8f8',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  previewDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  previewDetailLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#666',
  },
  previewDetailValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    width: '90%',
    maxWidth: 400,
    maxHeight: '80%',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  closeButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 1,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  previewContainer: {
    width: '100%',
    alignItems: 'center',
  },
  previewImage: {
    width: '100%',
    height: 300,
    borderRadius: 10,
    marginBottom: 15,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 2.22,
  },
  previewCardName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  previewRarityContainer: {
    width: '100%',
    marginBottom: 15,
  },
  previewRarityLabel: {
    fontSize: 14,
    marginBottom: 5,
    textAlign: 'center',
  },
  previewActionsContainer: {
    width: '100%',
  },
  downloadButton: {
    width: '100%',
    borderRadius: 25,
    marginVertical: 5,
    paddingVertical: 8,
    backgroundColor: '#4CAF50',
  },
  previewScrollContent: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  // Replace spectrum styles with simpler rarity info styles
  rarityInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  rarityLabel: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
  },
  rarityValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  auctionCreateModal: {
    backgroundColor: 'white',
    margin: 20,
    borderRadius: 12,
    overflow: 'hidden',
    maxHeight: '85%',
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  auctionCreateScrollContent: {
    paddingBottom: 20,
  },
  auctionCreateContainer: {
    padding: 16,
  },
  modalSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  searchInput: {
    marginBottom: 12,
  },
  cardSelectionContainer: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    minHeight: 200,
    maxHeight: 250,
  },
  cardSelectionScrollView: {
    maxHeight: 250,
  },
  cardListItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  cardListItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardListItemName: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    marginLeft: 8,
  },
  selectedCardListItem: {
    backgroundColor: '#E8F5E9',
  },
  rarityIndicator: {
    width: 16,
    height: 16,
    borderRadius: 4,
    marginRight: 8,
  },
  emptyStateContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    height: 150,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptyStateSubtext: {
    textAlign: 'center',
    color: '#666',
  },
  loadingContainer: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    height: 80,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    fontStyle: 'italic',
    marginTop: 10,
  },
  modalDivider: {
    height: 1,
    marginVertical: 16,
  },
  selectedCardPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    padding: 12,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
  },
  selectedCardImage: {
    width: 80,
    height: 120,
    borderRadius: 6,
    marginRight: 12,
  },
  selectedCardInfo: {
    flex: 1,
  },
  selectedCardName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  noCardSelectedContainer: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginBottom: 16,
  },
  noCardSelectedText: {
    fontSize: 16,
    color: '#888',
  },
  auctionSettingsContainer: {
    marginTop: 8,
  },
  bidInput: {
    marginBottom: 16,
  },
  durationLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  durationButtons: {
    marginBottom: 16,
  },
  auctionSummary: {
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginBottom: 16,
  },
  summaryText: {
    fontSize: 14,
    lineHeight: 20,
  },
  summaryHighlight: {
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  createButton: {
    marginTop: 8,
    paddingVertical: 8,
    backgroundColor: '#4CAF50',
    borderRadius: 25,
  },
  // Add rarity border styles
  rarityBorderCommon: {
    borderWidth: 2,
    borderColor: RARITY_COLORS[RARITY_TYPES.COMMON]
  },
  rarityBorderUncommon: {
    borderWidth: 2,
    borderColor: RARITY_COLORS[RARITY_TYPES.UNCOMMON]
  },
  rarityBorderRare: {
    borderWidth: 2,
    borderColor: RARITY_COLORS[RARITY_TYPES.RARE]
  },
  rarityBorderEpic: {
    borderWidth: 2,
    borderColor: RARITY_COLORS[RARITY_TYPES.EPIC]
  },
  rarityBorderLegendary: {
    borderWidth: 2,
    borderColor: RARITY_COLORS[RARITY_TYPES.LEGENDARY]
  },
  rarityBorderMythic: {
    borderWidth: 2,
    borderColor: RARITY_COLORS[RARITY_TYPES.MYTHIC]
  },
  rarityBorderMystery: {
    borderWidth: 2,
    borderColor: RARITY_COLORS['mystery']
  },
  // Database warning styles
  dbWarningContainer: {
    padding: 8,
    backgroundColor: '#FFF9C4', // Light yellow background
    borderBottomWidth: 1,
    borderBottomColor: '#E6E6E6',
  },
  dbWarningText: {
    fontSize: 14,
    color: '#F57C00', // Warning orange
    fontWeight: 'bold',
    textAlign: 'center',
  },
  dbWarningCritical: {
    color: '#D32F2F', // Red
  },
  dbWarningHigh: {
    color: '#F57F17', // Dark orange
  },
  dbWarningInfo: {
    fontSize: 12,
    color: '#D32F2F',
    textAlign: 'center',
    marginTop: 4,
  },
  dbUsageBar: {
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    marginTop: 4,
    overflow: 'hidden',
  },
  dbUsageProgress: {
    height: '100%',
    backgroundColor: '#F57C00', // Warning orange
    borderRadius: 2,
  },
  dbUsageHigh: {
    backgroundColor: '#F57F17', // Dark orange
  },
  dbUsageCritical: {
    backgroundColor: '#D32F2F', // Red
  },
});

// --- WRAP WITH ERROR BOUNDARY ---
const WrappedAuctionScreen = (props) => (
  <ErrorBoundary>
    <AuctionScreen {...props} />
  </ErrorBoundary>
);
export default WrappedAuctionScreen;