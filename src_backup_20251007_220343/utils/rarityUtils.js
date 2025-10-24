/**
 * Centralized Rarity Utilities
 * 
 * This module consolidates all rarity-related logic to eliminate redundancy
 * and provide a single source of truth for rarity calculations and displays.
 */

import { RARITY_COLORS, RARITY_TYPES } from './rarity';

/**
 * Get the display rarity for an auction with fallback logic
 * @param {Object} auction - The auction object
 * @returns {string} - The rarity to display (always uppercase)
 */
export const getDisplayRarity = (auction) => {
  if (!auction) return RARITY_TYPES.COMMON.toUpperCase();
  
  // For completed/expired auctions, use final cardRarity if valid
  if ((auction.status === 'completed' || auction.status === 'expired' || auction.status === 'canceled') && 
      auction.cardRarity && 
      auction.cardRarity !== 'unknown' && 
      auction.cardRarity !== '') {
    return auction.cardRarity.toUpperCase();
  }
  
  // For active auctions, prioritize currentRarity (live updates)
  let rarity = auction.status === 'active' ? 
             (auction.currentRarity || auction.cardRarity || RARITY_TYPES.COMMON) : 
             (auction.cardRarity || auction.currentRarity || RARITY_TYPES.COMMON);
  
  // Always convert unknown to COMMON
  if (rarity.toLowerCase() === 'unknown' || rarity === '') {
    rarity = RARITY_TYPES.COMMON;
  }
  
  return rarity.toUpperCase();
};

/**
 * Get the rarity color for an auction
 * @param {Object} auction - The auction object
 * @returns {string} - The hex color for the rarity
 */
export const getRarityColor = (auction) => {
  const rarity = getDisplayRarity(auction).toLowerCase();
  return RARITY_COLORS[rarity] || RARITY_COLORS.common;
};

/**
 * Get rarity style for auction cards (border, background, etc.)
 * @param {Object} auction - The auction object
 * @param {Object} rarityStyles - Style mapping object
 * @returns {Object} - The style object for the rarity
 */
export const getRarityStyle = (auction, rarityStyles) => {
  const rarity = auction?.currentRarity || auction?.cardRarity || RARITY_TYPES.COMMON;
  return rarityStyles[rarity] || rarityStyles[RARITY_TYPES.COMMON];
};

/**
 * Check if a card is coined (has dynamic rarity)
 * @param {Object} auction - The auction object
 * @returns {boolean} - True if the card is coined
 */
export const isCoined = (auction) => {
  return !auction?.cardRarity || 
         auction.cardRarity === 'unknown' || 
         auction.cardRarity === '';
};

/**
 * Get rarity badge configuration for display
 * @param {Object} auction - The auction object
 * @returns {Object} - Badge configuration with text, color, and background
 */
export const getRarityBadge = (auction) => {
  const rarity = getDisplayRarity(auction);
  const color = getRarityColor(auction);
  
  return {
    text: rarity,
    color: 'white',
    backgroundColor: `${color}CC`, // Semi-transparent
    borderColor: color
  };
};

/**
 * Get optimistic rarity for bid placement (client-side prediction)
 * @param {string} currentRarity - Current auction rarity
 * @param {number} bidAmount - New bid amount
 * @param {number} bidderCount - Number of unique bidders
 * @returns {string} - Predicted rarity
 */
export const getOptimisticRarity = (currentRarity, bidAmount, bidderCount) => {
  // Use the same logic as the server for consistency
  if (bidAmount >= 50 && bidderCount >= 3) return 'legendary';
  if (bidAmount >= 30 && bidderCount >= 2) return 'epic';
  if (bidAmount >= 20 && bidderCount >= 2) return 'rare';
  if (bidAmount >= 10 || bidderCount >= 2) return 'uncommon';
  return currentRarity || 'common';
};

/**
 * Format rarity for display with consistent capitalization
 * @param {string} rarity - Raw rarity string
 * @returns {string} - Formatted rarity string
 */
export const formatRarityForDisplay = (rarity) => {
  if (!rarity || rarity === 'unknown' || rarity === '') {
    return RARITY_TYPES.COMMON.toUpperCase();
  }
  return rarity.toUpperCase();
};

export default {
  getDisplayRarity,
  getRarityColor,
  getRarityStyle,
  isCoined,
  getRarityBadge,
  getOptimisticRarity,
  formatRarityForDisplay
}; 