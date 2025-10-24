# Phase 2: Listener Audit & Elimination - Analysis

**Date**: October 10, 2025
**Status**: 🔍 Analysis Complete - Ready for Implementation
**Expected Impact**: -10 to -20 reads/session
**Current Progress**: Phase 1 Complete (ConsolidatedBidService → 0 reads)

---

## 📊 Executive Summary

Phase 2 focuses on eliminating unknown/hidden Firestore listeners that are causing 10-20 reads per session. I've completed a comprehensive audit of the codebase and identified **TWO main listener sources**:

1. **firestoreUtils.js listener functions** (active, causing reads)
2. **collectionScreenOptimizer.js** (needs investigation)

---

## 🔍 Findings

### 1. firestoreUtils.js Listeners

#### Functions with onSnapshot:

1. **`setupCachedQueryListener`** (line 668)
   - Contains **2** onSnapshot calls (lines 853, 940)
   - **Purpose**: Sets up real-time Firestore listeners with caching
   - **Status**: ⚠️ **ACTIVELY USED**

2. **`setupCachedQueryListenerWithChanges`** (line 406)
   - Contains **1** onSnapshot call (line 1079/422)
   - **Purpose**: Sets up listeners that only process document changes
   - **Status**: ❓ **UNKNOWN - needs caller analysis**

#### Callers of setupCachedQueryListener:

**Only 3 files import these functions:**
- ✅ `/src/utils/firestoreUtils.js` (exports them)
- ✅ `/src/utils/auctionTimerUtils.js` (uses `setupCachedQueryListener`)
- ✅ `/src/utils/index.js` (likely re-exports)

#### auctionTimerUtils.js Usage:

**File**: `src/utils/auctionTimerUtils.js:416`
```javascript
const unsubscribe = setupCachedQueryListener(
  auctionRef,
  (auctionData) => {
    // Auction event handling
  },
  options
);
```

**Function**: `setupAuctionEventListeners(auctionId, onUpdate, onError, options)`

**Callers of setupAuctionEventListeners** (5 files found):
1. `/src/hooks/useAuctionData.js`
2. `/src/hooks/useBidding.js`
3. `/src/components/auction/AuctionTimer.js`
4. `/src/components/auction/AuctionBidModal.js`
5. `/src/utils/auctionTimerUtils.js` (defines it)

---

### 2. collectionScreenOptimizer.js

**File**: `src/utils/collectionScreenOptimizer.js`
**Status**: ⏳ Needs investigation

**Potential onSnapshot call at line 82** (from initial grep)

Need to determine:
- [ ] Is this file imported anywhere?
- [ ] Is it actively used by CollectionScreen?
- [ ] Can we delete it entirely?

---

## 🎯 Impact Assessment

### Current Read Sources (Estimated):

```
Source                          Reads/Session   Status
─────────────────────────────────────────────────────
ConsolidatedBidService          0               ✅ Phase 1 Complete
auctionTimerUtils listeners     10-15           🔴 Active
collectionScreenOptimizer       5-10            ❓ Unknown
Other unknown listeners         0-5             ❓ TBD
─────────────────────────────────────────────────────
TOTAL LISTENER READS            15-30 reads
```

### Expected After Phase 2:

```
All Firestore listeners:        0-5 reads       ✅ Target
```

---

## 📋 Implementation Plan

### Task 1: Analyze auctionTimerUtils Listener Usage

**Goal**: Determine if we can replace with cache-first fetch or eliminate entirely

**Steps**:
1. Check how often `setupAuctionEventListeners` is called
2. Determine if real-time updates are actually needed
3. Check if auction data is already available from `useUltraSimpleAuctionData`
4. Measure read frequency

**Options**:
- **Option A**: Replace with polling (fetch every 30s when auction screen active)
- **Option B**: Use existing cached auction data (no listener needed)
- **Option C**: Use Expo push notifications (like ConsolidatedBidService)

**Recommendation**: **Option B** - Use cached data from `useUltraSimpleAuctionData`
- Auctions are already cached via auction overview documents
- Real-time updates come from ConsolidatedBidService (bids via push notifications)
- Timer can work with cached endTime (no need for live sync)

