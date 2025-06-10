import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text, useTheme } from 'react-native-paper';
import { useBalance } from '../hooks/useBackwardCompatibility';

const CoinCount = ({ size = 'normal', showLabel = false, forceValue = null }) => {
  const theme = useTheme();
  const { balance, isLoading } = useBalance();
  const [displayBalance, setDisplayBalance] = useState(0);
  
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
  
  if (isLoading) {
    return (
      <View style={[styles.container, { paddingHorizontal, paddingVertical }]}>
        <ActivityIndicator size={iconSize} color={theme.colors.primary} />
      </View>
    );
  }
  
  return (
    <View
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
    >
      <Icon name="leaf" size={iconSize} color={theme.colors.primary} style={styles.icon} />
      <Text style={[
        styles.balance, 
        { 
          color: theme.colors.primary,
          fontSize: textSize
        }
      ]}>
        {showLabel ? `Coins: ${displayBalance}` : displayBalance}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
    minWidth: 50, // Ensure minimum width for small balances
  },
  icon: {
    marginRight: 2,
    marginLeft: 4, // Add some left margin for better spacing
  },
  balance: {
    marginLeft: 4,
    fontWeight: 'bold',
  },
});

export default CoinCount; 