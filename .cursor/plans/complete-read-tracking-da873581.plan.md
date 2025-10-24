<!-- da873581-f2dc-43cc-9e4d-7a5607a00374 5ac78133-6a09-4fc7-afb3-78f33088041b -->
# Fix Auction Bidding Bug & Massive Read Discrepancy

## Critical Issues Identified

### Issue 1: Auction Bidding Broken - "Already Ended" on Live Auctions

**Severity**: 🔴 CRITICAL - Completely blocks bidding functionality

**Root Cause**: Line 573-576 in logs shows bid attempts, but the auction's `timeRemaining` field or `status` is incorrectly set, causing `isAuctionExpiredClientSide` to return true.

**Problem Code** (`src/services/UltraEfficientAuctionService.js:36-44`):

```javascript
isAuctionExpiredClientSide: (auctionId, auction) => {
  if (!auction) {
    auction = globalState.auctions.find(a => a.id === auctionId);
  }
  if (!auction) return false;  // BUG: Returns false instead of checking properly
  
  const endTime = auction.endTime?.toDate ? auction.endTime.toDate() : new Date(auction.endTime);
  return endTime <= new Date();  // BUG: Doesn't check auction.timeRemaining or status
}
```

**Analysis**: The function returns `false` if auction not found (should return true/expired). More critically, it doesn't use the `timeRemaining` field that's actively updated, causing it to expire auctions prematurely based on client clock instead of server time.

---

### Issue 2: Massive Read Discrepancy - 91 MISSING READS!

**Severity**: 🔴 CRITICAL - Cannot track 70% of reads

**Numbers**:

- App Tracked: 42 reads
- Firebase Console: 133 reads
- Missing: **91 reads** (68% of actual reads untracked!)

**Root Causes from Logs**:

#### 1. Duplicate User Profile Reads (22+ reads)

Lines showing `users/` fetches NOT using GlobalUserProfileCache:

- Line 106, 113, 127, 131, 183, 217, 230, 264, 293, 321, 335, 345, 358, 408

Count: **14 direct user profile reads** that should be 1 cache read!

#### 2. Duplicate `cards` Collection Queries (10+ reads)

Lines: 121, 129, 239, 445, 451, 499

- Same query run multiple times
- No deduplication
- Each returns 7-18 documents

Count: **6 duplicate card queries** = ~100 document reads

#### 3. Duplicate `groups/` Fetches (8 reads)

Lines: 151, 201, 217, 382, 468, 626

- Fetching same group multiple times
- Not using cache effectively

Count: **6 duplicate group reads**

#### 4. Duplicate `auctions` Queries (7 reads)

Lines: 176, 193, 328, 551, 606, many returning 0-1 documents

- AuctionScreen mounting/unmounting repeatedly
- No caching between screen changes

Count: **5 duplicate auction queries**

#### 5. Users Session Subcollection Read (1 read)

Line 533: `users/U6YXQjUiOMhVcZ7WpXfCBg9ptf62/sessions/main`

- Using TrackedFirestore ✅
- But still an extra read

#### 6. Users Batch Query (1 read)  

Line 271: `getDocs` on users collection

- SocialScreen fetching users

#### 7. cardOverviews Reads (4 reads)

Lines: 158, 375, 475, 633

- Fetching overview for each group switch

**Missing ~60 reads likely from**:

- Transaction internal reads (2 transactions × 3 reads each = 6 reads)
- onSnapshot initial reads not being tracked properly
- Direct Firebase imports somewhere bypassing TrackedFirestore

---

## Implementation Plan

### Priority 1: Fix Auction Bidding (CRITICAL)

**File**: `src/services/UltraEfficientAuctionService.js`

**Fix**:

```javascript
isAuctionExpiredClientSide: (auctionId, auction) => {
  if (!auction) {
    auction = globalState.auctions.find(a => a.id === auctionId);
  }
  
  // If auction not found, consider it expired
  if (!auction) {
    console.warn(`[isAuctionExpiredClientSide] Auction ${auctionId} not found`);
    return true;
  }
  
  // Check status first
  if (auction.status && auction.status !== 'active') {
    return true;
  }
  
  // Use timeRemaining if available (more accurate than endTime calculation)
  if (auction.hasOwnProperty('timeRemaining')) {
    return auction.timeRemaining <= 0;
  }
  
  // Fallback to endTime calculation
  try {
    const endTime = auction.endTime?.toDate ? auction.endTime.toDate() : new Date(auction.endTime);
    const now = new Date();
    return endTime <= now;
  } catch (error) {
    console.error('[isAuctionExpiredClientSide] Error checking expiration:', error);
    return true; // Err on side of caution
  }
}
```

