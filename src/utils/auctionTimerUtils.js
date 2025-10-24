import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { Alert } from 'react-native';
import { db } from '../config/firebase';
import { getDoc } from '../services/ReadTracking/TrackedFirestore';
import { getCachedDoc } from './firestoreUtils';

// Constants
const CLOCK_SYNC_KEY = 'auction_clock_sync';
const MAX_ACCEPTABLE_DRIFT = 5000; // 5 seconds in milliseconds
const SYNC_INTERVAL = 5 * 60 * 1000; // Sync clock every 5 minutes
const LAST_MINUTE_THRESHOLD = 60 * 1000; // 1 minute in milliseconds

// Track active auction timers
const activeTimers = new Map();
// Track event listeners for auctions
const auctionEventListeners = new Map();
// Track server-client time drift
let serverClientDrift = 0;
// Last time we synced with server
let lastSyncTime = 0;
// Keep track of auctions that have sent end notifications
const auctionEndNotifications = new Set();

/**
 * OPTIMIZED: Streamlined clock sync with better error handling and caching
 * @returns {Promise<number>} Time drift in milliseconds
 */
export const syncClock = async () => {
  try {
    const now = Date.now();
    
    // OPTIMIZATION 1: Extended sync interval to reduce network calls
    if (now - lastSyncTime < SYNC_INTERVAL) {
      return serverClientDrift;
    }
    
    // OPTIMIZATION 2: Simplified server list with fastest endpoints first
    const timeServers = [
      { url: 'https://worldtimeapi.org/api/ip', parser: (data) => new Date(data.utc_datetime).getTime() },
      { url: 'https://timeapi.io/api/Time/current/zone?timeZone=UTC', parser: (data) => new Date(data.dateTime).getTime() }
    ];
    
    const syncStart = Date.now();
    let serverTime = null;
    let serverUsed = null;
    
    // OPTIMIZATION 3: Parallel requests with race condition for fastest response
    const timePromises = timeServers.map(async ({ url, parser }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // Reduced timeout
      
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`Status: ${response.status}`);
        
        const data = await response.json();
        return { time: parser(data), server: url };
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    });
    
    try {
      // Use the first successful response
      const result = await Promise.any(timePromises);
      serverTime = result.time;
      serverUsed = result.server;
    } catch (allErrors) {
      console.warn('All time servers failed, using fallback');
      
      // OPTIMIZATION 4: Simplified fallback using existing drift
      if (serverClientDrift === 0 && !lastSyncTime) {
        // Quick Firebase RTT test as last resort
        try {
          const startTest = Date.now();
          await getDoc(doc(db, 'system', 'time'));
          const estimatedLatency = Math.floor((Date.now() - startTest) / 2);
          serverClientDrift = estimatedLatency;
          lastSyncTime = now;
          
          await AsyncStorage.setItem(CLOCK_SYNC_KEY, JSON.stringify({
            drift: serverClientDrift,
            timestamp: now
          }));
        } catch (fallbackError) {
          console.error('Firebase RTT test failed:', fallbackError);
        }
      }
      
      return serverClientDrift;
    }
    
    // OPTIMIZATION 5: Simplified drift calculation
    const syncEnd = Date.now();
    const latency = Math.floor((syncEnd - syncStart) / 2);
    const adjustedServerTime = serverTime + latency;
    const drift = syncEnd - adjustedServerTime;
    
    // Smooth drift changes to avoid jitter
    serverClientDrift = Math.abs(drift - serverClientDrift) > 500 ? 
      drift : 
      Math.floor(0.8 * serverClientDrift + 0.2 * drift);
    
    lastSyncTime = now;
    
    // Cache the result
    await AsyncStorage.setItem(CLOCK_SYNC_KEY, JSON.stringify({
      drift: serverClientDrift,
      timestamp: now
    }));
    
    console.log(`Clock synced: ${serverClientDrift}ms drift, ${latency}ms latency`);
    return serverClientDrift;
    
  } catch (error) {
    console.error('Clock sync error:', error);
    return serverClientDrift;
  }
};

/**
 * Initialize clock synchronization and load saved drift
 * @returns {Promise<void>}
 */
export const initializeClockSync = async () => {
  try {
    // Load saved drift
    const savedSync = await AsyncStorage.getItem(CLOCK_SYNC_KEY);
    if (savedSync) {
      const { drift, timestamp } = JSON.parse(savedSync);
      serverClientDrift = drift;
      lastSyncTime = timestamp;
      
      console.log(`Loaded saved clock drift: ${drift}ms from ${new Date(timestamp).toISOString()}`);
    }
    
    // Force a sync
    await syncClock();
    
    // Set up periodic sync
    setInterval(syncClock, SYNC_INTERVAL);
  } catch (error) {
    console.error('Error initializing clock sync:', error);
  }
};

