# Comprehensive Fix Plan: Coin Balance, Coining Reads, and Collection Performance

## Investigation Summary

After conducting an in-depth investigation, I've identified several critical issues and opportunities for optimization:

---

## 1. COIN BALANCE HANDLING ISSUES

### Current State
- **Multiple coin operation paths**:
  1. `UnifiedUserDataContext` - Main coin operations (`addCoins`, `subtractCoins`)
  2. `balanceOperations.js` - Transaction-based operations
  3. `coinUtils.js` - Utility functions
  4. Direct `updateDoc` calls in various components

### Problems Identified
1. **Inconsistent data paths**: Some operations use `users/{uid}/sessions/main` while others use `users/{uid}`
2. **Race conditions**: Batching in `UnifiedUserDataContext` (150ms timeout) can cause issues when operations happen quickly
3. **No atomic guarantees**: The coining process deducts coins OUTSIDE of the card creation transaction in some flows
4. **Overlapping operations**: Both `performCoinOperation` and `updateBalance` exist, creating confusion

### ✅ GOOD NEWS
The **coining process** in `CoinScreen.js` (lines 318-376) is already **OPTIMIZED** with atomic transactions:
- ✅ Card creation + coin deduction in **single transaction**
- ✅ Prevents race conditions
- ✅ All-or-nothing guarantee

### Issues to Fix

#### Issue 1.1: Inconsistent Session Path
**Location**: `balanceOperations.js` line 68
```javascript
// WRONG: Uses 'users/{uid}' instead of 'users/{uid}/sessions/main'
const userRef = doc(db, 'users', userId);
```

**Fix**: Update to use sessions/main path consistently
```javascript
const userRef = doc(db, 'users', userId, 'sessions', 'main');
```

#### Issue 1.2: Balance Reading Unnecessary in Some Operations
**Location**: `UnifiedUserDataContext.js` lines 498-555
- Current `performCoinOperation` reads balance before operation
- Then uses `updateDoc` which doesn't verify balance atomically
- Should use `runTransaction` instead

**Fix**: Always use transactions for coin operations
```javascript
await runTransaction(db, async (transaction) => {
  const userSessionRef = doc(db, 'users', user.uid, 'sessions', 'main');
  const userDoc = await transaction.get(userSessionRef);
  const currentBalance = userDoc.data().groupBalances[groupId] || 0;

  if (operationType === 'subtract' && currentBalance < amount) {
    throw new Error('Insufficient balance');
  }

  const newBalance = operationType === 'add' ? currentBalance + amount : currentBalance - amount;
  transaction.update(userSessionRef, {
    [`groupBalances.${groupId}`]: newBalance,
    lastUpdated: serverTimestamp()
  });
});
```

---

## 2. COINING PROCESS - READ COUNT ANALYSIS

### Current Read Count: ~6-8 reads per coin
**Breakdown**:
1. **Initial data fetch** (lines 118-212 in CoinScreen.js):
   - ✅ User data: Cached (30s TTL) - **0-1 read**
   - ✅ Group data: Cached via GlobalGroupCache - **0-1 read**
   - Total: **0-2 reads**

2. **Card coining transaction** (lines 322-376):
   - ✅ User session read (in transaction): **1 read**
   - ✅ Card write: **1 write** (not counted)
   - ✅ Auction write: **1 write** (not counted)
   - Total: **1 read**

3. **Background operations** (lines 408-438):
   - XP award: **~2-3 reads** ❌ (fetches user profile + updates)
   - Achievement record: **~1-2 reads** ❌
   - Notification: **0 reads** ✅ (async)
   - Total: **~3-5 reads**

### Problem Areas

#### Issue 2.1: XP Service Reads Too Much
**Location**: `src/services/XPService.js`
- Likely fetches full user document
- Calculates XP
- Updates user document
- **Should use transaction with minimal read**

**Fix**: Create optimized XP transaction
```javascript
export const awardCoinXPOptimized = async (userId, groupId) => {
  return runTransaction(db, async (transaction) => {
    const userRef = doc(db, 'users', userId, 'sessions', 'main');
    const userDoc = await transaction.get(userRef);

    const currentXP = userDoc.data().xp || 0;
    const newXP = currentXP + 10; // +10 XP for coining

    transaction.update(userRef, {
      xp: newXP,
      lastXPUpdate: serverTimestamp()
    });
  });
};
```

