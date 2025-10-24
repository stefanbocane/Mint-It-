/**
 * App initialization utilities for optimizing startup and caching
 * 
 * DEPRECATED: Most functionality moved to UnifiedBootstrapService
 * This file maintained for backward compatibility only
 */


// DEPRECATED: Use UnifiedBootstrapService.performUnifiedBootstrap instead

// DEPRECATED: Use UnifiedBootstrapService.performUnifiedBootstrap instead
export const preloadUserData = async (userId, groupId) => {
  console.warn('preloadUserData is deprecated. Use UnifiedBootstrapService.performUnifiedBootstrap instead.');
  
  // Fallback to unified bootstrap service
  return await UnifiedBootstrapService.performUnifiedBootstrap(userId, groupId, {
    prefetchUserCards: true,
    prefetchActiveAuctions: true,
    prefetchActiveTrades: false
  });
};

// DEPRECATED: Moved to UnifiedBootstrapService background loading
const preloadNonEssentialData = async (userId, groupId) => {
  console.warn('preloadNonEssentialData is deprecated. Use UnifiedBootstrapService background loading instead.');
  return null;
};

// DEPRECATED: Use UnifiedBootstrapService.performCacheMaintenance instead
export const performCacheMaintenance = async () => {
  console.warn('performCacheMaintenance is deprecated. Use UnifiedBootstrapService.performCacheMaintenance instead.');
  return await UnifiedBootstrapService.performCacheMaintenance();
};

/**
 * Pre-warm cache with frequently accessed data to improve perceived performance
 * This should be called once on app startup after user authentication
 * 
 * @param {string} userId - Current user ID
 * @param {string} groupId - Current group ID
 * @returns {Promise<void>}
 */
export const preWarmCache = async (userId, groupId) => {
  if (!userId || !groupId) {
    console.log('Cannot pre-warm cache without user ID and group ID');
    return;
  }
  
  try {
    console.log('Pre-warming cache for frequently accessed data...');
    
    const startTime = Date.now();
    const promises = [];
    
    // 1. Pre-fetch user profile with selective fields and long TTL
    promises.push(
      getCachedDocFields('users', userId, 
        ['displayName', 'username', 'email', 'photoURL', 'groupBalances'], 
        { ttl: CACHE_TTL.USER_PROFILE * 2 }
      )
    );
    
    // 2. Pre-fetch current group data
    promises.push(
      getCachedDoc('groups', groupId, { ttl: CACHE_TTL.GROUP_DATA })
    );
    
    // 3. Pre-fetch first batch of user's cards
    const cardsQuery = query(
      collection(db, 'cards'),
      where('ownerId', '==', userId),
      where('groupId', '==', groupId),
      limit(10)
    );
    promises.push(
      getCachedQuery(cardsQuery, { ttl: CACHE_TTL.COLLECTION })
    );
    
    // 4. Pre-fetch active auctions for the group
    const auctionsQuery = query(
      collection(db, 'auctions'),
      where('groupId', '==', groupId),
      where('status', '==', 'active'),
      limit(10)
    );
    promises.push(
      getCachedQuery(auctionsQuery, { ttl: CACHE_TTL.AUCTION_DATA })
    );
    
    // Execute all promises in parallel
    await Promise.all(promises);
    
    console.log(`Cache pre-warming completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.warn('Error pre-warming cache:', error);
    // Continue even if pre-warming fails - this is just an optimization
  }
}; 

/**
 * Initialize the app by setting up auth listener and retrieving last active group
 * @returns {Promise<{ user: Object|null, currentGroup: Object|null }>} Promise that resolves to current user and group objects
 */
export const initializeApp = async () => {
  try {
    const auth = getAuth();
    
    // Get current user if already logged in
    const authUser = auth.currentUser;
    
    if (!authUser) {
      return { user: null, currentGroup: null };
    }
    
    // User is signed in
    const user = authUser;
    let currentGroup = null;
    
    try {
      // Get user document to check for lastActiveGroup
      const userDocRef = doc(db, 'users', authUser.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists() && userDoc.data().lastActiveGroup) {
        // Get the last active group
        const groupId = userDoc.data().lastActiveGroup;
        const groupDocRef = doc(db, 'groups', groupId);
        const groupDoc = await getDoc(groupDocRef);
        
        if (groupDoc.exists()) {
          currentGroup = {
            id: groupDoc.id,
            ...groupDoc.data()
          };
        }
      }
    } catch (error) {
      console.error('Error fetching user data or last active group:', error);
    }
    
    return { user, currentGroup };
  } catch (error) {
    console.error('Error in initializeApp:', error);
    return { user: null, currentGroup: null };
  }
}; 