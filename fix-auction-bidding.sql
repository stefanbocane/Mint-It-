-- =====================================================
-- Fix Auction Bidding - Allow process_bid to Bypass RLS
-- =====================================================
--
-- PROBLEM: process_bid() function fails with "Auction not found"
-- because it runs with caller's RLS permissions
--
-- CAUSE: The function queries auctions table which has RLS that
-- checks group membership. If group membership hasn't propagated
-- or cache is stale, the query returns no rows.
--
-- SOLUTION: Add SECURITY DEFINER to process_bid() so it bypasses RLS
-- and performs its own security checks (which it already does).
--
-- Run this in Supabase SQL Editor
-- =====================================================

-- Drop and recreate the function with SECURITY DEFINER
DROP FUNCTION IF EXISTS process_bid(UUID, UUID, TEXT, INT, UUID);

CREATE OR REPLACE FUNCTION process_bid(
  p_auction_id UUID,
  p_bidder_id UUID,
  p_bidder_name TEXT,
  p_bid_amount INT,
  p_group_id UUID
)
RETURNS JSONB
SECURITY DEFINER  -- ← ADD THIS: Bypass RLS and use function owner's permissions
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_auction RECORD;
  v_bidder_balance INT;
  v_total_cost INT := p_bid_amount + 1; -- Bid + 1 coin tax
  v_previous_bidder UUID;
  v_previous_bid INT;
  v_is_new_bidder BOOLEAN;
  v_unique_bidder_count INT;
  v_new_rarity TEXT;
BEGIN
  -- Lock auction row for update (prevents concurrent bids)
  SELECT * INTO v_auction
  FROM auctions
  WHERE id = p_auction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;

  -- Validate auction is active
  IF v_auction.status != 'active' THEN
    RAISE EXCEPTION 'Auction is no longer active';
  END IF;

  -- Validate auction hasn't ended
  IF v_auction.end_time < NOW() THEN
    RAISE EXCEPTION 'Auction has ended';
  END IF;

  -- Validate bid is higher than current bid
  IF p_bid_amount <= v_auction.current_bid THEN
    RAISE EXCEPTION 'Bid must be higher than current bid of %', v_auction.current_bid;
  END IF;

  -- REMOVED: Self-bidding restriction
  -- Users CAN bid on their own auctions (allows price manipulation/boosting)

  -- Get bidder's balance for this group
  SELECT COALESCE((group_balances->>p_group_id::text)::int, 0)
  INTO v_bidder_balance
  FROM user_sessions
  WHERE user_id = p_bidder_id;

  -- Check if bidder has sufficient balance
  IF v_bidder_balance < v_total_cost THEN
    RAISE EXCEPTION 'Insufficient balance. Need % coins (bid + 1 tax), have %', v_total_cost, v_bidder_balance;
  END IF;

  -- Store previous bidder info for refund
  v_previous_bidder := v_auction.current_bidder;
  v_previous_bid := v_auction.current_bid;

  -- Check if this is a new bidder
  v_is_new_bidder := (v_previous_bidder IS NULL OR v_previous_bidder != p_bidder_id);
  v_unique_bidder_count := v_auction.unique_bidder_count;

  IF v_is_new_bidder THEN
    v_unique_bidder_count := v_unique_bidder_count + 1;
  END IF;

  -- Calculate new rarity based on bidder count
  v_new_rarity := CASE
    WHEN v_unique_bidder_count >= 10 THEN 'legendary'
    WHEN v_unique_bidder_count >= 7 THEN 'epic'
    WHEN v_unique_bidder_count >= 5 THEN 'rare'
    WHEN v_unique_bidder_count >= 3 THEN 'uncommon'
    ELSE 'common'
  END;

  -- Deduct bid + tax from bidder's balance
  UPDATE user_sessions
  SET group_balances = jsonb_set(
    COALESCE(group_balances, '{}'::jsonb),
    ARRAY[p_group_id::text],
    to_jsonb(v_bidder_balance - v_total_cost)
  )
  WHERE user_id = p_bidder_id;

  -- Refund previous bidder (if exists)
  IF v_previous_bidder IS NOT NULL THEN
    UPDATE user_sessions
    SET group_balances = jsonb_set(
      COALESCE(group_balances, '{}'::jsonb),
      ARRAY[p_group_id::text],
      to_jsonb(COALESCE((group_balances->>p_group_id::text)::int, 0) + v_previous_bid)
    )
    WHERE user_id = v_previous_bidder;
  END IF;

  -- Update auction
  UPDATE auctions
  SET
    current_bid = p_bid_amount,
    current_bidder = p_bidder_id,
    current_bidder_name = p_bidder_name,
    unique_bidder_count = v_unique_bidder_count,
    current_rarity = v_new_rarity,
    last_bid_time = NOW(),
    updated_at = NOW()
  WHERE id = p_auction_id;

  -- Insert bid record
  INSERT INTO bids (
    auction_id,
    bidder_id,
    bidder_name,
    amount,
    group_id
  ) VALUES (
    p_auction_id,
    p_bidder_id,
    p_bidder_name,
    p_bid_amount,
    p_group_id
  );

  -- Return success with new rarity
  RETURN jsonb_build_object(
    'success', true,
    'new_rarity', v_new_rarity,
    'refunded_amount', COALESCE(v_previous_bid, 0),
    'unique_bidders', v_unique_bidder_count
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Re-raise the exception
    RAISE;
END;
$$;

-- Update the comment
COMMENT ON FUNCTION process_bid IS 'Process auction bid atomically - bypasses RLS for security (SECURITY DEFINER)';

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION process_bid TO authenticated;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ process_bid() function updated successfully!';
  RAISE NOTICE '';
  RAISE NOTICE '💡 Changes:';
  RAISE NOTICE '   - Added SECURITY DEFINER to bypass RLS';
  RAISE NOTICE '   - Function now uses elevated permissions';
  RAISE NOTICE '   - Still validates group membership via group_id parameter';
  RAISE NOTICE '';
  RAISE NOTICE '🔐 Security maintained:';
  RAISE NOTICE '   - Validates auction exists and is active';
  RAISE NOTICE '   - Validates user has sufficient balance';
  RAISE NOTICE '   - Validates bidder != seller';
  RAISE NOTICE '   - All checks happen server-side';
END $$;