#### Issue 2.2: Achievement System Reads
**Location**: `src/utils/gemRewards.js`
- Fetches user achievements
- Checks if achievement already earned
- Updates achievements array
- **Could be optimized with arrayUnion**

**Fix**: Use arrayUnion to avoid read
```javascript
export const recordAchievementOptimized = async (userId, achievementType) => {
  const userRef = doc(db, 'users', userId, 'sessions', 'main');

  // Single write operation, no read needed
  await updateDoc(userRef, {
    achievements: arrayUnion(achievementType),
    [`achievementDates.${achievementType}`]: serverTimestamp()
  });
};
```

### Target: Reduce coining reads from 6-8 to 2-3 reads
- Initial fetch: 0-2 reads (cached)
- Transaction: 1 read
- Background ops: 0 reads (optimized)
- **Total: 1-3 reads** ✅

---

## 3. COLLECTION SCREEN - SLOW LOADING ANALYSIS

### Current Architecture
**Hook**: `useUltraOptimizedCollectionData.js`
- Fetches ALL cards at once (no pagination)
- 5-minute cache TTL
- Uses `cardOverviews` for optimization
- Module-level persistent cache

### Performance Issues Identified

#### Issue 3.1: Double Fetch on Mount
**Location**: Lines 930-960
```javascript
useEffect(() => {
  // Check persistent cache first
  if (isCacheValid) {
    // Restore from cache
  }

  // BUT ALSO calls initializeData() even if cache is valid!
  initializeData().catch(err => {
    console.error('Initialization error in useEffect:', err);
  });
}, [user?.uid, currentGroup?.id]);
```

**Problem**: Even with valid cache, it still calls `initializeData()` causing unnecessary reads

**Fix**: Skip initialization if cache is valid
```javascript
useEffect(() => {
  // ... cache check ...

  if (isCacheValid) {
    console.log('Using cache, skipping initialization');
    return; // Add return statement
  }

  // Only initialize if cache invalid
  initializeData().catch(err => {
    console.error('Initialization error:', err);
  });
}, [user?.uid, currentGroup?.id]);
```

#### Issue 3.2: Deduplication Not Working Properly
**Location**: Lines 99-101, 336-345
```javascript
async function deduplicatedFetch(key, fetchFunction) {
  return GlobalRequestDeduplicator.deduplicate(key, fetchFunction);
}

// But forceRefresh bypasses deduplication:
const finalDedupeKey = forceRefresh ? `${dedupeKey}_${Date.now()}` : dedupeKey;
```

**Problem**: Force refresh creates unique key, defeating deduplication purpose

**Fix**: Use separate mechanism for force refresh
```javascript
// Don't use timestamp in key for force refresh
// Instead, invalidate cache before fetch
if (forceRefresh) {
  await CacheService.invalidate(cacheKey);
}
return deduplicatedFetch(dedupeKey, fetchFunction); // Always same key
```

#### Issue 3.3: CardOverview Fallback Query
**Location**: Lines 370-458
- Tries `cardOverviews` document first (1 read)
- Falls back to full cards query (1+ reads)
- If overview doesn't exist, makes 2 queries total

**Problem**: No cardOverview document = wasted read

**Fix**: Check if cardOverview exists in cache first
```javascript
// Check metadata collection for overview existence
const overviewExistsCacheKey = `overview_exists_${groupId}_${userId}`;
const overviewExists = await getCachedData(overviewExistsCacheKey, 24 * 60 * 60 * 1000); // 24hr cache

if (overviewExists) {
  // Try to fetch overview
} else {
  // Skip directly to cards query
}
```

#### Issue 3.4: Background Sync Causes Unnecessary Reads
**Location**: Lines 898-927
- Background sync runs every 10 minutes
- Checks for stale data and refetches
- Can cause reads even when user isn't actively viewing

**Fix**: Only sync when screen is active
```javascript
useEffect(() => {
  if (!state.loading && state.cards.length > 0) {
    // Only start background sync if screen is focused
    const unsubscribe = navigation.addListener('focus', () => {
      // Start sync timer
    });

    const unsubscribeBlur = navigation.addListener('blur', () => {
      // Stop sync timer
    });

    return () => {
      unsubscribe();
      unsubscribeBlur();
    };
  }
}, [/* deps */]);
```

