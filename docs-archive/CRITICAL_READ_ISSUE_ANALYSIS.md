# Critical Read Issue - Root Cause Found

## The Real Problem

The deduplication IS working (`⏳ [Deduplication] Reusing in-flight request`) but **reads are still happening**. This reveals the core issue:

**Multiple screens are independently fetching user profile data when they mount, bypassing all caching systems.**

## Read Breakdown from Logs

### Initialization (Reads 1-12)
- Read #1: initialAppLoad ✅ (necessary)
- Read #2: users/.../sessions/main ✅ (UnifiedUserDataContext - necessary)
- Read #3-5: users/... ❌ (3 DUPLICATE user profile reads during init)
- Read #6: cardOverviews ✅ (necessary)
- Read #7: userStats ✅ (necessary)
- Read #8: cards query ✅ (necessary)
- Read #9-11: users/... ❌ (3 MORE duplicate user profile reads)
- Read #12: groups/... ⚠️ (premature background prefetch)

### Screen Navigation (Reads 13-22)
- Read #13: auctions query ✅ (AuctionScreen - necessary)
- **Read #14: users/... ❌ (AuctionScreen - DUPLICATE)**
- **Read #15: users/... ❌ (TradesScreen - DUPLICATE)**
- Read #16: cards query (TradesScreen - may be necessary)
- **Read #17: users/... ❌ (SocialScreen - DUPLICATE #1)**
- **Read #18: users/... ❌ (SocialScreen - DUPLICATE #2)**
- Read #19: users query (SocialScreen - batch fetch)
- **Read #20: users/... ❌ (ProfileScreen/achievements - DUPLICATE #1)**
- **Read #21: users/... ❌ (ProfileScreen/achievements - DUPLICATE #2)**
- **Read #22: groups/... ❌ (CoinScreen - DUPLICATE)**

## Root Causes

### 1. **Screens Fetching User Data Independently**

Each screen that needs user data is fetching it directly instead of:
- Using UnifiedUserDataContext (which already has it cached)
- Using GlobalUserProfileCache (which should deduplicate)
- Checking if data is already available

### 2. **Components Not Using Cached Context Data**

Screens are calling `getDoc(doc(db, 'users', userId))` directly instead of:
```javascript
const { userData } = useUnifiedUserData(); // Already cached!
```

### 3. **Balance/Coin Components Fetching Independently**

The `CoinCount` or balance display components are fetching user/group data on every screen mount instead of using the context.

### 4. **Achievement System Fetching User Data**

The ProfileScreen's achievement loading is fetching user data twice (Reads #20, #21).

## The Fix Strategy

### Phase 1: Stop Direct User Profile Fetches in Screens

**Problem:** Screens are doing this:
```javascript
const userDoc = await getDoc(doc(db, 'users', userId));
```

**Solution:** Use the context that already has it:
```javascript
const { userData } = useUnifiedUserData();
// userData is already loaded and cached!
```

### Phase 2: Fix Balance/Coin Display Components

**Problem:** `CoinCount` component is fetching balance on every mount

**Solution:** Use UnifiedUserDataContext:
```javascript
const { balance, getBalance } = useUnifiedUserData();
```

### Phase 3: Fix Achievement System

**Problem:** Achievement loading is fetching user data twice

**Solution:** Pass user data from context instead of fetching:
```javascript
// In ProfileScreen
const { userData } = useUnifiedUserData();
// Pass userData to achievement component
<AchievementComponent userData={userData} />
```

### Phase 4: Prevent Premature Background Operations

**Already Fixed:** Background prefetch now waits for initialization to complete

## Expected Results After Full Fix

### Current: 22 reads during session start
```
Initialization: 12 reads (7 duplicates)
Screen Navigation: 10 reads (8 duplicates)
Total: 22 reads (15 unnecessary)
```

### Target: 6-8 reads during session start
```
Initialization: 6 reads (no duplicates)
  - initialAppLoad
  - user session
  - cardOverviews
  - userStats
  - cards query
  - (optional: groups for prefetch)
  
Screen Navigation: 2 reads (only necessary queries)
  - auctions query (AuctionScreen)
  - trades query (TradesScreen)
  
Total: 6-8 reads (73% reduction)
```

## Implementation Priority

### CRITICAL (Do Immediately)
1. ✅ Create GlobalRequestDeduplicator
2. ✅ Update GlobalUserProfileCache to use it
3. ✅ Update GlobalGroupCache to use it
4. ✅ Defer background operations in useUltraOptimizedCollectionData
5. ⚠️ **FIX CoinCount/Balance components to use UnifiedUserDataContext**
6. ⚠️ **FIX Achievement loading to use passed userData**
7. ⚠️ **FIX SocialScreen to use cached user data**

### HIGH (Do Next)
8. Add logging to track where user profile fetches originate
9. Create a UserDataProvider wrapper that prevents direct fetches
10. Add development-mode warnings when direct fetches are detected

## Key Insight

The deduplication system works perfectly - the problem is that **screens are fetching user data AFTER the deduplication window closes** (100ms). Each screen mounts at different times, so they each trigger a new fetch.

**Solution:** Don't fetch at all - use the already-cached data from UnifiedUserDataContext!
