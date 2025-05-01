import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import MintScreen from '../screens/MintScreen';
import TradeScreen from '../screens/TradeScreen';
import AuctionScreen from '../screens/AuctionScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';

const Stack = createNativeStackNavigator();

const AppStack = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Mint" component={MintScreen} />
      <Stack.Screen name="Trade" component={TradeScreen} />
      <Stack.Screen name="Auction" component={AuctionScreen} />
      <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
    </Stack.Navigator>
  );
};

export default AppStack; 