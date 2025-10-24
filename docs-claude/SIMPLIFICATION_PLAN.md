# Collection Screen Simplification Plan

**Date**: October 11, 2025
**Problem**: Cards fetched successfully but state never updates, 15 reads on boot, timeout after 10 seconds

---

## 🔴 Root Cause

From logs analysis:
```
LOG  ✅ Updated latestCardsRef and persistent cache with 2 cards from overview
LOG  💾 CACHED: ultra_collection_all_cards_... (TTL: 5min)
LOG  ✅ OVERVIEW CARDS FETCHED: 2 cards (1 read)
LOG  ⏰ Init timeout reached (10s), forcing loading=false
```

**The Problem**: `await setCachedData()` at line 275 is HANGING (likely IndexedDB failure on iOS). This blocks the entire `initializeData` Promise from resolving, so state never updates even though cards are in the ref.

**Evidence**:
1. Cards ARE fetched: "✅ OVERVIEW CARDS FETCHED: 2 cards"
2. Cards ARE stored in ref: "✅ Updated latestCardsRef"
3. BUT init never completes: "⏰ Init timeout reached (10s)"
4. Missing log: "🔄 Init: Setting state with 2 cards" (never executes)

**Why it hangs**: CacheService.setValue uses IndexedDB which fails on iOS Simulator:
```
WARN  [2025-10-11T19:34:41.014Z]  @firebase/firestore: Error using user provided cache. Falling back to memory cache: FirebaseError: This platform is either missing IndexedDB or is known to have an incomplete implementation.
```

---

## 🎯 Simplification Strategy

### Remove ALL Complex Caching Layers:
1. ❌ Remove CacheService (IndexedDB - fails on iOS)
2. ❌ Remove GlobalRequestDeduplicator (adds complexity)
3. ❌ Remove deduplicatedFetch wrapper (not needed)
4. ❌ Remove Bootstrap check existence cache (24hr cache)
5. ❌ Remove trackCacheHit/trackRead (performance tracking)
6. ❌ Remove getCachedData/setCachedData async operations
7. ✅ Keep ONLY persistentCardCache (simple in-memory object)
8. ✅ Keep cardOverview fetch (1 read for all cards)

### Simplified Flow:
```
Mount → Check persistentCardCache (in-memory) →
  If valid: Use cache (0 reads) →
  If invalid: Fetch cardOverview (1 read) →
    Update state IMMEDIATELY → Done
```

**Total complexity**: ~50 lines instead of 700+

---

## 📋 Implementation Plan

### Step 1: Create Ultra-Simple Hook

