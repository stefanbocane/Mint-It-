-- =====================================================
-- CardMates - Performance Indexes
-- Optimized for read-heavy workload
-- =====================================================
--
-- Index strategy:
-- - Cover common query patterns
-- - Support foreign key relationships
-- - Enable fast JOINs
-- - Optimize WHERE clauses
-- - Support ORDER BY operations
--
-- Run after: 01-schema.sql
-- =====================================================

-- =====================================================
-- USERS TABLE INDEXES
-- =====================================================

-- Email lookup (login, uniqueness)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Username lookup (profile, @mentions)
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Last active group (for filtering users by group)
CREATE INDEX IF NOT EXISTS idx_users_last_active_group ON users(last_active_group)
  WHERE last_active_group IS NOT NULL;

-- XP and level for leaderboards (composite for sorting)
CREATE INDEX IF NOT EXISTS idx_users_xp_level ON users(xp DESC, level DESC);

-- Firebase UID lookup (migration mapping)
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid)
  WHERE firebase_uid IS NOT NULL;

-- =====================================================
-- USER SESSIONS TABLE INDEXES
-- =====================================================

-- Primary key is user_id, so no additional indexes needed
-- JSONB gin indexes for balance lookups
CREATE INDEX IF NOT EXISTS idx_user_sessions_group_balances ON user_sessions USING GIN(group_balances);
CREATE INDEX IF NOT EXISTS idx_user_sessions_group_gems ON user_sessions USING GIN(group_gems);

-- =====================================================
-- GROUPS TABLE INDEXES
-- =====================================================

-- Group code lookup (joining groups)
CREATE INDEX IF NOT EXISTS idx_groups_code ON groups(code)
  WHERE code IS NOT NULL;