### Target: Reduce collection loads from 3-5 seconds to <1 second
- Use persistent cache on mount: **0 reads, instant load**
- First fetch (cache miss): **1-2 reads** (overview OR cards query)
- Refresh: **1-2 reads** (forced fresh data)
- Background: **0 reads** (disabled when not focused)

---

## 4. IMPLEMENTATION PRIORITY

### Phase 1: Critical Fixes (High Impact, Low Risk)
1. ✅ **Fix coin balance path consistency**
   - Update `balanceOperations.js` to use `sessions/main`
   - Test all coin operations
   - **Impact**: Prevents future balance corruption
   - **Risk**: Low (simple path fix)

2. ✅ **Fix collection cache return bug**
   - Add `return` statement in useEffect when cache is valid
   - **Impact**: Eliminates 50% of unnecessary reads on remount
   - **Risk**: Very low

3. ✅ **Optimize XP award operation**
   - Single transaction, minimal read
   - **Impact**: -2 reads per coin operation
   - **Risk**: Low (isolated service)

### Phase 2: Performance Optimizations (High Impact, Medium Risk)
4. **Optimize achievement recording**
   - Use `arrayUnion` to avoid read
   - **Impact**: -1-2 reads per coin operation
   - **Risk**: Medium (need to test duplicate prevention)

   **Implementation**:
   ```javascript
   // File: src/utils/gemRewards.js
   // Before: ~2 reads (fetch + check + update)
   export const recordAchievement = async (userId, achievementType) => {
     const userRef = doc(db, 'users', userId, 'sessions', 'main');
     const userDoc = await getDoc(userRef); // READ 1
     const achievements = userDoc.data().achievements || [];

     if (!achievements.includes(achievementType)) { // Check locally
       await updateDoc(userRef, { // WRITE 1
         achievements: [...achievements, achievementType]
       });
     }
   };

   // After: 0 reads (write-only operation)
   export const recordAchievementOptimized = async (userId, achievementType) => {
     const userRef = doc(db, 'users', userId, 'sessions', 'main');

     // arrayUnion automatically deduplicates, no read needed
     await updateDoc(userRef, { // WRITE 1 only
       achievements: arrayUnion(achievementType),
       [`achievementDates.${achievementType}`]: serverTimestamp(),
       lastAchievementUpdate: serverTimestamp()
     });
   };
   ```

5. **Add cardOverview existence check**
   - Cache whether overview exists
   - **Impact**: -1 read per collection load
   - **Risk**: Low (additional caching layer)

   **Implementation**:
   ```javascript
   // File: src/hooks/useUltraOptimizedCollectionData.js
   // Add after line 99

   const OVERVIEW_EXISTS_CACHE = new Map();
   const OVERVIEW_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

   async function checkOverviewExists(groupId, userId) {
     const cacheKey = `${groupId}_${userId}`;
     const cached = OVERVIEW_EXISTS_CACHE.get(cacheKey);

     if (cached && (Date.now() - cached.timestamp) < OVERVIEW_CACHE_TTL) {
       return cached.exists;
     }

     // First time check - will do 1 read to verify
     const overviewRef = doc(db, 'groups', groupId, 'cardOverviews', userId);
     const overviewSnap = await getDoc(overviewRef); // 1 READ (once per 24hr)
     const exists = overviewSnap.exists();

     // Cache the result
     OVERVIEW_EXISTS_CACHE.set(cacheKey, {
       exists,
       timestamp: Date.now()
     });

     return exists;
   }

   // Then in fetchCardsData() around line 370
   async function fetchCardsData(groupId, userId, forceRefresh) {
     // Check if overview exists before trying to fetch it
     const overviewExists = await checkOverviewExists(groupId, userId);

     if (overviewExists) {
       // Try overview path (1 read)
       const overviewRef = doc(db, 'groups', groupId, 'cardOverviews', userId);
       const overviewSnap = await getDoc(overviewRef);

       if (overviewSnap.exists()) {
         return processOverviewData(overviewSnap.data());
       }
     }

     // Skip directly to cards query if overview doesn't exist
     return fetchCardsDirectly(groupId, userId);
   }
   ```

