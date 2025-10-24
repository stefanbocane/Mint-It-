import { CACHE_TTL } from '../constants/cacheConfig';
import { getCachedDocs } from './firestoreUtils';

// Map of entity relationships for smart prefetching
const ENTITY_RELATIONSHIPS = {
  auctions: ['userId'], // auctions contain userId
  cards: ['userId', 'ownerId'], // cards contain userId and ownerId
  trades: ['senderId', 'receiverId', 'cards'], // trades contain user IDs and card IDs
  bids: ['userId', 'auctionId'] // bids contain userId and auctionId
};

// Track recently prefetched entities to avoid redundant prefetching
const recentlyPrefetched = new Set();
const PREFETCH_COOLDOWN = 60 * 1000; // 1 minute cooldown

/**
 * Prefetch related data based on fetched entities
 * @param {string} entityType - The type of entities (e.g., 'cards', 'auctions')
 * @param {Array} entities - The array of fetched entities
 */
export const prefetchRelatedData = async (entityType, entities) => {
  if (!entities || entities.length === 0) return;
  
  const relations = ENTITY_RELATIONSHIPS[entityType];
  if (!relations) return;
  
  // Run prefetching in the background with a small delay
  setTimeout(async () => {
    try {
      // Extract related IDs
      const relatedIds = {
        users: new Set(),
        cards: new Set(),
        auctions: new Set()
      };
      
      // Collect all related IDs
      entities.forEach(entity => {
        relations.forEach(relation => {
          if (relation === 'cards' && Array.isArray(entity[relation])) {
            entity[relation].forEach(cardId => relatedIds.cards.add(cardId));
          } else if (relation === 'auctionId' && entity[relation]) {
            relatedIds.auctions.add(entity[relation]);
          } else if (entity[relation]) {
            // Assume it's a user ID if not cards or auctions
            relatedIds.users.add(entity[relation]);
          }
        });
      });
      
      // Prefetch user data
      if (relatedIds.users.size > 0) {
        const userIds = Array.from(relatedIds.users).filter(userId => {
          const key = `prefetch_user_${userId}`;
          if (recentlyPrefetched.has(key)) return false;
          
          recentlyPrefetched.add(key);
          setTimeout(() => recentlyPrefetched.delete(key), PREFETCH_COOLDOWN);
          return true;
        });
        
        if (userIds.length > 0) {
          console.log(`🔍 Prefetching ${userIds.length} related users`);
          await prefetchUsers(userIds);
        }
      }
      
      // Prefetch card data
      if (relatedIds.cards.size > 0) {
        const cardIds = Array.from(relatedIds.cards).filter(cardId => {
          const key = `prefetch_card_${cardId}`;
          if (recentlyPrefetched.has(key)) return false;
          
          recentlyPrefetched.add(key);
          setTimeout(() => recentlyPrefetched.delete(key), PREFETCH_COOLDOWN);
          return true;
        });
        
        if (cardIds.length > 0) {
          console.log(`🔍 Prefetching ${cardIds.length} related cards`);
          await prefetchCards(cardIds);
        }
      }
      
      // Prefetch auction data
      if (relatedIds.auctions.size > 0) {
        const auctionIds = Array.from(relatedIds.auctions).filter(auctionId => {
          const key = `prefetch_auction_${auctionId}`;
          if (recentlyPrefetched.has(key)) return false;
          
          recentlyPrefetched.add(key);
          setTimeout(() => recentlyPrefetched.delete(key), PREFETCH_COOLDOWN);
          return true;
        });
        
        if (auctionIds.length > 0) {
          console.log(`🔍 Prefetching ${auctionIds.length} related auctions`);
          await prefetchAuctions(auctionIds);
        }
      }
      
      console.log(`✅ Prefetching completed for ${entityType}`);
    } catch (error) {
      console.error('Error prefetching related data:', error);
    }
  }, 300); // Small delay to not block main operations
};

/**
 * Prefetch user data with appropriate caching
 * @param {Array} userIds - Array of user IDs to prefetch
 */
const prefetchUsers = async (userIds) => {
  try {
    await getCachedDocs('users', userIds, { 
      ttl: CACHE_TTL.USER_PROFILE,
      forceRefresh: false 
    });
  } catch (error) {
    console.error('Error prefetching users:', error);
  }
};

/**
 * Prefetch card data with appropriate caching
 * @param {Array} cardIds - Array of card IDs to prefetch
 */
const prefetchCards = async (cardIds) => {
  try {
    await getCachedDocs('cards', cardIds, { 
      ttl: CACHE_TTL.CARD_DATA,
      forceRefresh: false 
    });
  } catch (error) {
    console.error('Error prefetching cards:', error);
  }
};

/**
 * Prefetch auction data with appropriate caching
 * @param {Array} auctionIds - Array of auction IDs to prefetch
 */
const prefetchAuctions = async (auctionIds) => {
  try {
    await getCachedDocs('auctions', auctionIds, { 
      ttl: CACHE_TTL.AUCTION_DATA,
      forceRefresh: false 
    });
  } catch (error) {
    console.error('Error prefetching auctions:', error);
  }
}; 