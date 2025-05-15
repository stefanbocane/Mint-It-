import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import BackgroundImage from '../components/BackgroundImage';
import { useAuth } from '../contexts/AuthContext';
import { useBalance } from '../contexts/BalanceContext';
import { useGroup } from '../contexts/GroupContext';
import { useTheme } from '../contexts/ThemeContext';
import ScreenBackground from '../components/ScreenBackground';

const HomeScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const { balance, refreshBalance } = useBalance();
  const [balanceLoading, setBalanceLoading] = useState(true);

  useEffect(() => {
    // Refresh balance when the screen is focused
    const unsubscribe = navigation.addListener('focus', () => {
      if (user && currentGroup) {
        setBalanceLoading(true);
        refreshBalance(currentGroup.id)
          .finally(() => setBalanceLoading(false));
      }
    });

    if (user && currentGroup) {
      setBalanceLoading(true);
      refreshBalance(currentGroup.id)
        .finally(() => setBalanceLoading(false));
    }

    return unsubscribe;
  }, [navigation, user, currentGroup, refreshBalance]);

  if (!user || !currentGroup) {
    return (
      <ScreenBackground>
        <View style={styles.container}>
          <Card style={[styles.welcomeCard, { backgroundColor: theme.colors.surface }]}>
            <Card.Content>
              <Text style={[styles.welcomeText, { color: theme.colors.text }]}>
                Welcome to Cardmates!
              </Text>
              <Text style={[styles.balanceText, { color: theme.colors.textSecondary }]}>
                Please sign in to access features.
              </Text>
              <Button
                mode="contained"
                onPress={() => navigation.navigate('Login')}
                style={{ marginTop: 16 }}
              >
                Sign In
              </Button>
            </Card.Content>
          </Card>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScrollView style={styles.container}>
        <Card style={[styles.welcomeCard, { backgroundColor: theme.colors.surface }]}>
          <Card.Content>
            <Text style={[styles.welcomeText, { color: theme.colors.text }]}>
              Welcome back, {user?.displayName || 'User'}!
            </Text>
            <Text style={[styles.balanceText, { color: theme.colors.textSecondary }]}>
              Balance in {currentGroup.name}: {balanceLoading ? 'Loading...' : balance} coins
            </Text>
          </Card.Content>
        </Card>

        <View style={styles.buttonContainer}>
          <Button
            mode="contained"
            onPress={() => navigation.navigate('Social')}
            style={styles.button}
            icon="account-group"
          >
            My Groups
          </Button>

          <Button
            mode="contained"
            onPress={() => navigation.navigate('Mint')}
            style={styles.button}
            icon="plus-circle"
          >
            Mint New Card
          </Button>

          <Button
            mode="outlined"
            onPress={() => navigation.navigate('Settings')}
            style={styles.button}
            icon="cog"
          >
            Settings
          </Button>
        </View>

        <Card style={[styles.statsCard, { backgroundColor: theme.colors.surface }]}>
          <Card.Content>
            <Text style={[styles.statsTitle, { color: theme.colors.text }]}>
              Your Stats
            </Text>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: theme.colors.primary }]}>0</Text>
                <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>
                  Cards Minted
                </Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: theme.colors.primary }]}>0</Text>
                <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>
                  Groups Joined
                </Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: theme.colors.primary }]}>0</Text>
                <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>
                  Trades Made
                </Text>
              </View>
            </View>
          </Card.Content>
        </Card>
      </ScrollView>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  welcomeCard: {
    margin: 16,
    borderRadius: 12,
    elevation: 4,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  balanceText: {
    fontSize: 16,
  },
  buttonContainer: {
    padding: 16,
  },
  button: {
    marginBottom: 16,
  },
  statsCard: {
    marginBottom: 24,
  },
  statsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
  },
});

export default HomeScreen; 