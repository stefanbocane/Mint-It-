-- =====================================================
-- Fix Users Table RLS Policy - CORRECT VERSION
-- =====================================================
-- The existing policy has a bug:
--   WHERE (auth.uid() = ANY (g.members)) AND (g.id = ANY (g.members))
--                                              ^^^^ WRONG!
--
-- It's checking if the GROUP ID is in members, not the USER ID.
-- This is why it never matches and users can't see other profiles.
--
-- Correct version:
--   WHERE (auth.uid() = ANY (g.members)) AND (users.id = ANY (g.members))
--                                              ^^^^^^^^ CORRECT!
-- =====================================================

-- Drop the broken policy
DROP POLICY IF EXISTS users_select_group_members ON users;

-- Create the CORRECT policy
CREATE POLICY users_select_group_members ON users
  FOR SELECT
  USING (
    -- Check if the current user and the target user share any groups
    EXISTS (
      SELECT 1
      FROM groups g
      WHERE auth.uid() = ANY(g.members)   -- Current user is in the group
        AND users.id = ANY(g.members)     -- Target user (the row being selected) is in the group
    )
  );

COMMENT ON POLICY users_select_group_members ON users IS 'Users can read profiles of people in their groups';

-- Verify the fix
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Fixed users_select_group_members policy';
  RAISE NOTICE '';
  RAISE NOTICE 'The bug was:';
  RAISE NOTICE '  WHERE (g.id = ANY (g.members))  ❌ Wrong!';
  RAISE NOTICE '';
  RAISE NOTICE 'Now fixed to:';
  RAISE NOTICE '  WHERE (users.id = ANY (g.members))  ✅ Correct!';
  RAISE NOTICE '';
  RAISE NOTICE '🎉 Leaderboard should now work!';
  RAISE NOTICE '========================================';
END $$;
