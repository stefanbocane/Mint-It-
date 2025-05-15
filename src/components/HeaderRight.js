import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import BalanceDisplay from './BalanceDisplay';

const HeaderRight = () => {
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const navigation = useNavigation();
  
  // Get the current route name
  const currentRoute = navigation.getState()?.routes[navigation.getState().index];
  const routeName = currentRoute?.name;
  
  // Check if we're in the Social tab or its sub-screens
  const isInSocialTab = routeName === 'SocialHub' || 
                        routeName === 'Settings' || 
                        routeName === 'Leaderboard' || 
                        routeName === 'CreateGroup' || 
                        routeName === 'JoinGroup';
  
  // Also check if we're in the Collection screen since we'll handle it separately
  const isCollectionScreen = routeName === 'MyCollection';

  if (!user || !currentGroup || isInSocialTab || isCollectionScreen) {
    return null;
  }

  return <BalanceDisplay size="small" showLabel={false} />;
};

export default HeaderRight; 