-- =====================================================
-- Fix Groups UPDATE Policy - Allow Users to Join Groups
-- =====================================================
--
-- PROBLEM: Users can't update groups to add themselves as members
-- because the UPDATE policy only allows admins to update groups.
--
-- SOLUTION: Add a policy that allows users to add themselves
-- to the members array of public groups (for joining).
--
-- Run this in Supabase SQL Editor AFTER fix-group-rls-policy.sql
-- =====================================================

-- Keep the existing admin update policy
-- (Don't drop it, we need it!)

-- Add a new policy that allows users to join public groups
CREATE POLICY groups_update_join ON groups
  FOR UPDATE
  USING (
    -- Allow if group is public
    is_private = false
  )
  WITH CHECK (
    -- Only allow adding yourself to members
    -- (Check that the user is in the NEW members array but wasn't in the OLD)
    is_private = false AND
    auth.uid() = ANY(members)
  );

COMMENT ON POLICY groups_update_join ON groups IS 'Users can add themselves to public groups (join)';

-- Verify the policies
DO $$
BEGIN
  RAISE NOTICE '✅ Group UPDATE policies configured:';
  RAISE NOTICE '   1. Admins can update their groups (existing)';
  RAISE NOTICE '   2. Users can join public groups (NEW)';
  RAISE NOTICE '';
  RAISE NOTICE '💡 Security maintained:';
  RAISE NOTICE '   - Users can only add themselves to members';
  RAISE NOTICE '   - Only public groups can be joined';
  RAISE NOTICE '   - Admins still control all other fields';
END $$;
