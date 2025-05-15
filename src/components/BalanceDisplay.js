import { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, IconButton, useTheme } from 'react-native-paper';
import { useBalance } from '../contexts/BalanceContext';
import CoinCount from './CoinCount';

const BalanceDisplay = ({ size = 'normal', showLabel = true, showRefreshButton = false }) => {
  const { balance, isLoading, refreshBalance } = useBalance();
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  // Remove automatic refresh to prevent unwanted 200 coin awards

  const handleRefresh = async () => {
    // Initiate refresh
    setRefreshing(true);
    console.log('Manually refreshing balance display');
    
    // Actually refresh the balance using the safe method
    await refreshBalance();
    
    // Delay for visual feedback
    setTimeout(() => {
      setRefreshing(false);
    }, 1000);
  };

  if (isLoading || refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size={size === 'small' ? 'small' : 'medium'} color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CoinCount size={size} showLabel={showLabel} />
      {showRefreshButton && (
        <TouchableOpacity onPress={handleRefresh} style={styles.refreshButton}>
          <IconButton
            icon="refresh"
            size={size === 'small' ? 16 : 24}
            iconColor={theme.colors.primary}
          />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingContainer: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButton: {
    marginLeft: 4,
  },
});

export default BalanceDisplay; 