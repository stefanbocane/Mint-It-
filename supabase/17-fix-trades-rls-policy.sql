-- =====================================================
-- Fix Trades Table RLS Policy
-- =====================================================
-- Ensure users can see trades they're involved in
-- =====================================================

-- Drop existing policies if any
DROP POLICY IF EXISTS trades_select_participant ON trades;
DROP POLICY IF EXISTS trades_insert_sender ON trades;
DROP POLICY IF EXISTS trades_update_participant ON trades;
DROP POLICY IF EXISTS trades_delete_participant ON trades;

-- Users can see trades they're involved in (as sender or receiver)
CREATE POLICY trades_select_participant ON trades
  FOR SELECT
  USING (
    auth.uid() = sender_id OR auth.uid() = receiver_id
  );

-- Users can create trades as the sender
CREATE POLICY trades_insert_sender ON trades
  FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
  );

-- Users can update trades they're involved in (for accepting/rejecting)
CREATE POLICY trades_update_participant ON trades
  FOR UPDATE
  USING (
    auth.uid() = sender_id OR auth.uid() = receiver_id
  );

-- Users can delete their own sent trades (cancel before acceptance)
CREATE POLICY trades_delete_participant ON trades
  FOR DELETE
  USING (
    auth.uid() = sender_id
  );

COMMENT ON POLICY trades_select_participant ON trades IS 'Users can view trades they are involved in';
COMMENT ON POLICY trades_insert_sender ON trades IS 'Users can create trades as sender';
COMMENT ON POLICY trades_update_participant ON trades IS 'Users can update trades they are involved in';
COMMENT ON POLICY trades_delete_participant ON trades IS 'Users can delete trades they sent';

-- Verify
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Trades table RLS policies configured';
  RAISE NOTICE 'Users can now:';
  RAISE NOTICE '  - View trades they sent or received';
  RAISE NOTICE '  - Create new trades';
  RAISE NOTICE '  - Accept/reject trades';
  RAISE NOTICE '  - Cancel their own sent trades';
  RAISE NOTICE '========================================';
END $$;