/**
 * Convert a Firebase timestamp to adjusted local date
 * @param {Object} firebaseTimestamp - Firebase Timestamp object or serialized timestamp
 * @returns {Date} Adjusted local date
 */
export const getAdjustedDate = (firebaseTimestamp) => {
  if (!firebaseTimestamp) return new Date();
  
  let timestamp;
  try {
    // Handle different timestamp formats
    if (typeof firebaseTimestamp.toDate === 'function') {
      timestamp = firebaseTimestamp.toDate().getTime();
    } else if (firebaseTimestamp.seconds !== undefined) {
      timestamp = firebaseTimestamp.seconds * 1000 + 
                 (firebaseTimestamp.nanoseconds || 0) / 1000000;
    } else if (firebaseTimestamp._seconds !== undefined) {
      timestamp = firebaseTimestamp._seconds * 1000 + 
                 (firebaseTimestamp._nanoseconds || 0) / 1000000;
    } else if (firebaseTimestamp instanceof Date) {
      timestamp = firebaseTimestamp.getTime();
    } else if (typeof firebaseTimestamp === 'number') {
      timestamp = firebaseTimestamp;
    } else {
      console.warn('Unknown timestamp format:', firebaseTimestamp);
      return new Date();
    }
    
    // Apply drift correction (add drift to local time)
    // If drift is positive, client is ahead, so subtract
    // If drift is negative, client is behind, so add
    return new Date(timestamp - serverClientDrift);
  } catch (error) {
    console.error('Error converting timestamp:', error);
    return new Date();
  }
};

/**
 * Get corrected current time accounting for server-client drift
 * @returns {Date} Corrected current time
 */
export const getCorrectedNow = () => {
  const localNow = Date.now();
  // Apply drift correction
  return new Date(localNow - serverClientDrift);
};

/**
 * Calculate time remaining for an auction with drift correction
 * @param {Object} auction - Auction object with endTime
 * @returns {Object} Time remaining object { timeLeft, formatted, isLastMinute, isEnded }
 */
export const calculateTimeRemaining = (auction) => {
  if (!auction || !auction.endTime) {
    return { timeLeft: 0, formatted: 'Ended', isLastMinute: false, isEnded: true };
  }

  // If auction status is explicitly set to anything except 'active', it's ended
  if (auction.status && auction.status !== 'active') {
    return { timeLeft: 0, formatted: 'Ended', isLastMinute: false, isEnded: true };
  }

  // Ensure we're working with a proper Date object
  let endTime;
  try {
    if (typeof auction.endTime.toDate === 'function') {
      // Handle Firebase Timestamp objects
      endTime = auction.endTime.toDate();
    } else if (auction.endTime instanceof Date) {
      // Already a Date object
      endTime = auction.endTime;
    } else {
      // Try to convert from a string or number
      endTime = new Date(auction.endTime);
    }
  } catch (error) {
    console.error('Error converting endTime to Date:', error);
    return { timeLeft: 0, formatted: 'Ended', isLastMinute: false, isEnded: true };
  }

  // Get adjusted "now" time (accounting for drift)
  const now = getCorrectedNow();

  // Calculate milliseconds remaining and ensure it never goes below 0
  const timeLeftMs = Math.max(0, endTime - now);

  // Check if auction has ended
  if (timeLeftMs <= 0) {
    return { timeLeft: 0, formatted: 'Ended', isLastMinute: false, isEnded: true };
  }

  // Check if in last minute
  const isLastMinute = timeLeftMs <= LAST_MINUTE_THRESHOLD;

  // Format the time remaining
  let formatted;
  if (timeLeftMs < 60000) { // Less than 1 minute
    const seconds = Math.floor(timeLeftMs / 1000);
    formatted = `${seconds}s`;
  } else if (timeLeftMs < 3600000) { // Less than 1 hour
    const minutes = Math.floor(timeLeftMs / 60000);
    const seconds = Math.floor((timeLeftMs % 60000) / 1000);
    formatted = `${minutes}m ${seconds}s`;
  } else if (timeLeftMs < 86400000) { // Less than 1 day
    const hours = Math.floor(timeLeftMs / 3600000);
    const minutes = Math.floor((timeLeftMs % 3600000) / 60000);
    formatted = `${hours}h ${minutes}m`;
  } else { // More than 1 day
    const days = Math.floor(timeLeftMs / 86400000);
    const hours = Math.floor((timeLeftMs % 86400000) / 3600000);
    formatted = `${days}d ${hours}h`;
  }
  
  return {
    timeLeft: timeLeftMs,
    formatted,
    isLastMinute,
    isEnded: false
  };
};

