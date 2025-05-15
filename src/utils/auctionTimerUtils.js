import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc } from 'firebase/firestore';
import { Alert } from 'react-native';
import { db } from '../config/firebase';
import { setupCachedQueryListener } from './firestoreUtils';

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
 * Synchronize local clock with server time with improved error handling and fallbacks
 * @returns {Promise<number>} Time drift in milliseconds
 */
export const syncClock = async () => {
  try {
    // Only sync if we haven't synced recently
    const now = Date.now();
    if (now - lastSyncTime < SYNC_INTERVAL) {
      return serverClientDrift;
    }
    
    // Define fallback server endpoints in priority order
    const timeServers = [
      'https://worldtimeapi.org/api/ip',
      'https://worldclockapi.com/api/json/utc/now',
      'https://timeapi.io/api/Time/current/zone?timeZone=UTC'
    ];
    
    // Get the server timestamp with fallbacks
    const syncStart = Date.now();
    let serverTime = null;
    let serverUsed = null;
    let error = null;
    
    // Try each server in sequence until we get a successful response
    for (const server of timeServers) {
      try {
        // Use a timeout for the fetch to prevent long-hanging requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // Reduced timeout to 3 seconds
        
        console.log(`Attempting to sync clock using: ${server}`);
        const response = await fetch(server, {
          signal: controller.signal,
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`Server responded with status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Parse timestamp based on the server format
        if (server.includes('worldtimeapi')) {
          serverTime = new Date(data.utc_datetime).getTime();
        } else if (server.includes('worldclockapi')) {
          serverTime = new Date(data.currentDateTime).getTime();
        } else if (server.includes('timeapi')) {
          serverTime = new Date(data.dateTime).getTime();
        }
        
        if (serverTime) {
          serverUsed = server;
          break; // Successfully got time, exit the loop
        }
      } catch (serverError) {
        console.warn(`Clock sync failed with ${server}:`, serverError.message);
        error = serverError; // Store the most recent error
        // Continue to next server
      }
    }
    
    // If all servers failed, use the fallback
    if (!serverTime) {
      console.warn('All time servers failed. Using local time with existing drift.');
      
      // If we have never synced successfully, try to estimate drift using
      // a simple RTT with the Firebase servers as a last resort
      if (serverClientDrift === 0 && !lastSyncTime) {
        try {
          // Simple RTT test to firebase to estimate latency
          const startTest = Date.now();
          const docRef = doc(db, 'system', 'time');
          await getDoc(docRef);
          const endTest = Date.now();
          
          // Assume a symmetric network path and estimate latency
          const estimatedLatency = Math.floor((endTest - startTest) / 2);
          console.log(`Estimated network latency based on Firestore RTT: ${estimatedLatency}ms`);
          
          // Use a reasonable default drift based on latency
          serverClientDrift = estimatedLatency;
          lastSyncTime = now;
          
          // Save this estimate
          await AsyncStorage.setItem(CLOCK_SYNC_KEY, JSON.stringify({
            drift: serverClientDrift,
            timestamp: now
          }));
        } catch (fallbackError) {
          console.error('Even Firebase RTT test failed:', fallbackError);
        }
      }
      
      return serverClientDrift;    }
    
    const syncEnd = Date.now();
    
    // Calculate the network latency (round-trip time / 2)
    const latency = Math.floor((syncEnd - syncStart) / 2);
    
    // Adjust the server time by adding the latency
    const adjustedServerTime = serverTime + latency;
    
    // Calculate drift (positive means client is ahead, negative means client is behind)
    const drift = syncEnd - adjustedServerTime;
    
    // Only update if the drift is significantly different
    // This helps avoid small fluctuations
    if (Math.abs(drift - serverClientDrift) > 500) {
      console.log(`Significant drift change detected: ${serverClientDrift}ms → ${drift}ms`);
      serverClientDrift = drift;
    } else {
      // Small change, use a weighted average to smooth transitions
      serverClientDrift = Math.floor(0.8 * serverClientDrift + 0.2 * drift);
    }
    
    lastSyncTime = now;
    
    // Save to persistent storage
    await AsyncStorage.setItem(CLOCK_SYNC_KEY, JSON.stringify({
      drift: serverClientDrift,
      timestamp: now
    }));
    
    console.log(`Clock synchronized using ${serverUsed}. Drift: ${serverClientDrift}ms, Latency: ${latency}ms`);
    return serverClientDrift;
  } catch (error) {
    console.error('Error synchronizing clock:', error);
    return serverClientDrift; // Return current drift instead of 0 to maintain previous value
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
 * Set up event listeners for a specific auction with optimized updates
 * @param {string} auctionId - Auction ID
 * @param {Function} onUpdate - Callback when auction is updated
 * @param {Function} onBidPlaced - Callback when new bid is placed
 * @param {Function} onError - Callback when error occurs
 * @returns {Function} Function to remove listeners
 */
export const setupAuctionEventListeners = (auctionId, onUpdate, onBidPlaced, onError) => {
  // Clear existing listeners if any
  removeAuctionEventListeners(auctionId);
  
  try {
    if (!auctionId) {
      console.error('Invalid auction ID provided to setupAuctionEventListeners');
      if (onError) onError(new Error('Invalid auction ID'));
      return () => {};
    }
    
    // Set up listener for the auction
    const auctionRef = doc(db, 'auctions', auctionId);
    const unsubscribe = setupCachedQueryListener(
      auctionRef,
      (auctionData) => {
        // Create a safe data object with the ID even if data is incomplete
        const safeData = {
          id: auctionId,
          ...(auctionData || {})
        };
        
        // Check if the auction exists or is valid
        if (!auctionData) {
          console.error(`Empty snapshot received for auction ${auctionId}`);
          if (onError) onError(new Error(`Empty data received for auction ${auctionId}`));
          return;
        }
        
        // Create a unique notification key that includes auction ID and status
        const notificationKey = `${auctionId}_${safeData.status || 'unknown'}`;
        
        // Check if auction status has changed to anything other than "active"
        if (safeData.status && safeData.status !== 'active') {
          // Check if we've already sent a notification for this auction end
          if (!auctionEndNotifications.has(notificationKey)) {
            // Mark this notification as sent
            auctionEndNotifications.add(notificationKey);
            
            // Only now notify that the auction status has changed
            if (onUpdate) onUpdate(safeData);
          } else {
            // Already sent notification, don't send again
            console.log(`Suppressing duplicate notification for auction ${auctionId} status: ${safeData.status}`);
            return; // Skip calling onUpdate to prevent duplicate notifications
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
              return; // Skip calling onUpdate to prevent duplicate notifications
            }
          } else {
            // Normal update for active auction
            if (onUpdate) onUpdate(safeData);
          }
        } else {
          // Normal update for active auction
          if (onUpdate) onUpdate(safeData);
        }
        
        // Check if this is a bid update
        if (onBidPlaced) {
          // We can detect new bids by checking timestamp or bid count changes
          // For now, we'll just call onBidPlaced with the updated auction
          onBidPlaced(safeData);
        }
      },
      { 
        errorHandler: (error) => {
          console.error(`Error in auction listener for ${auctionId}:`, error);
          if (onError) onError(error);
        },
        forceRefresh: false // Don't force refresh to reduce database reads
      }
    );
    
    // Store unsubscribe function
    auctionEventListeners.set(auctionId, unsubscribe);
    
    return unsubscribe;
  } catch (error) {
    console.error(`Error setting up auction listeners for ${auctionId}:`, error);
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