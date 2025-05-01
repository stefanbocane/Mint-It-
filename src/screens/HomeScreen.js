import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Avatar, Card, Divider, Icon, List, Surface, Text } from 'react-native-paper';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

const HomeScreen = () => {
  const navigation = useNavigation();
  const { user, signOut } = useAuth();
  const [userModalVisible, setUserModalVisible] = useState(false);

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.Content title="Cardmates" />
        <Appbar.Action icon="account" onPress={() => setUserModalVisible(true)} />
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.content}>
        {/* User Stats Card */}
        <Surface style={styles.statsCard}>
          <View style={styles.userInfo}>
            <Avatar.Text 
              size={50} 
              label={user?.email?.charAt(0).toUpperCase() || 'U'} 
              style={styles.avatar}
            />
            <View style={styles.userDetails}>
              <Text style={styles.userName}>{user?.email}</Text>
              <Text style={styles.userBalance}>{user?.coinBalance || 0} coins</Text>
            </View>
          </View>
          <Divider style={styles.divider} />
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Icon source="cards" size={24} color={theme.colors.primary} />
              <Text style={styles.statValue}>12</Text>
              <Text style={styles.statLabel}>Cards</Text>
            </View>
            <View style={styles.statItem}>
              <Icon source="swap-horizontal" size={24} color={theme.colors.primary} />
              <Text style={styles.statValue}>5</Text>
              <Text style={styles.statLabel}>Trades</Text>
            </View>
            <View style={styles.statItem}>
              <Icon source="gavel" size={24} color={theme.colors.primary} />
              <Text style={styles.statValue}>3</Text>
              <Text style={styles.statLabel}>Auctions</Text>
            </View>
          </View>
        </Surface>

        {/* Recent Activity */}
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <Card style={styles.activityCard}>
          <List.Item
            title="New Card Minted"
            description="You minted a Rare Card"
            left={props => <List.Icon {...props} icon="cards-playing-outline" />}
            right={props => <Text {...props} style={styles.activityTime}>2h ago</Text>}
          />
          <Divider />
          <List.Item
            title="Trade Completed"
            description="Traded with @user123"
            left={props => <List.Icon {...props} icon="swap-horizontal" />}
            right={props => <Text {...props} style={styles.activityTime}>5h ago</Text>}
          />
          <Divider />
          <List.Item
            title="Auction Won"
            description="Won Legendary Card auction"
            left={props => <List.Icon {...props} icon="gavel" />}
            right={props => <Text {...props} style={styles.activityTime}>1d ago</Text>}
          />
        </Card>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickActions}>
          <Card style={styles.actionCard} onPress={() => navigation.navigate('Mint')}>
            <Card.Content style={styles.actionContent}>
              <Icon source="cards-playing-outline" size={32} color={theme.colors.primary} />
              <Text style={styles.actionText}>Mint Card</Text>
            </Card.Content>
          </Card>
          <Card style={styles.actionCard} onPress={() => navigation.navigate('Trade')}>
            <Card.Content style={styles.actionContent}>
              <Icon source="swap-horizontal" size={32} color={theme.colors.primary} />
              <Text style={styles.actionText}>Trade</Text>
            </Card.Content>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: 16,
  },
  statsCard: {
    padding: 16,
    borderRadius: 12,
    elevation: 4,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    backgroundColor: theme.colors.primary,
  },
  userDetails: {
    marginLeft: 16,
  },
  userName: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  userBalance: {
    fontSize: 16,
    color: theme.colors.primary,
    marginTop: 4,
  },
  divider: {
    marginVertical: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 4,
  },
  statLabel: {
    fontSize: 12,
    color: theme.colors.outline,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 24,
    marginBottom: 12,
  },
  activityCard: {
    borderRadius: 12,
    elevation: 2,
  },
  activityTime: {
    fontSize: 12,
    color: theme.colors.outline,
    alignSelf: 'center',
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  actionCard: {
    width: '48%',
    borderRadius: 12,
    elevation: 2,
  },
  actionContent: {
    alignItems: 'center',
    padding: 16,
  },
  actionText: {
    marginTop: 8,
    fontSize: 16,
    fontWeight: '500',
  },
});

export default HomeScreen; 