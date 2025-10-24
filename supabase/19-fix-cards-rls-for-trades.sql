-- =====================================================
-- Fix Cards RLS Policy for Trade Transfers
-- =====================================================
-- Allow cards to be transferred between users during trades
-- =====================================================

-- Drop existing cards policies
DROP POLICY IF EXISTS cards_select_owner ON cards;
DROP POLICY IF EXISTS cards_select_group_member ON cards;
DROP POLICY IF EXISTS cards_insert_owner ON cards;
DROP POLICY IF EXISTS cards_update_owner ON cards;
DROP POLICY IF EXISTS cards_update_trade_transfer ON cards;
DROP POLICY IF EXISTS cards_delete_owner ON cards;

-- Users can view their own cards
CREATE POLICY cards_select_owner ON cards
  FOR SELECT
  USING (auth.uid() = owner_id);

-- Users can view cards in their groups (for trading/viewing other collections)
CREATE POLICY cards_select_group_member ON cards
  FOR SELECT
  USING (
    group_id IN (
      SELECT id FROM groups WHERE auth.uid() = ANY(members)
    )
  );

-- Users can create cards (minting)
CREATE POLICY cards_insert_owner ON cards
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

-- Users can update their own cards (apply borders, etc.)
CREATE POLICY cards_update_owner ON cards
  FOR UPDATE
  USING (auth.uid() = owner_id);

-- CRITICAL: Allow card ownership transfers during trades
-- This policy allows updating cards when:
-- 1. The card is involved in a trade (in_trade = true AND trade_id is set)
-- 2. The user is either the sender or receiver of that trade
CREATE POLICY cards_update_trade_transfer ON cards
  FOR UPDATE
  USING (
    in_trade = true
    AND trade_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM trades
      WHERE trades.id = cards.trade_id
      AND (
        trades.sender_id = auth.uid() OR
        trades.receiver_id = auth.uid()
      )
    )
  );

-- Users can delete their own cards (if needed)
CREATE POLICY cards_delete_owner ON cards
  FOR DELETE
  USING (auth.uid() = owner_id);

-- Add helpful comments
COMMENT ON POLICY cards_select_owner ON cards IS 'Users can view their own cards';
COMMENT ON POLICY cards_select_group_member ON cards IS 'Users can view cards in their groups';
COMMENT ON POLICY cards_insert_owner ON cards IS 'Users can create (mint) cards';
COMMENT ON POLICY cards_update_owner ON cards IS 'Users can update their own cards';
COMMENT ON POLICY cards_update_trade_transfer ON cards IS 'Allow card ownership transfers during trades';
COMMENT ON POLICY cards_delete_owner ON cards IS 'Users can delete their own cards';

-- Verify policies were created
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Cards RLS policies updated';
  RAISE NOTICE 'Trade transfers are now allowed!';
  RAISE NOTICE '';
  RAISE NOTICE 'Policies created:';
  RAISE NOTICE '  - cards_select_owner (view own cards)';
  RAISE NOTICE '  - cards_select_group_member (view group cards)';
  RAISE NOTICE '  - cards_insert_owner (mint cards)';
  RAISE NOTICE '  - cards_update_owner (update own cards)';
  RAISE NOTICE '  - cards_update_trade_transfer (trade transfers)';
  RAISE NOTICE '  - cards_delete_owner (delete own cards)';
  RAISE NOTICE '========================================';
END $$;
