import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  COMMON_CARD_STYLES,
  getCardDimensions,
  getCardImageStyle,
  getCardOverlayStyle,
  getCardStatusBadge
} from '../utils/cardStyleUtils';
import SimpleCardImage from './SimpleCardImage';

// Get card dimensions from shared utility with fallback
const { cardWidth, cardHeight } = typeof getCardDimensions === 'function' 
  ? getCardDimensions() 
  : { cardWidth: 150, cardHeight: 210 };

// Use shared card styles with dynamic dimensions and fallback
const cardStyles = StyleSheet.create({
  cardContainer: {
    ...(COMMON_CARD_STYLES?.container || {
      borderRadius: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 4,
      elevation: 3,
      backgroundColor: 'white',
    }),
    width: cardWidth,
    height: cardHeight,
    margin: 4,
  },
});

const CardRenderer = React.memo(({ item, onPress, style }) => {
  // Use shared styling utilities for better performance and consistency
  const cardContainerStyle = useMemo(() => [
    cardStyles.cardContainer,
    style
  ], [style]);

  const imageStyle = useMemo(() => {
    if (typeof getCardImageStyle === 'function') {
      return getCardImageStyle(item, {
        width: cardWidth,
        height: cardHeight,
        borderRadius: 16,
      });
    }
    // Fallback if function not available
    return {
      width: cardWidth,
      height: cardHeight,
      borderRadius: 16,
    };
  }, [item]);

  const overlayStyle = useMemo(() => {
    if (typeof getCardOverlayStyle === 'function') {
      return getCardOverlayStyle(item, COMMON_CARD_STYLES?.overlay || {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomLeftRadius: 16,
        borderBottomRightRadius: 16,
      });
    }
    // Fallback
    return {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomLeftRadius: 16,
      borderBottomRightRadius: 16,
      backgroundColor: 'rgba(0,0,0,0.8)',
    };
  }, [item]);

  const statusBadge = useMemo(() => {
    if (typeof getCardStatusBadge === 'function') {
      return getCardStatusBadge(item);
    }
    // Fallback status badge logic
    if (item.inTrade) {
      return { backgroundColor: '#FF9800', text: 'IN TRADE' };
    }
    if (item.inAuction) {
      return { backgroundColor: '#2196F3', text: 'IN AUCTION' };
    }
    return null;
  }, [item]);

  const handlePress = useCallback(() => {
    onPress(item);
  }, [item, onPress]);

  // Handle image load errors
  const handleImageError = useCallback((error) => {
    console.warn('CardRenderer: Image failed to load for card:', {
      cardId: item.id,
      cardName: item.name,
      imageUrl: item.imageUrl,
      error: error?.nativeEvent || error
    });
  }, [item.id, item.name, item.imageUrl]);

  return (
    <TouchableOpacity
      style={cardContainerStyle}
      onPress={handlePress}
      activeOpacity={0.9}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`Card: ${item.name || 'Unknown'}${item.rarity ? `, ${item.rarity} rarity` : ''}`}
      accessibilityHint="Double tap to view card details"
    >
      <SimpleCardImage
        imageUrl={item.imageUrl}
        card={item} // Pass full card object for border lookup
        onError={handleImageError}
        style={imageStyle} // Pass border effects in style
      />
      
      <View style={overlayStyle}>
        <Text style={COMMON_CARD_STYLES?.text || {
          color: 'white',
          fontSize: 12,
          fontWeight: 'bold',
          textAlign: 'center',
          textShadowColor: 'rgba(0,0,0,0.8)',
          textShadowOffset: { width: 1, height: 1 },
          textShadowRadius: 2,
        }} numberOfLines={1}>
          {item.name || 'Unknown Card'}
        </Text>
      </View>

      {statusBadge && (
        <View style={[COMMON_CARD_STYLES?.statusBadge || {
          position: 'absolute',
          top: 8,
          right: 8,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 12,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.3,
          shadowRadius: 2,
        }, { backgroundColor: statusBadge.backgroundColor }]}>
          <Text style={COMMON_CARD_STYLES?.statusText || {
            color: 'white',
            fontSize: 10,
            fontWeight: 'bold',
            textShadowColor: 'rgba(0,0,0,0.5)',
            textShadowOffset: { width: 0.5, height: 0.5 },
            textShadowRadius: 1,
          }}>{statusBadge.text}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

CardRenderer.displayName = 'CardRenderer';

export default CardRenderer;