-- Created by (owner's groups)
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups(created_by);

-- Members array (GIN for "user in members" queries)
CREATE INDEX IF NOT EXISTS idx_groups_members ON groups USING GIN(members);

-- Created date (sorting)
CREATE INDEX IF NOT EXISTS idx_groups_created_at ON groups(created_at DESC);

-- =====================================================
-- CARDS TABLE INDEXES
-- =====================================================

-- Owner and group (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_cards_owner_group ON cards(owner_id, group_id);

-- Owner, group, and status (with available cards)
CREATE INDEX IF NOT EXISTS idx_cards_owner_group_status ON cards(owner_id, group_id, status)
  WHERE status != 'deleted';

-- Group (all cards in a group)
CREATE INDEX IF NOT EXISTS idx_cards_group ON cards(group_id)
  WHERE status != 'deleted';

-- Auction reference (cards in auction)
CREATE INDEX IF NOT EXISTS idx_cards_auction ON cards(auction_id)
  WHERE auction_id IS NOT NULL;

-- Trade reference (cards in trade)
CREATE INDEX IF NOT EXISTS idx_cards_trade ON cards(trade_id)
  WHERE trade_id IS NOT NULL;

-- Rarity (filtering by rarity)
CREATE INDEX IF NOT EXISTS idx_cards_rarity ON cards(rarity);

-- Name (sorting alphabetically)
CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);

-- Minted date (recent cards)
CREATE INDEX IF NOT EXISTS idx_cards_minted_at ON cards(minted_at DESC);

-- =====================================================
-- AUCTIONS TABLE INDEXES
-- =====================================================

-- Group and status (active auctions in group)
CREATE INDEX IF NOT EXISTS idx_auctions_group_status ON auctions(group_id, status)
  WHERE status = 'active';

-- Group, status, and end time (active auctions sorted by ending soon)
CREATE INDEX IF NOT EXISTS idx_auctions_group_status_end ON auctions(group_id, status, end_time ASC)
  WHERE status = 'active';

-- End time for active auctions (auction completion job)
CREATE INDEX IF NOT EXISTS idx_auctions_end_time_active ON auctions(end_time ASC)
  WHERE status = 'active';

-- Seller (seller's auctions)
CREATE INDEX IF NOT EXISTS idx_auctions_seller ON auctions(seller_id);

-- Card (unique constraint, but index helps lookups)
CREATE INDEX IF NOT EXISTS idx_auctions_card ON auctions(card_id);

-- Current bidder (user's active bids)
CREATE INDEX IF NOT EXISTS idx_auctions_current_bidder ON auctions(current_bidder)
  WHERE current_bidder IS NOT NULL;

-- Created date (recent auctions)
CREATE INDEX IF NOT EXISTS idx_auctions_created_at ON auctions(created_at DESC);

-- =====================================================
-- BIDS TABLE INDEXES
-- =====================================================

-- Auction (all bids for an auction, sorted by time)
CREATE INDEX IF NOT EXISTS idx_bids_auction_created ON bids(auction_id, created_at DESC);

-- Bidder (user's bid history)
CREATE INDEX IF NOT EXISTS idx_bids_bidder ON bids(bidder_id, created_at DESC);

-- Bidder and auction (check if user bid on auction)
CREATE INDEX IF NOT EXISTS idx_bids_bidder_auction ON bids(bidder_id, auction_id);

-- =====================================================
-- TRADES TABLE INDEXES
-- =====================================================

-- Group and status (active trades in group)
CREATE INDEX IF NOT EXISTS idx_trades_group_status ON trades(group_id, status)
  WHERE status IN ('pending', 'offered', 'active');

-- Group, status, created (sorted trades)
CREATE INDEX IF NOT EXISTS idx_trades_group_status_created ON trades(group_id, status, created_at DESC);

-- Sender (user's sent trades)
CREATE INDEX IF NOT EXISTS idx_trades_sender ON trades(sender_id, created_at DESC);

-- Receiver (user's received trades)
CREATE INDEX IF NOT EXISTS idx_trades_receiver ON trades(receiver_id, created_at DESC);

-- Participants array (GIN for "user in participants" queries)
CREATE INDEX IF NOT EXISTS idx_trades_participants ON trades USING GIN(participant_ids);

-- Offered cards (GIN for "card in trade" queries)
CREATE INDEX IF NOT EXISTS idx_trades_offered_cards ON trades USING GIN(offered_cards);

-- Requested cards (GIN for "card in trade" queries)
CREATE INDEX IF NOT EXISTS idx_trades_requested_cards ON trades USING GIN(requested_cards);

-- =====================================================
-- POSTS TABLE INDEXES
-- =====================================================

-- Group and created (recent posts in group)
CREATE INDEX IF NOT EXISTS idx_posts_group_created ON posts(group_id, created_at DESC);

-- Author (user's posts)
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, created_at DESC);

-- Liked by array (GIN for "user liked post" queries)
CREATE INDEX IF NOT EXISTS idx_posts_liked_by ON posts USING GIN(liked_by);

-- Text search (full-text search on post content)
CREATE INDEX IF NOT EXISTS idx_posts_text_search ON posts USING GIN(to_tsvector('english', text));

-- =====================================================
-- SETS TABLE INDEXES
-- =====================================================

-- Name (unique, but index helps lookups)
CREATE INDEX IF NOT EXISTS idx_sets_name ON sets(name);

-- Created date
CREATE INDEX IF NOT EXISTS idx_sets_created_at ON sets(created_at DESC);

-- =====================================================
-- SET PROGRESS TABLE INDEXES
-- =====================================================

-- User (user's progress across all sets)
CREATE INDEX IF NOT EXISTS idx_set_progress_user ON set_progress(user_id);

-- Set (all users' progress on a set)
CREATE INDEX IF NOT EXISTS idx_set_progress_set ON set_progress(set_id);

-- Cards owned (GIN for "card in progress" queries)
CREATE INDEX IF NOT EXISTS idx_set_progress_cards_owned ON set_progress USING GIN(cards_owned);

-- Completion percentage (leaderboards)
CREATE INDEX IF NOT EXISTS idx_set_progress_completion ON set_progress(completion_percentage DESC);

-- =====================================================
-- SET COMPLETIONS TABLE INDEXES
-- =====================================================

-- User (user's completed sets)
CREATE INDEX IF NOT EXISTS idx_set_completions_user ON set_completions(user_id, completed_at DESC);

-- Set (users who completed a set)
CREATE INDEX IF NOT EXISTS idx_set_completions_set ON set_completions(set_id, completed_at DESC);

-- Unclaimed rewards
CREATE INDEX IF NOT EXISTS idx_set_completions_unclaimed ON set_completions(user_id, reward_claimed)
  WHERE reward_claimed = FALSE;

-- =====================================================
-- NOTIFICATIONS TABLE INDEXES
-- =====================================================

-- User and read status (unread notifications)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read, created_at DESC)
  WHERE read = FALSE;

-- User (all notifications, sorted by date)
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- Type (filtering by notification type)
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- =====================================================
-- COMPOSITE INDEXES FOR COMPLEX QUERIES
-- =====================================================

-- Cards owned by user in group, sorted by name, excluding deleted
CREATE INDEX IF NOT EXISTS idx_cards_user_group_name ON cards(owner_id, group_id, name)
  WHERE status != 'deleted';

-- Active auctions in group, sorted by end time
CREATE INDEX IF NOT EXISTS idx_auctions_active_group_end ON auctions(group_id, end_time)
  WHERE status = 'active';

-- User's active trades as sender
CREATE INDEX IF NOT EXISTS idx_trades_sender_active ON trades(sender_id, status, created_at DESC)
  WHERE status IN ('pending', 'offered', 'active');

-- User's active trades as receiver
CREATE INDEX IF NOT EXISTS idx_trades_receiver_active ON trades(receiver_id, status, created_at DESC)
  WHERE status IN ('pending', 'offered', 'active');

-- =====================================================
-- PARTIAL INDEXES (for specific conditions)
-- =====================================================

-- Only index active auctions (can't use NOW() in index predicate - not immutable)
CREATE INDEX IF NOT EXISTS idx_auctions_active_only ON auctions(group_id, end_time)
  WHERE status = 'active';

-- Only index available cards
CREATE INDEX IF NOT EXISTS idx_cards_available ON cards(owner_id, group_id)
  WHERE status = 'available';

-- Only index unread notifications
CREATE INDEX IF NOT EXISTS idx_notifications_unread_only ON notifications(user_id, created_at DESC)
  WHERE read = FALSE;

-- =====================================================
-- GIN INDEXES FOR ARRAY/JSONB OPERATIONS
-- =====================================================

-- Already created above, but listing here for reference:
-- - idx_groups_members (GIN on members array)
-- - idx_user_sessions_group_balances (GIN on group_balances JSONB)
-- - idx_user_sessions_group_gems (GIN on group_gems JSONB)
-- - idx_trades_participants (GIN on participant_ids array)
-- - idx_trades_offered_cards (GIN on offered_cards array)
-- - idx_trades_requested_cards (GIN on requested_cards array)
-- - idx_posts_liked_by (GIN on liked_by array)
-- - idx_set_progress_cards_owned (GIN on cards_owned array)

-- =====================================================
-- TEXT SEARCH INDEXES
-- =====================================================

-- Full-text search on posts
-- (Already created above: idx_posts_text_search)

-- Username search (trigram for fuzzy matching)
CREATE INDEX IF NOT EXISTS idx_users_username_trgm ON users USING GIN(username gin_trgm_ops);

-- Card name search (trigram for fuzzy matching)
CREATE INDEX IF NOT EXISTS idx_cards_name_trgm ON cards USING GIN(name gin_trgm_ops);

-- Group name search (trigram)
CREATE INDEX IF NOT EXISTS idx_groups_name_trgm ON groups USING GIN(name gin_trgm_ops);

-- =====================================================
-- ANALYZE FOR QUERY PLANNER
-- =====================================================

-- Update statistics for query planner
ANALYZE users;
ANALYZE user_sessions;
ANALYZE groups;
ANALYZE cards;
ANALYZE auctions;
ANALYZE bids;
ANALYZE trades;
ANALYZE posts;
ANALYZE sets;
ANALYZE set_progress;
ANALYZE set_completions;
ANALYZE notifications;

-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  v_index_count INT;
BEGIN
  SELECT COUNT(*) INTO v_index_count
  FROM pg_indexes
  WHERE schemaname = 'public';

  RAISE NOTICE '✅ Performance indexes created successfully';
  RAISE NOTICE 'Total indexes in public schema: %', v_index_count;
  RAISE NOTICE 'Indexes optimized for:';
  RAISE NOTICE '  - User/group/card ownership queries';
  RAISE NOTICE '  - Auction bidding and completion';
  RAISE NOTICE '  - Trade management';
  RAISE NOTICE '  - Social feed and posts';
  RAISE NOTICE '  - Array and JSONB operations';
  RAISE NOTICE '  - Full-text search';
END $$;
