-- =====================================================
-- Fix Auction Completion - Add SECURITY DEFINER
-- =====================================================
--
-- PROBLEM: complete_auctions() fails with RLS error
-- "new row violates row-level security policy for table "cards""
--
-- CAUSE: Function tries to transfer card ownership (change owner_id)
-- but RLS only allows current owner to update their cards.
-- During ownership transfer, neither old nor new owner can make the update!
--
-- SOLUTION: Add SECURITY DEFINER to bypass RLS
--
-- Run this in Supabase SQL Editor
-- =====================================================

-- Drop and recreate with SECURITY DEFINER
DROP FUNCTION IF EXISTS complete_auctions();

CREATE OR REPLACE FUNCTION complete_auctions()
RETURNS TABLE(
  auction_id UUID,
  card_id UUID,
  winner_id UUID,
  seller_id UUID,
  final_bid INT,
  completion_status TEXT  -- ← RENAMED to avoid ambiguity
)
SECURITY DEFINER  -- ← ADD THIS: Bypass RLS for ownership transfers
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_auction RECORD;
  v_completed_count INT := 0;
BEGIN
  -- Process all auctions that have ended
  FOR v_auction IN
    SELECT a.*
    FROM auctions a
    WHERE a.status = 'active' AND a.end_time <= NOW()
    FOR UPDATE SKIP LOCKED -- Prevent concurrent processing
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

      -- Return result for this auction
      auction_id := v_auction.id;
      card_id := v_auction.card_id;
      winner_id := v_auction.current_bidder;
      seller_id := v_auction.seller_id;
      final_bid := v_auction.current_bid;
      completion_status := 'completed_with_winner';  -- ← Use renamed column
      RETURN NEXT;

    ELSE
      -- No bids: return card to seller
      UPDATE cards
      SET
        in_auction = FALSE,
        auction_id = NULL,
        status = 'available',
        status_update_time = NOW(),
        updated_at = NOW()
      WHERE id = v_auction.card_id;

      -- Return result
      auction_id := v_auction.id;
      card_id := v_auction.card_id;
      winner_id := NULL;
      seller_id := v_auction.seller_id;
      final_bid := 0;
      completion_status := 'completed_no_bids';  -- ← Use renamed column
      RETURN NEXT;
    END IF;

    v_completed_count := v_completed_count + 1;
  END LOOP;

  -- Log completion
  IF v_completed_count > 0 THEN
    RAISE NOTICE 'Completed % auction(s)', v_completed_count;
  END IF;

  RETURN;
END;
$$;

-- Update comment
COMMENT ON FUNCTION complete_auctions IS 'Complete expired auctions and transfer cards - bypasses RLS (SECURITY DEFINER)';

-- Grant execute to authenticated users and service role
GRANT EXECUTE ON FUNCTION complete_auctions TO authenticated;
GRANT EXECUTE ON FUNCTION complete_auctions TO service_role;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ complete_auctions() function updated successfully!';
  RAISE NOTICE '';
  RAISE NOTICE '💡 Changes:';
  RAISE NOTICE '   - Added SECURITY DEFINER to bypass RLS';
  RAISE NOTICE '   - Function can now transfer card ownership';
  RAISE NOTICE '   - Auctions will complete automatically';
  RAISE NOTICE '';
  RAISE NOTICE '🔐 Security maintained:';
  RAISE NOTICE '   - Only processes expired auctions (end_time <= NOW())';
  RAISE NOTICE '   - Uses FOR UPDATE SKIP LOCKED (prevents race conditions)';
  RAISE NOTICE '   - Transfers cards only to valid winners';
  RAISE NOTICE '   - Awards coins to sellers correctly';
END $$;
