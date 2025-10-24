-- =====================================================
-- Fix Users Table RLS Policy
-- =====================================================
-- The current policy only allows users to read their own profile.
-- This breaks the leaderboard which needs to read profiles of
-- other users in the same group.
--
-- This migration adds a policy to allow reading profiles of
-- users in the same groups.
-- =====================================================

-- Drop the existing restrictive policy
DROP POLICY IF EXISTS users_select_own ON users;

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
BEGIN
  RAISE NOTICE '✅ Users table RLS policies updated:';
  RAISE NOTICE '  - users_select_own: Users can read own profile';
  RAISE NOTICE '  - users_select_group_members: Users can read group members'' profiles';
END $$;
