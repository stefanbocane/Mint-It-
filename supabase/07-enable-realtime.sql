/**
 * Enable Supabase Realtime on Tables
 *
 * This configures Postgres LISTEN/NOTIFY for real-time subscriptions.
 * Replaces Firebase onSnapshot listeners with more efficient Realtime.
 *
 * Run this in Supabase SQL Editor after creating tables.
 */

-- Enable Realtime on auctions table
ALTER PUBLICATION supabase_realtime ADD TABLE auctions;

-- Enable Realtime on user_sessions table (for balance updates)
ALTER PUBLICATION supabase_realtime ADD TABLE user_sessions;

-- Enable Realtime on trades table
ALTER PUBLICATION supabase_realtime ADD TABLE trades;

-- Enable Realtime on posts table (social feed)
ALTER PUBLICATION supabase_realtime ADD TABLE posts;

-- Enable Realtime on cards table (for collection updates)
ALTER PUBLICATION supabase_realtime ADD TABLE cards;

-- Enable Realtime on notifications table
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Verify Realtime is enabled
SELECT
  schemaname,
  tablename
FROM
  pg_publication_tables
WHERE
  pubname = 'supabase_realtime'
ORDER BY
  tablename;

-- Expected output: auctions, cards, notifications, posts, trades, user_sessions
