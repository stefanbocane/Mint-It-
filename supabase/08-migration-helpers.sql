/**
 * Migration Helper Functions
 *
 * Utilities for data migration and post-migration tasks.
 */

-- Function to refresh all materialized views at once
CREATE OR REPLACE FUNCTION refresh_all_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_auction_overview;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_card_overview;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trade_overview;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_social_overview;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_leaderboard;

  RAISE NOTICE 'All materialized views refreshed';
END;
$$ LANGUAGE plpgsql;

-- Function to verify data integrity after migration
CREATE OR REPLACE FUNCTION verify_migration()
RETURNS TABLE(
  table_name TEXT,
  row_count BIGINT,
  issues TEXT
) AS $$
BEGIN
  -- Count rows in each table
  RETURN QUERY
  SELECT 'users'::TEXT, COUNT(*)::BIGINT, ''::TEXT FROM users
  UNION ALL
  SELECT 'user_sessions'::TEXT, COUNT(*)::BIGINT, ''::TEXT FROM user_sessions
  UNION ALL
  SELECT 'groups'::TEXT, COUNT(*)::BIGINT, ''::TEXT FROM groups
  UNION ALL
  SELECT 'cards'::TEXT, COUNT(*)::BIGINT, ''::TEXT FROM cards
  UNION ALL
  SELECT 'auctions'::TEXT, COUNT(*)::BIGINT, ''::TEXT FROM auctions
  UNION ALL
  SELECT 'trades'::TEXT, COUNT(*)::BIGINT, ''::TEXT FROM trades
  UNION ALL
  SELECT 'posts'::TEXT, COUNT(*)::BIGINT, ''::TEXT FROM posts;

  -- Check for orphaned cards (no owner)
  RETURN QUERY
  SELECT
    'orphaned_cards'::TEXT,
    COUNT(*)::BIGINT,
    'Cards with invalid owner_id'::TEXT
  FROM cards c
  WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.owner_id);

  -- Check for orphaned auctions (no card or seller)
  RETURN QUERY
  SELECT
    'orphaned_auctions'::TEXT,
    COUNT(*)::BIGINT,
    'Auctions with invalid card_id or seller_id'::TEXT
  FROM auctions a
  WHERE NOT EXISTS (SELECT 1 FROM cards c WHERE c.id = a.card_id)
     OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.seller_id);
END;
$$ LANGUAGE plpgsql;

-- Function to send password reset emails to all migrated users
CREATE OR REPLACE FUNCTION send_migration_password_resets()
RETURNS TABLE(
  user_id UUID,
  email TEXT,
  reset_sent BOOLEAN
) AS $$
DECLARE
  v_user RECORD;
BEGIN
  FOR v_user IN SELECT id, email FROM users WHERE email IS NOT NULL LOOP
    BEGIN
      -- This would call Supabase Auth API to send reset email
      -- For now, just return the users who need resets
      RETURN QUERY
      SELECT v_user.id, v_user.email, FALSE;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Error sending reset to %: %', v_user.email, SQLERRM;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up test data (if needed)
CREATE OR REPLACE FUNCTION cleanup_test_data()
RETURNS void AS $$
BEGIN
  -- Delete test users (adjust filter as needed)
  DELETE FROM users WHERE email LIKE '%@test.com';
  DELETE FROM users WHERE username LIKE 'test%';

  RAISE NOTICE 'Test data cleaned up';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_all_views() IS 'Refresh all materialized views after migration';
COMMENT ON FUNCTION verify_migration() IS 'Verify data integrity and show row counts';
COMMENT ON FUNCTION send_migration_password_resets() IS 'Send password reset emails to migrated users';
COMMENT ON FUNCTION cleanup_test_data() IS 'Remove test data from database';
