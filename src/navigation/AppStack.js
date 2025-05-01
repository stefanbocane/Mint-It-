import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import AuctionScreen from '../screens/AuctionScreen';
import CardDetailsScreen from '../screens/CardDetailsScreen';
import CardLibraryScreen from '../screens/CardLibraryScreen';
import HomeScreen from '../screens/HomeScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';
import MintScreen from '../screens/MintScreen';
import TradeScreen from '../screens/TradeScreen';
import UsersDebugScreen from '../screens/UsersDebugScreen';

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
      <Stack.Screen name="CardLibrary" component={CardLibraryScreen} />
      <Stack.Screen name="CardDetails" component={CardDetailsScreen} />
      <Stack.Screen name="Trade" component={TradeScreen} />
      <Stack.Screen name="Auction" component={AuctionScreen} />
      <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
      <Stack.Screen name="UsersDebug" component={UsersDebugScreen} options={{ title: 'Debug Users' }} />
    </Stack.Navigator>
  );
};

export default AppStack; 