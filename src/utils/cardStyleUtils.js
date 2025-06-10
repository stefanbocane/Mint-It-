/**
 * Shared Card Styling Utilities
 * 
 * Centralizes card styling calculations to eliminate redundancy
 * and improve performance through memoization and caching.
 * 
 * Benefits:
 * - Eliminates duplicate styling calculations
 * - Provides consistent card appearance
 * - Improves performance through caching
 * - Reduces bundle size
 */

import { Dimensions } from 'react-native';
import { BORDER_OPTIONS, getBorderAnimationStyle } from './borderOptions';
import { getRarityColor } from './rarity';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Cache for computed styles to avoid recalculation
const styleCache = new Map();
const CACHE_SIZE_LIMIT = 100;

/**
 * Calculate card dimensions for grid layout
 */
export const getCardDimensions = (columns = 2, screenPadding = 16, cardMargin = 8) => {
  const cacheKey = `dimensions_${columns}_${screenPadding}_${cardMargin}`;
  
  if (styleCache.has(cacheKey)) {
    return styleCache.get(cacheKey);
  }
  
  const totalHorizontalSpace = screenPadding + (cardMargin * (columns - 1));
  const cardWidth = Math.floor((SCREEN_WIDTH - totalHorizontalSpace) / columns);
  const cardHeight = Math.floor(cardWidth * 1.4); // Standard card aspect ratio
  
  const dimensions = { cardWidth, cardHeight };
  
  // Cache the result
  if (styleCache.size < CACHE_SIZE_LIMIT) {
    styleCache.set(cacheKey, dimensions);
  }
  
  return dimensions;
};

/**
 * Get card border style based on border type and rarity
 */
export const getCardBorderStyle = (card) => {
  if (!card) return {};
  
  const cacheKey = `border_${card.borderType || 'default'}_${card.rarity || 'common'}`;
  
  if (styleCache.has(cacheKey)) {
    return styleCache.get(cacheKey);
  }
  
  const rarityColor = getRarityColor(card.rarity);
  
  // Use actual borderType if set, otherwise use rarity-based default border
  const effectiveBorderType = card.borderType && card.borderType !== 'default' 
    ? card.borderType 
    : 'rarity';

  let borderStyle;

  if (effectiveBorderType === 'rarity') {
    // Apply rarity-based default border
    borderStyle = {
      borderWidth: 3,
      borderColor: rarityColor,
      shadowColor: rarityColor,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.6,
      shadowRadius: 6,
    };
  } else {
    const borderOption = BORDER_OPTIONS.find(b => b.id === effectiveBorderType);
    if (!borderOption) {
      // Fallback to rarity border if border option not found
      borderStyle = {
        borderWidth: 3,
        borderColor: rarityColor,
        shadowColor: rarityColor,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 6,
      };
    } else {
      borderStyle = getBorderAnimationStyle(
        borderOption.animationType,
        borderOption.color,
        borderOption.secondaryColor,
        borderOption.glowIntensity
      );
    }
  }
  
  // Cache the result
  if (styleCache.size < CACHE_SIZE_LIMIT) {
    styleCache.set(cacheKey, borderStyle);
  }
  
  return borderStyle;
};

/**
 * Get card status badge configuration
 */
export const getCardStatusBadge = (card) => {
  if (!card) return null;
  
  const cacheKey = `status_${card.status || 'none'}_${card.inTrade || false}_${card.inAuction || false}_${card.isMarked || false}_${card.isFlagged || false}_${card.isLocked || false}_${card.isRestricted || false}`;
  
  if (styleCache.has(cacheKey)) {
    return styleCache.get(cacheKey);
  }
  
  let badge = null;
  
  // Check for restricted status first (highest priority)
  if (card.status === 'marked' || card.isMarked) {
    badge = { backgroundColor: '#F44336', text: 'MARKED' };
  } else if (card.status === 'flagged' || card.isFlagged) {
    badge = { backgroundColor: '#FF5722', text: 'FLAGGED' };
  } else if (card.status === 'suspended') {
    badge = { backgroundColor: '#9C27B0', text: 'SUSPENDED' };
  } else if (card.status === 'banned') {
    badge = { backgroundColor: '#000000', text: 'BANNED' };
  } else if (card.status === 'pending') {
    badge = { backgroundColor: '#FFC107', text: 'PENDING' };
  } else if (card.status === 'locked' || card.isLocked) {
    badge = { backgroundColor: '#607D8B', text: 'LOCKED' };
  } else if (card.isRestricted) {
    badge = { backgroundColor: '#795548', text: 'RESTRICTED' };
  } else if (card.inTrade) {
    badge = { backgroundColor: '#FF9800', text: 'IN TRADE' };
  } else if (card.inAuction) {
    badge = { backgroundColor: '#2196F3', text: 'IN AUCTION' };
  } else if (!card.inTrade && !card.inAuction && card.status === 'auction') {
    badge = { backgroundColor: '#2196F3', text: 'AUCTION' };
  }
  
  // Cache the result
  if (styleCache.size < CACHE_SIZE_LIMIT) {
    styleCache.set(cacheKey, badge);
  }
  
  return badge;
};

/**
 * Check if card should be visually restricted (semi-transparent)
 */
export const isCardRestricted = (card) => {
  if (!card) return false;
  
  const restrictedStatuses = ['marked', 'flagged', 'suspended', 'banned', 'pending', 'locked'];
  return (card.status && restrictedStatuses.includes(card.status)) || 
         card.isMarked || card.isFlagged || card.isLocked || card.isRestricted;
};

/**
 * Get complete card image style including border effects and restrictions
 */
export const getCardImageStyle = (card, baseStyle = {}) => {
  if (!card) return baseStyle;
  
  const borderStyle = getCardBorderStyle(card);
  const isRestricted = isCardRestricted(card);
  
  return {
    ...baseStyle,
    ...borderStyle,
    opacity: isRestricted ? 0.6 : 1,
  };
};

/**
 * Get card overlay style with rarity-based border
 */
export const getCardOverlayStyle = (card, baseStyle = {}) => {
  if (!card) return baseStyle;
  
  const borderStyle = getCardBorderStyle(card);
  const rarityColor = getRarityColor(card.rarity);
  
  return {
    ...baseStyle,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderTopColor: borderStyle.borderColor || rarityColor,
    borderTopWidth: 2,
  };
};

/**
 * Clear the style cache (useful for memory management)
 */
export const clearStyleCache = () => {
  styleCache.clear();
};

/**
 * Get cache statistics for debugging
 */
export const getStyleCacheStats = () => {
  return {
    size: styleCache.size,
    limit: CACHE_SIZE_LIMIT,
    keys: Array.from(styleCache.keys())
  };
};

/**
 * Pre-computed common card styles for better performance
 */
export const COMMON_CARD_STYLES = {
  container: {
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
    backgroundColor: 'white',
  },
  
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  
  text: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  
  statusBadge: {
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
  },
  
  statusText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0.5, height: 0.5 },
    textShadowRadius: 1,
  },
}; 