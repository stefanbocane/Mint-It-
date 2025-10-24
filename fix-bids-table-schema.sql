-- =====================================================
-- Fix Bids Table Schema - Add group_id Column
-- =====================================================
--
-- PROBLEM: process_bid() tries to insert group_id into bids table
-- but the column doesn't exist
--
-- ERROR: column "group_id" of relation "bids" does not exist
--
-- SOLUTION: Add group_id column to bids table with proper FK
--
-- Run this in Supabase SQL Editor AFTER fix-auction-bidding.sql
-- =====================================================

-- Add group_id column to bids table
ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE RESTRICT;

-- Add index for querying bids by group
CREATE INDEX IF NOT EXISTS idx_bids_group_id ON bids(group_id);

-- Update the RLS policy to use the new column
-- (The existing policy checks via auction, but we can optimize with direct group_id)
DROP POLICY IF EXISTS bids_select_group_member ON bids;

CREATE POLICY bids_select_group_member ON bids
  FOR SELECT
  USING (
    -- Can see bids in groups you're a member of
    group_id IN (
      SELECT id FROM groups WHERE auth.uid() = ANY(members)
    )
  );

-- Update existing bids with group_id from their auctions
-- (In case there's existing data)
UPDATE bids
SET group_id = auctions.group_id
FROM auctions
WHERE bids.auction_id = auctions.id
  AND bids.group_id IS NULL;

-- Make group_id NOT NULL now that we've backfilled
ALTER TABLE bids
  ALTER COLUMN group_id SET NOT NULL;

-- Update comments
COMMENT ON COLUMN bids.group_id IS 'Group context for the bid (denormalized from auction)';
COMMENT ON POLICY bids_select_group_member ON bids IS 'Group members can read all bids in their groups';

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ bids table schema updated successfully!';
  RAISE NOTICE '';
  RAISE NOTICE '💡 Changes:';
  RAISE NOTICE '   - Added group_id column to bids table';
  RAISE NOTICE '   - Added index on group_id';
  RAISE NOTICE '   - Updated RLS policy for better performance';
  RAISE NOTICE '   - Backfilled existing bids (if any)';
  RAISE NOTICE '';
  RAISE NOTICE '🎯 Next: Users can now place bids successfully!';
END $$;
