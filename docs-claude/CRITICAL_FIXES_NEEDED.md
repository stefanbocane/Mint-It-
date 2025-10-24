# Critical Issues & Fixes

**Date**: October 10, 2025
**Priority**: URGENT
**Status**: In Progress

---

## Issues Reported

1. **Collection refresh not displaying cards** ⚠️
2. **Coining card deducts 50 coins instead of expected amount** ⚠️
3. **Coining card uses too many reads** ⚠️

---

## Issue 1: Collection Refresh Not Displaying Cards

### Root Cause Analysis:
The `onRefresh` function in `useUltraOptimizedCollectionData.js` (line 642-665) calls:
1. `RefreshCoordinator.refreshAll()` - Only invalidates cache keys
2. `initializeData(true)` - Should re-fetch cards with `forceRefresh=true`

**Problem**: The `RefreshCoordinator` only invalidates cache but doesn't trigger a state update that causes the UI to re-render with the new data.

### Investigation Steps:
1. Check if `initializeData(true)` actually fetches fresh data
2. Verify state is updating after refresh
3. Check if cards are being filtered out somewhere

### Potential Fix:
The issue might be that after cache invalidation, the `initializeData` is not forcing a fresh fetch properly. The `forceRefresh` flag needs to be passed correctly through all fetch functions.

---

## Issue 2: Coin Deduction Amount

### Current Behavior:
User reports 50 coins deducted when "coining" a card.

### Expected Behavior:
Need clarification on expected amount:
- If card was **Common**: Should deduct 5 coins
- If card was **Epic**: 50 coins is correct
- If card was **Common** but deducted 50: BUG

### Download Prices (from rarity.js:38-45):
```javascript
export const DOWNLOAD_PRICES = {
  [RARITY_TYPES.COMMON]: 5,
  [RARITY_TYPES.UNCOMMON]: 10,
  [RARITY_TYPES.RARE]: 25,
  [RARITY_TYPES.EPIC]: 50,        // ← 50 coins for Epic
  [RARITY_TYPES.LEGENDARY]: 75,
  [RARITY_TYPES.MYTHIC]: 100
};
```

### Investigation Needed:
1. What was the rarity of the card that was "coined"?
2. Was it the download feature or the "own card" feature?
3. Check logs to see actual deduction amount

### Code Location:
- **Download feature**: CardPreviewModal.js:152 - `subtractCoins(downloadPrice)`
- **Own card feature**: CardPreviewModal.js:103 - `addCoins(coinReward)` (ADDS coins, not subtracts)

**WAIT**: The "own card" feature **ADDS** coins, it doesn't subtract them!

### Clarification Needed:
- Was the user trying to **download** the card (costs coins)?
- Or trying to **own** the card (gives coins + removes from collection)?

---

## Issue 3: Coining Card Uses Too Many Reads

### Current Read Sources:

#### When "Own Card" is clicked (CardPreviewModal.js:64-138):
1. `addCoins(coinReward)` calls `unifiedAddCoins` (CollectionScreen.js:77-80)
2. `unifiedAddCoins` is from `UnifiedUserDataContext`
3. This likely triggers multiple Firestore operations

### Investigation Needed:
1. Check `UnifiedUserDataContext.addCoins` implementation
2. Count actual reads during "own card" operation
3. Identify if there are unnecessary reads

### Potential Read Sources:
1. Reading user balance
2. Updating user balance
3. Deleting card document
4. Updating group stats
5. Updating user stats
6. Cache operations

### Optimization Strategy:
1. Use cached balance (don't re-fetch)
2. Use transaction/batch write for atomic updates
3. Minimize reads by using local state

---

## Recommended Fixes

### Fix 1: Collection Refresh

**Option A - Force State Update**:
```javascript
// In useUltraOptimizedCollectionData.js onRefresh function
const onRefresh = useCallback(async () => {
  if (!user?.uid || !currentGroup?.id) return;

  setState(prev => ({ ...prev, refreshing: true, error: null }));

  try {
    await RefreshCoordinator.refreshAll(user.uid, currentGroup.id);

    // FORCE FRESH FETCH - bypass cache completely
    const freshCardsData = await fetchAllCards(user.uid, currentGroup.id, true);

    // DIRECTLY UPDATE STATE with fresh data
    setState(prev => ({
      ...prev,
      cards: freshCardsData.cards,
      refreshing: false
    }));
  } catch (error) {
    console.error('Refresh failed:', error);
    handleError(error, 'refresh');
  }
}, [user?.uid, currentGroup?.id, fetchAllCards, handleError]);
```

**Option B - Clear Cache Then Re-initialize**:
```javascript
const onRefresh = useCallback(async () => {
  if (!user?.uid || !currentGroup?.id) return;

  setState(prev => ({ ...prev, refreshing: true }));

  try {
    // Clear ALL collection-related cache
    const cacheKey = generateCacheKey('all_cards', user.uid, currentGroup.id);
    await CacheService.invalidate(cacheKey);

    // Re-initialize from scratch
    await initializeData(true);
  } catch (error) {
    handleError(error, 'refresh');
  } finally {
    setState(prev => ({ ...prev, refreshing: false }));
  }
}, [user?.uid, currentGroup?.id, initializeData, handleError]);
```

### Fix 2: Coin Deduction Clarification

**If issue is wrong rarity detection**:
```javascript
// Add logging to CardPreviewModal.js downloadCardToDevice
const downloadPrice = getDownloadPrice(card.rarity);
console.log(`💰 Download price for ${card.rarity} card: ${downloadPrice} coins`);
```

**If issue is using wrong function**:
- Confirm user is using "Download" button (costs coins)
- Not "Own Card" button (gives coins)

### Fix 3: Optimize Coining Reads

**Current (High Reads)**:
```javascript
const addResult = await addCoins(coinReward);
```

**Optimized (Low Reads)**:
```javascript
// Use batch write to minimize reads
const addResult = await addCoins(coinReward, {
  skipBalanceFetch: true,  // Don't re-fetch balance
  useTransaction: false     // Use batch write instead
});
```

---

## Testing Plan

### Test 1: Collection Refresh
1. Open CollectionScreen
2. Note number of cards displayed
3. Add a new card via another device/browser
4. Pull to refresh
5. **Expected**: New card appears
6. **Check**: Cards count increased

### Test 2: Coin Deduction
1. Note current balance
2. Find a **Common** card
3. Click "Download" (NOT "Own Card")
4. **Expected**: Balance decreased by 5 coins
5. If decreased by 50: BUG CONFIRMED

### Test 3: Read Count
1. Open ReadDashboard
2. Note current read count
3. Click "Own Card" on any card
4. Check ReadDashboard
5. **Expected**: <5 additional reads
6. **Actual**: Document actual reads

---

## Next Steps

1. **Immediate**: Get clarification from user on coin issue
   - Was it Common card that deducted 50?
   - Or was it Epic card (50 is correct)?

2. **Fix collection refresh**: Implement Option A (force state update)

3. **Optimize reads**: Check UnifiedUserDataContext implementation

4. **Test thoroughly**: Run all tests before marking complete

---

## Status Tracking

- [ ] Clarify coin deduction issue with user
- [ ] Fix collection refresh
- [ ] Optimize coining reads
- [ ] Test all fixes
- [ ] Deploy to production

**Next**: Waiting for user clarification on coin amount issue.
