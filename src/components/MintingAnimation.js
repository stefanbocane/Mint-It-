import { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Surface } from 'react-native-paper';
import theme from '../theme';

const BORDER_RADIUS = 20;

const MintingAnimation = ({ 
  imageUrl, 
  rarity, 
  onComplete,
  style 
}) => {
  useEffect(() => {
    if (!imageUrl || !rarity) {
      onComplete?.();
      return;
    }

    // Call onComplete after a short delay
    const timer = setTimeout(() => {
      onComplete?.();
    }, 1000);

    return () => clearTimeout(timer);
  }, [imageUrl, rarity, onComplete]);

  const getRarityGlowColor = (rarity) => {
    if (!rarity) return 'rgba(102, 102, 102, 0.3)';
    
    const rarityColors = {
      common: theme.colors.rarity.common,
      rare: theme.colors.rarity.rare,
      epic: theme.colors.rarity.epic,
      legendary: theme.colors.rarity.legendary,
    };

    return rarityColors[rarity.toLowerCase()] || rarityColors.common;
  };

  if (!imageUrl || !rarity) {
    return null;
  }

  return (
    <View style={[styles.container, style]}>
      <View 
        style={[
          styles.glow, 
          { backgroundColor: `${getRarityGlowColor(rarity)}40` }
        ]} 
      />
      <View style={styles.cardContainer}>
        <Surface style={styles.card}>
          <View style={[styles.cardWrapper, { borderColor: getRarityGlowColor(rarity) }]}>
            <Image
              source={{ uri: imageUrl }}
              style={styles.cardImage}
              resizeMode="cover"
              onError={() => {
                console.error('Failed to load image in animation');
                onComplete?.();
              }}
            />
          </View>
        </Surface>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  glow: {
    position: 'absolute',
    width: 300,
    height: 400,
    borderRadius: BORDER_RADIUS,
  },
  cardContainer: {
    width: 300,
    height: 400,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '100%',
    height: '100%',
    borderRadius: BORDER_RADIUS,
    elevation: 8,
    backgroundColor: 'transparent',
  },
  cardWrapper: {
    width: '100%',
    height: '100%',
    borderRadius: BORDER_RADIUS,
    borderWidth: 4,
    backgroundColor: theme.colors.surface,
  },
  cardImage: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
});

export default MintingAnimation; 