# Apply Auction Fixes - Quick Guide

## Issues Fixed

1. ✅ **Starting bid now 6 coins** (was 0)
2. ✅ **Coins deducted when bidding** (SQL function already exists)
3. ✅ **Won cards appear in collection** (complete_auctions updated)
4. ✅ **Rarity persists from auction** (card rarity set from auction)

## Quick Fix (Copy-Paste SQL)

### Step 1: Add `starting_bid` Column

Go to your Supabase Dashboard → SQL Editor and run:

```sql
-- Add starting_bid column
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS starting_bid INT DEFAULT 6 CHECK (starting_bid > 0);

-- Set starting_bid = current_bid for existing auctions (or 6 if higher)
UPDATE auctions SET starting_bid = GREATEST(COALESCE(current_bid, 0), 6) WHERE starting_bid IS NULL;

COMMENT ON COLUMN auctions.starting_bid IS 'Minimum bid amount for the auction (default 6 coins)';
```

### Step 2: Update `complete_auctions` Function

Copy and run this in Supabase SQL Editor:

```sql
-- Update complete_auctions to set card rarity
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
  -- Process all auctions that have ended
  FOR v_auction IN
    SELECT *
    FROM auctions
    WHERE status = 'active' AND end_time <= NOW()
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Mark auction as completed
    UPDATE auctions
    SET
      status = 'completed',
      completed_at = NOW(),
      updated_at = NOW()
    WHERE id = v_auction.id;

    -- Transfer card to winner if there was a winning bid
    IF v_auction.current_bidder IS NOT NULL AND v_auction.current_bid > 0 THEN

      -- Update card ownership AND rarity (set to final auction rarity)
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

      -- Award seller with coins
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
      SELECT
        v_auction.id,
        v_auction.card_id,
        v_auction.current_bidder,
        v_auction.seller_id,
        v_auction.current_bid,
        'winner_paid'::TEXT;

    ELSE
      -- No winner, return card to seller
      UPDATE cards
      SET
        in_auction = FALSE,
        auction_id = NULL,
        status = 'available',
        status_update_time = NOW(),
        updated_at = NOW()
      WHERE id = v_auction.card_id;

      RETURN QUERY
      SELECT
        v_auction.id,
        v_auction.card_id,
        NULL::UUID,
        v_auction.seller_id,
        0,
        'no_winner'::TEXT;
    END IF;

    v_completed_count := v_completed_count + 1;
  END LOOP;

  RAISE NOTICE 'Completed % auctions', v_completed_count;

END;
$$ LANGUAGE plpgsql;
```

## Restart Your App

After running the SQL above:

```bash
npm start -- --clear
```

## Test Checklist

- [ ] Mint a new card → Auction starts at 6 coins
- [ ] Bid on an auction → Coins deducted from balance
- [ ] Win an auction → Card appears in your collection
- [ ] Check card rarity → Should match final auction rarity (not 'common')

## Files Changed

### JavaScript (already updated):
- `src/screens/CoinScreenSupabase.js` - Line 207-208: Set starting_bid and current_bid to 6

### SQL (needs to be applied above):
- `supabase/12-add-starting-bid-column.sql` - Adds missing column
- `supabase/11-fix-auction-issues.sql` - Updates complete_auctions function

## Verification

Check that the column was added:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'auctions' AND column_name = 'starting_bid';
```

Should return:
```
column_name   | data_type | column_default
starting_bid  | integer   | 6
```
