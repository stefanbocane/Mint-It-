import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTheme } from 'react-native-paper';
import { startAuctionTimer } from '../../utils/auctionTimerUtils';

/**
 * Component for displaying an auction timer with efficient local updates
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
  
  useEffect(() => {
    if (!auction?.id || !auction?.endTime) {
      setTimeDisplay('N/A');
      return () => {};
    }
    
    // Start the timer and get cleanup function
    const clearTimer = startAuctionTimer(
      auction,
      // onTick callback
      (timeRemaining) => {
        setTimeDisplay(timeRemaining.formatted);
        setIsLastMinute(timeRemaining.isLastMinute);
      },
      // onLastMinute callback
      () => {
        if (onLastMinute) onLastMinute(auction);
      },
      // onEnd callback
      () => {
        if (onEnd) onEnd(auction);
      }
    );
    
    // Return cleanup function to clear timer on unmount
    return clearTimer;
  }, [auction?.id, auction?.endTime]);
  
  // Apply color styling based on time remaining
  const getTimerStyle = () => {
    if (timeDisplay === 'Ended') {
      return { color: colors.error };
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
  };
  
  return (
    <Text style={[styles.timerText, getTimerStyle(), style]}>
      {timeDisplay}
    </Text>
  );
};

const styles = StyleSheet.create({
  timerText: {
    fontSize: 14,
    fontWeight: '500',
  },
});

export default React.memo(AuctionTimer); 