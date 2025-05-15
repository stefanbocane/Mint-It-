import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Text, useTheme } from 'react-native-paper';
import { useBalance } from '../contexts/BalanceContext';

const CoinCount = ({ size = 'normal', showLabel = false, forceValue = null }) => {
  const theme = useTheme();
  const { balance, isLoading, refreshBalance } = useBalance();
  const [displayBalance, setDisplayBalance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const iconSize = size === 'small' ? 16 : size === 'large' ? 32 : 24;
  const textSize = size === 'small' ? 14 : size === 'large' ? 20 : 16;
  const paddingHorizontal = size === 'small' ? 8 : size === 'large' ? 16 : 12;
  const paddingVertical = size === 'small' ? 4 : size === 'large' ? 8 : 6;
  
  // Remove the automatic refresh when component mounts
  // This prevents unwanted 200 coin awards
  
  // Update displayed balance when the actual balance changes
  useEffect(() => {
    console.log('Balance updated in CoinCount:', balance);
    if (forceValue !== null) {
      setDisplayBalance(forceValue);
    } else {
      setDisplayBalance(balance);
    }
  }, [balance, forceValue]);
  
  const handleRefresh = useCallback(async () => {
    console.log('Manual refresh triggered in CoinCount');
    setIsRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // Use the safe refresh that doesn't trigger awards
    await refreshBalance();
    
    // Add a small delay to show the refreshing state
    setTimeout(() => {
      setIsRefreshing(false);
    }, 800);
  }, [refreshBalance]);
  
  if (isLoading) {
    return (
      <View style={[styles.container, { paddingHorizontal, paddingVertical }]}>
        <ActivityIndicator size={iconSize} color={theme.colors.primary} />
      </View>
    );
  }
  
  return (
    <TouchableOpacity
      style={[
        styles.container, 
        { 
          backgroundColor: 'rgba(255,255,255,0.2)',
          borderColor: theme.colors.primary,
          shadowColor: theme.colors.primary,
          paddingHorizontal,
          paddingVertical
        }
      ]}
      onPress={handleRefresh}
      activeOpacity={0.7}
    >
      {isRefreshing ? (
        <ActivityIndicator size={iconSize} color={theme.colors.primary} style={styles.icon} />
      ) : (
        <Icon name="leaf" size={iconSize} color={theme.colors.primary} style={styles.icon} />
      )}
      <Text style={[
        styles.balance, 
        { 
          color: theme.colors.primary,
          fontSize: textSize
        }
      ]}>
        {showLabel ? `Coins: ${displayBalance}` : displayBalance}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  icon: {
    marginRight: 2,
  },
  balance: {
    marginLeft: 4,
    fontWeight: 'bold',
  },
});

export default CoinCount; 