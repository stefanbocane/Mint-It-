import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTheme } from 'react-native-paper';
import { calculateTimeRemaining } from '../../utils/auctionTimerUtils';

// 🚀 OPTIMIZATION: Smart timer intervals based on auction urgency
const getOptimalTimerInterval = (timeRemaining) => {
  if (timeRemaining <= 0) return null; // Ended
  if (timeRemaining < 60000) return 1000; // Last minute: 1s updates
  if (timeRemaining < 5 * 60000) return 5000; // Last 5 minutes: 5s updates
  if (timeRemaining < 30 * 60000) return 15000; // Last 30 minutes: 15s updates
  if (timeRemaining < 2 * 60 * 60000) return 60000; // Last 2 hours: 1min updates
  return 5 * 60000; // Beyond 2 hours: 5min updates
};

// 🚀 OPTIMIZATION: Global timer coordinator for batching updates
class TimerCoordinator {
  constructor() {
    this.timers = new Map();
    this.masterInterval = null;
    this.updateIntervals = new Map();
  }

  register(auctionId, callback, timeRemaining) {
    this.timers.set(auctionId, {
      callback,
      lastUpdate: 0,
      interval: getOptimalTimerInterval(timeRemaining)
    });
    
    this.startMasterTimer();
  }

  unregister(auctionId) {
    this.timers.delete(auctionId);
    if (this.timers.size === 0) {
      this.stopMasterTimer();
    }
  }

  startMasterTimer() {
    if (this.masterInterval) return;
    
    this.masterInterval = setInterval(() => {
      const now = Date.now();
      
      this.timers.forEach((timer, auctionId) => {
        if (!timer.interval) return; // Ended auction
        
        const timeSinceLastUpdate = now - timer.lastUpdate;
        if (timeSinceLastUpdate >= timer.interval) {
          timer.lastUpdate = now;
          timer.callback();
        }
      });
    }, 1000); // Check every second, but only update based on individual intervals
  }

  stopMasterTimer() {
    if (this.masterInterval) {
      clearInterval(this.masterInterval);
      this.masterInterval = null;
    }
  }

  updateInterval(auctionId, timeRemaining) {
    const timer = this.timers.get(auctionId);
    if (timer) {
      timer.interval = getOptimalTimerInterval(timeRemaining);
    }
  }
}

// Global coordinator instance
const timerCoordinator = new TimerCoordinator();

/**
 * Optimized auction timer component with smart update intervals
 * 
 * Key optimizations:
 * - Smart update intervals based on auction urgency (1s to 5min)
 * - Global timer coordinator for batching updates
 * - Memoized style calculations
 * - Stable callback references
 * - Efficient state updates
 * 
 * @param {Object} props
 * @param {Object} props.auction - The auction object with endTime
 * @param {Function} props.onLastMinute - Callback when auction enters last minute
 * @param {Function} props.onEnd - Callback when auction ends
 * @param {Object} props.style - Additional style for the timer text
 */
