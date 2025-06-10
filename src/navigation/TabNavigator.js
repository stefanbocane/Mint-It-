import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation, useTheme as useNavTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Platform, StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BackgroundImage from '../components/BackgroundImage';
import HeaderRight from '../components/HeaderRight';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import { useTheme } from '../contexts/ThemeContext';
import AuctionScreen from '../screens/AuctionScreen';
import CoinScreen from '../screens/CoinScreen';
import CollectionScreen from '../screens/CollectionScreen';
import CreateGroupScreen from '../screens/CreateGroupScreen';
import CreateTradeScreen from '../screens/CreateTradeScreen';
import JoinGroupScreen from '../screens/JoinGroupScreen';
import PrivacyPolicyScreen from '../screens/PrivacyPolicyScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SetsScreen from '../screens/SetsScreen';
import SocialScreen from '../screens/SocialScreen';

import TermsAndConditionsScreen from '../screens/TermsAndConditionsScreen';
import TradeDetailsScreen from '../screens/TradeDetailsScreen';
import TradesScreen from '../screens/TradesScreen';
import navigationPrefetcher from '../utils/navigationPrefetcher';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Fallback theme in case the theme context is not available
const fallbackTheme = {
  colors: {
    primary: '#4FC3A1',
    background: '#FFFFFF',
    surface: '#FFFFFF',
    text: '#000000',
    outline: 'rgba(0,0,0,0.05)',
    disabled: '#757575',
  },
  dark: false,
};

