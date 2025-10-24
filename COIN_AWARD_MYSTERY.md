# Mystery: 17 Coins Being Awarded After Minting

## The Facts

From your console logs:
```
Balance: 137 coins
✅ subtractCoins: 6 coins. Balance: 137 → 131  ← CORRECT
✅ Coins deducted
✅ Card created
✅ Auction created
[User data refreshed]
Balance: 148 coins  ← WRONG! Should be 131
```

**Mystery**: 17 coins appear from nowhere (131 + 17 = 148)

## Investigation

### ✅ Checked: App Code
- `CoinScreenSupabase.js` only calls `subtractCoins(6)` ✅
- No achievement/reward calls in mint function ✅
- `performCoinOperation` correctly passes `-6` ✅
- `update_balance` RPC correctly does `balance + (-6)` ✅

### ✅ Checked: Database Triggers
- No triggers on `cards` table that award coins ✅
- No triggers on `auctions` table that award coins ✅
- Only materialized view refreshes (harmless) ✅

### ❓ Possible Sources

1. **Firebase Cloud Functions Still Running** 🔥
   - You have `functions/index.js` with Cloud Functions
   - These might still be deployed and active
   - But you're writing to **Supabase**, not Firebase
   - So they shouldn't trigger... unless there's a webhook?

2. **Hidden Reward System**
   - First card minted in a group?
   - Daily reward claiming at same time?
   - Achievement unlocked?

3. **Race Condition**
   - Two operations happening simultaneously
   - One deducts 6, another adds 23?
   - Net result: +17

4. **Data Corruption**
   - Old balance data being re-applied
   - Session data out of sync

## The Smoking Gun: +17 Coins

The number **17** is oddly specific. Let me search for where this exact number appears:

### Common Reward Amounts to Check:
- First card reward?
- Auction creation bonus?
- Daily login reward?
- Level up reward?
- Achievement reward?

## Next Steps to Solve This

### Option 1: Check Supabase Database Directly
In Supabase Dashboard → SQL Editor, run:
```sql
-- Check recent balance changes for your user
SELECT * FROM user_sessions
WHERE user_id = 'YOUR_USER_ID';

-- Check if there are balance update logs
SELECT * FROM audit_logs
WHERE table_name = 'user_sessions'
ORDER BY created_at DESC
LIMIT 10;
```

### Option 2: Disable Firebase Functions
Check if Firebase Functions are still deployed:
```bash
firebase functions:list
```

If they exist, delete them:
```bash
firebase functions:delete functionName
```

### Option 3: Add More Detailed Logging
Before `refreshBalance()` in `CoinScreenSupabase.js`, add:
```javascript
console.log('🔍 Balance before refresh:', balance);

const { data: sessionData } = await supabase
  .from('user_sessions')
  .select('group_balances')
  .eq('user_id', user.id)
  .single();

console.log('🔍 Raw database balance:', sessionData);

await refreshBalance();

console.log('🔍 Balance after refresh:', balance);
```

This will show if the database itself has the wrong value or if the refresh is calculating incorrectly.

### Option 4: Check for Multiple Instances
- Are you running the app in multiple simulators/devices?
- Is there a web version also running?
- Multiple tabs open?

## Most Likely Culprit

My bet is on **Firebase Cloud Functions still deployed and somehow getting triggered**, possibly through:
- A webhook you forgot about
- Edge Functions in Supabase that forward to Firebase
- Database replication/sync between Firebase and Supabase

**Check your Firebase Console** → Functions tab → See if anything is deployed and running!

## The Solution

Once we identify the source, the fix will be one of:
1. Delete Firebase Functions
2. Disable specific reward trigger
3. Fix race condition with proper locking
4. Fix data sync issue

**Try Option 3 first** (add detailed logging) and mint one more card. Share the output!