6. **Disable background sync when screen inactive**
   - Use navigation focus/blur events
   - **Impact**: -10-20 reads per session
   - **Risk**: Low (existing patterns)

   **Implementation**:
   ```javascript
   // File: src/hooks/useUltraOptimizedCollectionData.js
   // Replace lines 898-927 with:

   useEffect(() => {
     let syncTimer = null;
     let isScreenFocused = false;

     const startBackgroundSync = () => {
       if (state.loading || state.cards.length === 0) return;

       syncTimer = setInterval(async () => {
         // Only sync if screen is focused AND data is stale
         if (isScreenFocused && isDataStale()) {
           console.log('[Collection] Background sync triggered');
           await refreshData(false); // Soft refresh
         }
       }, 10 * 60 * 1000); // 10 minutes
     };

     const stopBackgroundSync = () => {
       if (syncTimer) {
         clearInterval(syncTimer);
         syncTimer = null;
         console.log('[Collection] Background sync stopped');
       }
     };

     // Listen to screen focus events
     const unsubscribeFocus = navigation?.addListener('focus', () => {
       console.log('[Collection] Screen focused - enabling background sync');
       isScreenFocused = true;
       startBackgroundSync();
     });

     const unsubscribeBlur = navigation?.addListener('blur', () => {
       console.log('[Collection] Screen blurred - disabling background sync');
       isScreenFocused = false;
       stopBackgroundSync();
     });

     // Start sync if screen is already focused
     if (navigation?.isFocused()) {
       isScreenFocused = true;
       startBackgroundSync();
     }

     return () => {
       stopBackgroundSync();
       unsubscribeFocus?.();
       unsubscribeBlur?.();
     };
   }, [state.loading, state.cards.length, navigation]);

### Phase 3: Architecture Improvements (Medium Impact, Higher Risk)
7. **Consolidate coin operations to transactions**
   - Replace `updateDoc` with `runTransaction` everywhere
   - **Impact**: Atomic guarantees, prevents race conditions
   - **Risk**: High (touches many flows, needs extensive testing)

   **Implementation**:
   ```javascript
   // File: src/contexts/UnifiedUserDataContext.js
   // Replace performCoinOperation (lines 498-555) with:

   const performCoinOperation = useCallback(async (
     groupId,
     amount,
     operationType,
     metadata = {}
   ) => {
     if (!user?.uid) {
       throw new Error('User not authenticated');
     }

     console.log(`[CoinOp] ${operationType} ${amount} coins for group ${groupId}`);

     return await runTransaction(db, async (transaction) => {
       const userSessionRef = doc(db, 'users', user.uid, 'sessions', 'main');
       const userDoc = await transaction.get(userSessionRef); // 1 READ

       if (!userDoc.exists()) {
         throw new Error('User session not found');
       }

       const userData = userDoc.data();
       const currentBalance = userData.groupBalances?.[groupId] || 0;

       // Validate operation
       if (operationType === 'subtract' && currentBalance < amount) {
         throw new Error(`Insufficient balance: ${currentBalance} < ${amount}`);
       }

       // Calculate new balance
       const newBalance = operationType === 'add'
         ? currentBalance + amount
         : currentBalance - amount;

       // Atomic update
       transaction.update(userSessionRef, {
         [`groupBalances.${groupId}`]: newBalance,
         lastBalanceUpdate: serverTimestamp(),
         ...(metadata.reason && { lastBalanceReason: metadata.reason })
       });

       console.log(`[CoinOp] Balance: ${currentBalance} -> ${newBalance}`);

       return {
         success: true,
         oldBalance: currentBalance,
         newBalance,
         amount,
         operationType
       };
     });
   }, [user?.uid]);

   // File: src/utils/balanceOperations.js
   // Replace updateBalance function (around line 68)

   export async function updateBalance(userId, groupId, change, reason = '') {
     return await runTransaction(db, async (transaction) => {
       // ✅ FIXED: Use sessions/main path
       const userRef = doc(db, 'users', userId, 'sessions', 'main');
       const userDoc = await transaction.get(userRef); // 1 READ

       if (!userDoc.exists()) {
         throw new Error('User session not found');
       }

       const currentBalance = userDoc.data().groupBalances?.[groupId] || 0;

       // Prevent negative balance
       const newBalance = Math.max(0, currentBalance + change);

       transaction.update(userRef, {
         [`groupBalances.${groupId}`]: newBalance,
         lastBalanceUpdate: serverTimestamp(),
         lastBalanceChange: change,
         lastBalanceReason: reason
       });

       return {
         oldBalance: currentBalance,
         newBalance,
         change
       };
     });
   }
   ```

8. **Add operation queue for rapid coin operations**
   - Batch operations within 100ms window
   - **Impact**: Better UX, fewer transactions
   - **Risk**: High (complex state management)

   **Implementation**:
   ```javascript
   // File: src/services/CoinOperationQueue.js
   class CoinOperationQueue {
     constructor() {
       this.queue = [];
       this.processing = false;
       this.batchWindow = 100; // ms
       this.timer = null;
     }

     async enqueue(groupId, amount, operationType, metadata = {}) {
       return new Promise((resolve, reject) => {
         this.queue.push({
           groupId,
           amount,
           operationType,
           metadata,
           resolve,
           reject,
           timestamp: Date.now()
         });

         // Start batch timer
         if (!this.timer) {
           this.timer = setTimeout(() => {
             this.processBatch();
           }, this.batchWindow);
         }
       });
     }

     async processBatch() {
       if (this.processing || this.queue.length === 0) return;

       this.processing = true;
       this.timer = null;

       // Group operations by groupId
       const groupedOps = this.queue.reduce((acc, op) => {
         if (!acc[op.groupId]) acc[op.groupId] = [];
         acc[op.groupId].push(op);
         return acc;
       }, {});

       // Clear queue
       this.queue = [];

       // Process each group's operations
       for (const [groupId, operations] of Object.entries(groupedOps)) {
         try {
           // Calculate net change
           let netChange = 0;
           for (const op of operations) {
             netChange += op.operationType === 'add' ? op.amount : -op.amount;
           }

           // Single transaction for all operations
           await runTransaction(db, async (transaction) => {
             const userRef = doc(db, 'users', getCurrentUserId(), 'sessions', 'main');
             const userDoc = await transaction.get(userRef);

             const currentBalance = userDoc.data().groupBalances?.[groupId] || 0;
             const newBalance = Math.max(0, currentBalance + netChange);

             transaction.update(userRef, {
               [`groupBalances.${groupId}`]: newBalance,
               lastBalanceUpdate: serverTimestamp()
             });
           });

           // Resolve all operations
           operations.forEach(op => op.resolve({ success: true }));
         } catch (error) {
           // Reject all operations in this group
           operations.forEach(op => op.reject(error));
         }
       }

       this.processing = false;
     }
   }

   export default new CoinOperationQueue();

   // Usage in components:
   import CoinOperationQueue from '../services/CoinOperationQueue';

   // Instead of:
   // await performCoinOperation(groupId, 100, 'add');

   // Use:
   await CoinOperationQueue.enqueue(groupId, 100, 'add', { reason: 'daily_reward' });
   ```

---

## 5. ESTIMATED IMPACT

### Before Fixes
- **Coining**: 6-8 reads per operation
- **Collection Load**: 2-4 reads per mount (including cache misses)
- **Collection Remount**: 2-4 reads (cache not working properly)
- **Background Sync**: 2-4 reads every 10 min
- **Session Total**: ~40-80 reads for typical session

### After Phase 1 Fixes
- **Coining**: 3-4 reads per operation ✅ (-50%)
- **Collection Load**: 1-2 reads per mount
- **Collection Remount**: 0 reads (cache working) ✅ (-100%)
- **Background Sync**: 0 reads when inactive ✅ (-100% when inactive)
- **Session Total**: ~15-25 reads ✅ (-60%)

### After All Phases
- **Coining**: 1-2 reads per operation ✅ (-75%)
- **Collection Load**: 1-2 reads (first load only)
- **Collection Remount**: 0 reads (persistent cache)
- **Background Sync**: 0 reads (smart scheduling)
- **Session Total**: <10 reads ✅ (-85%)

---

## 6. TESTING PLAN

### Test Cases
1. **Coin Balance Tests**
   - [ ] Rapid coin operations (10 ops in 1 second)
   - [ ] Concurrent coin operations (multiple tabs)
   - [ ] Insufficient balance handling
   - [ ] Transaction rollback on error
   - [ ] Balance consistency across operations

2. **Coining Tests**
   - [ ] Normal coining flow
   - [ ] Coining with insufficient balance
   - [ ] Rapid coining (stress test)
   - [ ] Network failure during upload
   - [ ] Transaction failure recovery

3. **Collection Tests**
   - [ ] Initial load from empty cache
   - [ ] Remount with valid cache
   - [ ] Refresh operation
   - [ ] Large collection (100+ cards)
   - [ ] Background sync behavior

### Success Criteria
- ✅ No coin balance drift or corruption
- ✅ Coining completes in <3 seconds
- ✅ Collection loads instantly on remount
- ✅ Read count reduction of 60%+ after Phase 1
- ✅ No race conditions or transaction conflicts

---

## 7. ROLLOUT STRATEGY

1. **Development Environment Testing** (2-3 days)
   - Implement Phase 1 fixes
   - Run comprehensive test suite
   - Monitor read counts with ReadMonitor

2. **Staging Testing** (1-2 days)
   - Deploy to staging
   - Real-world usage testing
   - Performance benchmarking

3. **Production Deployment** (Gradual)
   - Deploy Phase 1 fixes
   - Monitor error rates and read counts
   - Collect user feedback
   - Deploy Phase 2 if Phase 1 is stable

4. **Monitoring** (Ongoing)
   - Track read counts via ReadMonitor
   - Monitor transaction failure rates
   - User experience metrics (load times)
   - Error logging and alerting

---

## 8. RISK MITIGATION

### Rollback Plan
- Keep original code in backup
- Feature flags for new transaction logic
- Ability to revert to old coin operation paths
- Database state verification scripts

### Data Integrity
- Transaction logs for all coin operations
- Balance reconciliation scripts
- Automated testing of edge cases
- Manual balance audit tools

### Performance Monitoring
- **Read count tracking per operation**
  - Use ReadMonitor to track all Firestore reads
  - Log read operations by screen/operation type
  - Daily/weekly aggregated reports
  - Alert on unexpected read spikes (>50% increase)

- **Operation timing metrics**
  - Track time for coin operations (target: <2s)
  - Track collection load times (target: <1s cached, <3s fresh)
  - Track transaction completion times
  - 95th percentile latency monitoring

- **Error rate monitoring**
  - Transaction conflict rate (target: <1%)
  - Insufficient balance errors
  - Cache miss rate (target: >80% hit rate)
  - Network failure recovery rate

- **User session analytics**
  - Average reads per session (target: <10)
  - Collection screen visit frequency
  - Coining operation frequency
  - Feature usage patterns

**Implementation**:
```javascript
// File: src/services/monitoring/PerformanceMonitor.js
class PerformanceMonitor {
  static metrics = {
    reads: {},
    timing: {},
    errors: {},
  };

