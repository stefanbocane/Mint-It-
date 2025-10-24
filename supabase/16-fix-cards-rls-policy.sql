-- =====================================================
-- Fix Cards Table RLS Policy for Leaderboard
-- =====================================================
-- The current policy only allows users to read their own cards.
-- This breaks the leaderboard which needs to count cards for
-- all users in the group.
--
-- This adds a policy to allow reading cards of users in the
-- same group (for leaderboard, viewing collections, etc.)
-- =====================================================

-- Policy: Users can read cards of people in their groups
-- This allows leaderboard to count cards, and other group features
CREATE POLICY cards_select_group_members ON cards
  FOR SELECT
  USING (
    -- Check if the current user and the card owner share any groups
    EXISTS (
      SELECT 1
      FROM groups g
      WHERE auth.uid() = ANY(g.members)      -- Current user is in the group
        AND owner_id = ANY(g.members)        -- Card owner is in the group
        AND cards.group_id = g.id            -- Card belongs to this group
    )
  );

COMMENT ON POLICY cards_select_group_members ON cards IS 'Users can read cards of people in their groups';

-- Verify the policy
DO $$
DECLARE
  v_policy_count INT;
BEGIN
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'cards'
    AND cmd = 'SELECT';

  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Cards table RLS policies configured:';
  RAISE NOTICE '  - Total SELECT policies: %', v_policy_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Users can now read cards that are:';
  RAISE NOTICE '  1. Their own cards (existing policy)';
  RAISE NOTICE '  2. Cards owned by group members (new policy)';
  RAISE NOTICE '';
  RAISE NOTICE '🎉 Leaderboard should now show correct card counts!';
  RAISE NOTICE '========================================';
END $$;
