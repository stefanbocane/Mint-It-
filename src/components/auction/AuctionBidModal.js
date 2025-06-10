import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from 'react-native';
import { Button, Card, Modal, useTheme } from 'react-native-paper';
import { calculateTimeRemaining } from '../../utils/auctionTimerUtils';
import { getDisplayRarity, getRarityColor, isCoined } from '../../utils/rarityUtils';

/**
 * Modal component for placing bids on auctions
 */
const AuctionBidModal = ({ 
  visible, 
  onDismiss, 
  selectedAuction, 
  bidAmount, 
  setBidAmount, 
  placeBid,
  processingAction,
  currentUser
}) => {
  const { colors } = useTheme();
  const [countdown, setCountdown] = useState(null);
  const [timeLeft, setTimeLeft] = useState('');
  const [isAuctionEnded, setIsAuctionEnded] = useState(false);

  // Setup the countdown interval when the modal opens
  useEffect(() => {
    let interval = null;
    
    // Only start the timer if the modal is visible and we have an auction
    if (visible && selectedAuction) {
      console.log(`Setting up countdown timer for auction ${selectedAuction.id}`);
      
      // Reset the end alert flag when opening the modal
      hasShownEndAlert.current = false;
      setIsAuctionEnded(false);
      
      // Update immediately on first render
      updateTimeLeft();
      
      // Set interval to update once per second
      interval = setInterval(updateTimeLeft, 1000);
      setCountdown(interval);
    }
    
    // Clean up function that runs when the component unmounts
    // or when the dependencies change
    return () => {
      if (interval) {
        console.log('Clearing countdown interval');
        clearInterval(interval);
        setCountdown(null);
      }
    };
  }, [visible, selectedAuction?.id]); // Add .id to ensure it updates if auction changes
  
  // Add effect to ensure we display the most current rarity
  useEffect(() => {
    if (selectedAuction) {
      // Log the current rarity information for debugging
      console.log(`AuctionBidModal: Current rarity for auction ${selectedAuction.id} is ${selectedAuction.currentRarity || 'undefined'}`);
    }
  }, [selectedAuction, selectedAuction?.currentRarity]);
  
  // Update the time left displayed in the modal
  const updateTimeLeft = () => {
    if (!selectedAuction || !selectedAuction.endTime) return;
    
    // Check if the auction status is explicitly set to something other than 'active'
    // In that case, don't rely on time calculations
    if (selectedAuction.status && selectedAuction.status !== 'active') {
      setTimeLeft('Ended');
      setIsAuctionEnded(true);
      
      if (countdown) {
        clearInterval(countdown);
        setCountdown(null);
      }
      return;
    }
    
    // Otherwise, calculate time remaining normally
    const timeInfo = calculateTimeRemaining(selectedAuction);
    setTimeLeft(timeInfo.formatted);
    setIsAuctionEnded(timeInfo.isEnded);
    
    if (timeInfo.isEnded) {
      if (countdown) {
        clearInterval(countdown);
        setCountdown(null);
      }
      
      // Use a ref to track if we've already shown the alert
      // This prevents showing multiple alerts
      if (!hasShownEndAlert.current) {
        hasShownEndAlert.current = true;
        
        // Show the alert with slight delay
        setTimeout(() => {
          Alert.alert(
            'Auction Ended',
            'This auction has ended while you were viewing it.',
            [{ text: 'OK', onPress: onDismiss }]
          );
        }, 500);
      }
    }
  };

  // Add ref to track if we've shown the end alert
  const hasShownEndAlert = useRef(false);

  // Reset the alert flag when the modal closes or opens
  useEffect(() => {
    if (visible) {
      hasShownEndAlert.current = false;
      setIsAuctionEnded(false);
    }
  }, [visible]);

  const handlePlaceBid = async () => {
    // 🚀 FIX: Early return if auction has ended - prevent double validation
    if (isAuctionEnded || (selectedAuction?.status && selectedAuction.status !== 'active')) {
      // Don't show alert here - the button should be disabled already
      return;
    }
    
    // Check for valid bid amount
    if (!bidAmount || isNaN(parseInt(bidAmount))) {
      Alert.alert('Invalid Bid', 'Please enter a valid bid amount.');
      return;
    }
    
    // Determine the correct minimum bid - always 1 coin higher than current bid
    const bidValue = parseInt(bidAmount);
    const currentBid = selectedAuction?.currentBid || 0;
    const minimumBid = currentBid + 1;
    
    if (bidValue < minimumBid) {
      Alert.alert('Invalid Bid', `Your bid must be at least ${minimumBid} coins (1 coin more than the current bid).`);
      return;
    }
    
    // Add a comprehensive check for the auction object
    if (!selectedAuction || !selectedAuction.id) {
      Alert.alert('Error', 'Auction data is invalid or has been removed.');
      onDismiss();
      return;
    }
    
    // FIXED: Properly await placeBid and handle response to close modal
    try {
      console.log(`Attempting to place bid of ${bidValue} on auction ${selectedAuction.id}`);
      const success = await placeBid(selectedAuction, bidAmount);
      
      // CRITICAL: Close modal automatically on successful bid
      if (success) {
        console.log('Bid placed successfully, closing modal');
        onDismiss();
      }
      // If success is false, placeBid already showed an error alert
    } catch (error) {
      console.error('Error in handlePlaceBid:', error);
      Alert.alert('Error', error.message || 'There was a problem placing your bid. Please try again.');
    }
  };

  if (!selectedAuction) return null;

  // Add additional safety checks
  const auctionName = selectedAuction?.cardName || 'Unknown Card';
  const currentBidAmount = selectedAuction?.currentBid || 0;
  const isCurrentBidder = selectedAuction?.currentBidder === currentUser?.uid;
  const minimumBid = currentBidAmount + 1; // Always 1 coin higher than current bid
  
  // Use centralized rarity utilities
  const isCardCoined = isCoined(selectedAuction);
  const displayRarity = getDisplayRarity(selectedAuction);
  const rarityColor = getRarityColor(selectedAuction);

  // Debug logging to track rarity updates
  console.log(`AuctionBidModal: Rarity for auction ${selectedAuction.id} - current: ${selectedAuction.currentRarity || 'undefined'}, card: ${selectedAuction.cardRarity || 'undefined'}, display: ${displayRarity}`);
  
  return (
    <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.container}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <Card style={styles.card}>
          <Card.Title title={auctionName} />
          <Card.Content>
            {isCardCoined && (
              <View style={styles.rarityContainer}>
                <Text style={styles.rarityLabel}>Live Rarity:</Text>
                <Text style={[styles.rarityValue, { color: rarityColor }]}>
                  {displayRarity}
                </Text>
                <View style={[styles.rarityIndicator, { backgroundColor: rarityColor }]} />
              </View>
            )}
            
            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.text }]}>Current Bid:</Text>
              <Text style={styles.value}>{currentBidAmount} coins</Text>
            </View>
            
            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.text }]}>Time Left:</Text>
              <Text style={styles.value}>{isAuctionEnded ? 'Ended' : timeLeft}</Text>
            </View>
            
            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.text }]}>Your Status:</Text>
              <Text style={[
                styles.value, 
                isCurrentBidder ? { color: colors.success || 'green', fontWeight: 'bold' } : { color: colors.error }
              ]}>
                {isCurrentBidder ? 'Winning' : 'Not Winning'}
              </Text>
            </View>
            
            <View style={styles.bidInputContainer}>
              <Text style={[styles.bidInputLabel, { color: colors.text }]}>Place Your Bid:</Text>
              <TextInput
                style={[styles.bidInput, { borderColor: colors.backdrop, color: colors.text }]}
                keyboardType="numeric"
                value={bidAmount}
                onChangeText={setBidAmount}
                placeholder={`Minimum bid: ${minimumBid} coins`}
                placeholderTextColor={colors.placeholder}
                editable={!processingAction && !isAuctionEnded}
              />
              <Text style={[styles.bidTaxText, { color: colors.placeholder }]}>
                Note: A 1 coin tax will be charged in addition to your bid amount.
              </Text>
            </View>
          </Card.Content>
          <Card.Actions style={styles.actions}>
            <Button 
              mode="outlined" 
              onPress={onDismiss} 
              style={[styles.button, { flex: 1, marginRight: 8 }]} 
              disabled={processingAction}
            >
              Cancel
            </Button>
            <Button 
              mode="contained" 
              onPress={handlePlaceBid} 
              style={[styles.button, { flex: 1, marginLeft: 8 }]}
              loading={processingAction}
              disabled={processingAction || !bidAmount || parseInt(bidAmount) < minimumBid || isAuctionEnded}
              color={colors.primary}
            >
              Place Bid
            </Button>
          </Card.Actions>
        </Card>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 500,
  },
  rarityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
    padding: 10,
    borderRadius: 8,
  },
  rarityLabel: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  rarityValue: {
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
  },
  rarityIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontWeight: '500',
    fontSize: 16,
    color: '#555',
  },
  value: {
    fontSize: 16,
  },
  winningText: {
    color: 'green',
    fontWeight: 'bold',
  },
  losingText: {
    color: 'red',
  },
  bidInputContainer: {
    marginTop: 16,
  },
  bidInputLabel: {
    fontWeight: '500',
    fontSize: 16,
    marginBottom: 8,
  },
  bidInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 8,
    fontSize: 16,
  },
  bidTaxText: {
    fontSize: 12,
    color: '#777',
    marginTop: 4,
  },
  actions: {
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
  },
  button: {
    minWidth: 120,
    paddingHorizontal: 16,
  },
});

export default AuctionBidModal; 