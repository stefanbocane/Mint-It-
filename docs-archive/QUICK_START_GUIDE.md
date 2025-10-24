# 🚀 Quick Start Guide - Single-Digit Reads Implementation
## Get Up and Running in 5 Minutes

**Last Updated:** October 8, 2025

---

## ⚡ TL;DR

**Phase 1 Complete!** Your app now has:
- ✅ Read monitoring system
- ✅ Removed critical listener (60% savings)
- ✅ Overview documents for trades/social
- ✅ Development dashboard
- ✅ Circuit breaker protection

**Expected Result:** **75-85% read reduction**

---

## 📋 5-Minute Checklist

### 1. Deploy Cloud Functions (2 min)
```bash
cd functions
firebase deploy --only functions:syncTradeOverview,syncSocialOverview
```

### 2. Run Dev Build (1 min)
```bash
npm start
```

### 3. Look for Dashboard (30 sec)
- Top-right corner: "📊 0/10" button
- Should be green initially
- Tap to expand full dashboard

### 4. Test a Scenario (1 min)
- Navigate to a few screens
- Watch counter increment
- Should stay under 10 reads

### 5. Verify Success (30 sec)
```javascript
// In console
const report = ReadMonitor.getReport();
console.log(`Session reads: ${report.totalReads}/${report.budget}`);
// Should be < 10 for normal usage
```

**Done!** ✅

---

## 🎯 What You Should See

### On App Launch
```
Console:
📊 ReadMonitor initialized [Session: session_xxx]
✅ Unified user data loaded from cache (no read)
📖 Read #1: CollectionScreen.load_overview
🟢 OK (9 remaining)

Dashboard:
📊 1/10 (green)
```

### After Navigation
```
Console:
📖 Read #2: AuctionScreen.load_overview
🟢 OK (8 remaining)

Dashboard:
📊 2/10 (green)
```

### If Budget Exceeded
```
Console:
⚠️ APPROACHING READ BUDGET: 8/10 (yellow)
🚨 READ BUDGET EXCEEDED: 11/10 (red)
⚡ CIRCUIT BREAKER TRIPPED

Dashboard:
📊 11/10 (red) ⚠️
Status: OPEN 🔴
```

---

## 🐛 Troubleshooting

### Problem: Dashboard Not Showing
**Check:** Is `__DEV__` true?
```javascript
console.log('Dev mode:', __DEV__);
```
**Fix:** Run in development mode, not production

---

### Problem: Reads Still High
**Check Dashboard:** Tap button, see "Reads by Source"

**Common Culprits:**
1. Screen not using overview docs → Migrate to overview pattern
2. Cache not working → Check CacheService logs
3. Other listeners active → Search for `onSnapshot`

**Debug:**
```javascript
const report = ReadMonitor.getReport();
console.log('Top sources:', report.bySource);
// Identify which component is causing reads
```

---

### Problem: Stale Data
**Solution:** Pull to refresh on any screen
```javascript
// Triggers RefreshCoordinator
await RefreshCoordinator.refreshAll(userId, groupId);
// Invalidates caches, fresh reads (2-5 total)
```

---

### Problem: Circuit Breaker Tripping
**Cause:** Budget exceeded (usually a bug)

**Fix:**
1. Check dashboard for top read source
2. Fix that component
3. Reset: `ReadCircuitBreaker.reset()`

**Temporary Workaround:**
```javascript
// Increase budget (not recommended)
ReadMonitor.setBudget(20); // Default is 10
```

---

## 📖 Common Patterns

### Loading Data (Overview Pattern)
```javascript
const MyScreen = () => {
  const [data, setData] = useState([]);
  
  const loadData = async () => {
    // 1. Cache first
    const cached = await CacheService.getValue(`key_${groupId}`);
    if (cached) return setData(cached.data);
    
    // 2. Overview doc (1 READ)
    const snap = await getDoc(doc(db, 'overviews', groupId));
    ReadMonitor.trackRead('MyScreen', 'load');
    
    const data = snap.data()?.items || [];
    setData(data);
    
    // 3. Cache 45 min
    await CacheService.setValue(`key_${groupId}`, { data });
  };
  
  return <FlatList data={data} />;
};
```