```javascript
/**
 * ULTRA-SIMPLE Collection Data Hook
 * Goal: Fetch cards in 1 read, update state immediately, no complex caching
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { doc } from 'firebase/firestore';
import { getDoc } from '../services/ReadTracking/TrackedFirestore';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';

// ONLY persistent cache (survives unmount/remount)
const persistentCardCache = {
  cards: [],
  userId: null,
  groupId: null,
  timestamp: 0
};

export const useSimpleCollectionData = () => {
  const [state, setState] = useState({
    cards: [],
    loading: true,
    refreshing: false,
    error: null
  });

  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const mountedRef = useRef(true);
  const initializingRef = useRef(false);

  // Fetch cards from cardOverview (1 read)
  const fetchCards = useCallback(async () => {
    if (!user?.uid || !currentGroup?.id || initializingRef.current) return;

    initializingRef.current = true;

    try {
      console.log('🚀 Fetching cards...');

      const overviewId = `${currentGroup.id}_${user.uid}`;
      const overviewSnap = await getDoc(doc(db, 'cardOverviews', overviewId));

      if (overviewSnap.exists()) {
        const data = overviewSnap.data();
        const cards = data.cards || [];

        // Transform cards
        const transformedCards = cards.map(card => ({
          ...card,
          ownerId: user.uid,
          groupId: currentGroup.id,
          ownerName: 'You',
          createdAt: card.createdAt?.toDate?.() || new Date(),
          updatedAt: card.updatedAt?.toDate?.() || new Date()
        }));

        console.log(`✅ Fetched ${transformedCards.length} cards`);

        // Update persistent cache
        persistentCardCache.cards = transformedCards;
        persistentCardCache.userId = user.uid;
        persistentCardCache.groupId = currentGroup.id;
        persistentCardCache.timestamp = Date.now();

        // Update state IMMEDIATELY (no async cache operations to block)
        if (mountedRef.current) {
          setState({
            cards: transformedCards,
            loading: false,
            refreshing: false,
            error: null
          });
          console.log(`✅ State updated with ${transformedCards.length} cards`);
        }
      } else {
        console.log('⚠️ No cardOverview found');
        setState({ cards: [], loading: false, refreshing: false, error: null });
      }
    } catch (error) {
      console.error('❌ Fetch failed:', error);
      if (mountedRef.current) {
        setState(prev => ({ ...prev, loading: false, refreshing: false, error: error.message }));
      }
    } finally {
      initializingRef.current = false;
    }
  }, [user?.uid, currentGroup?.id]);

  // Manual refresh
  const onRefresh = useCallback(async () => {
    if (!user?.uid || !currentGroup?.id) return;

    setState(prev => ({ ...prev, refreshing: true }));

    // Clear cache
    persistentCardCache.timestamp = 0;

    // Refetch
    await fetchCards();
  }, [user?.uid, currentGroup?.id, fetchCards]);

  // Initialize on mount
  useEffect(() => {
    mountedRef.current = true;

    if (!user?.uid || !currentGroup?.id) {
      setState({ cards: [], loading: false, refreshing: false, error: null });
      return;
    }

    // Check persistent cache
    const cacheAge = Date.now() - persistentCardCache.timestamp;
    const isCacheValid =
      persistentCardCache.userId === user.uid &&
      persistentCardCache.groupId === currentGroup.id &&
      persistentCardCache.cards.length > 0 &&
      cacheAge < 60000; // 1 minute

    if (isCacheValid) {
      console.log(`⚡ Using cache: ${persistentCardCache.cards.length} cards`);
      setState({
        cards: persistentCardCache.cards,
        loading: false,
        refreshing: false,
        error: null
      });
      return;
    }

    // Fetch fresh
    fetchCards();

    return () => {
      mountedRef.current = false;
    };
  }, [user?.uid, currentGroup?.id, fetchCards]);

  return {
    cards: state.cards,
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
    onRefresh
  };
};
```

### Step 2: Replace in CollectionScreen

```javascript
// Before:
import { useUltraOptimizedCollectionData } from '../hooks/useUltraOptimizedCollectionData';

// After:
import { useSimpleCollectionData } from '../hooks/useSimpleCollectionData';

// Usage:
const { cards, loading, refreshing, onRefresh } = useSimpleCollectionData();
```

---

## ✅ Benefits

1. **Eliminates 10-second timeout** - No async cache operations to hang
2. **Reduces complexity** - From 700+ lines to ~100 lines
3. **Reduces reads** - 1 read for cardOverview (vs 15 currently)
4. **Instant state updates** - No blocking on CacheService.setValue
5. **Works on iOS Simulator** - No IndexedDB dependency
6. **Still has persistent cache** - In-memory cache survives remounts
7. **Easier to debug** - Simple linear flow

---

## 📊 Expected Results

### Before (Current):
- 15 reads on boot
- 10-second timeout
- No cards displayed
- Complex caching failures

### After (Simplified):
- 1 read on boot (cardOverview)
- 0 reads on remount (persistent cache)
- Cards display in <1 second
- No timeouts
- Works reliably

---

## 🚀 Implementation Steps

1. Create `src/hooks/useSimpleCollectionData.js` with simplified hook
2. Update `src/screens/CollectionScreen.js` to use new hook
3. Test fresh boot (should show cards immediately)
4. Test remount (should use cache, 0 reads)
5. Test refresh (should refetch)
6. Remove old hook once verified

---

##Status**: 📝 **Plan Complete - Ready for Implementation**
