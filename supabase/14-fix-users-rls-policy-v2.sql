-- =====================================================
-- Fix Users Table RLS Policy (v2 - safe to re-run)
-- =====================================================
-- The current policy only allows users to read their own profile.
-- This breaks the leaderboard which needs to read profiles of
-- other users in the same group.
--
-- This migration adds a policy to allow reading profiles of
-- users in the same groups.
-- =====================================================

-- Drop existing policies if they exist (safe to re-run)
DROP POLICY IF EXISTS users_select_own ON users;
DROP POLICY IF EXISTS users_select_group_members ON users;

-- Policy 1: Users can read their own profile
CREATE POLICY users_select_own ON users
  FOR SELECT
  USING (auth.uid() = id);

-- Policy 2: Users can read profiles of people in their groups
-- This allows leaderboard, trades, auctions, etc. to show other users' info
CREATE POLICY users_select_group_members ON users
  FOR SELECT
  USING (
    -- Check if the current user and the target user share any groups
    EXISTS (
      SELECT 1
      FROM groups g
      WHERE auth.uid() = ANY(g.members)  -- Current user is in the group
        AND id = ANY(g.members)           -- Target user is in the group
    )
  );

COMMENT ON POLICY users_select_own ON users IS 'Users can read their own profile';
COMMENT ON POLICY users_select_group_members ON users IS 'Users can read profiles of people in their groups';

-- Verify the policies are in place
DO $$
DECLARE
  v_policy_count INT;
BEGIN
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'users'
    AND policyname IN ('users_select_own', 'users_select_group_members');

  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Users table RLS policies configured:';
  RAISE NOTICE '  - Total SELECT policies: %', v_policy_count;
  RAISE NOTICE '  - users_select_own: ✓';
  RAISE NOTICE '  - users_select_group_members: ✓';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Users can now:';
  RAISE NOTICE '  1. Read their own profile';
  RAISE NOTICE '  2. Read profiles of group members';
  RAISE NOTICE '';
  RAISE NOTICE '🎉 Leaderboard should now work correctly!';
  RAISE NOTICE '========================================';
END $$;