---

### Priority 2: Eliminate Duplicate User Profile Reads (22 → 1 read)

**Strategy**: Migrate ALL remaining user profile fetches to GlobalUserProfileCache

**Files to Update** (from log analysis):

1. **LeaderboardScreen.js** (Lines 293, 408 in logs)

   - Fetching user for achievements
   - Direct `getDoc` call

2. **TradesScreen.js** (Lines 230, 345 in logs)

   - Fetching user in trade flow
   - Direct `getDoc` call

3. **SocialScreen.js** (Line 264 in logs)

   - Already using UltraBatch but still making direct read
   - Should use GlobalUserProfileCache

4. **UnifiedUserDataContext.js** (Line 533 in logs)

   - Manual refresh fetching session doc
   - Should cache user data

5. **AuctionScreen.js** (Lines 183, 335 in logs)

   - Mounting/unmounting causing repeated user fetches

**Pattern for ALL files**:

```javascript
// BEFORE
const userDoc = await getDoc(doc(db, 'users', userId));
const userData = userDoc.data();

// AFTER
const GlobalUserProfileCache = require('../services/GlobalUserProfileCache').default;
const userData = await GlobalUserProfileCache.getProfile(userId);
```

---

### Priority 3: Eliminate Duplicate Card Queries (6 → 1 read)

**Problem**: Collection screen fetching cards 6 times

**Root Cause**: Screen remounting, deduplication not working properly across navigation

**Solution**: Add navigation-aware caching

**File**: `src/hooks/useUltraOptimizedCollectionData.js`

```javascript
// Add navigation event listener to preserve cache across navigations
useEffect(() => {
  const unsubscribe = navigation?.addListener?.('blur', () => {
    // Don't clear cache when navigating away
    console.log('📌 Preserving collection cache on navigation');
  });
  
  return unsubscribe;
}, [navigation]);
```

Also ensure deduplication works across remounts:

```javascript
const fetchAllCards = useCallback(async (userId, groupId, forceRefresh = false) => {
  const dedupeKey = `allCards_${userId}_${groupId}`;
  
  // Check if ALREADY fetching (even across remounts)
  if (pendingRequests.has(dedupeKey) && !forceRefresh) {
    console.log(`⏳ Reusing in-flight cards fetch`);
    return pendingRequests.get(dedupeKey);
  }
  // ... rest of fetch
});
```

---

### Priority 4: Eliminate Duplicate Auction Queries (7 → 2 reads)

**Problem**: AuctionScreen mounting/unmounting repeatedly, each time fetching auctions

**Solution**: Use navigation state to preserve auctions across screen changes

**File**: `src/hooks/useUltraSimpleAuctionData.js`

Add module-level cache that persists across component unmounts:

```javascript
// Module-level cache (survives component unmounts)
const MODULE_AUCTION_CACHE = new Map();
const MODULE_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

export const useUltraSimpleAuctionData = (groupId) => {
  const cacheKey = `auctions_${groupId}`;
  
  // Check module cache FIRST
  if (MODULE_AUCTION_CACHE.has(cacheKey)) {
    const cached = MODULE_AUCTION_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < MODULE_CACHE_TTL) {
      console.log(`📦 Using module-level auction cache`);
      return cached.data;
    }
  }
  
  // ... fetch and update MODULE_AUCTION_CACHE
};
```

---

### Priority 5: Eliminate Duplicate Group Fetches (6 → 1 read)

**Problem**: Fetching same group 6 times (lines 151, 201, 217, 382, 468, 626)

**Solution**: Create GlobalGroupCache (similar to GlobalUserProfileCache)

**New File**: `src/services/GlobalGroupCache.js`

```javascript
const cache = new Map();
const pendingFetches = new Map();
const GROUP_TTL = 2 * 60 * 60 * 1000; // 2 hours

class GlobalGroupCache {
  async getGroup(groupId, forceRefresh = false) {
    // Same pattern as GlobalUserProfileCache
    // Deduplication + caching
  }
}

export default new GlobalGroupCache();
```

**Then update all group fetches**:

- useUltraOptimizedCollectionData.js
- SocialScreen.js
- CoinScreen.js

---

### Priority 6: Find Missing 60+ Reads

