-- =====================================================
-- CardMates - Materialized Views
-- Replace Firebase "overview documents" pattern
-- =====================================================
--
-- Materialized views provide pre-computed aggregations
-- that can be refreshed on-demand or via triggers.
--
-- Benefits vs Firebase overview docs:
-- - Automatic refresh via triggers (no Cloud Functions)
-- - CONCURRENTLY refresh (no read locks)
-- - Built-in indexing for fast lookups
-- - SQL query flexibility
--
-- Run after: 01-schema.sql, 02-functions.sql
-- =====================================================

-- =====================================================
-- AUCTION OVERVIEW
-- Replaces: auctionOverviews/{groupId}
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_auction_overview AS
SELECT
  group_id,
  jsonb_agg(
    jsonb_build_object(
      'id', id,
      'cardName', card_name,
      'cardImageUrl', card_image_url,
      'currentBid', current_bid,
      'currentBidder', current_bidder,
      'currentBidderName', current_bidder_name,
      'endTime', end_time,
      'status', status,
      'sellerId', seller_id,
      'sellerUsername', seller_username,
      'sellerAvatarUrl', seller_avatar_url,
      'currentRarity', current_rarity,
      'uniqueBidderCount', unique_bidder_count,
      'lastBidTime', last_bid_time
    ) ORDER BY end_time ASC
  ) AS auctions,
  COUNT(*) AS auction_count,
  NOW() AS updated_at
FROM auctions
WHERE status = 'active' AND end_time > NOW() -- Only active, non-expired auctions
GROUP BY group_id;

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_auction_overview_group_id
  ON mv_auction_overview (group_id);

COMMENT ON MATERIALIZED VIEW mv_auction_overview IS 'Aggregated auction data per group - replaces Firebase auctionOverviews collection';

-- =====================================================
-- CARD OVERVIEW
-- Replaces: cardOverviews/{groupId}_{userId}
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_card_overview AS
SELECT
  group_id || '_' || owner_id AS id,
  group_id,
  owner_id,
  jsonb_agg(
    jsonb_build_object(
      'id', id,
      'name', name,
      'rarity', rarity,
      'status', status,
      'imageUrl', image_url,
      'inTrade', in_trade,
      'inAuction', in_auction,
      'updatedAt', updated_at,
      'createdAt', created_at,
      'mintedAt', minted_at
    ) ORDER BY name ASC
  ) AS cards,
  COUNT(*) AS card_count,
  NOW() AS updated_at
FROM cards
WHERE status != 'deleted' -- Exclude deleted cards
GROUP BY group_id, owner_id;

-- Unique index on composite key
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_card_overview_id
  ON mv_card_overview (id);

-- Additional index for group lookups
CREATE INDEX IF NOT EXISTS idx_mv_card_overview_group_owner
  ON mv_card_overview (group_id, owner_id);

COMMENT ON MATERIALIZED VIEW mv_card_overview IS 'Aggregated card data per user per group - replaces Firebase cardOverviews collection';

-- =====================================================
-- TRADE OVERVIEW
-- Replaces: tradeOverviews/{groupId}
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_trade_overview AS
SELECT
  group_id,
  jsonb_agg(
    jsonb_build_object(
      'id', id,
      'senderId', sender_id,
      'senderName', sender_name,
      'senderAvatar', sender_avatar,
      'receiverId', receiver_id,
      'receiverName', receiver_name,
      'receiverAvatar', receiver_avatar,
      'status', status,
      'offeredCards', offered_cards,
      'requestedCards', requested_cards,
      'createdAt', created_at,
      'updatedAt', updated_at
    ) ORDER BY created_at DESC
  ) AS trades,
  COUNT(*) AS trade_count,
  NOW() AS updated_at
FROM trades
WHERE status IN ('pending', 'offered', 'active') -- Only active trades
GROUP BY group_id;

-- Unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_trade_overview_group_id
  ON mv_trade_overview (group_id);

COMMENT ON MATERIALIZED VIEW mv_trade_overview IS 'Aggregated trade data per group - replaces Firebase tradeOverviews collection';

-- =====================================================
-- SOCIAL OVERVIEW (FEED)
-- Replaces: socialOverviews/{groupId}
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_social_overview AS
SELECT
  group_id,
  jsonb_agg(
    jsonb_build_object(
      'id', id,
      'text', text,
      'authorId', author_id,
      'authorName', author_name,
      'authorAvatar', author_avatar,
      'imageUrl', image_url,
      'createdAt', created_at,
      'likes', likes,
      'likedBy', liked_by,
      'commentCount', comment_count
    ) ORDER BY created_at DESC
  ) AS posts,
  COUNT(*) AS post_count,
  NOW() AS updated_at
FROM (
  SELECT *
  FROM posts
  ORDER BY created_at DESC
  LIMIT 50 -- Match Firebase function limit (50 most recent posts)
) recent_posts
GROUP BY group_id;

-- Unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_social_overview_group_id
  ON mv_social_overview (group_id);

