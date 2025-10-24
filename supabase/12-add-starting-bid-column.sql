-- Migration: Add starting_bid column to auctions table
-- Date: 2025-01-23

-- Add starting_bid column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auctions' AND column_name = 'starting_bid'
  ) THEN
    ALTER TABLE auctions ADD COLUMN starting_bid INT DEFAULT 6 CHECK (starting_bid > 0);

    -- Set starting_bid = current_bid for existing auctions
    UPDATE auctions SET starting_bid = GREATEST(current_bid, 6);

    RAISE NOTICE 'Added starting_bid column to auctions table';
  ELSE
    RAISE NOTICE 'starting_bid column already exists';
  END IF;
END $$;

COMMENT ON COLUMN auctions.starting_bid IS 'Minimum bid amount for the auction (default 6 coins)';
