/**
 * Auction Completion Notification Component
 * 
 * Shows real-time notifications when auctions complete and 
 * collection rarities are automatically updated.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Portal, Snackbar } from 'react-native-paper';
import useAuctionCompletion from '../../hooks/useAuctionCompletion';

const AuctionCompletionNotification = ({ visible = true }) => {
  const {
    recentCompletions,
    hasRecentWins,
    getRecentWins,
    isWaitingForAuctionUpdate,
    isAuctionServiceActive,
    forceCollectionRefresh,
    clearNotifications
  } = useAuctionCompletion();

  const [showSnackbar, setShowSnackbar] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  // Show notification when user wins an auction
  useEffect(() => {
    if (hasRecentWins()) {
      const recentWins = getRecentWins();
      const latestWin = recentWins[0];
      
      if (latestWin) {
        const message = `🎉 You won auction for ${latestWin.cardName || 'a card'}! Rarity: ${latestWin.finalRarity || 'common'}`;
        setSnackbarMessage(message);
        setShowSnackbar(true);
      }
    }
  }, [hasRecentWins, getRecentWins]);

  // Show notification when collection is being updated
  useEffect(() => {
    if (isWaitingForAuctionUpdate) {
      setSnackbarMessage('🔄 Updating collection with auction results...');
      setShowSnackbar(true);
    }
  }, [isWaitingForAuctionUpdate]);

  if (!visible || !isAuctionServiceActive) {
    return null;
  }

  const handleManualRefresh = async () => {
    setSnackbarMessage('🔄 Manually refreshing collection...');
    setShowSnackbar(true);
    
    const success = await forceCollectionRefresh();
    
    const message = success 
      ? '✅ Collection refreshed successfully!' 
      : '❌ Failed to refresh collection';
    
    setSnackbarMessage(message);
    setShowSnackbar(true);
  };

  return (
    <Portal>
      {/* Development/Debug Card - only show if there are recent completions */}
      {recentCompletions.length > 0 && (
        <Card style={styles.debugCard}>
          <Card.Content>
            <Text style={styles.debugTitle}>🎯 Auction Completion Status</Text>
            <Text style={styles.debugText}>
              Recent completions: {recentCompletions.length}
            </Text>
            <Text style={styles.debugText}>
              Recent wins: {getRecentWins().length}
            </Text>
            <Text style={styles.debugText}>
              Service active: {isAuctionServiceActive ? '✅' : '❌'}
            </Text>
            <Text style={styles.debugText}>
              Updating: {isWaitingForAuctionUpdate ? '🔄' : '✅'}
            </Text>
            
            <View style={styles.buttonContainer}>
              <Button 
                mode="outlined" 
                onPress={handleManualRefresh}
                style={styles.button}
              >
                Force Refresh
              </Button>
              <Button 
                mode="outlined" 
                onPress={clearNotifications}
                style={styles.button}
              >
                Clear
              </Button>
            </View>
          </Card.Content>
        </Card>
      )}

      {/* Snackbar for notifications */}
      <Snackbar
        visible={showSnackbar}
        onDismiss={() => setShowSnackbar(false)}
        duration={3000}
        style={styles.snackbar}
      >
        {snackbarMessage}
      </Snackbar>
    </Portal>
  );
};

const styles = StyleSheet.create({
  debugCard: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(76, 195, 161, 0.1)',
    borderColor: '#4FC3A1',
    borderWidth: 1,
    zIndex: 1000,
  },
  debugTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#4FC3A1',
  },
  debugText: {
    fontSize: 12,
    marginBottom: 4,
    color: '#666',
  },
  buttonContainer: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 10,
  },
  button: {
    flex: 1,
  },
  snackbar: {
    backgroundColor: '#4FC3A1',
  },
});

export default AuctionCompletionNotification; 