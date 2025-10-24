import { StyleSheet, View } from 'react-native';
import { Surface, Text, useTheme } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ScreenBackground from '../components/ScreenBackground';

/**
 * Sets & Trophies Screen - Coming Soon
 *
 * This feature is currently disabled and will be implemented in a future update.
 */
const SetsScreen = () => {
  const theme = useTheme();

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <Surface style={[styles.contentSurface, { backgroundColor: theme.colors.surface }]}>
          <Icon
            name="trophy-outline"
            size={80}
            color={theme.colors.primary}
            style={styles.icon}
          />
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>
            Sets & Trophies
          </Text>
          <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
            Coming Soon!
          </Text>
          <Text style={[styles.description, { color: theme.colors.onSurfaceVariant }]}>
            We're working on an exciting sets and trophies system where you can complete collections and earn special rewards.
          </Text>
          <Text style={[styles.description, { color: theme.colors.onSurfaceVariant, marginTop: 16 }]}>
            Stay tuned for updates! 🎉
          </Text>
        </Surface>
      </View>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  contentSurface: {
    padding: 40,
    borderRadius: 16,
    alignItems: 'center',
    maxWidth: 400,
    width: '100%',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  icon: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 24,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
});

export default SetsScreen;
