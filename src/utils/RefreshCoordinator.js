// Centralized RefreshCoordinator - v1.0
// Provides a single entry-point to trigger a lightweight, cross-screen refresh without direct Firestore reads.
// Each screen should call refreshAll(..) in its pull-to-refresh handler.
// The coordinator will:
// 1. Invalidate the most common cache keys so existing listeners will auto-sync.
// 2. Ping global stores (e.g. auction store) to perform their own differential sync if needed.
// 3. Never issue direct getDoc / getDocs calls on its own – zero read cost.

import CacheService from '../services/caching/CacheService';
import useAuctionStore from '../services/UltraEfficientAuctionService';

// NOTE: this module must remain free of React hooks (it is a plain JS helper).
// If a store exposes `getState`, it is safe to call outside of React.

const RefreshCoordinator = {
  /**
   * Trigger an application-wide refresh.
   * @param {string|null} userId – Current user id (null allowed if unknown).
   * @param {string|null} groupId – Current active group id (null allowed).
   * @returns {Promise<void>} Resolves when the invalidation cycle completes.
   */
  async refreshAll(userId = null, groupId = null) {
    try {
      console.log('🔄 [RefreshCoordinator] Global refresh started');

      // Step 1: collect cache keys to invalidate.
      const keys = new Set();

      if (userId && groupId) {
        keys.add(`user_cards_${userId}_${groupId}`);
        keys.add(`collection_${userId}_${groupId}`);
        keys.add(`trades_${groupId}_${userId}`);
        keys.add(`user_trades_${userId}_${groupId}`);
        keys.add(`shared_user_cards_${userId}_${groupId}`);
        keys.add(`ultra_collection_all_cards_${userId}_${groupId}`);
        keys.add(`ultra_collection_user_profile_${userId}`);
      }

      if (groupId) {
        keys.add(`auctions_${groupId}`);
        keys.add(`auctionOverviews_${groupId}`);
        keys.add(`leaderboard_optimized_${groupId}`);
        // 🚀 OPTIMIZED: New overview documents
        keys.add(`tradeOverviews_${groupId}`);
        keys.add(`socialOverviews_${groupId}`);
        keys.add(`ultra_collection_group_info_${groupId}`);
      }
      
      // 🚀 OPTIMIZED: User data cache
      if (userId) {
        keys.add(`unified_user_${userId}`);
      }

      // Batch invalidate – ignore individual errors.
      if (keys.size > 0) {
        await Promise.allSettled(Array.from(keys).map(k => CacheService.invalidate(k)));
        console.log(`🧹 [RefreshCoordinator] Invalidated ${keys.size} cache keys`);
      }

      // Step 2: poke global auction store so it re-evaluates freshness.
      try {
        const auctionStore = useAuctionStore.getState();
        if (groupId && auctionStore?.refreshGroup) {
          // Force refresh so newly created auctions appear immediately
          auctionStore.refreshGroup(groupId, { forceRefresh: true });
          console.log('📤 [RefreshCoordinator] Notified auction store');
        }
      } catch (err) {
        console.warn('[RefreshCoordinator] Auction store refresh skipped:', err?.message);
      }

      // Step 3: future hooks / stores can be signalled here (placeholder).
      // e.g., tradeStore.refreshGroup(groupId), collectionStore.refresh(userId, groupId), etc.

      console.log('✅ [RefreshCoordinator] Global refresh completed');
    } catch (error) {
      console.error('❌ [RefreshCoordinator] Global refresh failed:', error);
    }
  }
};

export default RefreshCoordinator; 