COMMENT ON MATERIALIZED VIEW mv_social_overview IS 'Aggregated social posts per group (50 most recent) - replaces Firebase socialOverviews collection';

-- =====================================================
-- LEADERBOARD OVERVIEW
-- Replaces: leaderboard/{groupId}
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_leaderboard AS
SELECT
  g.id AS group_id,
  jsonb_agg(
    jsonb_build_object(
      'userId', u.id,
      'displayName', COALESCE(u.display_name, u.username, 'User'),
      'avatarUrl', u.avatar_url,
      'xp', u.xp,
      'level', u.level,
      'coins', COALESCE((us.group_balances->>g.id::text)::int, 0)
    ) ORDER BY u.xp DESC, u.level DESC
  ) AS entries,
  COUNT(*) AS member_count,
  NOW() AS updated_at
FROM groups g
JOIN LATERAL unnest(g.members) WITH ORDINALITY AS member_id ON TRUE
JOIN users u ON u.id = member_id
LEFT JOIN user_sessions us ON us.user_id = u.id
GROUP BY g.id;

-- Unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_leaderboard_group_id
  ON mv_leaderboard (group_id);

COMMENT ON MATERIALIZED VIEW mv_leaderboard IS 'Leaderboard rankings per group - replaces Firebase leaderboard collection';

-- =====================================================
-- AUTOMATIC REFRESH TRIGGERS
-- =====================================================

-- Trigger function to refresh auction overview
CREATE OR REPLACE FUNCTION refresh_auction_overview()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_auction_overview;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger on auctions table changes
CREATE TRIGGER trg_refresh_auction_overview
AFTER INSERT OR UPDATE OR DELETE ON auctions
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_auction_overview();

COMMENT ON FUNCTION refresh_auction_overview IS 'Automatically refresh auction overview when auctions change';

-- Trigger function to refresh card overview
CREATE OR REPLACE FUNCTION refresh_card_overview()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_card_overview;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger on cards table changes
CREATE TRIGGER trg_refresh_card_overview
AFTER INSERT OR UPDATE OR DELETE ON cards
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_card_overview();

COMMENT ON FUNCTION refresh_card_overview IS 'Automatically refresh card overview when cards change';

-- Trigger function to refresh trade overview
CREATE OR REPLACE FUNCTION refresh_trade_overview()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trade_overview;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger on trades table changes
CREATE TRIGGER trg_refresh_trade_overview
AFTER INSERT OR UPDATE OR DELETE ON trades
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_trade_overview();

COMMENT ON FUNCTION refresh_trade_overview IS 'Automatically refresh trade overview when trades change';

-- Trigger function to refresh social overview
CREATE OR REPLACE FUNCTION refresh_social_overview()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_social_overview;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger on posts table changes
CREATE TRIGGER trg_refresh_social_overview
AFTER INSERT OR UPDATE OR DELETE ON posts
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_social_overview();

COMMENT ON FUNCTION refresh_social_overview IS 'Automatically refresh social overview when posts change';

-- Trigger function to refresh leaderboard
-- Note: Leaderboard refreshes on user XP/level changes, not balance changes (for performance)
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_leaderboard;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger on users table changes (XP, level)
CREATE TRIGGER trg_refresh_leaderboard
AFTER UPDATE OF xp, level ON users
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_leaderboard();

-- Trigger on group membership changes
CREATE TRIGGER trg_refresh_leaderboard_on_group_change
AFTER UPDATE OF members ON groups
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_leaderboard();

COMMENT ON FUNCTION refresh_leaderboard IS 'Automatically refresh leaderboard when user XP/level or group membership changes';

-- =====================================================
-- MANUAL REFRESH FUNCTION (FOR MAINTENANCE)
-- =====================================================

CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS TABLE(view_name TEXT, refreshed_at TIMESTAMPTZ) AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_auction_overview;
  RETURN QUERY SELECT 'mv_auction_overview'::TEXT, NOW();

  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_card_overview;
  RETURN QUERY SELECT 'mv_card_overview'::TEXT, NOW();

  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trade_overview;
  RETURN QUERY SELECT 'mv_trade_overview'::TEXT, NOW();

  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_social_overview;
  RETURN QUERY SELECT 'mv_social_overview'::TEXT, NOW();

  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_leaderboard;
  RETURN QUERY SELECT 'mv_leaderboard'::TEXT, NOW();

  RAISE NOTICE 'All materialized views refreshed successfully';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_all_materialized_views IS 'Manually refresh all materialized views (for maintenance)';

-- =====================================================
-- INITIAL DATA POPULATION
-- =====================================================

-- Refresh all views after schema creation
DO $$
BEGIN
  RAISE NOTICE 'Performing initial refresh of all materialized views...';
  PERFORM refresh_all_materialized_views();
  RAISE NOTICE 'Initial refresh complete';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Initial refresh failed (expected if tables are empty): %', SQLERRM;
END $$;
