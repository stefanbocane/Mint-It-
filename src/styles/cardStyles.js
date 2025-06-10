import { Dimensions, PixelRatio, StyleSheet } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PIXEL_RATIO = PixelRatio.get();

// Calculate consistent card dimensions for 2-column grid using PixelRatio
const padding = 16; // Total padding for screen margins
const cardMargin = 8; // Margin between cards
const totalHorizontalSpace = padding + cardMargin;

// Account for device pixel ratio for consistent rendering across devices
const effectiveScreenWidth = SCREEN_WIDTH / PIXEL_RATIO * PIXEL_RATIO;
const CARD_WIDTH = Math.floor((effectiveScreenWidth - totalHorizontalSpace) / 2);
const CARD_HEIGHT = Math.floor(CARD_WIDTH / 0.7); // Standard card aspect ratio

export const cardStyles = StyleSheet.create({
  cardContainer: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    margin: 4,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  cardSurface: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  cardContentWrapper: {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  cardImageContainer: {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    backgroundColor: '#f5f5f5',
  },
  cardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    padding: 8,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    minHeight: 50,
    justifyContent: 'center',
  },
  cardInfo: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    color: 'white',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
    lineHeight: 16,
  },
  cardName: {
    color: 'white',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
    lineHeight: 16,
  },
  cardRarity: {
    color: 'white',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  statusBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(255,0,0,0.8)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    minWidth: 50,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 9,
    color: 'white',
    fontWeight: 'bold',
    textAlign: 'center',
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
}); 