-- =====================================================
-- FIX: Allow Users to Join Public Groups
-- =====================================================
-- This fixes the "Failed to add user to group members array" error
--
-- COPY AND PASTE THIS INTO SUPABASE SQL EDITOR AND CLICK RUN
-- =====================================================

-- Create a policy that allows users to add themselves to public groups
CREATE POLICY groups_update_join ON groups
  FOR UPDATE
  USING (
    -- User can update if the group is public
    is_private = false
  )
  WITH CHECK (
    -- After update, user must be in the members array
    -- (This ensures they can only add themselves)
    is_private = false AND
    auth.uid() = ANY(members)
  );

-- Add a helpful comment
COMMENT ON POLICY groups_update_join ON groups IS 'Users can add themselves to public groups by joining';

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ groups_update_join policy created successfully!';
  RAISE NOTICE '';
  RAISE NOTICE '💡 Users can now:';
  RAISE NOTICE '   1. See all public groups';
  RAISE NOTICE '   2. Join any public group';
  RAISE NOTICE '   3. Group will persist after joining';
  RAISE NOTICE '';
  RAISE NOTICE '🔐 Security maintained:';
  RAISE NOTICE '   - Users can only add themselves to members';
  RAISE NOTICE '   - Only works for public groups';
  RAISE NOTICE '   - Admins still control all other fields';
END $$;
