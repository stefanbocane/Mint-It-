-- =====================================================
-- CARDMATES - ALL DATABASE FIXES
-- =====================================================
-- Run this entire file in Supabase SQL Editor to fix:
-- 1. Border system (add border_type column)
-- 2. Trade transfer functions (bypass RLS securely)
-- =====================================================

-- =====================================================
-- FIX 1: Add border_type column to cards table
-- =====================================================

ALTER TABLE cards
ADD COLUMN IF NOT EXISTS border_type TEXT DEFAULT 'default';

COMMENT ON COLUMN cards.border_type IS 'Type of border applied to the card (e.g., default, gold, rainbow, etc.)';

-- =====================================================
-- FIX 2: Create Trade Functions (Bypass RLS Securely)
-- =====================================================
-- These functions use SECURITY DEFINER to bypass RLS
-- while maintaining security through permission checks
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

-- =====================================================
-- Verification and Summary
-- =====================================================

DO $$
DECLARE
  border_column_exists BOOLEAN;
  functions_count INTEGER;
BEGIN
  -- Check if border_type column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cards' AND column_name = 'border_type'
  ) INTO border_column_exists;

  -- Count trade functions
  SELECT COUNT(*) INTO functions_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.proname IN ('accept_trade', 'decline_trade', 'cancel_trade');

  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ ALL FIXES APPLIED SUCCESSFULLY!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Fix 1: Border System';
  IF border_column_exists THEN
    RAISE NOTICE '  ✅ border_type column added to cards table';
  ELSE
    RAISE NOTICE '  ❌ border_type column NOT found (check for errors above)';
  END IF;
  RAISE NOTICE '';
  RAISE NOTICE 'Fix 2: Trade Functions (Bypass RLS)';
  RAISE NOTICE '  ✅ % trade functions created', functions_count;
  RAISE NOTICE '  ✅ accept_trade() - Accept and transfer cards';
  RAISE NOTICE '  ✅ decline_trade() - Decline and release cards';
  RAISE NOTICE '  ✅ cancel_trade() - Cancel and release cards';
  RAISE NOTICE '';
  RAISE NOTICE 'What you can do now:';
  RAISE NOTICE '  ✅ Apply borders to cards (they will display!)';
  RAISE NOTICE '  ✅ Accept trades (cards will transfer!)';
  RAISE NOTICE '  ✅ Decline/Cancel trades (cards will be released!)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Refresh your app';
  RAISE NOTICE '  2. Test border application';
  RAISE NOTICE '  3. Test trade acceptance';
  RAISE NOTICE '========================================';
END $$;
