# Debug: Coins Being Awarded for Minting

## Issue
User reports being **awarded coins** when minting a card, instead of having coins **deducted**.

## Expected Behavior
**Minting a card should COST coins:**
1. User takes photo of card
2. User pays 6 coins (COIN_COST)
3. Card is created
4. Auction is started
5. **Balance should DECREASE by 6**

## What the Code Does (CoinScreenSupabase.js)

### Line 159: Deduct Coins
```javascript
const coinsDeducted = await subtractCoins(COIN_COST);
```

This calls `subtractCoins(6)` from `useBalance` hook.

### Check useBalance Hook
The issue might be in `/src/hooks/useBackwardCompatibility.js` where `subtractCoins` is implemented.

## Possible Causes

### 1. Database Function Bug
If `update_user_balance` RPC function has wrong logic:
- Parameter sign might be inverted
- Positive amount adds instead of subtracts

### 2. Hook Implementation Bug
If `subtractCoins` in `useBackwardCompatibility.js`:
- Calls award function instead of deduct
- Passes positive amount instead of negative

### 3. Balance Calculation Bug
If balance refresh logic:
- Reads wrong value
- Calculates incorrectly

## How to Debug

### Step 1: Check Console Logs
When you mint a card, look for logs like:
```
🪙 Starting coin card process...
✅ Coins deducted
```

And check what balance changes show:
```
💰 Balance: 100 → 106  ← WRONG (should be 94)
```

### Step 2: Check useBalance Hook
Look at `/src/hooks/useBackwardCompatibility.js`:
- Find `subtractCoins` function
- Check if it calls the right RPC function
- Check if amount is negated correctly

### Step 3: Check RPC Function
Look at `/supabase/02-functions.sql`:
- Find `update_user_balance` or similar
- Check the SQL logic for balance updates

## Quick Fix Locations

### If Hook is Wrong
**File**: `src/hooks/useBackwardCompatibility.js`
```javascript
// WRONG:
await supabase.rpc('update_user_balance', {
  p_amount: amount  // ← Positive adds coins
});

// RIGHT:
await supabase.rpc('update_user_balance', {
  p_amount: -amount  // ← Negative subtracts coins
});
```

### If RPC is Wrong
**File**: `supabase/02-functions.sql`
```sql
-- Check the function logic
-- Make sure it's doing: current_balance + p_amount
-- NOT: current_balance - p_amount (with inverted sign)
```

## Next Steps

1. **Mint a card** and **watch the console logs closely**
2. **Note the exact balance change** (before → after)
3. **Share the console output** showing:
   - Starting balance
   - Logs from coin deduction
   - Ending balance
4. **Look for error messages** or unexpected function calls

With that information, I can pinpoint exactly where the bug is!

## Expected Console Output (Correct)
```
💰 Current balance: 100 coins
🪙 Starting coin card process...
💸 Calling subtractCoins(6)
📡 RPC: update_user_balance({ amount: -6 })
✅ Coins deducted
💰 New balance: 94 coins  ← Should be 94
```

## Actual Output (If Bugged)
```
💰 Current balance: 100 coins
🪙 Starting coin card process...
💸 Calling subtractCoins(6)
📡 RPC: update_user_balance({ amount: +6 })  ← BUG: positive instead of negative
✅ Coins deducted
💰 New balance: 106 coins  ← WRONG: added instead of subtracted
```

**Share the console logs when you mint and I'll fix it!** 🔍