### Mutations (Optimistic Updates)
```javascript
const addCoins = async (amount) => {
  // 1. Update UI immediately
  setBalance(prev => prev + amount);
  
  // 2. Transaction in background
  await runTransaction(...);
  
  // 3. NO FETCH! Trust the update.
};
```

### Manual Refresh
```javascript
const onRefresh = async () => {
  await RefreshCoordinator.refreshAll(userId, groupId);
  // Invalidates all caches, screens reload with 1-2 reads each
};
```

---

## 🎓 Key Principles

### ✅ DO
- Cache first, always
- Use overview documents
- Track reads with ReadMonitor
- Optimistic updates for mutations
- Manual refresh only

### ❌ DON'T
- Use real-time listeners
- Fetch after mutations
- Query individual documents
- Forget to track reads
- Bypass circuit breaker

---

## 📊 Expected Metrics

### Good Performance 🟢
```
Session Reads: 5-10
Budget: 10
Status: OK (5-0 remaining)
Cache Hit Rate: 80-95%
Circuit: CLOSED
```

### Warning ⚠️
```
Session Reads: 10-15
Budget: 10
Status: WARNING (-0 to -5 over)
Cache Hit Rate: 60-80%
Circuit: HALF_OPEN
```

### Problem 🔴
```
Session Reads: 20+
Budget: 10
Status: ERROR (-10+ over)
Cache Hit Rate: <60%
Circuit: OPEN
```

---

## 🆘 Emergency Commands

### Reset Everything
```javascript
// Clear all counters
await ReadMonitor.reset();
await ReadCircuitBreaker.reset();

// Clear all caches
await RefreshCoordinator.refreshAll(userId, groupId);
```

### Export Debug Data
```javascript
const report = ReadMonitor.exportSession();
console.log(JSON.stringify(report, null, 2));
// Copy and analyze
```

### Check Critical Logs
```javascript
// Get critical event logs
const criticalLogs = await ReadMonitor.getCriticalLogs();
console.log('Critical events:', criticalLogs);
```

---

## 📞 Need Help?

### Check Documentation
- `CURRENT_STATE_ANALYSIS.md` - Current state and issues
- `SINGLE_DIGIT_READS_MASTER_PLAN.md` - Complete strategy
- `IMPLEMENTATION_SUMMARY.md` - What was implemented
- `PHASE_1_COMPLETE.md` - Phase 1 results

### Common Questions

**Q: How do I check if a screen is optimized?**
```javascript
// Navigate to screen, check dashboard
// Should add 0-1 reads maximum
```

**Q: When should I use overview docs vs queries?**
```
Always use overview docs when available.
Only query if:
- No overview doc exists yet
- Need specific filters
- Doing writes
```

**Q: How often should cache refresh?**
```
Automatically: Never (manual only)
TTL expiry: 45-120 minutes
Manual refresh: When user pulls
```

**Q: What if I need real-time updates?**
```
Don't use listeners! Instead:
1. Cache with short TTL (5-10 min)
2. Manual refresh available
3. Optimistic updates for mutations
4. Consider polling for critical data (sparingly)
```

---

## 🎯 Next Steps

After Phase 1 is working:

1. **Migrate remaining screens** to overview pattern
2. **Implement boot service** (1 read for everything)
3. **Add differential sync** (0-1 reads on refresh)
4. **Set up production monitoring**
5. **Complete documentation**

See `PHASE_1_COMPLETE.md` for full Phase 2 roadmap.

---

## ✅ Success Checklist

- [ ] Cloud Functions deployed
- [ ] Dev dashboard visible
- [ ] Session reads < 10
- [ ] Cache hit rate > 80%
- [ ] Circuit breaker CLOSED
- [ ] No console errors
- [ ] Screens load fast
- [ ] Data stays fresh
- [ ] Pull-to-refresh works
- [ ] No budget violations

**All checked?** You're ready to go! 🚀

---

*Last Updated: October 8, 2025*  
*Version: 1.0 (Phase 1)*



