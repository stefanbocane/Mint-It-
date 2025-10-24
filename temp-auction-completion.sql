-- =====================================================
-- AUCTION COMPLETION FUNCTION
-- Processes expired auctions and transfers cards
-- =====================================================

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS complete_auctions();

CREATE OR REPLACE FUNCTION complete_auctions()
RETURNS TABLE(
  auction_id UUID,
  card_id UUID,
  winner_id UUID,
  seller_id UUID,
  final_bid INT,
  result_status TEXT
) AS $$
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

      -- Update card ownership
      UPDATE cards
      SET
        owner_id = v_auction.current_bidder,
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

      -- Return completed auction info
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

      -- Return completed auction info (no winner)
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

GRANT EXECUTE ON FUNCTION complete_auctions TO authenticated;

COMMENT ON FUNCTION complete_auctions IS 'Process all expired auctions: transfer cards, pay sellers, update status';

-- Validation
DO $$
BEGIN
  RAISE NOTICE '✅ Auction completion function created';
  RAISE NOTICE 'Call with: SELECT * FROM complete_auctions();';
END $$;
