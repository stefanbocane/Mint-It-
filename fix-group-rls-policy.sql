-- =====================================================
-- Fix Groups RLS Policy - Allow Discovery of Public Groups
-- =====================================================
--
-- PROBLEM: Users can only see groups they're already members of,
-- which prevents them from discovering and joining new groups.
--
-- SOLUTION: Add a policy that allows all authenticated users to
-- view public (non-private) groups for discovery and joining.
--
-- Run this in Supabase SQL Editor
-- =====================================================

-- Drop the old restrictive policy
DROP POLICY IF EXISTS groups_select_member ON groups;

-- Create two new policies:

-- 1. Members can see groups they belong to (existing functionality)
CREATE POLICY groups_select_member ON groups
  FOR SELECT
  USING (
    auth.uid() = ANY(members)
  );

-- 2. ALL authenticated users can discover public groups (NEW!)
CREATE POLICY groups_select_public ON groups
  FOR SELECT
  USING (
    is_private = false
  );

-- Add comments for documentation
COMMENT ON POLICY groups_select_member ON groups IS 'Members can read their groups';
COMMENT ON POLICY groups_select_public ON groups IS 'All authenticated users can discover public groups';

-- Verify the policies were created
DO $$
BEGIN
  RAISE NOTICE '✅ Group RLS policies updated successfully';
  RAISE NOTICE '   - Members can see their own groups';
  RAISE NOTICE '   - All users can discover public groups';
  RAISE NOTICE '';
  RAISE NOTICE '💡 Users can now:';
  RAISE NOTICE '   1. See all public groups (is_private = false)';
  RAISE NOTICE '   2. Join any public group';
  RAISE NOTICE '   3. Only see private groups they are already members of';
END $$;