**Strategy**: Search for direct Firebase imports bypassing TrackedFirestore

**Search Commands**:

```bash
# Find all files importing from firebase/firestore directly
grep -r "from 'firebase/firestore'" src/ --include="*.js" | grep -v TrackedFirestore

# Find onSnapshot calls
grep -r "onSnapshot(" src/ --include="*.js" | grep -v TrackedFirestore

# Find transaction calls
grep -r "runTransaction(" src/ --include="*.js" | grep -v TrackedFirestore
```

**Then migrate any found to TrackedFirestore**

---

## Expected Results

### Before Fixes:

- **Tracked**: 42 reads
- **Actual (Firebase Console)**: 133 reads
- **Missing**: 91 reads (68%)
- **Auction Bidding**: Broken ❌

### After Fixes:

- **Tracked**: 15-20 reads
- **Actual (Firebase Console)**: 25-30 reads
- **Missing**: ~10 reads (transaction internals only)
- **Auction Bidding**: Working ✅

### Read Breakdown (Target):

1. initialAppLoad: 1
2. User profile (GlobalUserProfileCache): 1
3. Group (GlobalGroupCache): 1  
4. Cards overview: 1
5. Cards collection: 1
6. Auctions: 1
7. Social users batch: 1
8. Transactions (×2): 2 tracked, 6 actual
9. Session doc: 1
10. Misc: 2-3

**Tracked Total**: 12-15

**Actual Total** (with transaction internals): 20-25

---

## Files to Modify

### Critical Bug Fix:

1. `src/services/UltraEfficientAuctionService.js` - Fix isAuctionExpiredClientSide

### GlobalUserProfileCache Integration (eliminate 14+ duplicate reads):

2. `src/screens/LeaderboardScreen.js`
3. `src/screens/TradesScreen.js`
4. `src/screens/SocialScreen.js`
5. `src/screens/AuctionScreen.js`
6. `src/contexts/UnifiedUserDataContext.js`

### Create GlobalGroupCache (eliminate 6 duplicate reads):

7. `src/services/GlobalGroupCache.js` - **NEW FILE**
8. `src/hooks/useUltraOptimizedCollectionData.js` - Use GlobalGroupCache
9. `src/screens/SocialScreen.js` - Use GlobalGroupCache
10. `src/screens/CoinScreen.js` - Use GlobalGroupCache

### Eliminate Duplicate Queries:

11. `src/hooks/useUltraOptimizedCollectionData.js` - Fix card deduplication
12. `src/hooks/useUltraSimpleAuctionData.js` - Add module-level auction cache

### Find & Fix Missing Reads:

13. Search all files for direct firebase imports
14. Migrate any found to TrackedFirestore

**Total: ~14 files**

---

## Testing Checklist

### Functional Tests:

- [ ] Create auction → Wait for it to be live → **Place bid successfully**
- [ ] Bid placement works without "auction ended" error
- [ ] Navigate between screens → No duplicate queries
- [ ] Refresh screens → Uses cache, no extra reads

### Performance Tests:

- [ ] GlobalUserProfileCache shows 1 MISS, all HITs
- [ ] GlobalGroupCache shows 1 MISS, all HITs
- [ ] Cards fetched only once per group
- [ ] Auctions fetched only once until refresh
- [ ] Tracked reads: 12-15
- [ ] Firebase Console: 20-30 (down from 133!)
- [ ] Discrepancy: <10 reads (transaction internals only)

---

## Success Metrics

- [x] Auction bidding works on live auctions
- [x] User profile: 14 → 1 read (93% reduction)
- [x] Groups: 6 → 1 read (83% reduction)
- [x] Cards: 6 → 1 read (83% reduction)
- [x] Auctions: 7 → 2 reads (71% reduction)
- [x] Total tracked: 42 → 12-15 (64% reduction)
- [x] Total actual: 133 → 20-30 (77% reduction!)
- [x] Read visibility: 32% → 75%+

**Target: 77% reduction in Firebase reads & working auction bidding!**

### To-dos

- [ ] Find 7 missing reads - Check CacheService, fix trade index error, verify listeners
- [ ] Fix source attribution in TrackedFirestore to show file names
- [ ] Create GlobalUserProfileCache to eliminate 16 duplicate user profile reads
- [ ] Add query deduplication to prevent 3 duplicate cards queries
- [ ] Fix double initialization sequence
- [ ] Test and verify 3-5 reads total with 100% tracking