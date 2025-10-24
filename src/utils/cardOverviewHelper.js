/**
 * Card Overview Helper
 * 
 * Manual utilities for updating cardOverviews documents when Cloud Functions are not available.
 * This ensures the collection screen stays in sync with card changes.
 */

import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Update a specific card within a cardOverviews document
 * 
 * @param {string} groupId - Group ID
 * @param {string} userId - User ID (card owner)
 * @param {string} cardId - Card ID to update
 * @param {Object} updates - Fields to update (e.g., { rarity: 'uncommon', status: 'available' })
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateCardInOverview(groupId, userId, cardId, updates) {
  try {
    console.log(`📝 [CardOverviewHelper] Updating card ${cardId} in overview for user ${userId}`);
    console.log(`📝 [CardOverviewHelper] Updates:`, updates);

    // Construct the overview document ID
    const overviewId = `${groupId}_${userId}`;
    const overviewRef = doc(db, 'cardOverviews', overviewId);

    // Fetch the current overview document
    const overviewSnap = await getDoc(overviewRef);

    if (!overviewSnap.exists()) {
      console.warn(`⚠️ [CardOverviewHelper] CardOverview ${overviewId} does not exist`);
      return { success: false, error: 'CardOverview document not found' };
    }

    const overviewData = overviewSnap.data();
    let cards = overviewData.cards || [];

    console.log(`📦 [CardOverviewHelper] Found ${cards.length} cards in overview`);

    // Find the card to update
    const cardIndex = cards.findIndex(c => c.id === cardId);

    if (cardIndex === -1) {
      console.warn(`⚠️ [CardOverviewHelper] Card ${cardId} not found in overview`);
      return { success: false, error: 'Card not found in overview' };
    }

    // Update the card
    const oldCard = { ...cards[cardIndex] };
    cards[cardIndex] = {
      ...cards[cardIndex],
      ...updates,
      updatedAt: new Date()
    };

    console.log(`🔄 [CardOverviewHelper] Card updated:`, {
      old: oldCard,
      new: cards[cardIndex]
    });

    // Sort cards alphabetically by name (matching Cloud Function behavior)
    cards.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Write back to Firestore
    await updateDoc(overviewRef, { cards });

    console.log(`✅ [CardOverviewHelper] Successfully updated card ${cardId} in overview ${overviewId}`);
    return { success: true };

  } catch (error) {
    console.error(`❌ [CardOverviewHelper] Error updating card in overview:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove a card from a cardOverviews document
 * 
 * @param {string} groupId - Group ID
 * @param {string} userId - User ID (card owner)
 * @param {string} cardId - Card ID to remove
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function removeCardFromOverview(groupId, userId, cardId) {
  try {
    console.log(`🗑️ [CardOverviewHelper] Removing card ${cardId} from overview for user ${userId}`);

    const overviewId = `${groupId}_${userId}`;
    const overviewRef = doc(db, 'cardOverviews', overviewId);

    const overviewSnap = await getDoc(overviewRef);

    if (!overviewSnap.exists()) {
      console.warn(`⚠️ [CardOverviewHelper] CardOverview ${overviewId} does not exist`);
      return { success: false, error: 'CardOverview document not found' };
    }

    const overviewData = overviewSnap.data();
    let cards = overviewData.cards || [];

    // Filter out the card
    const filteredCards = cards.filter(c => c.id !== cardId);

    if (filteredCards.length === cards.length) {
      console.warn(`⚠️ [CardOverviewHelper] Card ${cardId} was not in overview`);
      return { success: false, error: 'Card not found in overview' };
    }

    await updateDoc(overviewRef, { cards: filteredCards });

    console.log(`✅ [CardOverviewHelper] Removed card ${cardId} from overview`);
    return { success: true };

  } catch (error) {
    console.error(`❌ [CardOverviewHelper] Error removing card from overview:`, error);
    return { success: false, error: error.message };
  }
}

export default {
  updateCardInOverview,
  removeCardFromOverview
};