---

### Task 2: Investigate collectionScreenOptimizer.js

**Goal**: Determine if file is dead code or actively used

**Steps**:
1. Search for imports: `grep -r "collectionScreenOptimizer" src/`
2. Check if CollectionScreen uses it
3. Verify with `useUltraOptimizedCollectionData` hook

**Possible Outcomes**:
- **Scenario A**: Dead code → Delete entire file
- **Scenario B**: Active → Replace with cached fetch
- **Scenario C**: Partially used → Refactor to remove listener

**Expected**: Dead code (CollectionScreen likely uses `useUltraOptimizedCollectionData`)

---

### Task 3: Remove setupCachedQueryListener Functions

**Goal**: Delete unused listener infrastructure

**After verifying no active usage**:
1. Remove `setupCachedQueryListener` from firestoreUtils.js
2. Remove `setupCachedQueryListenerWithChanges` from firestoreUtils.js
3. Update exports in `src/utils/index.js`
4. Remove related throttling code if unused

**Files to modify**:
- `/src/utils/firestoreUtils.js` - Remove functions
- `/src/utils/index.js` - Remove exports
- `/src/utils/auctionTimerUtils.js` - Refactor to use cached fetch

---

### Task 4: Refactor auctionTimerUtils

**Current** (with listener):
```javascript
// BAD: Uses onSnapshot listener
const unsubscribe = setupCachedQueryListener(
  auctionRef,
  (auctionData) => {
    // Process auction updates
  }
);
```

**Proposed** (cache-first):
```javascript
// GOOD: Uses cached data + manual refresh
const auctionData = await getCachedDoc('auctions', auctionId, {
  ttl: 60 * 1000, // 1 minute cache
  forceRefresh: false
});

// Process auction data
onUpdate(auctionData);

// Optional: Set up polling for active auctions only
if (isScreenActive) {
  const pollInterval = setInterval(async () => {
    const freshData = await getCachedDoc('auctions', auctionId, {
      forceRefresh: true
    });
    onUpdate(freshData);
  }, 30000); // Poll every 30s

  return () => clearInterval(pollInterval);
}
```

**Better** (use existing cached data):
```javascript
// BEST: Use data from useUltraSimpleAuctionData
// No additional reads needed - data is already cached
const { auctions } = useUltraSimpleAuctionData(groupId);
const auction = auctions.find(a => a.id === auctionId);

// Timer works with cached endTime
// Bid updates come from ConsolidatedBidService (FCM)
// No listener needed!
```

---

## 🚀 Quick Win Opportunity

**Immediate Action**: Remove auctionTimerUtils listener

