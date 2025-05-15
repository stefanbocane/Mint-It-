import React, { useMemo } from 'react';
import { Animated, Dimensions, Image, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import theme from '../theme';
import { getRarityColor, getRarityLabel } from '../utils/rarity';

interface CardProps {
  imageUrl: string;
  rarity: string;
  name: string;
  ownerLabel?: string;
  style?: any;
  borderType?: string;
  animationValue?: Animated.Value;
}

const { width } = Dimensions.get('window');
const CARD_WIDTH = width * 0.4;
const CARD_HEIGHT = CARD_WIDTH * 1.4;

// Fixed color values for animation
const FIXED_COLORS = {
  neon: {
    primary: '#00FF00',
    secondary: '#00FF88',
  },
  gold: {
    primary: '#FFD700',
    secondary: '#FFC107',
  },
  fire: {
    primary: '#FF4500',
    secondary: '#FFCC00',
  },
  ice: {
    primary: '#ADD8E6',
    secondary: '#E0FFFF',
  },
  shadow: {
    primary: '#800080',
    secondary: '#4B0082',
  },
  rainbow: {
    primary: '#FF0000',
    secondary: '#FF00FF',
  }
};

const Card: React.FC<CardProps> = ({ 
  imageUrl, 
  rarity, 
  name, 
  ownerLabel, 
  style, 
  borderType,
  animationValue
}) => {
  const borderColor = getRarityColor(rarity);
  const rarityLabel = getRarityLabel(rarity);
  
  // Create border style with useMemo to avoid recreation on every render
  const borderStyle = useMemo(() => {
    let result: any = { borderColor };
    
    if (borderType && animationValue) {
      switch (borderType) {
        case 'default':
          // For default, just use the rarity-based border with no special effects
          return { borderColor };
        case 'neon':
          return {
            borderColor: FIXED_COLORS.neon.primary,
            shadowColor: FIXED_COLORS.neon.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.8,
            shadowRadius: 6,
          };
        case 'gold':
          return {
            borderColor: FIXED_COLORS.gold.primary,
            shadowColor: FIXED_COLORS.gold.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.8,
            shadowRadius: 5,
          };
        case 'rainbow':
          return {
            borderColor: FIXED_COLORS.rainbow.primary,
            shadowColor: FIXED_COLORS.rainbow.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.8,
            shadowRadius: 5,
          };
        case 'fire':
          return {
            borderColor: FIXED_COLORS.fire.primary,
            shadowColor: FIXED_COLORS.fire.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.8,
            shadowRadius: 8,
          };
        case 'ice':
          return {
            borderColor: FIXED_COLORS.ice.primary,
            shadowColor: FIXED_COLORS.ice.secondary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.7,
            shadowRadius: 8,
          };
        case 'shadow':
          return {
            borderColor: FIXED_COLORS.shadow.primary,
            shadowColor: FIXED_COLORS.shadow.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.7,
            shadowRadius: 5,
          };
        default:
          return { borderColor };
      }
    }
    
    return result;
  }, [borderType, borderColor, animationValue]);

  return (
    <Animated.View style={[styles.container, borderStyle, style]}>
      <View style={styles.contentWrapper}>
        <View style={styles.innerWrapper}>
          <Image
            source={{ uri: imageUrl }}
            style={styles.image}
            resizeMode="cover"
          />
          <View style={styles.overlay}>
            <Text style={styles.name}>{ownerLabel ? `${ownerLabel}: ${name}` : name}</Text>
            <View style={[styles.rarityBadge, { backgroundColor: borderColor }]}>
              <Text style={styles.rarityText}>{rarityLabel}</Text>
            </View>
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
    borderWidth: 3,
    backgroundColor: theme.colors.surface,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  contentWrapper: {
    width: '100%',
    height: '100%',
    borderRadius: 13, // Slightly smaller than container to account for border
  },
  innerWrapper: {
    width: '100%',
    height: '100%',
    borderRadius: 13,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 8,
  },
  name: {
    color: theme.colors.surface,
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  rarityBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  rarityText: {
    color: theme.colors.surface,
    fontSize: 12,
    fontWeight: 'bold',
  },
});

export default Card; 