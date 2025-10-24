-- =====================================================
-- Trade Acceptance Function (Bypasses RLS)
-- =====================================================
-- This function runs with SECURITY DEFINER privileges
-- to bypass RLS and properly transfer card ownership
-- =====================================================

-- Drop function if exists
DROP FUNCTION IF EXISTS accept_trade(UUID);

-- Create function to accept a trade
CREATE OR REPLACE FUNCTION accept_trade(trade_id_param UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER -- Run with elevated privileges to bypass RLS
AS $$
DECLARE
  trade_record RECORD;
  card_record RECORD;
  result JSON;
  cards_transferred INTEGER := 0;
  row_count_temp INTEGER;
BEGIN
  -- Get the trade details
  SELECT * INTO trade_record
  FROM trades
  WHERE id = trade_id_param;

  -- Verify trade exists
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Trade not found'
    );
  END IF;

  -- Verify trade is pending/active
  IF trade_record.status NOT IN ('pending', 'active') THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Trade is not in pending/active status'
    );
  END IF;

  -- Verify the current user is the receiver
  IF trade_record.receiver_id != auth.uid() THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Only the receiver can accept this trade'
    );
  END IF;

  -- Update trade status to completed
  UPDATE trades
  SET status = 'completed',
      updated_at = NOW()
  WHERE id = trade_id_param;

  -- Transfer offered cards to receiver (from sender to receiver)
  IF trade_record.offered_cards IS NOT NULL AND array_length(trade_record.offered_cards, 1) > 0 THEN
    UPDATE cards
    SET owner_id = trade_record.receiver_id,
        in_trade = false,
        trade_id = NULL,
        status = 'available',
        updated_at = NOW()
    WHERE id = ANY(trade_record.offered_cards);

    GET DIAGNOSTICS row_count_temp = ROW_COUNT;
    cards_transferred := row_count_temp;
  END IF;

  -- Transfer requested cards to sender (from receiver to sender)
  IF trade_record.requested_cards IS NOT NULL AND array_length(trade_record.requested_cards, 1) > 0 THEN
    UPDATE cards
    SET owner_id = trade_record.sender_id,
        in_trade = false,
        trade_id = NULL,
        status = 'available',
        updated_at = NOW()
    WHERE id = ANY(trade_record.requested_cards);

    GET DIAGNOSTICS row_count_temp = ROW_COUNT;
    cards_transferred := cards_transferred + row_count_temp;
  END IF;

  -- Return success
  RETURN json_build_object(
    'success', true,
    'trade_id', trade_id_param,
    'cards_transferred', cards_transferred,
    'sender_id', trade_record.sender_id,
    'receiver_id', trade_record.receiver_id
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Return error
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION accept_trade(UUID) TO authenticated;

-- Add comment
COMMENT ON FUNCTION accept_trade(UUID) IS 'Accept a trade and transfer card ownership (bypasses RLS with SECURITY DEFINER)';

-- =====================================================
-- Create similar functions for decline and cancel
-- =====================================================

-- Drop functions if exist
DROP FUNCTION IF EXISTS decline_trade(UUID);
DROP FUNCTION IF EXISTS cancel_trade(UUID);

-- Decline trade function
CREATE OR REPLACE FUNCTION decline_trade(trade_id_param UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  trade_record RECORD;
BEGIN
  -- Get the trade details
  SELECT * INTO trade_record
  FROM trades
  WHERE id = trade_id_param;

  -- Verify trade exists
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Trade not found');
  END IF;

  -- Verify the current user is the receiver
  IF trade_record.receiver_id != auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'Only the receiver can decline this trade');
  END IF;

  -- Update trade status
  UPDATE trades
  SET status = 'rejected',
      updated_at = NOW()
  WHERE id = trade_id_param;

  -- Release all cards from trade
  UPDATE cards
  SET in_trade = false,
      trade_id = NULL,
      status = 'available',
      updated_at = NOW()
  WHERE id = ANY(trade_record.offered_cards)
     OR id = ANY(trade_record.requested_cards);

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
  -- Get the trade details
  SELECT * INTO trade_record
  FROM trades
  WHERE id = trade_id_param;

  -- Verify trade exists
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Trade not found');
  END IF;

  -- Verify the current user is the sender
  IF trade_record.sender_id != auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'Only the sender can cancel this trade');
  END IF;

  -- Update trade status
  UPDATE trades
  SET status = 'canceled',
      updated_at = NOW()
  WHERE id = trade_id_param;

  -- Release all cards from trade
  UPDATE cards
  SET in_trade = false,
      trade_id = NULL,
      status = 'available',
      updated_at = NOW()
  WHERE id = ANY(trade_record.offered_cards)
     OR id = ANY(trade_record.requested_cards);

  RETURN json_build_object('success', true, 'trade_id', trade_id_param);

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION decline_trade(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_trade(UUID) TO authenticated;

-- Add comments
COMMENT ON FUNCTION decline_trade(UUID) IS 'Decline a trade and release cards (bypasses RLS)';
COMMENT ON FUNCTION cancel_trade(UUID) IS 'Cancel a trade and release cards (bypasses RLS)';

-- Verify
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Trade functions created successfully!';
  RAISE NOTICE '';
  RAISE NOTICE 'Functions available:';
  RAISE NOTICE '  - accept_trade(trade_id)';
  RAISE NOTICE '  - decline_trade(trade_id)';
  RAISE NOTICE '  - cancel_trade(trade_id)';
  RAISE NOTICE '';
  RAISE NOTICE 'These functions bypass RLS using SECURITY DEFINER';
  RAISE NOTICE 'and properly handle all card ownership transfers.';
  RAISE NOTICE '========================================';
END $$;