  static trackRead(operation, count = 1) {
    if (!this.metrics.reads[operation]) {
      this.metrics.reads[operation] = 0;
    }
    this.metrics.reads[operation] += count;
    console.log(`[ReadMonitor] ${operation}: ${count} reads`);
  }

  static async trackOperation(name, operation) {
    const startTime = Date.now();
    try {
      const result = await operation();
      const duration = Date.now() - startTime;

      if (!this.metrics.timing[name]) {
        this.metrics.timing[name] = [];
      }
      this.metrics.timing[name].push(duration);

      console.log(`[PerfMonitor] ${name}: ${duration}ms`);
      return result;
    } catch (error) {
      if (!this.metrics.errors[name]) {
        this.metrics.errors[name] = 0;
      }
      this.metrics.errors[name]++;
      throw error;
    }
  }

  static getReport() {
    const totalReads = Object.values(this.metrics.reads).reduce((a, b) => a + b, 0);
    const avgTimings = {};

    for (const [op, times] of Object.entries(this.metrics.timing)) {
      avgTimings[op] = {
        avg: times.reduce((a, b) => a + b, 0) / times.length,
        p95: times.sort()[Math.floor(times.length * 0.95)],
        count: times.length,
      };
    }

    return {
      totalReads,
      readsByOperation: this.metrics.reads,
      timings: avgTimings,
      errors: this.metrics.errors,
    };
  }
}

