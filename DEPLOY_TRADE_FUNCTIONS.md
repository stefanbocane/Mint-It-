# Deploy Trade Functions - FIX RLS ERROR NOW

## ERROR YOU'RE SEEING
```
Could not find the function public.accept_trade(trade_id_param) in the schema cache
```

## THE FIX (2 MINUTES)

### Step 1: Open Supabase SQL Editor
1. Go to your Supabase dashboard
2. Click "SQL Editor" in the left sidebar
3. Click "New Query"

### Step 2: Copy and Paste This SQL

**Copy ALL of this and paste into the SQL Editor:**

```sql
-- =====================================================
-- CARDMATES - TRADE FUNCTIONS (Bypass RLS)
-- =====================================================

-- Drop functions if they exist
DROP FUNCTION IF EXISTS accept_trade(UUID);
DROP FUNCTION IF EXISTS decline_trade(UUID);
DROP FUNCTION IF EXISTS cancel_trade(UUID);

-- Accept trade function
CREATE OR REPLACE FUNCTION accept_trade(trade_id_param UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  trade_record RECORD;
  cards_transferred INTEGER := 0;
  row_count_temp INTEGER;
BEGIN
  SELECT * INTO trade_record FROM trades WHERE id = trade_id_param;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Trade not found');
  END IF;

  IF trade_record.status NOT IN ('pending', 'active') THEN
    RETURN json_build_object('success', false, 'error', 'Trade is not in pending/active status');
  END IF;

  IF trade_record.receiver_id != auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'Only the receiver can accept this trade');
  END IF;

  UPDATE trades SET status = 'completed', updated_at = NOW() WHERE id = trade_id_param;

  IF trade_record.offered_cards IS NOT NULL AND array_length(trade_record.offered_cards, 1) > 0 THEN
    UPDATE cards SET owner_id = trade_record.receiver_id, in_trade = false, trade_id = NULL,
      status = 'available', updated_at = NOW() WHERE id = ANY(trade_record.offered_cards);
    GET DIAGNOSTICS row_count_temp = ROW_COUNT;
    cards_transferred := row_count_temp;
  END IF;

  IF trade_record.requested_cards IS NOT NULL AND array_length(trade_record.requested_cards, 1) > 0 THEN
    UPDATE cards SET owner_id = trade_record.sender_id, in_trade = false, trade_id = NULL,
      status = 'available', updated_at = NOW() WHERE id = ANY(trade_record.requested_cards);
    GET DIAGNOSTICS row_count_temp = ROW_COUNT;
    cards_transferred := cards_transferred + row_count_temp;
  END IF;

  RETURN json_build_object('success', true, 'trade_id', trade_id_param, 'cards_transferred', cards_transferred);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Decline trade function
CREATE OR REPLACE FUNCTION decline_trade(trade_id_param UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  trade_record RECORD;
BEGIN
  SELECT * INTO trade_record FROM trades WHERE id = trade_id_param;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Trade not found');
  END IF;

  IF trade_record.receiver_id != auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'Only the receiver can decline this trade');
  END IF;

  UPDATE trades SET status = 'rejected', updated_at = NOW() WHERE id = trade_id_param;
  UPDATE cards SET in_trade = false, trade_id = NULL, status = 'available', updated_at = NOW()
    WHERE id = ANY(trade_record.offered_cards) OR id = ANY(trade_record.requested_cards);

  RETURN json_build_object('success', true, 'trade_id', trade_id_param);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Cancel trade function
CREATE OR REPLACE FUNCTION cancel_trade(trade_id_param UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  trade_record RECORD;
BEGIN
  SELECT * INTO trade_record FROM trades WHERE id = trade_id_param;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Trade not found');
  END IF;

  IF trade_record.sender_id != auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'Only the sender can cancel this trade');
  END IF;

  UPDATE trades SET status = 'canceled', updated_at = NOW() WHERE id = trade_id_param;
  UPDATE cards SET in_trade = false, trade_id = NULL, status = 'available', updated_at = NOW()
    WHERE id = ANY(trade_record.offered_cards) OR id = ANY(trade_record.requested_cards);

  RETURN json_build_object('success', true, 'trade_id', trade_id_param);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION accept_trade(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION decline_trade(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_trade(UUID) TO authenticated;

-- Add border_type column if it doesn't exist
ALTER TABLE cards
ADD COLUMN IF NOT EXISTS border_type TEXT DEFAULT 'default';

-- Verify
DO $$
DECLARE
  functions_count INTEGER;
  border_column_exists BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO functions_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.proname IN ('accept_trade', 'decline_trade', 'cancel_trade');

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cards' AND column_name = 'border_type'
  ) INTO border_column_exists;

  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ DEPLOYMENT COMPLETE!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Trade Functions: % created', functions_count;
  IF border_column_exists THEN
    RAISE NOTICE 'Border Column: ✅ Exists';
  ELSE
    RAISE NOTICE 'Border Column: ❌ Missing';
  END IF;
  RAISE NOTICE '';
  RAISE NOTICE 'You can now:';
  RAISE NOTICE '  ✅ Accept trades';
  RAISE NOTICE '  ✅ Decline trades';
  RAISE NOTICE '  ✅ Cancel trades';
  RAISE NOTICE '  ✅ Apply card borders';
  RAISE NOTICE '========================================';
END $$;
```

### Step 3: Click "RUN"

You should see output like:
```
✅ DEPLOYMENT COMPLETE!
Trade Functions: 3 created
Border Column: ✅ Exists
```

### Step 4: Refresh Your App

Close and reopen your app, then try accepting a trade again.

## What This Does

These functions bypass RLS (Row-Level Security) using `SECURITY DEFINER` while maintaining security through explicit permission checks:

- **accept_trade()** - Transfers cards between users when trade is accepted
- **decline_trade()** - Releases cards when trade is declined
- **cancel_trade()** - Releases cards when sender cancels

## Expected Console Output After Fix

When you accept a trade, you should see:
```
🔄 Calling accept_trade function for trade: [trade-id]
✅ Trade accepted! Transferred 2 cards
```

No more RLS errors! 🎉
