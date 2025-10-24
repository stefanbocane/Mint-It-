# Final Auction Fixes Summary

## Issues Fixed ✅

### 1. **Starting Bid = 6 Coins**
- **File**: `src/screens/CoinScreenSupabase.js`
- **Fix**: Lines 207-208 now set `starting_bid: 6` and `current_bid: 6`
- **Status**: ✅ JavaScript updated, needs SQL column added

### 2. **Coins Refresh After Bidding**
- **File**: `src/hooks/useOptimizedBidding.js`
- **Fix**: Lines 211-213 now call `refreshUserData()` after successful bid
- **Status**: ✅ Complete - balance updates immediately in UI

### 3. **Top Bidder Shows Display Name**
- **File**: `src/hooks/useOptimizedBidding.js`
- **Fix**: Line 143 now uses `userData?.display_name` from users table
- **Status**: ✅ Complete - shows user's set display name

### 4. **Won Cards Appear in Collection**
- **How it works**:
  1. User refreshes collection (pull down)
  2. `complete_auctions()` RPC is called (line 168 in `useSimpleCollectionData.js`)
  3. Expired auctions are processed and cards transferred
  4. `fetchCards()` loads updated card list with new cards
- **Status**: ⚠️ Needs SQL fix for ambiguous column error

### 5. **Rarity Persists from Auction**
- **SQL Fix**: `complete_auctions()` now sets `rarity = v_auction.current_rarity`
- **Status**: ⚠️ Needs SQL deployment

### 6. **Minted Cards Show with "In Auction" Tag**
- **How it works**: When card is minted (CoinScreenSupabase.js):
  1. Card created with `in_auction: false` (line 183)
  2. Auction created (line 195-213)
  3. Card updated with `in_auction: true` and `auction_id` (lines 219-226)
  4. Card appears in collection with "In Auction" status
- **Status**: ✅ Already working correctly

---

## Required SQL Fixes (Run These in Supabase SQL Editor)

### Step 1: Add `starting_bid` Column
```sql
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS starting_bid INT DEFAULT 6 CHECK (starting_bid > 0);

UPDATE auctions SET starting_bid = GREATEST(COALESCE(current_bid, 0), 6) WHERE starting_bid IS NULL;

COMMENT ON COLUMN auctions.starting_bid IS 'Minimum bid amount for the auction (default 6 coins)';
```

### Step 2: Fix `complete_auctions` Function (Resolves Ambiguous Column Error)
```sql
DROP FUNCTION IF EXISTS complete_auctions();

CREATE OR REPLACE FUNCTION complete_auctions()
RETURNS TABLE(
  auction_id UUID,
  card_id UUID,
  winner_id UUID,
  seller_id UUID,
  final_bid INT,
  status TEXT
) AS $$
DECLARE
  v_auction RECORD;
  v_completed_count INT := 0;
BEGIN
  FOR v_auction IN
    SELECT *
    FROM auctions
    WHERE auctions.status = 'active' AND auctions.end_time <= NOW()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE auctions
    SET
      status = 'completed',
      completed_at = NOW(),
      updated_at = NOW()
    WHERE id = v_auction.id;

    IF v_auction.current_bidder IS NOT NULL AND v_auction.current_bid > 0 THEN
      UPDATE cards
      SET
        owner_id = v_auction.current_bidder,
        rarity = v_auction.current_rarity,
        in_auction = FALSE,
        auction_id = NULL,
        status = 'available',
        status_update_time = NOW(),
        updated_at = NOW()
      WHERE id = v_auction.card_id;

      UPDATE user_sessions
      SET
        group_balances = jsonb_set(
          group_balances,
          ARRAY[v_auction.group_id::text],
          to_jsonb(COALESCE((group_balances->>v_auction.group_id::text)::int, 0) + v_auction.current_bid)
        ),
        updated_at = NOW()
      WHERE user_id = v_auction.seller_id;

      RETURN QUERY
      SELECT v_auction.id, v_auction.card_id, v_auction.current_bidder,
             v_auction.seller_id, v_auction.current_bid, 'winner_paid'::TEXT;
    ELSE
      UPDATE cards
      SET
        in_auction = FALSE,
        auction_id = NULL,
        status = 'available',
        status_update_time = NOW(),
        updated_at = NOW()
      WHERE id = v_auction.card_id;

      RETURN QUERY
      SELECT v_auction.id, v_auction.card_id, NULL::UUID,
             v_auction.seller_id, 0, 'no_winner'::TEXT;
    END IF;

    v_completed_count := v_completed_count + 1;
  END LOOP;

  RAISE NOTICE 'Completed % auctions', v_completed_count;
END;
$$ LANGUAGE plpgsql;
```

