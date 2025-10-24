-- =====================================================
-- Add border_type column to cards table
-- =====================================================
-- This migration adds the border_type column to support
-- card border customization from the store
-- =====================================================

-- Add border_type column to cards table
ALTER TABLE cards
ADD COLUMN IF NOT EXISTS border_type TEXT DEFAULT 'default';

-- Add a comment to explain the column
COMMENT ON COLUMN cards.border_type IS 'Type of border applied to the card (e.g., default, gold, rainbow, etc.)';

-- Verify the column was added
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ border_type column added to cards table';
  RAISE NOTICE 'Cards can now have custom borders!';
  RAISE NOTICE '========================================';
END $$;