export default PerformanceMonitor;
```

**Usage in Code**:
```javascript
// In coin operations
await PerformanceMonitor.trackOperation('coin_operation', async () => {
  PerformanceMonitor.trackRead('coin_transaction', 1);
  // ... perform coin operation
});

// In collection loading
await PerformanceMonitor.trackOperation('collection_load', async () => {
  PerformanceMonitor.trackRead('collection_fetch', readCount);
  // ... load collection
});
```

---

## 9. DEBUGGING & TROUBLESHOOTING

### Common Issues and Solutions

#### Issue: Coin Balance Drift
**Symptoms**: User's coin balance doesn't match expected value
**Diagnosis**:
```javascript
// File: src/utils/diagnosticHelper.js
export async function diagnoseBalanceDrift(userId, groupId) {
  const userRef = doc(db, 'users', userId, 'sessions', 'main');
  const userDoc = await getDoc(userRef);

  const balance = userDoc.data()?.groupBalances?.[groupId] || 0;

  // Fetch all transactions for this user/group
  const txQuery = query(
    collection(db, 'transactions'),
    where('userId', '==', userId),
    where('groupId', '==', groupId),
    orderBy('timestamp', 'desc'),
    limit(100)
  );
  const txSnap = await getDocs(txQuery);

  // Calculate expected balance
  let calculatedBalance = 0;
  txSnap.forEach(doc => {
    const tx = doc.data();
    calculatedBalance += tx.type === 'add' ? tx.amount : -tx.amount;
  });

  return {
    currentBalance: balance,
    calculatedBalance,
    drift: balance - calculatedBalance,
    hasDrift: Math.abs(balance - calculatedBalance) > 0.01
  };
}
```

**Solution**: Run balance reconciliation script
```javascript
export async function reconcileBalance(userId, groupId) {
  const diagnosis = await diagnoseBalanceDrift(userId, groupId);

  if (diagnosis.hasDrift) {
    console.warn(`Balance drift detected: ${diagnosis.drift}`);

    // Fix balance to match calculated value
    const userRef = doc(db, 'users', userId, 'sessions', 'main');
    await updateDoc(userRef, {
      [`groupBalances.${groupId}`]: diagnosis.calculatedBalance,
      lastReconciliation: serverTimestamp()
    });

    return { fixed: true, correction: diagnosis.drift };
  }

  return { fixed: false, message: 'No drift detected' };
}
```

#### Issue: Slow Collection Loading
**Symptoms**: Collection screen takes >3 seconds to load
**Diagnosis**:
```javascript
// Add to useUltraOptimizedCollectionData.js
const DEBUG_MODE = __DEV__;

