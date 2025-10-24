-- =====================================================
-- Add last_daily_claim column to user_sessions
-- Stores per-group last claim timestamps
-- =====================================================

-- Add column if it doesn't exist
ALTER TABLE user_sessions
ADD COLUMN IF NOT EXISTS last_daily_claim JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN user_sessions.last_daily_claim IS 'Per-group daily claim timestamps: { "group_uuid": "2025-01-23T10:30:00Z", ... }';

-- Validation
DO $$
BEGIN
  RAISE NOTICE '✅ Added last_daily_claim column to user_sessions';
  RAISE NOTICE 'Format: { "group_id": "ISO_timestamp", ... }';
END $$;