---

## After Running SQL Fixes

### Restart Your App
```bash
npm start -- --clear
```

### Test Checklist
- [ ] **Mint a card** → Auction starts at 6 coins
- [ ] **Check collection while card is in auction** → Card shows with "In Auction" tag
- [ ] **Bid on the auction** → Coins deducted immediately from balance
- [ ] **Wait for auction to end** (or use short 30-second duration)
- [ ] **Refresh collection** → Won card appears with correct rarity
- [ ] **Check top bidder name** → Shows display_name you set in settings

---

## How Collection Refresh Works

```
User pulls down to refresh
    ↓
complete_auctions() RPC called
    ↓
Processes expired auctions:
  - If winner exists: Transfer card + set rarity + pay seller
  - If no winner: Return card to seller
    ↓
fetchCards() gets ALL user's cards
    ↓
Collection displays updated list
```

### Cards Included in Collection:
- ✅ Available cards (`status = 'available'`)
- ✅ Cards in auction (`in_auction = true`)
- ✅ Cards in trades (`in_trade = true`)
- ✅ Newly won cards (after `complete_auctions` runs)

### Why Won Cards Might Not Show:
1. **`complete_auctions` failing** → Fixed by SQL above (ambiguous column)
2. **Cache not cleared** → Already handled by `forceRefresh = true`
3. **RPC permissions** → Check RLS policies if still failing

---

## Files Changed (JavaScript)

1. **src/screens/CoinScreenSupabase.js**
   - Line 207-208: Set `starting_bid: 6` and `current_bid: 6`

2. **src/hooks/useOptimizedBidding.js**
   - Line 23: Added `userData` from UnifiedUserDataContext
   - Line 143: Use `userData?.display_name` for bidder name
   - Lines 211-213: Call `refreshUserData()` after successful bid
   - Line 247: Added `userData` to dependency array

3. **src/hooks/useSimpleCollectionData.js**
   - Lines 165-177: Already calls `complete_auctions()` before fetching cards
   - Line 180: Force refresh bypasses cache

---

## Database Schema Notes

### Auctions Table
- `starting_bid` (NEW): Minimum bid (default 6)
- `current_bid`: Current highest bid
- `current_bidder`: UUID of top bidder
- `current_bidder_name`: Display name of top bidder
- `current_rarity`: Live rarity based on bidding activity

### Cards Table
- `owner_id`: Current owner (changes on auction completion)
- `rarity`: Card rarity (set from `current_rarity` on auction end)
- `in_auction`: Boolean flag
- `auction_id`: Reference to active auction
- `status`: 'available', 'in_auction', 'in_trade'

### User Sessions Table
- `group_balances`: JSONB with per-group coin balances
- Updated atomically by `process_bid()` and `complete_auctions()`

---

## Next Steps

1. ✅ **Run SQL Fix #1** (add starting_bid column)
2. ✅ **Run SQL Fix #2** (fix complete_auctions function)
3. ✅ **Restart app** with cache cleared
4. ✅ **Test full flow** (mint → bid → win → refresh → verify)

All JavaScript changes are already in place! Just need the SQL updates.