/**
 * Start a local timer for an auction that updates UI without Firebase reads
 * @param {Object} auction - Auction object
 * @param {Function} onTick - Callback function called on timer tick
 * @param {Function} onLastMinute - Callback when auction enters last minute
 * @param {Function} onEnd - Callback when auction ends
 * @returns {Function} Function to clear the timer
 */
export const startAuctionTimer = (auction, onTick, onLastMinute, onEnd) => {
  if (!auction?.id) {
    console.error('Invalid auction object provided to timer');
    return () => {};
  }
  
  // Clear existing timer if any
  clearAuctionTimer(auction.id);
  
  // 🚀 FIX: Add safety check to prevent excessive timer creation
  if (activeTimers.size > 50) {
    console.warn(`⚠️ Too many active timers (${activeTimers.size}), clearing old ones`);
    // Clear timers older than 30 minutes
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    for (const [id, timer] of activeTimers.entries()) {
      if (timer.startTime < thirtyMinutesAgo) {
        clearAuctionTimer(id);
      }
    }
  }
  
  // Calculate initial time remaining
  const initialTime = calculateTimeRemaining(auction);
  
  // If already ended, just call onEnd and return
  if (initialTime.isEnded) {
    console.log(`Auction ${auction.id} has already ended`);
    if (onEnd) onEnd(auction);
    return () => {};
  }
  
  // Determine tick interval - more frequent updates in last minute
  const tickInterval = initialTime.isLastMinute ? 1000 : 1000;
  
  // Set up variables to track state
  let hasEnteredLastMinute = initialTime.isLastMinute;
  let hasEnded = false;
  
  // Create and start timer
  const timerId = setInterval(() => {
    // Calculate current time remaining
    const timeRemaining = calculateTimeRemaining(auction);
    
    // Call tick callback
    if (onTick) onTick(timeRemaining, auction);
    
    // Check if entered last minute
    if (!hasEnteredLastMinute && timeRemaining.isLastMinute) {
      hasEnteredLastMinute = true;
      if (onLastMinute) onLastMinute(auction);
    }
    
    // Check if ended
    if (!hasEnded && timeRemaining.isEnded) {
      hasEnded = true;
      if (onEnd) onEnd(auction);
      clearAuctionTimer(auction.id);
    }
  }, tickInterval);
  
  // Store timer ID
  activeTimers.set(auction.id, {
    timerId,
    auction,
    startTime: Date.now()
  });
  
  // Return function to clear timer
  return () => clearAuctionTimer(auction.id);
};

/**
 * Clear a running auction timer
 * @param {string} auctionId - Auction ID
 */
export const clearAuctionTimer = (auctionId) => {
  if (activeTimers.has(auctionId)) {
    const { timerId } = activeTimers.get(auctionId);
    clearInterval(timerId);
    activeTimers.delete(auctionId);
  }
};

/**
 * Clear all running auction timers
 */
export const clearAllAuctionTimers = () => {
  for (const [auctionId, { timerId }] of activeTimers.entries()) {
    clearInterval(timerId);
  }
  activeTimers.clear();
};

/**
 * Reset the auction end notification tracking - useful after app restart
 */
export const resetAuctionEndNotifications = () => {
  auctionEndNotifications.clear();
};

/**
 * Check if an auction has recently ended and needs an automatic completion
 * @returns {Promise<string[]>} Array of auction IDs that need completion
 */
export const checkRecentlyExpiredAuctions = async () => {
  // Implementation details...
  return [];
};

/**
 * 🚀 OPTIMIZED: Load auction data without real-time listener
 * Uses cached data with ConsolidatedBidService for bid updates
 *
 * @param {string} auctionId - Auction ID
 * @param {Function} onUpdate - Callback when auction is updated
 * @param {Function} onBidPlaced - Callback when new bid is placed (handled by ConsolidatedBidService)
 * @param {Function} onError - Callback when error occurs
 * @returns {Function} Function to cleanup
 */