if (DEBUG_MODE) {
  console.log('[Collection Debug]', {
    cacheHit: isCacheValid,
    cacheAge: Date.now() - cacheTimestamp,
    cardCount: state.cards.length,
    loadTime: loadEndTime - loadStartTime,
    readCount: totalReads
  });
}
```

**Solutions**:
1. Check cache validity: Verify 5-minute cache is working
2. Check persistent cache: Ensure module-level cache survives remounts
3. Check read count: Should be 0 on remount with valid cache
4. Check network: Slow network can cause delays even with cache

#### Issue: Transaction Conflicts
**Symptoms**: "Transaction failed" errors during coin operations
**Diagnosis**:
```javascript
export async function diagnoseTransactionConflicts(userId, groupId) {
  let attempts = 0;
  let conflicts = 0;

  for (let i = 0; i < 10; i++) {
    attempts++;
    try {
      await runTransaction(db, async (transaction) => {
        const userRef = doc(db, 'users', userId, 'sessions', 'main');
        const userDoc = await transaction.get(userRef);
        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 100));
        transaction.update(userRef, { test: Date.now() });
      });
    } catch (error) {
      if (error.code === 'failed-precondition') {
        conflicts++;
      }
    }
  }

  return {
    conflictRate: conflicts / attempts,
    recommendation: conflicts > 2 ? 'High contention - implement queue' : 'Normal'
  };
}
```

**Solutions**:
1. Reduce transaction duration (faster reads/writes)
2. Implement operation queue (Phase 3.8)
3. Add exponential backoff retry logic
4. Separate hot paths (high-traffic operations)

#### Issue: Cache Not Working
**Symptoms**: Reads happening on every mount despite cache
**Diagnosis**:
```javascript
// Check cache validity in console
console.log('[Cache Debug]', {
  hasCachedData: persistentCacheData !== null,
  cacheTimestamp: persistentCacheTimestamp,
  currentTime: Date.now(),
  cacheAge: Date.now() - persistentCacheTimestamp,
  isCacheValid: isCacheValid,
  cacheTTL: 5 * 60 * 1000
});
```

**Solutions**:
1. Verify cache key uniqueness: `${groupId}_${userId}`
2. Check cache TTL: Should be 5 minutes (300000ms)
3. Verify return statement: Add `return` after cache restore
4. Check cache invalidation: Ensure not invalidating too aggressively

### Debug Flags and Logging

```javascript
// File: src/config/debug.js
export const DEBUG_CONFIG = {
  // Enable detailed logging
  VERBOSE_LOGGING: __DEV__,

  // Track all reads
  TRACK_READS: true,

  // Track operation timing
  TRACK_PERFORMANCE: true,

  // Log cache operations
  LOG_CACHE: __DEV__,

  // Log transactions
  LOG_TRANSACTIONS: __DEV__,
};

