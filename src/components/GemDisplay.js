import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useGems } from '../hooks/useBackwardCompatibility';

const GemDisplay = ({ size = 24, showText = true, style }) => {
  const { gems, isLoading } = useGems();

  if (isLoading) {
    return (
      <View style={[styles.container, style]}>
        <ActivityIndicator size="small" color="#4fc3f7" />
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <MaterialCommunityIcons name="diamond-stone" size={size} color="#4fc3f7" />
      {showText && <Text style={[styles.text, { fontSize: size * 0.7 }]}>{gems || 0}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(79, 195, 247, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(79, 195, 247, 0.5)',
    minWidth: 50, // Ensure minimum width for small counts
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  text: {
    color: '#4fc3f7',
    fontWeight: 'bold',
    marginLeft: 4,
    fontSize: 14, // Match the default text size of CoinCount
  },
});

export default GemDisplay;
