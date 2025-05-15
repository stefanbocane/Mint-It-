import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BackgroundImage from '../components/BackgroundImage';
import HeaderRight from '../components/HeaderRight';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import AuctionScreen from '../screens/AuctionScreen';
import CoinScreen from '../screens/CoinScreen';
import CollectionScreen from '../screens/CollectionScreen';
import CreateGroupScreen from '../screens/CreateGroupScreen';
import CreateTradeScreen from '../screens/CreateTradeScreen';
import JoinGroupScreen from '../screens/JoinGroupScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SocialScreen from '../screens/SocialScreen';
import StoreScreen from '../screens/StoreScreen';
import SystemOptimizationScreen from '../screens/SystemOptimizationScreen';
import TradeDetailsScreen from '../screens/TradeDetailsScreen';
import TradesScreen from '../screens/TradesScreen';
import theme from '../theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Common header options for all stacks
const commonHeaderOptions = {
  headerTransparent: true,
  headerStyle: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    elevation: 0,
    shadowOpacity: 0,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  headerTintColor: theme.colors.text,
  headerTitleStyle: {
    fontWeight: 'bold',
  },
  headerRight: () => <HeaderRight />,
};

const createStackNavigator = (screens) => (
  <Stack.Navigator 
    screenOptions={commonHeaderOptions}
  >
    {screens.map(({ name, component, options = {} }) => (
      <Stack.Screen 
        key={name} 
        name={name} 
        component={component} 
        options={{
          ...options,
          headerShown: true, // Show headers by default
        }} 
      />
    ))}
  </Stack.Navigator>
);

const CollectionStack = () => createStackNavigator([
  { name: 'MyCollection', component: CollectionScreen, options: { title: 'My Collection' } },
]);

const TradesStack = () => createStackNavigator([
  { name: 'TradesOverview', component: TradesScreen, options: { title: 'Trades' } },
  { name: 'CreateTrade', component: CreateTradeScreen, options: { title: 'Create Trade' } },
  { name: 'TradeDetails', component: TradeDetailsScreen, options: { title: 'Trade Details' } },
]);

const AuctionStack = () => createStackNavigator([
  { name: 'AuctionDashboard', component: AuctionScreen, options: { title: 'The Mint' } },
]);

const SocialStack = () => createStackNavigator([
  { name: 'SocialHub', component: SocialScreen, options: { title: 'Social', headerShown: false } },
  { name: 'Settings', component: SettingsScreen, options: { title: 'Settings', headerShown: false } },
  { name: 'Leaderboard', component: LeaderboardScreen, options: { title: 'Leaderboard' } },
  { name: 'Store', component: StoreScreen, options: { title: 'Card Border Store' } },
  { name: 'CreateGroup', component: CreateGroupScreen, options: { title: 'Create Group' } },
  { name: 'JoinGroup', component: JoinGroupScreen, options: { title: 'Join Group' } },
  { name: 'SystemOptimization', component: SystemOptimizationScreen, options: { title: 'System Optimization' } },
]);

// Create a stack for Coin screen to have a header
const CoinStack = () => createStackNavigator([
  { name: 'CoinCard', component: CoinScreen, options: { title: 'Coin New Card' } },
]);

const TabNavigator = () => {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { currentGroup, isNewUser } = useGroup();
  const navigation = useNavigation();
  const [initialTab] = useState(isNewUser ? 'Social' : null); // Set Social as initial tab for new users

  useEffect(() => {
    StatusBar.setBarStyle('dark-content');
  }, []);

  // Navigate to Social tab for new users without showing an alert
  useEffect(() => {
    if (user && !currentGroup && isNewUser) {
      navigation.navigate('Social');
    }
  }, [currentGroup, user, isNewUser, navigation]);

  // Handle tab press to reset stack navigation
  const handleTabPress = (e, route) => {
    const isFocused = navigation.isFocused();
    
    // If we're already on this tab and it's focused
    if (isFocused) {
      // Get the route state for this tab
      const state = navigation.getState();
      // Find the index of the current tab in the state
      const tabIndex = state.routes.findIndex(r => r.name === route.name);
      
      if (tabIndex !== -1) {
        // Get the specific tab route state
        const tabRoute = state.routes[tabIndex];
        // If this tab has a nested navigator with more than 1 screen
        if (tabRoute.state && tabRoute.state.routes.length > 1) {
          // Reset this stack to first route (index 0)
          navigation.navigate(route.name, {
            screen: route.name === 'Trades' ? 'TradesOverview' : 
                    route.name === 'Collection' ? 'MyCollection' :
                    route.name === 'The Mint' ? 'AuctionDashboard' :
                    route.name === 'Social' ? 'SocialHub' : 
                    route.name === 'Coin' ? 'CoinCard' : undefined
          });
        }
      }
    }
    
    // Don't prevent default navigation
    return false;
  };

  return (
    <BackgroundImage style={styles.container}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
        <Tab.Navigator
          initialRouteName={initialTab}
          screenOptions={({ route }) => ({
            headerShown: false, // Hide tab navigator header, show stack headers instead
            tabBarStyle: [styles.tabBar, { paddingBottom: insets.bottom }],
            tabBarLabelStyle: styles.tabBarLabel,
            tabBarShowLabel: true, // Show labels on main tabs
            tabBarIcon: ({ focused, color, size }) => {
              let iconName;

              switch (route.name) {
                case 'Collection':
                  iconName = focused ? 'cards' : 'cards-outline';
                  break;
                case 'The Mint':
                  iconName = focused ? 'gavel' : 'gavel';
                  break;
                case 'Coin':
                  iconName = focused ? 'camera-plus' : 'camera-plus-outline';
                  break;
                case 'Trades':
                  iconName = focused ? 'swap-horizontal' : 'swap-horizontal';
                  break;
                case 'Social':
                  iconName = focused ? 'account-group' : 'account-group-outline';
                  break;
                default:
                  iconName = 'help-circle';
              }

              return <Icon name={iconName} size={size} color={color} />;
            },
            tabBarActiveTintColor: theme.colors.primary,
            tabBarInactiveTintColor: theme.colors.disabled,
            tabBarButton: (props) => (
              <TouchableOpacity 
                {...props} 
                onPress={(e) => {
                  const shouldPreventDefault = handleTabPress(e, route);
                  if (!shouldPreventDefault) {
                    props.onPress(e);
                  }
                }}
              />
            ),
          })}
        >
          <Tab.Screen 
            name="Collection" 
            component={CollectionStack} 
            options={{ tabBarBadge: !currentGroup ? '!' : undefined }}
          />
          <Tab.Screen 
            name="The Mint" 
            component={AuctionStack} 
            options={{ tabBarBadge: !currentGroup ? '!' : undefined }}
          />
          <Tab.Screen 
            name="Coin" 
            component={CoinStack} 
            options={{ tabBarBadge: !currentGroup ? '!' : undefined }}
          />
          <Tab.Screen 
            name="Trades" 
            component={TradesStack} 
            options={{ tabBarBadge: !currentGroup ? '!' : undefined }}
          />
          <Tab.Screen 
            name="Social" 
            component={SocialStack} 
            options={{ tabBarBadge: !currentGroup ? '⚠️' : undefined }}
          />
        </Tab.Navigator>
      </View>
    </BackgroundImage>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabBar: {
    backgroundColor: 'white',
    borderTopColor: 'rgba(0,0,0,0.05)',
    borderTopWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 4,
  },
  tabBarLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
});

export default TabNavigator; 