const TabNavigator = () => {
  // Get themes from both navigation and our context
  const navTheme = useNavTheme();
  const themeContext = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { currentGroup, isNewUser } = useGroup();
  const navigation = useNavigation();
  const [initialTab] = useState(isNewUser ? 'Social' : null);
  
  // Merge themes with priority to our context theme
  const theme = useMemo(() => ({
    colors: {
      ...fallbackTheme.colors,
      ...navTheme.colors,
      ...(themeContext?.theme?.colors || {})
    },
    dark: themeContext?.theme?.dark ?? navTheme.dark ?? false
  }), [navTheme, themeContext]);

  // Common header options for all stacks
  const commonHeaderOptions = useMemo(() => {
    try {
      return {
        headerTransparent: false,
        headerStyle: {
          backgroundColor: theme.colors.background,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.outline,
          height: 56, // Fixed header height to ensure consistent spacing
        },
        headerTintColor: theme.colors.text,
        headerTitleStyle: {
          fontWeight: '600',
          fontSize: 17,
          lineHeight: 22,
          letterSpacing: -0.41,
          color: theme?.colors?.text || fallbackTheme.colors.text,
        },
        headerTitleContainerStyle: {
          paddingVertical: 0,
          flex: 2, // Give title more space so it doesn't compress the header right
          maxWidth: '60%', // Limit title width to prevent overlap with XP bar
        },
        headerRightContainerStyle: {
          paddingRight: 10,
          paddingLeft: 0, // Remove left padding to allow XP bar to be truly on the left
          paddingVertical: 0,
          margin: 0,
          justifyContent: 'center',
          alignItems: 'center',
          flex: 1, // Allow the container to take available space
          minWidth: 200, // Ensure minimum width for proper layout
        },
        headerRight: () => <HeaderRight />,
        headerTitleAlign: 'center',
      };
    } catch (error) {
      console.warn('Error creating header options, using fallback:', error);
      return {
        headerTransparent: false,
        headerStyle: {
          backgroundColor: fallbackTheme.colors.background,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: fallbackTheme.colors.outline,
          height: 56, // Fixed header height for fallback as well
        },
        headerTintColor: fallbackTheme.colors.text,
        headerTitleStyle: {
          fontWeight: '600',
          fontSize: 17,
          lineHeight: 22,
          letterSpacing: -0.41,
          color: fallbackTheme.colors.text,
        },
        headerTitleContainerStyle: {
          paddingVertical: 0,
        },
        headerRightContainerStyle: {
          paddingRight: 10,
          paddingLeft: 10,
          paddingVertical: 0,
          margin: 0,
          justifyContent: 'center',
          alignItems: 'center',
        },
        headerRight: () => <HeaderRight />,
        headerTitleAlign: 'center',
      };
    }
  }, [theme]);

  const createStackNavigator = (screens) => (
    <Stack.Navigator screenOptions={commonHeaderOptions}>
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
    { name: 'Sets', component: SetsScreen, options: { title: 'Sets & Trophies' } },
  ]);

  const TradesStack = () => createStackNavigator([
    { name: 'TradesOverview', component: TradesScreen, options: { title: 'Trades' } },
    { name: 'CreateTrade', component: CreateTradeScreen, options: { title: 'Create Trade' } },
    { name: 'TradeDetails', component: TradeDetailsScreen, options: { title: 'Trade Details' } },
  ]);

  const AuctionStack = () => createStackNavigator([
    { name: 'AuctionDashboard', component: AuctionScreen, options: { title: 'The Mint' } },
  ]);

  const SocialStack = () => {
    const SocialStackNav = createNativeStackNavigator();
    
    return (
      <SocialStackNav.Navigator 
        screenOptions={{
          ...commonHeaderOptions,
          headerRight: () => <HeaderRight showProfileButton />,
        }}
      >
        <SocialStackNav.Screen 
          name="SocialHub" 
          component={SocialScreen} 
          options={{
            title: 'Social',
            headerShown: true,
          }} 
        />
        <SocialStackNav.Screen 
          name="Profile" 
          component={ProfileScreen} 
          options={({ route }) => ({
            title: route.params?.userName || 'Profile',
            headerShown: true,
          })}
        />
        <SocialStackNav.Screen 
          name="CreateGroup" 
          component={CreateGroupScreen} 
          options={{ 
            title: 'Create Group',
            headerShown: true
          }} 
        />
        <SocialStackNav.Screen 
          name="JoinGroup" 
          component={JoinGroupScreen} 
          options={{ 
            title: 'Join Group',
            headerShown: true
          }} 
        />

        <SocialStackNav.Screen 
          name="TermsAndConditions" 
          component={TermsAndConditionsScreen} 
          options={{ 
            title: 'Terms and Conditions',
            headerShown: true
          }} 
        />
        <SocialStackNav.Screen 
          name="PrivacyPolicy" 
          component={PrivacyPolicyScreen} 
          options={{ 
            title: 'Privacy Policy',
            headerShown: true
          }} 
        />
      </SocialStackNav.Navigator>
    );
  };

  const CoinStack = () => createStackNavigator([
    { name: 'CoinCard', component: CoinScreen, options: { title: 'Coin New Card' } },
  ]);

  useEffect(() => {
    try {
      const isDark = theme?.dark || false;
      StatusBar.setBarStyle(isDark ? 'light-content' : 'dark-content');
      if (Platform.OS === 'android') {
        StatusBar.setBackgroundColor(theme?.colors?.background || fallbackTheme.colors.background);
      }
    } catch (error) {
      console.warn('Error setting status bar style:', error);
      StatusBar.setBarStyle('dark-content');
    }
  }, [theme?.dark, theme?.colors?.background]);

  // Navigate to Social tab for new users without showing an alert
  useEffect(() => {
    if (user && !currentGroup && isNewUser) {
      navigation.navigate('Social');
    }
  }, [currentGroup, user, isNewUser, navigation]);

  // Track navigation state changes for optimization prefetching
  useEffect(() => {
    if (!user || !currentGroup) return;

    const unsubscribe = navigation.addListener('state', (e) => {
      const state = e.data.state;
      const routeName = state?.routes?.[state.index]?.name;
      
      if (routeName) {
        // Record navigation pattern and prefetch likely next screens
        navigationPrefetcher.smartPrefetch(
          routeName, 
          user.uid, 
          currentGroup.id,
          { userGroup: currentGroup }
        );
      }
    });

    return unsubscribe;
  }, [navigation, user, currentGroup]);

  // Handle tab press to reset stack navigation
  const handleTabPress = (e, route) => {
    const isFocused = navigation.isFocused();
    
    // If we're already on this tab and it's focused
    if (isFocused) {

      // For other tabs, use the existing logic
      const state = navigation.getState();
      const tabIndex = state.routes.findIndex(r => r.name === route.name);
      
      if (tabIndex !== -1) {
        const tabRoute = state.routes[tabIndex];
        if (tabRoute.state?.routes?.length > 1) {
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
    <View style={styles.container}>
      <StatusBar 
        barStyle={theme.dark ? 'light-content' : 'dark-content'} 
        backgroundColor="transparent" 
        translucent 
      />
      <View style={[styles.content, { paddingTop: insets.top }]}>
        <BackgroundImage style={{ flex: 1 }}>
          <Tab.Navigator
            initialRouteName={initialTab}
            screenOptions={({ route }) => ({
              headerShown: false,
              tabBarLabelStyle: styles.tabBarLabel,
              tabBarShowLabel: true,
              tabBarIcon: ({ focused, color, size = 22 }) => {
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
              tabBarStyle: {
                backgroundColor: theme.colors.surface,
                borderTopColor: theme.colors.outline,
                borderTopWidth: 1,
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 56 + insets.bottom, // Add bottom safe area to height
                paddingBottom: insets.bottom, // Add bottom safe area padding
                elevation: 8,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -2 },
                shadowOpacity: 0.1,
                shadowRadius: 3,
                zIndex: 10,
              },
              tabBarItemStyle: {
                height: 50,          // Slightly increased height
                paddingVertical: 12, // Increased vertical padding
                paddingBottom: 10,    // Increased bottom padding
              },

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
              options={{
                tabBarLabel: 'Social',
                tabBarIcon: ({ color, size }) => (
                  <Icon name="account-group" size={size} color={color} />
                ),
                headerShown: false,
              }} 
            />
          </Tab.Navigator>
        </BackgroundImage>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    paddingTop: 0, // Removed extra padding that was causing spacing issues
  },
  tabBar: {
    // This style is now managed in the tabBarStyle above
  },
  tabBarLabel: {
    fontSize: 10,
    marginBottom: 2,
    marginTop: 0,
    lineHeight: 12,
  },
  tabBarButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    height: 48,
    paddingVertical: 0,
    margin: 0,
  },
});

export default TabNavigator;