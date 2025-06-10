import { arrayUnion, doc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Adds a card to the user's collection in the specified group
 * @param {Object} params - Parameters object
 * @param {string} params.userId - The ID of the user
 * @param {string} params.groupId - The ID of the group
 * @param {string} params.cardId - The ID of the card to add
 * @param {Object} params.cardData - The complete card data
 * @param {string} params.timestamp - ISO string of when the card was added
 * @returns {Promise<void>}
 */
export const addCardToCollection = async ({
  userId,
  groupId,
  cardId,
  cardData,
  timestamp
}) => {
  try {
    if (!userId || !groupId || !cardId) {
      throw new Error('Missing required parameters');
    }

    console.log(`Adding card ${cardId} to user ${userId}'s collection in group ${groupId}`);
    
    const cardRef = doc(db, 'cards', cardId);
    const now = new Date().toISOString();

    try {
      // Prepare the card data for storage in the cards collection
      const cardDataForStorage = {
        ...cardData,
        // Ensure we're not storing any functions or undefined values
        ...Object.entries(cardData).reduce((acc, [key, value]) => {
          if (typeof value !== 'function' && value !== undefined) {
            acc[key] = value;
          }
          return acc;
        }, {}),
        // Add required fields for the CollectionScreen
        id: cardId,
        ownerId: userId,
        userId: userId,
        groupId: groupId,
        addedAt: timestamp || now,
        isNew: true,
        isTraded: false,
        isAuctioned: false,
        lastUpdated: now,
        createdAt: timestamp || now
      };
      
      console.log('Saving card to cards collection:', JSON.stringify({
        id: cardId,
        ...cardDataForStorage
      }, null, 2));
      
      // Store the card in the cards collection
      await setDoc(cardRef, cardDataForStorage, { merge: true });
      
      console.log(`Card ${cardId} successfully stored in cards collection`);
      
      // Also update the user's group document to track this card
      try {
        const userGroupRef = doc(db, 'users', userId, 'groups', groupId);
        
        await setDoc(userGroupRef, {
          lastUpdated: now,
          // Add a reference to this card in the user's group
          cards: arrayUnion({
            cardId,
            addedAt: timestamp || now,
            isNew: true
          })
        }, { merge: true });
        
        console.log(`Updated user ${userId}'s group ${groupId} with card reference`);
        
      } catch (groupUpdateError) {
        console.error('Error updating user group document:', groupUpdateError);
        // Non-critical error, continue
      }
      
      return true;
      
    } catch (cardError) {
      console.error('Error in addCardToCollection:', {
        error: cardError.message,
        stack: cardError.stack,
        userId,
        groupId,
        cardId
      });
      throw new Error(`Failed to add card to collection: ${cardError.message}`);
    }
    
  } catch (error) {
    console.error('Error in addCardToCollection:', {
      error: error.message,
      stack: error.stack,
      userId,
      groupId,
      cardId
    });
    throw error;
  }
};

/**
 * Gets all cards in a user's collection for a specific group
 * @param {string} userId - The ID of the user
 * @param {string} groupId - The ID of the group
 * @returns {Promise<Array>} - Array of card objects in the user's collection
 */
export const getUserCollection = async (userId, groupId) => {
  try {
    // Use cache for user group data with appropriate TTL
    const userGroupData = await CacheService.getDocument(`users/${userId}/groups`, groupId, { 
      ttl: 2 * 60 * 1000 // 2 minute cache for collection data
    });
    
    if (!userGroupData) {
      return [];
    }
    
    return userGroupData.collection || [];
  } catch (error) {
    console.error('Error getting user collection:', error);
    throw error;
  }
};
