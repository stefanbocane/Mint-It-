import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';

// Constants for limits
export const CARD_COLLECTION_LIMIT = 25;
export const GROUP_MEMBERSHIP_LIMIT = 3;

/**
 * Check if user has reached their card collection limit
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @returns {Promise<{canAdd: boolean, currentCount: number, limit: number}>}
 */
export const checkCardCollectionLimit = async (userId, groupId) => {
  try {
    // Get user's cards in this group
    const cardsRef = collection(db, 'cards');
    const userCardsQuery = query(
      cardsRef,
      where('userId', '==', userId),
      where('groupId', '==', groupId)
    );
    
    const snapshot = await getDocs(userCardsQuery);
    const currentCount = snapshot.size;
    
    return {
      canAdd: currentCount < CARD_COLLECTION_LIMIT,
      currentCount,
      limit: CARD_COLLECTION_LIMIT
    };
  } catch (error) {
    console.error('Error checking card collection limit:', error);
    return {
      canAdd: false,
      currentCount: 0,
      limit: CARD_COLLECTION_LIMIT
    };
  }
};

/**
 * Check if user has reached their group membership limit
 * @param {string} userId - The user ID
 * @returns {Promise<{canJoin: boolean, currentCount: number, limit: number}>}
 */
export const checkGroupMembershipLimit = async (userId) => {
  try {
    // Get groups where user is a member
    const groupsRef = collection(db, 'groups');
    const userGroupsQuery = query(
      groupsRef,
      where('members', 'array-contains', userId)
    );
    
    const snapshot = await getDocs(userGroupsQuery);
    const currentCount = snapshot.size;
    
    return {
      canJoin: currentCount < GROUP_MEMBERSHIP_LIMIT,
      currentCount,
      limit: GROUP_MEMBERSHIP_LIMIT
    };
  } catch (error) {
    console.error('Error checking group membership limit:', error);
    return {
      canJoin: false,
      currentCount: 0,
      limit: GROUP_MEMBERSHIP_LIMIT
    };
  }
};

/**
 * Get user's card count for display purposes
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @returns {Promise<{count: number, limit: number, percentage: number}>}
 */
export const getUserCardStats = async (userId, groupId) => {
  try {
    const result = await checkCardCollectionLimit(userId, groupId);
    return {
      count: result.currentCount,
      limit: result.limit,
      percentage: (result.currentCount / result.limit) * 100
    };
  } catch (error) {
    console.error('Error getting user card stats:', error);
    return {
      count: 0,
      limit: CARD_COLLECTION_LIMIT,
      percentage: 0
    };
  }
};

/**
 * Get user's group membership stats
 * @param {string} userId - The user ID
 * @returns {Promise<{count: number, limit: number, percentage: number}>}
 */
export const getUserGroupStats = async (userId) => {
  try {
    const result = await checkGroupMembershipLimit(userId);
    return {
      count: result.currentCount,
      limit: result.limit,
      percentage: (result.currentCount / result.limit) * 100
    };
  } catch (error) {
    console.error('Error getting user group stats:', error);
    return {
      count: 0,
      limit: GROUP_MEMBERSHIP_LIMIT,
      percentage: 0
    };
  }
};

/**
 * Check if user can bid on auctions based on card limit
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @param {number} cardsToReceive - Number of cards they would receive if they win (default 1)
 * @returns {Promise<{canBid: boolean, currentCount: number, limit: number, wouldExceed: boolean}>}
 */
export const checkAuctionBiddingLimit = async (userId, groupId, cardsToReceive = 1) => {
  try {
    const result = await checkCardCollectionLimit(userId, groupId);
    const wouldExceed = (result.currentCount + cardsToReceive) > CARD_COLLECTION_LIMIT;
    
    return {
      canBid: !wouldExceed,
      currentCount: result.currentCount,
      limit: CARD_COLLECTION_LIMIT,
      wouldExceed,
      cardsToReceive
    };
  } catch (error) {
    console.error('Error checking auction bidding limit:', error);
    return {
      canBid: false,
      currentCount: 0,
      limit: CARD_COLLECTION_LIMIT,
      wouldExceed: true,
      cardsToReceive
    };
  }
}; 