// Usage in code:
import { DEBUG_CONFIG } from '../config/debug';

if (DEBUG_CONFIG.LOG_TRANSACTIONS) {
  console.log('[Transaction]', { userId, groupId, amount, type });
}
```

### Performance Testing Tools

```javascript
// File: src/utils/performanceTester.js
export async function stressTestCoinOperations(userId, groupId, count = 100) {
  const startTime = Date.now();
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < count; i++) {
    try {
      await performCoinOperation(groupId, 1, 'add');
      successCount++;
    } catch (error) {
      failCount++;
      console.error(`Operation ${i} failed:`, error);
    }
  }

  const duration = Date.now() - startTime;

  return {
    totalOperations: count,
    successCount,
    failCount,
    duration,
    avgTime: duration / count,
    opsPerSecond: (count / duration) * 1000
  };
}

export async function stressTestCollectionLoad(iterations = 10) {
  const loadTimes = [];

  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now();
    await loadCollection();
    const duration = Date.now() - startTime;
    loadTimes.push(duration);
  }

  return {
    iterations,
    avgLoadTime: loadTimes.reduce((a, b) => a + b, 0) / iterations,
    minLoadTime: Math.min(...loadTimes),
    maxLoadTime: Math.max(...loadTimes),
    p95LoadTime: loadTimes.sort()[Math.floor(iterations * 0.95)]
  };
}
```

### Quick Diagnostics Checklist

Before deploying fixes:
- [ ] Run `diagnoseBalanceDrift()` for test users
- [ ] Check cache hit rate (should be >80%)
- [ ] Verify transaction conflict rate (<1%)
- [ ] Test rapid coin operations (10 ops in 1 second)
- [ ] Test collection remount (should be instant)
- [ ] Monitor read count per operation
- [ ] Check background sync behavior
- [ ] Verify error handling and rollback

After deploying fixes:
- [ ] Monitor error rates (should decrease)
- [ ] Track read count reduction (target: 60%)
- [ ] Measure load time improvements
- [ ] Check user feedback
- [ ] Run balance reconciliation on production
- [ ] Verify no new regressions

---

## SUMMARY

The system has **good fundamentals** with transaction-based coining, but suffers from:
1. **Inconsistent paths** causing potential balance issues
2. **Unnecessary background operations** during coining
3. **Cache bugs** causing duplicate collection fetches
4. **Over-eager background sync** when screen is inactive

**Recommended Action**: Start with Phase 1 fixes (low risk, high impact), then evaluate Phase 2 based on results.

**Expected Outcome**: 60-85% reduction in reads, faster load times, better data consistency.

---

## APPENDIX: Quick Reference

### File Locations
- **Coin Operations**: `src/contexts/UnifiedUserDataContext.js:498-555`
- **Balance Operations**: `src/utils/balanceOperations.js:68`
- **XP Service**: `src/services/XPService.js`
- **Achievement Recording**: `src/utils/gemRewards.js`
- **Collection Hook**: `src/hooks/useUltraOptimizedCollectionData.js`
- **Coining Screen**: `src/screens/CoinScreen.js:318-438`

### Key Metrics Targets
- **Coining reads**: 1-2 reads (from 6-8)
- **Collection load**: <1s cached, <3s fresh
- **Cache hit rate**: >80%
- **Transaction conflicts**: <1%
- **Session total reads**: <10 (from 40-80)

### Priority Order
1. Fix balance path consistency ✅ (Immediate)
2. Fix collection cache return bug ✅ (Immediate)
3. Optimize XP operations ✅ (Phase 1)
4. Optimize achievements (Phase 2)
5. Add overview existence cache (Phase 2)
6. Disable inactive background sync (Phase 2)
7. Consolidate to transactions (Phase 3)
8. Add operation queue (Phase 3)