**Why This is Safe**:
1. Auction data is already cached via `auctionOverviews`
2. Bid updates come from ConsolidatedBidService (Phase 1 - FCM)
3. Timer only needs static `endTime` (doesn't change)
4. No real-time sync needed for auction status

**Implementation Time**: 1-2 hours

**Expected Savings**: -10 to -15 reads/session

---

## 📝 Detailed File Analysis

### auctionTimerUtils.js

**Purpose**: Manages auction timers and event listeners

**Functions**:
- `setupAuctionEventListeners(auctionId, onUpdate, onError, options)` - Line 416
  - **Uses**: `setupCachedQueryListener` to listen for auction changes
  - **Callers**: 4 components/hooks
  - **Reads**: ~10-15 per active auction

**Refactor Strategy**:
```javascript
// BEFORE:
export const setupAuctionEventListeners = (auctionId, onUpdate, onError, options) => {
  const auctionRef = doc(db, 'auctions', auctionId);
  const unsubscribe = setupCachedQueryListener(
    auctionRef,
    (auctionData) => {
      onUpdate(auctionData);
    },
    options
  );
  return unsubscribe;
};

// AFTER:
export const setupAuctionEventListeners = (auctionId, onUpdate, onError, options) => {
  // Option 1: Use cached data (no listener)
  const loadAuctionData = async () => {
    try {
      const auction Data = await getCachedDoc('auctions', auctionId, {
        ttl: 60 * 1000, // 1 min cache
        forceRefresh: options?.forceRefresh || false
      });

      if (auctionData) {
        onUpdate(auctionData);
      } else if (onError) {
        onError(new Error('Auction not found'));
      }
    } catch (error) {
      console.error('Error loading auction:', error);
      if (onError) onError(error);
    }
  };

  // Load initial data
  loadAuctionData();

  // Optional: Polling for active screens (can be removed entirely)
  let pollInterval = null;
  if (options?.enablePolling) {
    pollInterval = setInterval(loadAuctionData, 30000); // 30s
  }

  // Return cleanup function
  return () => {
    if (pollInterval) clearInterval(pollInterval);
  };
};
```

**Impact**:
- **Before**: 10-15 reads per auction (listener)
- **After**: 1-2 reads per auction (cached fetch with TTL)
- **Savings**: -8 to -13 reads per auction

---

### Callers to Refactor

#### 1. useAuctionData.js
**Check**: Does it need real-time updates?
**Likely**: Can use cached data from `useUltraSimpleAuctionData`

#### 2. useBidding.js
**Check**: What does it listen for?
**Likely**: Bid updates (already handled by ConsolidatedBidService FCM)

#### 3. AuctionTimer.js
**Check**: Why does timer need a listener?
**Likely**: Can work with static `endTime` from cached auction

#### 4. AuctionBidModal.js
**Check**: What auction data does it need?
**Likely**: Current bid (already from ConsolidatedBidService)

---

## ✅ Success Criteria

### Quantitative:
- ✅ **0** active `onSnapshot` listeners (except TrackedFirestore wrapper)
- ✅ **<5 reads** from auction event system (down from 10-15)
- ✅ **No performance degradation** in auction screens

### Qualitative:
- ✅ Timers still work correctly
- ✅ Bid updates still real-time (via FCM)
- ✅ Auction status updates correctly
- ✅ No stale data issues

---

## 🧪 Testing Plan

### Before Implementation:
1. Open ReadDashboard
2. Navigate to AuctionScreen
3. Monitor reads in real-time
4. Note: Listener reads from auctionTimerUtils

### During Implementation:
1. Refactor auctionTimerUtils
2. Update caller components
3. Test each component individually

### After Implementation:
1. Verify timers still work
2. Verify bid updates still real-time
3. Check ReadDashboard: Should show 0 listener reads
4. Monitor for 1 hour: Confirm <5 reads total

---

## 🔄 Rollback Plan

If issues arise:

1. **Git Revert**:
   ```bash
   git checkout HEAD~1 -- src/utils/auctionTimerUtils.js
   ```

2. **Re-enable listeners temporarily**:
   - Uncomment `setupCachedQueryListener` calls
   - Deploy hotfix

3. **Investigate**:
   - Check which component broke
   - Verify data flow
   - Fix and re-deploy

---

## 📊 Read Reduction Projection

### Current State (After Phase 1):
```
Boot payload:              1 read
ConsolidatedBidService:    0 reads  ✅
auctionTimerUtils:         10-15 reads  🔴
collectionScreenOptimizer: 5-10 reads   ❓
Other:                     5-10 reads
─────────────────────────────────────
TOTAL:                     21-36 reads
```

### After Phase 2:
```
Boot payload:              1 read
ConsolidatedBidService:    0 reads  ✅
auctionTimerUtils:         1-2 reads  ✅
collectionScreenOptimizer: 0 reads  ✅
Other:                     2-5 reads
─────────────────────────────────────
TOTAL:                     4-8 reads  🎉
```

**Achievement**: <10 reads per session! 🎯

---

## 🚦 Next Steps

### Immediate (Next 2 hours):
1. ✅ Analysis complete (this document)
2. ⏳ Investigate collectionScreenOptimizer usage
3. ⏳ Refactor auctionTimerUtils to remove listener
4. ⏳ Test auction screens

### Short-term (Today):
1. Remove dead listener code
2. Clean up firestoreUtils.js
3. Update documentation
4. Measure final read count

### Validation:
1. Monitor ReadDashboard for 24 hours
2. Verify <10 reads/session
3. Check for any regressions
4. Celebrate Phase 2 completion! 🎉

---

**Ready to proceed with implementation!**
