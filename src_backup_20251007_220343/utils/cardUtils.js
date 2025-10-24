/**
 * Card utility functions for status validation and restrictions
 */

/**
 * Check if a card is available for download/ownership based on its status
 * @param {Object} card - The card object
 * @returns {boolean} - Whether the card can be downloaded/owned
 */
export const isCardDownloadable = (card = {}) => {
  // Basic presence checks
  if (!card) return false;

  // If an explicit flag exists that says card is restricted, respect it
  if (card.isRestricted || card.isFlagged || card.isLocked) return false;

  // If the backend marks specific suspension/banned states
  const blockedStatuses = ['suspended', 'banned', 'flagged', 'marked', 'locked', 'pending'];
  if (blockedStatuses.includes((card.status || '').toLowerCase())) return false;

  // Card must NOT currently be in auction / trade
  if (card.inAuction || card.inTrade || card.status === 'auction' || card.status === 'traded') return false;

  // Must have an image URL to download
  if (!card.imageUrl) return false;

  // If status explicitly says available, allow. If no status, default allow.
  if (card.status && card.status.toLowerCase() !== 'available') return false;

  // Passed all tests → downloadable
  return true;
};

/**
 * Check if a card can be owned by a user
 * @param {Object} card - The card object
 * @param {Object} user - The user object
 * @returns {Object} - {canOwn: boolean, reason: string}
 */
export const canUserOwnCard = (card, user) => {
  if (!card || !user) {
    return { canOwn: false, reason: 'Invalid card or user data' };
  }
  
  // Check if card is downloadable first
  if (!isCardDownloadable(card)) {
    return { 
      canOwn: false, 
      reason: 'This card is currently restricted and cannot be owned' 
    };
  }
  
  // Check if card is already in an auction or trade
  if (card.status === 'auction' || card.inAuction) {
    return { 
      canOwn: false, 
      reason: 'This card is currently in an auction' 
    };
  }
  
  if (card.status === 'traded' || card.inTrade) {
    return { 
      canOwn: false, 
      reason: 'This card is currently in a trade' 
    };
  }
  
  return { canOwn: true, reason: null };
};

/**
 * Get a user-friendly message for restricted cards
 * @param {Object} card - The card object
 * @returns {string} - User-friendly restriction message
 */
export const getCardRestrictionMessage = (card) => {
  if (!card) return 'Card data not available';
  
  if (card.status === 'marked' || card.isMarked) {
    return 'This card has been marked and is not available for download or ownership';
  }
  
  if (card.status === 'flagged' || card.isFlagged) {
    return 'This card has been flagged and is temporarily restricted';
  }
  
  if (card.status === 'suspended') {
    return 'This card is suspended and cannot be accessed';
  }
  
  if (card.status === 'banned') {
    return 'This card has been banned and is not accessible';
  }
  
  if (card.status === 'pending') {
    return 'This card is pending review and temporarily unavailable';
  }
  
  if (card.status === 'locked' || card.isLocked) {
    return 'This card is locked and cannot be accessed';
  }
  
  if (card.isRestricted) {
    return 'This card is restricted and not available';
  }
  
  return 'This card is temporarily unavailable';
};

export default {
  isCardDownloadable,
  canUserOwnCard,
  getCardRestrictionMessage
}; 