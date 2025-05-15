export const RARITY_TYPES = {
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary',
  MYTHIC: 'mythic'
};

export const RARITY_WEIGHTS = {
  [RARITY_TYPES.COMMON]: 40,    // 40% (reduced from 55%)
  [RARITY_TYPES.UNCOMMON]: 30,  // 30% (increased from 25%)
  [RARITY_TYPES.RARE]: 18,      // 18% (increased from 12%)
  [RARITY_TYPES.EPIC]: 8,       // 8% (increased from 6%)
  [RARITY_TYPES.LEGENDARY]: 3,  // 3% (increased from 1.7%)
  [RARITY_TYPES.MYTHIC]: 1      // 1% (increased from 0.3%)
};

export const RARITY_COLORS = {
  'mystery': '#9B5DE5', // Updated purple color for mystery rarity
  [RARITY_TYPES.COMMON]: '#808080',
  [RARITY_TYPES.UNCOMMON]: '#4FC3A1', // Updated green color
  [RARITY_TYPES.RARE]: '#3498DB',
  [RARITY_TYPES.EPIC]: '#9B5DE5', // Updated purple color
  [RARITY_TYPES.LEGENDARY]: '#F1C40F',
  [RARITY_TYPES.MYTHIC]: '#E74C3C'
};

export const RARITY_DESCRIPTIONS = {
  [RARITY_TYPES.COMMON]: 'A basic card with standard attributes',
  [RARITY_TYPES.UNCOMMON]: 'A slightly enhanced card with improved attributes',
  [RARITY_TYPES.RARE]: 'A powerful card with unique attributes',
  [RARITY_TYPES.EPIC]: 'An exceptional card with rare attributes',
  [RARITY_TYPES.LEGENDARY]: 'A legendary card with extraordinary attributes',
  [RARITY_TYPES.MYTHIC]: 'The rarest of cards with mythical attributes'
};

// Define pricing for downloading cards based on rarity
export const DOWNLOAD_PRICES = {
  [RARITY_TYPES.COMMON]: 5,
  [RARITY_TYPES.UNCOMMON]: 10,
  [RARITY_TYPES.RARE]: 25,
  [RARITY_TYPES.EPIC]: 50,
  [RARITY_TYPES.LEGENDARY]: 75,
  [RARITY_TYPES.MYTHIC]: 100
};

/**
 * Get the price to download a card based on its rarity
 * @param {string} rarity - The card's rarity
 * @returns {number} - The price in coins to download the card
 */
export const getDownloadPrice = (rarity) => {
  return DOWNLOAD_PRICES[rarity] || DOWNLOAD_PRICES[RARITY_TYPES.COMMON];
};

/**
 * Get the color associated with a rarity
 * @param {string} rarity - The card's rarity
 * @returns {string} - The color code for the rarity
 */
export const getRarityColor = (rarity) => {
  return RARITY_COLORS[rarity] || RARITY_COLORS[RARITY_TYPES.COMMON];
};

/**
 * Get the display label for a rarity
 * @param {string} rarity - The card's rarity
 * @returns {string} - The formatted label for display
 */
export const getRarityLabel = (rarity) => {
  return rarity ? rarity.charAt(0).toUpperCase() + rarity.slice(1) : 'Common';
};

// Define Rarity type for TypeScript
export const Rarity = RARITY_TYPES; 