import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import { useTheme } from '../contexts/ThemeContext';
import BalanceDisplay from './BalanceDisplay';
import GemDisplay from './GemDisplay';
import XPBar from './XPBar';

const HeaderRight = ({ showProfileButton = false }) => {
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const { theme } = useTheme();
  const navigation = useNavigation();
  
  // Get the current route name
  const currentRoute = navigation.getState()?.routes[navigation.getState().index];
  const routeName = currentRoute?.name;
  
  // Check if we're in the Social tab or its sub-screens
  const isInSocialTab = routeName === 'SocialHub' || 
                        routeName === 'Settings' || 
                        routeName === 'Leaderboard' || 
                        routeName === 'CreateGroup' || 
                        routeName === 'JoinGroup' ||
                        routeName === 'Profile' ||
                        routeName === 'TermsAndConditions' ||
                        routeName === 'PrivacyPolicy';
  
  // Check specific screens for XP bar visibility
  const isCoinScreen = routeName === 'CoinCard';
  const isCollectionScreen = routeName === 'MyCollection' || routeName === 'Sets';
  const isAuctionScreen = routeName === 'AuctionDashboard';
  const isTradesScreen = routeName === 'TradesOverview' || routeName === 'CreateTrade' || routeName === 'TradeDetails';

  if (!user) {
    return null;
  }

  // COIN SCREEN: Show coin balance in header
  if (isCoinScreen && currentGroup) {
    return (
      <View style={styles.coinScreenContainer}>
        <BalanceDisplay size="small" showLabel={false} />
      </View>
    );
  }

  // SOCIAL TAB: XP bar on left, profile button on right
  if (isInSocialTab || showProfileButton) {
    return (
      <View style={styles.socialContainer}>
        <XPBar compact={true} />
        <TouchableOpacity 
          onPress={() => navigation.navigate('Profile')}
          style={styles.profileButton}
        >
          <MaterialIcons 
            name="account-circle" 
            size={28} 
            color={theme.colors.primary} 
          />
        </TouchableOpacity>
      </View>
    );
  }

  // COLLECTION SCREENS: XP bar on far left only
  if (isCollectionScreen) {
    return (
      <View style={styles.leftOnlyContainer}>
        <XPBar compact={true} />
      </View>
    );
  }

  // AUCTION SCREEN: XP bar on left, balance displays on right
  if (isAuctionScreen && currentGroup) {
    return (
      <View style={styles.tradesContainer}>
        <XPBar compact={true} />
        <View style={styles.rightSection}>
          <GemDisplay size={20} style={styles.gemDisplay} />
          <BalanceDisplay size="small" showLabel={false} />
        </View>
      </View>
    );
  }

  // TRADES SCREENS: XP bar on left, balance displays on right
  if (isTradesScreen && currentGroup) {
    return (
      <View style={styles.tradesContainer}>
        <XPBar compact={true} />
        <View style={styles.rightSection}>
          <GemDisplay size={20} style={styles.gemDisplay} />
          <BalanceDisplay size="small" showLabel={false} />
        </View>
      </View>
    );
  }

  // DEFAULT: XP bar on left only for any other screens
  return (
    <View style={styles.leftOnlyContainer}>
      <XPBar compact={true} />
    </View>
  );
};

const styles = StyleSheet.create({
  // Social tab layout: XP bar left, profile button right
  socialContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    minWidth: 200,
    height: 44,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  
  // Left-only layout: XP bar positioned at far left
  leftOnlyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
    height: 44,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  
  // Trades layout: XP bar left, balance displays right
  tradesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    minWidth: 200,
    height: 44,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  
  gemDisplay: {
    marginRight: 6,
  },
  
  profileButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 0,
    margin: 0,
  },

  coinScreenContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    width: '100%',
    height: 44,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});

export default HeaderRight;
