# Transaction Read Optimization - Critical Issue

## The Real Problem

Firebase transactions cause **2-3 internal reads per transaction** that count against your quota:

### Current Transaction Usage (from logs):
1. **Card Creation Transaction** (Reads #14-15): 3 reads
2. **Coin Deduction Transaction** (Reads #16-17): 3 reads  
3. **Bid Placement Transaction** (Reads #21-22): 3 reads

**Total from 3 transactions: 9 reads**

### Additional Issues:
4. **Auction List Refreshes** (Reads #6, #20, #23, #26): 4 reads
5. **Manual Refresh** (Reads #24-25): 2 reads
6. **Background User Query** (Read #18): 1 read

## Solution Strategy

### 1. Reduce Transaction Usage

**Current:** 3 transactions per coin operation = 9 reads
**Target:** 1 transaction per coin operation = 3 reads

**Implementation:**
- Combine card creation + coin deduction into single transaction
- Use batch writes where transactions aren't needed
- Cache auction data to avoid repeated queries

### 2. Implement Auction Query Caching

**Problem:** Auction list is queried 4 times in one session
**Solution:** Cache auction queries for 2 minutes, only refresh on user action

### 3. Optimize Manual Refresh

**Problem:** Manual refresh invalidates ALL caches
**Solution:** Selective cache invalidation - only invalidate what changed

### 4. Eliminate Background User Queries

**Problem:** Notification service queries users collection
**Solution:** Pass user data from context instead of querying

## Implementation Plan

### Phase 1: Transaction Consolidation
```javascript
// BEFORE: 2 transactions (6 reads)
await createCardTransaction();
await deductCoinsTransaction();

// AFTER: 1 transaction (3 reads)
await createCardAndDeductCoinsTransaction();
```

### Phase 2: Auction Query Caching
```javascript
// Add module-level cache with 2-minute TTL
const AUCTION_CACHE = new Map();
const AUCTION_CACHE_TTL = 2 * 60 * 1000;

// Only query if cache miss or force refresh
if (!forceRefresh && AUCTION_CACHE.has(key)) {
  return AUCTION_CACHE.get(key);
}
```

### Phase 3: Smart Refresh
```javascript
// BEFORE: Invalidate everything
RefreshCoordinator.invalidateAll();

// AFTER: Selective invalidation
RefreshCoordinator.invalidate(['auctions', 'cards']);
```

### Phase 4: Remove Background Queries
```javascript
// BEFORE: Query users in notification service
const userDoc = await getDocs(query(collection(db, 'users')));

// AFTER: Pass user data from context
sendNotification(userData);
```

## Expected Results

### Current: 26+ tracked reads (109 lifetime)
- Transactions: 9 reads
- Auction queries: 4 reads
- Manual refresh: 2 reads
- Background queries: 1 read
- Other: 10 reads

### After Optimization: 12-15 tracked reads
- Transactions: 3 reads (66% reduction)
- Auction queries: 1 read (75% reduction)
- Manual refresh: 1 read (50% reduction)
- Background queries: 0 reads (100% reduction)
- Other: 7-10 reads

**Total reduction: 42-50%**

## Priority Fixes

1. **CRITICAL:** Consolidate card creation + coin deduction transactions
2. **HIGH:** Implement auction query caching
3. **HIGH:** Fix notification service to not query users
4. **MEDIUM:** Optimize manual refresh to be selective
5. **LOW:** Add transaction read warnings in development

## Files to Modify

1. `src/screens/CoinScreen.js` - Consolidate transactions
2. `src/hooks/useUltraSimpleAuctionData.js` - Add query caching
3. `src/services/notifications.js` - Remove user queries
4. `src/services/RefreshCoordinator.js` - Selective invalidation
5. `src/services/ReadTracking/TrackedFirestore.js` - Better transaction tracking