const AuctionTimer = ({ auction, onLastMinute, onEnd, style = {} }) => {
  const { colors } = useTheme();
  const [timeDisplay, setTimeDisplay] = useState('');
  const [isLastMinute, setIsLastMinute] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  
  // Refs for cleanup and state tracking
  const hasLoggedLastMinuteRef = useRef(false);
  const lastAuctionIdRef = useRef(null);
  const registeredRef = useRef(false);
  
  // 🚀 OPTIMIZATION: Stable update callback to prevent coordinator re-registration
  const updateCallback = useCallback(() => {
    if (!auction?.endTime) {
      setTimeDisplay('N/A');
      return;
    }

    const timeInfo = calculateTimeRemaining(auction); // 🚀 FIX: Pass the full auction object, not just endTime
    setTimeDisplay(timeInfo.formatted);
    
    // Update coordinator interval if time remaining changed significantly
    timerCoordinator.updateInterval(auction.id, timeInfo.timeLeft); // 🚀 FIX: Use timeLeft instead of totalMs
    
    // Only update isLastMinute if it actually changed
    if (timeInfo.isLastMinute !== isLastMinute) {
      setIsLastMinute(timeInfo.isLastMinute);
      
      if (timeInfo.isLastMinute && !hasLoggedLastMinuteRef.current) {
        hasLoggedLastMinuteRef.current = true;
        console.log(`⏰ Auction ${auction?.id} entered last minute`);
        
        if (onLastMinute) {
          onLastMinute(auction);
        }
      }
    }
    
    // Handle auction end
    if (timeInfo.isEnded && !hasEnded) {
      console.log(`⏰ Timer ended for auction ${auction?.id}`);
      setHasEnded(true);
      setTimeDisplay('Ended');
      
      if (onEnd) {
        onEnd(auction);
      }
    }
  }, [auction, isLastMinute, hasEnded, onLastMinute, onEnd]);

  // 🚀 OPTIMIZATION: Register with global timer coordinator
  useEffect(() => {
    const auctionChanged = lastAuctionIdRef.current !== auction?.id;
    
    if (auctionChanged) {
      // Unregister old auction
      if (registeredRef.current && lastAuctionIdRef.current) {
        timerCoordinator.unregister(lastAuctionIdRef.current);
        registeredRef.current = false;
      }
      
      // Reset state for new auction
      setHasEnded(false);
      setIsLastMinute(false);
      setTimeDisplay('');
      hasLoggedLastMinuteRef.current = false;
      lastAuctionIdRef.current = auction?.id;
    }
    
    if (!auction?.id || !auction?.endTime) {
      setTimeDisplay('N/A');
      return;
    }

    // Register with coordinator
    const timeInfo = calculateTimeRemaining(auction); // 🚀 FIX: Pass the full auction object
    if (!registeredRef.current) {
      console.log(`⏰ Registering optimized timer for auction ${auction.id}`);
      timerCoordinator.register(auction.id, updateCallback, timeInfo.timeLeft); // 🚀 FIX: Use timeLeft instead of totalMs
      registeredRef.current = true;
      
      // Initial update
      updateCallback();
    }
    
    // Cleanup function
    return () => {
      if (registeredRef.current && auction?.id) {
        console.log(`⏰ Unregistering optimized timer for auction ${auction.id}`);
        timerCoordinator.unregister(auction.id);
        registeredRef.current = false;
      }
    };
  }, [auction?.id, auction?.endTime, updateCallback]);
  
  // Memoized style calculation to prevent re-computation
  const timerStyle = useMemo(() => {
    if (hasEnded || timeDisplay === 'Ended') {
      return { color: colors.error, fontWeight: 'bold' };
    }
    
    if (isLastMinute) {
      return { color: colors.error, fontWeight: 'bold' };
    }
    
    // Parse the time display to determine color
    if (timeDisplay.includes('s') && !timeDisplay.includes('m') && !timeDisplay.includes('h')) {
      return { color: colors.error, fontWeight: 'bold' };
    }
    
    if (timeDisplay.includes('m') && !timeDisplay.includes('h') && !timeDisplay.includes('d')) {
      const minutes = parseInt(timeDisplay.split('m')[0].trim());
      if (minutes < 5) {
        return { color: '#FF9800', fontWeight: 'bold' }; // Orange
      }
    }
    
    return { color: colors.text };
  }, [timeDisplay, isLastMinute, hasEnded, colors.error, colors.text]);
  
  // Memoized final style combination
  const finalStyle = useMemo(() => [
    styles.timerText, 
    timerStyle, 
    style
  ], [timerStyle, style]);
  
  return (
    <Text style={finalStyle}>
      {timeDisplay || 'Loading...'}
    </Text>
  );
};

const styles = StyleSheet.create({
  timerText: {
    fontSize: 14,
    fontWeight: '500',
  },
});

// Enhanced memo with custom comparison for better performance
export default React.memo(AuctionTimer, (prevProps, nextProps) => {
  // Only re-render if auction ID or endTime changed, or if callbacks changed
  return (
    prevProps.auction?.id === nextProps.auction?.id &&
    prevProps.auction?.endTime === nextProps.auction?.endTime &&
    prevProps.onLastMinute === nextProps.onLastMinute &&
    prevProps.onEnd === nextProps.onEnd &&
    JSON.stringify(prevProps.style) === JSON.stringify(nextProps.style)
  );
}); 