# Phase 2: Testing Guide

## Quick Start

```bash
# 1. Start the app
npx expo start

# 2. Open on device (iOS or Android)
# Press 'i' for iOS or 'a' for Android
```

---

## Critical Tests

### Test 1: Verify Listeners Are Disabled ⭐ **CRITICAL**

**What to check**:
1. Open the app
2. Check console output
3. **Should NOT see**: `"🚀 Realtime listeners ENABLED"`
4. **Should see**: `"REALTIME_LISTENERS_ENABLED = false"`

**Why this matters**:
- Previous bug was re-enabling listeners when app became active
- This test confirms the fix is working

**Expected**: No message about listeners being enabled

---

### Test 2: Foreground/Background Behavior ⭐ **CRITICAL**

**Steps**:
1. Open app and navigate to AuctionScreen
2. Open ReadDashboard - note current read count
3. Background the app (home button/swipe up)
4. Wait 5 seconds
5. Foreground the app
6. Check ReadDashboard - read count should increase by 0-2, **NOT** 10-20

**Why this matters**:
- Previous bug caused read spikes every time app was foregrounded
- This is the main symptom of the GlobalListenerCoordinator bug

**Expected**: <2 reads when foregrounding (just cache refresh, no listeners)

---

### Test 3: Auction Timers Work

**Steps**:
1. Navigate to AuctionScreen
2. Verify auction timers are counting down
3. Check that end times are accurate

**Expected**:
- Timers display correctly
- Countdown works smoothly
- No errors in console

---

### Test 4: Bid Updates Work (Real-time)

**Steps**:
1. Have two devices/simulators logged into same group
2. Place a bid from Device A
3. Verify Device B receives update within 1-2 seconds

**Expected**:
- Real-time bid updates via FCM push notifications (Phase 1)
- No delay > 3 seconds
- No errors in console

---

### Test 5: Read Dashboard Shows <10 Reads

**Steps**:
1. Start fresh app session (force quit and reopen)
2. Open ReadDashboard (floating button top-right)
3. Navigate to: HomeScreen → AuctionScreen → CollectionScreen → BackToAuction
4. Place 2-3 bids
5. Check ReadDashboard total

**Expected**:
- Total reads < 10 for entire session
- Most reads from initial boot (1-2 reads)
- Auction views add 1-2 reads total
- Bids add 0 reads (FCM push notifications)

---

## What Good Looks Like

### Console Output ✅
```
✅ Bootstrap loaded with 1 read
✅ Auction data from cache (age: 45s)
✅ FCM message received: BID_UPDATE
✅ REALTIME_LISTENERS_ENABLED = false
```

### Console Output ❌
```
❌ "🚀 Realtime listeners ENABLED"  // Bug is back!
❌ "Created consolidated group listener"  // Listeners active!
❌ "onSnapshot called"  // Listeners running!
```

---

## ReadDashboard Metrics

### Good Session (<10 reads):
```
Total Reads: 7
- Boot: 1 read
- Auction data: 2 reads (cache miss + refresh)
- Collection data: 2 reads (initial load)
- Profile: 1 read
- Other: 1 read
```

### Bad Session (>20 reads) - Bug Present:
```
Total Reads: 35  ⚠️ PROBLEM!
- Boot: 1 read
- Listeners: 20+ reads  ⚠️ BUG!
- Auction data: 5 reads
- Collection data: 5 reads
- Other: 4 reads
```

---

## Debugging Tips

### If Reads Are Still High (>10):

1. **Check GlobalListenerCoordinator**:
   ```bash
   # Verify line 19 has 'const' not 'let'
   head -20 src/utils/GlobalListenerCoordinator.js | grep "REALTIME_LISTENERS_ENABLED"

   # Should show:
   # const REALTIME_LISTENERS_ENABLED = false;
   ```

2. **Check for onSnapshot calls**:
   ```bash
   # Search for active listeners in console
   # Look for: "Created consolidated" or "onSnapshot"
   ```

3. **Check ReadDashboard breakdown**:
   - Expand ReadDashboard modal
   - Look for spike in reads
   - Identify which component is causing reads

4. **Test foreground/background**:
   - This is the #1 symptom of the bug
   - Should add <2 reads, not 10-20

### If Timers Don't Work:

1. Check `auctionTimerUtils.js` imports:
   ```bash
   head -10 src/utils/auctionTimerUtils.js | grep "getCachedDoc"

   # Should show:
   # import { getCachedDoc } from './firestoreUtils';
   ```

2. Check console for errors
3. Verify auction data is in cache

### If Bids Don't Update:

1. This is a **Phase 1** issue (FCM push notifications)
2. Check Firebase Cloud Function is deployed:
   ```bash
   firebase functions:list | grep onBidPlaced
   ```
3. Check console for FCM messages:
   ```
   "FCM message received: BID_UPDATE"
   ```

---

## Success Checklist

- [ ] ✅ Console never shows "Realtime listeners ENABLED"
- [ ] ✅ Foreground/background adds <2 reads (not 10-20)
- [ ] ✅ Auction timers work correctly
- [ ] ✅ Bids update in real-time (via FCM)
- [ ] ✅ ReadDashboard shows <10 reads total
- [ ] ✅ No errors in console
- [ ] ✅ No user-facing bugs or delays

---

## Rollback Instructions

### If Critical Issues Found:

```bash
# Revert all Phase 2 changes
git checkout HEAD~4 -- src/utils/auctionTimerUtils.js
git checkout HEAD~4 -- src/utils/firestoreUtils.js
git checkout HEAD~4 -- src/utils/index.js
git checkout HEAD~4 -- src/utils/GlobalListenerCoordinator.js

# Restart app
npx expo start --clear
```

### If Only GlobalListenerCoordinator Issues:

```bash
# Revert just the critical fix
git checkout HEAD~1 -- src/utils/GlobalListenerCoordinator.js

# Restart app
npx expo start --clear
```

---

## Report Template

After testing, report results:

```
## Phase 2 Testing Results

**Date**: [DATE]
**Tester**: [NAME]
**Device**: [iOS/Android + Version]

### Critical Tests:
- [ ] Listeners disabled (no "ENABLED" in console): YES/NO
- [ ] Foreground/background reads: ____ reads (expect <2)
- [ ] Auction timers work: YES/NO
- [ ] Bids update real-time: YES/NO
- [ ] Total reads < 10: ____ reads total

### Issues Found:
1. [Issue description]
2. [Issue description]

### Recommendation:
- [ ] ✅ APPROVE - Deploy to production
- [ ] ⚠️ MINOR ISSUES - Fix and re-test
- [ ] ❌ CRITICAL ISSUES - Rollback immediately
```

---

**Ready to test!** Focus on the foreground/background test - that's the #1 indicator of success.