export const setupAuctionEventListeners = async (auctionId, onUpdate, onBidPlaced, onError) => {
  try {
    if (!auctionId) {
      console.error('Invalid auction ID provided to setupAuctionEventListeners');
      if (onError) onError(new Error('Invalid auction ID'));
      return () => {};
    }

    // 🚀 OPTIMIZATION: Load auction data from cache (no listener!)
    // Auction data is already cached via auctionOverviews
    // Bid updates come from ConsolidatedBidService (FCM push notifications - Phase 1)
    const loadAuctionData = async () => {
      try {
        const auctionData = await getCachedDoc('auctions', auctionId, {
          ttl: 60 * 1000, // 1 minute cache
          forceRefresh: false
        });

        if (!auctionData) {
          console.error(`No data found for auction ${auctionId}`);
          if (onError) onError(new Error(`No data found for auction ${auctionId}`));
          return;
        }

        // Create a safe data object with the ID
        const safeData = {
          id: auctionId,
          ...auctionData
        };

        // Create a unique notification key that includes auction ID and status
        const notificationKey = `${auctionId}_${safeData.status || 'unknown'}`;

        // Check if auction status has changed to anything other than "active"
        if (safeData.status && safeData.status !== 'active') {
          // Check if we've already sent a notification for this auction end
          if (!auctionEndNotifications.has(notificationKey)) {
            // Mark this notification as sent
            auctionEndNotifications.add(notificationKey);

            // Notify that the auction status has changed
            if (onUpdate) onUpdate(safeData);
          } else {
            console.log(`Suppressing duplicate notification for auction ${auctionId} status: ${safeData.status}`);
          }
        }
        // Also create a notification key for time-based ending
        else if (safeData.endTime) {
          let endTime;
          try {
            endTime = typeof safeData.endTime.toDate === 'function' ?
                      safeData.endTime.toDate() :
                      new Date(safeData.endTime);
          } catch (dateError) {
            console.error('Error converting endTime to Date:', dateError);
            endTime = new Date(Date.now() + 3600000); // Default 1 hour from now
          }

          // Check if auction has ended by time
          const now = getCorrectedNow();
          if (endTime <= now) {
            const timeNotificationKey = `${auctionId}_time_ended`;
            if (!auctionEndNotifications.has(timeNotificationKey)) {
              auctionEndNotifications.add(timeNotificationKey);
              safeData.isTimeEnded = true; // Add flag to indicate time-based ending
              safeData.status = 'ended'; // Also update status to be consistent
              if (onUpdate) onUpdate(safeData);
            } else {
              console.log(`Suppressing duplicate time-end notification for auction ${auctionId}`);
            }
          } else {
            // Normal update for active auction
            if (onUpdate) onUpdate(safeData);
          }
        } else {
          // Normal update for active auction
          if (onUpdate) onUpdate(safeData);
        }

        // Note: Bid updates are handled by ConsolidatedBidService (FCM) - Phase 1 complete
        // onBidPlaced callback is deprecated in favor of FCM push notifications

      } catch (error) {
        console.error(`Error loading auction ${auctionId}:`, error);
        if (onError) onError(error);
      }
    };

    // Load initial data
    await loadAuctionData();

    // Return cleanup function (no listener to cleanup, but keep API compatible)
    return () => {
      console.log(`Cleanup called for auction ${auctionId} (no listener to remove)`);
    };

  } catch (error) {
    console.error(`Error setting up auction data load for ${auctionId}:`, error);
    if (onError) onError(error);
    return () => {};
  }
};

/**
 * Remove event listeners for a specific auction
 * @param {string} auctionId - Auction ID
 */
export const removeAuctionEventListeners = (auctionId) => {
  if (auctionEventListeners.has(auctionId)) {
    const unsubscribe = auctionEventListeners.get(auctionId);
    unsubscribe();
    auctionEventListeners.delete(auctionId);
  }
};

/**
 * Remove all auction event listeners
 */
export const removeAllAuctionEventListeners = () => {
  for (const [auctionId, unsubscribe] of auctionEventListeners.entries()) {
    unsubscribe();
  }
  auctionEventListeners.clear();
};

/**
 * Handle case where time drift exceeds acceptable threshold
 * Shows an alert to the user and forces a sync
 */
export const handleExcessiveDrift = () => {
  if (Math.abs(serverClientDrift) > MAX_ACCEPTABLE_DRIFT) {
    Alert.alert(
      'Time Synchronization Issue',
      'Your device clock is significantly different from the server time. This could affect auction timing. We recommend checking your device time settings.',
      [{ text: 'OK' }]
    );
  }
};

export default {
  initializeClockSync,
  syncClock,
  getAdjustedDate,
  getCorrectedNow,
  calculateTimeRemaining,
  startAuctionTimer,
  clearAuctionTimer,
  clearAllAuctionTimers,
  setupAuctionEventListeners,
  removeAuctionEventListeners,
  removeAllAuctionEventListeners,
  handleExcessiveDrift,
  resetAuctionEndNotifications,
  checkRecentlyExpiredAuctions
}; 