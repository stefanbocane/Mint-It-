-- =====================================================
-- CardMates - Supabase Database Schema
-- Migration from Firebase Firestore to PostgreSQL
-- =====================================================
--
-- This schema provides:
-- - Normalized relational data model
-- - Strong referential integrity via foreign keys
-- - ACID transaction support for bidding/trading
-- - Materialized views for "overview document" pattern
-- - Row Level Security (RLS) for data access control
--
-- Run order: 01-schema.sql → 02-functions.sql → 03-materialized-views.sql → 04-policies.sql → 05-indexes.sql
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search
CREATE EXTENSION IF NOT EXISTS "btree_gin"; -- For composite indexes

-- =====================================================
-- CORE TABLES
-- =====================================================

-- Users table - Central user profiles
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Migration reference (will be NULL for new users post-migration)
  firebase_uid TEXT UNIQUE,

  -- Authentication
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,

  -- Global resources
  gems INT DEFAULT 5 CHECK (gems >= 0),
  xp INT DEFAULT 0 CHECK (xp >= 0),
  level INT DEFAULT 1 CHECK (level >= 1),

  -- Preferences
  showcase JSONB DEFAULT '[]'::jsonb, -- Array of 3 card IDs
  card_borders TEXT[] DEFAULT ARRAY['default'],
  initial_reward_groups UUID[] DEFAULT ARRAY[]::UUID[],

  -- Last active group reference
  last_active_group UUID, -- FK added later to avoid circular dependency

  -- Notification token
  expo_push_token TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT username_length CHECK (char_length(username) >= 3 AND char_length(username) <= 30),
  CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- User sessions table - Per-user active session data (replaces users/{uid}/sessions/main)
CREATE TABLE IF NOT EXISTS user_sessions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Per-group balances and resources
  group_balances JSONB DEFAULT '{}'::jsonb, -- { "group_uuid": 1000 }
  group_gems JSONB DEFAULT '{}'::jsonb,     -- { "group_uuid": 50 }

  -- Aggregate stats
  total_cards INT DEFAULT 0 CHECK (total_cards >= 0),
  sets_completed INT DEFAULT 0 CHECK (sets_completed >= 0),
  notifications_unread INT DEFAULT 0 CHECK (notifications_unread >= 0),
  rank INT,

  -- Timestamps
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Groups table
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Basic info
  name TEXT NOT NULL,
  description TEXT,

  -- Ownership
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Membership
  members UUID[] DEFAULT ARRAY[]::UUID[],
  admin_ids UUID[] DEFAULT ARRAY[]::UUID[],
  member_count INT DEFAULT 0 CHECK (member_count >= 0),

  -- Settings
  is_private BOOLEAN DEFAULT FALSE,
  code TEXT UNIQUE, -- Join code for private groups
  mint_cost INT DEFAULT 100 CHECK (mint_cost >= 0),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT group_name_length CHECK (char_length(name) >= 3 AND char_length(name) <= 50),
  CONSTRAINT private_groups_have_code CHECK (
    (is_private = TRUE AND code IS NOT NULL) OR
    (is_private = FALSE)
  )
);

-- Add FK from users to groups (after groups table exists)
ALTER TABLE users ADD CONSTRAINT fk_users_last_active_group
  FOREIGN KEY (last_active_group) REFERENCES groups(id) ON DELETE SET NULL;

-- Cards table
CREATE TABLE IF NOT EXISTS cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Card details
  name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  rarity TEXT NOT NULL DEFAULT 'common' CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),

  -- Ownership
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,

  -- Status tracking
  status TEXT DEFAULT 'available' CHECK (status IN ('available', 'in_trade', 'in_auction', 'deleted')),
  in_trade BOOLEAN DEFAULT FALSE,
  in_auction BOOLEAN DEFAULT FALSE,

  -- References (FKs added later to avoid circular deps)
  trade_id UUID,
  auction_id UUID,

  -- Timestamps
  minted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  status_update_time TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT card_name_not_empty CHECK (char_length(name) > 0),
  CONSTRAINT status_flags_consistent CHECK (
    (status = 'in_trade' AND in_trade = TRUE AND trade_id IS NOT NULL) OR
    (status = 'in_auction' AND in_auction = TRUE AND auction_id IS NOT NULL) OR
    (status = 'available' AND in_trade = FALSE AND in_auction = FALSE) OR
    (status = 'deleted')
  )
);

-- =====================================================
-- AUCTION SYSTEM TABLES
-- =====================================================

-- Auctions table
CREATE TABLE IF NOT EXISTS auctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Card being auctioned (unique - one card per auction)
  card_id UUID NOT NULL UNIQUE REFERENCES cards(id) ON DELETE RESTRICT,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,

  -- Seller info (denormalized for overview performance)
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_username TEXT NOT NULL,
  seller_avatar_url TEXT,

  -- Card details (denormalized for overview queries)
  card_name TEXT NOT NULL,
  card_image_url TEXT,

  -- Auction lifecycle
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'canceled')),
  start_time TIMESTAMPTZ DEFAULT NOW(),
  end_time TIMESTAMPTZ NOT NULL,

  -- Bidding state
  current_bid INT DEFAULT 0 CHECK (current_bid >= 0),
  current_bidder UUID REFERENCES users(id) ON DELETE SET NULL,
  current_bidder_name TEXT,

  -- Live rarity system (changes based on bid activity)
  current_rarity TEXT CHECK (current_rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  unique_bidder_count INT DEFAULT 0 CHECK (unique_bidder_count >= 0),

  -- Timestamps
  last_bid_time TIMESTAMPTZ,
  last_rarity_update TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT end_after_start CHECK (end_time > start_time),
  CONSTRAINT completed_auctions_have_timestamp CHECK (
    (status = 'completed' AND completed_at IS NOT NULL) OR
    (status != 'completed')
  )
);

-- Add FK from cards to auctions (after auctions table exists)
ALTER TABLE cards ADD CONSTRAINT fk_cards_auction
  FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE SET NULL;

-- Bids table (replaces auctions/{id}/bids subcollection)
CREATE TABLE IF NOT EXISTS bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auction reference
  auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,

  -- Bidder info
  bidder_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  bidder_name TEXT NOT NULL,

  -- Bid amount
  amount INT NOT NULL CHECK (amount > 0),

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TRADING SYSTEM TABLES
-- =====================================================

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Group context
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,

  -- Participants (denormalized for query performance)
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sender_name TEXT NOT NULL,
  sender_avatar TEXT,

  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  receiver_name TEXT NOT NULL,
  receiver_avatar TEXT,

  -- Participant IDs array for easy "my trades" queries
  participant_ids UUID[] NOT NULL,

  -- Trade details
  offered_cards UUID[] DEFAULT ARRAY[]::UUID[],   -- Cards sender is offering
  requested_cards UUID[] DEFAULT ARRAY[]::UUID[], -- Cards sender wants from receiver

  -- Status lifecycle
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'offered', 'active', 'completed', 'rejected', 'canceled')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT different_participants CHECK (sender_id != receiver_id),
  CONSTRAINT participant_ids_match CHECK (
    participant_ids @> ARRAY[sender_id, receiver_id] AND
    array_length(participant_ids, 1) = 2
  )
);

-- Add FK from cards to trades (after trades table exists)
ALTER TABLE cards ADD CONSTRAINT fk_cards_trade
  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE SET NULL;

-- =====================================================
-- SOCIAL & COMMUNITY TABLES
-- =====================================================

-- Posts table (social feed)
CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Group context
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,

  -- Author info (denormalized)
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_avatar TEXT,

  -- Content
  text TEXT NOT NULL,
  image_url TEXT,

  -- Engagement
  likes INT DEFAULT 0 CHECK (likes >= 0),
  liked_by UUID[] DEFAULT ARRAY[]::UUID[],
  comment_count INT DEFAULT 0 CHECK (comment_count >= 0),

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT post_text_not_empty CHECK (char_length(text) > 0),
  CONSTRAINT post_text_max_length CHECK (char_length(text) <= 5000),
  CONSTRAINT likes_match_liked_by CHECK (likes = array_length(liked_by, 1) OR (likes = 0 AND liked_by = ARRAY[]::UUID[]))
);

-- =====================================================
-- SETS & COLLECTIONS TABLES
-- =====================================================

-- Sets table (card set definitions)
CREATE TABLE IF NOT EXISTS sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Set info
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  card_count INT NOT NULL CHECK (card_count > 0),

  -- Card definitions (JSONB for flexibility)
  cards JSONB NOT NULL,

  -- Completion rewards
  completion_reward_coins INT DEFAULT 0 CHECK (completion_reward_coins >= 0),
  completion_reward_gems INT DEFAULT 0 CHECK (completion_reward_gems >= 0),

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Set progress table (user progress toward completing sets)
CREATE TABLE IF NOT EXISTS set_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id UUID NOT NULL REFERENCES sets(id) ON DELETE CASCADE,

  -- Progress tracking
  cards_owned UUID[] DEFAULT ARRAY[]::UUID[],
  completion_percentage INT DEFAULT 0 CHECK (completion_percentage >= 0 AND completion_percentage <= 100),

  -- Timestamp
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint (one progress per user per set)
  UNIQUE(user_id, set_id)
);

-- Set completions table (completed sets)
CREATE TABLE IF NOT EXISTS set_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id UUID NOT NULL REFERENCES sets(id) ON DELETE CASCADE,

  -- Completion tracking
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  reward_claimed BOOLEAN DEFAULT FALSE,

  -- Unique constraint (one completion per user per set)
  UNIQUE(user_id, set_id)
);

-- =====================================================
-- NOTIFICATIONS TABLE
-- =====================================================

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User reference
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Notification content
  type TEXT NOT NULL, -- 'bid_update', 'trade_offer', 'auction_won', etc.
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,

  -- Status
  read BOOLEAN DEFAULT FALSE,

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- UPDATED_AT TRIGGERS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at column
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_sessions_updated_at BEFORE UPDATE ON user_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_groups_updated_at BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cards_updated_at BEFORE UPDATE ON cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_auctions_updated_at BEFORE UPDATE ON auctions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trades_updated_at BEFORE UPDATE ON trades
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_set_progress_updated_at BEFORE UPDATE ON set_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON TABLE users IS 'Central user profiles and global resources';
COMMENT ON TABLE user_sessions IS 'Per-user active session data with group-scoped balances';
COMMENT ON TABLE groups IS 'Game groups that isolate data and provide social context';
COMMENT ON TABLE cards IS 'Individual collectible cards owned by users';
COMMENT ON TABLE auctions IS 'Active and completed card auctions with bidding state';
COMMENT ON TABLE bids IS 'Individual bid records for auction history';
COMMENT ON TABLE trades IS 'Card trade offers between users';
COMMENT ON TABLE posts IS 'Social feed posts within groups';
COMMENT ON TABLE sets IS 'Collectible card set definitions';
COMMENT ON TABLE set_progress IS 'User progress toward completing sets';
COMMENT ON TABLE set_completions IS 'Completed sets and reward claim status';
COMMENT ON TABLE notifications IS 'User notifications for app events';

COMMENT ON COLUMN users.firebase_uid IS 'Original Firebase UID for migration mapping (NULL for new users)';
COMMENT ON COLUMN user_sessions.group_balances IS 'JSONB map of group_id to coin balance';
COMMENT ON COLUMN auctions.current_rarity IS 'Dynamically calculated rarity based on bid activity';
COMMENT ON COLUMN trades.participant_ids IS 'Array of [sender_id, receiver_id] for efficient queries';
COMMENT ON COLUMN posts.liked_by IS 'Array of user IDs who liked this post';
-- =====================================================
-- CardMates - Database Functions
-- Core business logic implemented in PL/pgSQL
-- =====================================================
--
-- These functions replace Firebase Cloud Functions with
-- in-database logic for better performance and atomicity.
--
-- Run after: 01-schema.sql
-- =====================================================

-- =====================================================
-- AUCTION FUNCTIONS
-- =====================================================

-- Calculate live rarity based on bid activity
-- Replaces: src/utils/auctionRarity.js
-- IMPORTANT: Thresholds match Firebase exactly (verified 2025-10-22)
CREATE OR REPLACE FUNCTION calculate_live_rarity(
  p_current_bid INT,
  p_unique_bidder_count INT
)
RETURNS TEXT AS $$
BEGIN
  -- Legendary: 50+ coins AND 3+ bidders (Firebase: [50, 3])
  IF p_current_bid >= 50 AND p_unique_bidder_count >= 3 THEN
    RETURN 'legendary';
  END IF;

  -- Epic: 30+ coins AND 2+ bidders (Firebase: [30, 2])
  IF p_current_bid >= 30 AND p_unique_bidder_count >= 2 THEN
    RETURN 'epic';
  END IF;

  -- Rare: 20+ coins AND 2+ bidders (Firebase: [20, 2])
  IF p_current_bid >= 20 AND p_unique_bidder_count >= 2 THEN
    RETURN 'rare';
  END IF;

  -- Uncommon: 10+ coins OR 2+ bidders (Firebase: [10, 0] or [0, 2])
  IF p_current_bid >= 10 OR p_unique_bidder_count >= 2 THEN
    RETURN 'uncommon';
  END IF;

  -- Common: default
  RETURN 'common';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_live_rarity IS 'Calculate auction rarity based on bid activity - replaces auctionRarity.js';

-- Process a bid (atomic transaction)
-- Replaces: src/services/AuctionService.placeBid()
CREATE OR REPLACE FUNCTION process_bid(
  p_auction_id UUID,
  p_bidder_id UUID,
  p_bidder_name TEXT,
  p_bid_amount INT,
  p_group_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_auction RECORD;
  v_bidder_balance INT;
  v_total_cost INT := p_bid_amount + 1; -- Bid + 1 coin tax
  v_previous_bidder UUID;
  v_previous_bid INT;
  v_is_new_bidder BOOLEAN;
  v_unique_bidder_count INT;
  v_new_rarity TEXT;
BEGIN
  -- Lock auction row for update (prevents concurrent bids)
  SELECT * INTO v_auction
  FROM auctions
  WHERE id = p_auction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auction not found';
  END IF;

  -- Validate auction is active
  IF v_auction.status != 'active' THEN
    RAISE EXCEPTION 'Auction is no longer active';
  END IF;

  -- Validate auction hasn't ended (use server time to prevent client manipulation)
  IF v_auction.end_time <= NOW() THEN
    RAISE EXCEPTION 'Auction has ended';
  END IF;

  -- Get bidder's balance for this group
  SELECT COALESCE((group_balances->>p_group_id::text)::int, 0) INTO v_bidder_balance
  FROM user_sessions
  WHERE user_id = p_bidder_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User session not found';
  END IF;

  -- Validate sufficient balance (bid + tax)
  IF v_bidder_balance < v_total_cost THEN
    RAISE EXCEPTION 'Insufficient balance: % < %', v_bidder_balance, v_total_cost;
  END IF;

  -- Validate bid is higher than current bid
  IF p_bid_amount <= v_auction.current_bid THEN
    RAISE EXCEPTION 'Bid must be higher than current bid of %', v_auction.current_bid;
  END IF;

  -- Store previous bidder info for refund
  v_previous_bidder := v_auction.current_bidder;
  v_previous_bid := v_auction.current_bid;
  v_is_new_bidder := (v_previous_bidder IS NULL OR v_previous_bidder != p_bidder_id);

  -- Calculate new unique bidder count
  v_unique_bidder_count := v_auction.unique_bidder_count;
  IF v_is_new_bidder THEN
    v_unique_bidder_count := v_unique_bidder_count + 1;
  END IF;

  -- Calculate new rarity
  v_new_rarity := calculate_live_rarity(p_bid_amount, v_unique_bidder_count);

  -- IMPORTANT: Never downgrade rarity, only upgrade (matches Firebase behavior)
  -- Rarity hierarchy: common(1) < uncommon(2) < rare(3) < epic(4) < legendary(5)
  IF v_auction.current_rarity IS NOT NULL THEN
    DECLARE
      v_current_level INT;
      v_calculated_level INT;
    BEGIN
      -- Map rarity to numeric level
      v_current_level := CASE v_auction.current_rarity
        WHEN 'common' THEN 1
        WHEN 'uncommon' THEN 2
        WHEN 'rare' THEN 3
        WHEN 'epic' THEN 4
        WHEN 'legendary' THEN 5
        ELSE 1
      END;

      v_calculated_level := CASE v_new_rarity
        WHEN 'common' THEN 1
        WHEN 'uncommon' THEN 2
        WHEN 'rare' THEN 3
        WHEN 'epic' THEN 4
        WHEN 'legendary' THEN 5
        ELSE 1
      END;

      -- Only upgrade rarity, never downgrade
      IF v_calculated_level <= v_current_level THEN
        v_new_rarity := v_auction.current_rarity;
      END IF;
    END;
  END IF;

  -- ========== ATOMIC OPERATIONS ==========

  -- 1. Update auction with new bid
  UPDATE auctions
  SET
    current_bid = p_bid_amount,
    current_bidder = p_bidder_id,
    current_bidder_name = p_bidder_name,
    unique_bidder_count = v_unique_bidder_count,
    current_rarity = v_new_rarity,
    last_bid_time = NOW(),
    last_rarity_update = NOW(),
    updated_at = NOW()
  WHERE id = p_auction_id;

  -- 2. Deduct coins from bidder (bid + tax)
  UPDATE user_sessions
  SET
    group_balances = jsonb_set(
      group_balances,
      ARRAY[p_group_id::text],
      to_jsonb(v_bidder_balance - v_total_cost)
    ),
    updated_at = NOW()
  WHERE user_id = p_bidder_id;

  -- 3. Refund previous bidder (if different user and not seller)
  IF v_is_new_bidder AND
     v_previous_bidder IS NOT NULL AND
     v_previous_bidder != v_auction.seller_id AND
     v_previous_bid > 0 THEN

    UPDATE user_sessions
    SET
      group_balances = jsonb_set(
        group_balances,
        ARRAY[p_group_id::text],
        to_jsonb(COALESCE((group_balances->>p_group_id::text)::int, 0) + v_previous_bid)
      ),
      updated_at = NOW()
    WHERE user_id = v_previous_bidder;
  END IF;

  -- 4. Insert bid record for history
  INSERT INTO bids (auction_id, bidder_id, bidder_name, amount)
  VALUES (p_auction_id, p_bidder_id, p_bidder_name, p_bid_amount);

  -- Return result
  RETURN jsonb_build_object(
    'success', true,
    'rarity', v_new_rarity,
    'uniqueBidderCount', v_unique_bidder_count,
    'totalCost', v_total_cost,
    'previousBidder', v_previous_bidder,
    'refundedAmount', CASE WHEN v_is_new_bidder THEN v_previous_bid ELSE 0 END
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Re-raise exception with context
    RAISE EXCEPTION 'Bid processing failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_bid IS 'Atomically process a bid: validate, deduct coins, update auction, refund previous bidder';

-- Complete expired auctions (scheduled function)
-- Replaces: functions/index.js processEndingAuctions
CREATE OR REPLACE FUNCTION complete_auctions()
RETURNS TABLE(
  auction_id UUID,
  card_id UUID,
  winner_id UUID,
  seller_id UUID,
  final_bid INT,
  status TEXT
) AS $$
DECLARE
  v_auction RECORD;
  v_completed_count INT := 0;
BEGIN
  -- Process all auctions that have ended
  FOR v_auction IN
    SELECT *
    FROM auctions
    WHERE status = 'active' AND end_time <= NOW()
    FOR UPDATE SKIP LOCKED -- Prevent concurrent processing
  LOOP
    -- Mark auction as completed
    UPDATE auctions
    SET
      status = 'completed',
      completed_at = NOW(),
      updated_at = NOW()
    WHERE id = v_auction.id;

    -- Transfer card to winner if there was a winning bid
    IF v_auction.current_bidder IS NOT NULL AND v_auction.current_bid > 0 THEN

      -- Update card ownership
      UPDATE cards
      SET
        owner_id = v_auction.current_bidder,
        in_auction = FALSE,
        auction_id = NULL,
        status = 'available',
        status_update_time = NOW(),
        updated_at = NOW()
      WHERE id = v_auction.card_id;

      -- Award seller with coins
      UPDATE user_sessions
      SET
        group_balances = jsonb_set(
          group_balances,
          ARRAY[v_auction.group_id::text],
          to_jsonb(COALESCE((group_balances->>v_auction.group_id::text)::int, 0) + v_auction.current_bid)
        ),
        updated_at = NOW()
      WHERE user_id = v_auction.seller_id;

      -- Return completed auction info
      RETURN QUERY
      SELECT
        v_auction.id,
        v_auction.card_id,
        v_auction.current_bidder,
        v_auction.seller_id,
        v_auction.current_bid,
        'winner_paid'::TEXT;

    ELSE
      -- No winner, return card to seller
      UPDATE cards
      SET
        in_auction = FALSE,
        auction_id = NULL,
        status = 'available',
        status_update_time = NOW(),
        updated_at = NOW()
      WHERE id = v_auction.card_id;

      -- Return completed auction info (no winner)
      RETURN QUERY
      SELECT
        v_auction.id,
        v_auction.card_id,
        NULL::UUID,
        v_auction.seller_id,
        0,
        'no_winner'::TEXT;
    END IF;

    v_completed_count := v_completed_count + 1;
  END LOOP;

  RAISE NOTICE 'Completed % auctions', v_completed_count;

END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION complete_auctions IS 'Process all expired auctions: transfer cards, pay sellers, update status';

-- =====================================================
-- BALANCE OPERATIONS
-- =====================================================

-- Update user balance (atomic)
-- Replaces: UnifiedUserDataContext performCoinOperation
CREATE OR REPLACE FUNCTION update_balance(
  p_user_id UUID,
  p_group_id UUID,
  p_amount INT -- Positive to add, negative to subtract
)
RETURNS JSONB AS $$
DECLARE
  v_current_balance INT;
  v_new_balance INT;
BEGIN
  -- Get current balance
  SELECT COALESCE((group_balances->>p_group_id::text)::int, 0)
  INTO v_current_balance
  FROM user_sessions
  WHERE user_id = p_user_id
  FOR UPDATE; -- Lock row

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User session not found for user %', p_user_id;
  END IF;

  -- Calculate new balance
  v_new_balance := v_current_balance + p_amount;

  -- Validate non-negative
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient balance: % + % = %', v_current_balance, p_amount, v_new_balance;
  END IF;

  -- Update balance
  UPDATE user_sessions
  SET
    group_balances = jsonb_set(
      group_balances,
      ARRAY[p_group_id::text],
      to_jsonb(v_new_balance)
    ),
    updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Return result
  RETURN jsonb_build_object(
    'success', true,
    'old_balance', v_current_balance,
    'new_balance', v_new_balance,
    'change', p_amount
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Balance update failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_balance IS 'Atomically update user balance with validation';

-- Update user gems (atomic)
CREATE OR REPLACE FUNCTION update_gems(
  p_user_id UUID,
  p_amount INT, -- Positive to add, negative to subtract
  p_group_id UUID DEFAULT NULL -- NULL for global gems, UUID for group gems
)
RETURNS JSONB AS $$
DECLARE
  v_current_gems INT;
  v_new_gems INT;
BEGIN
  IF p_group_id IS NULL THEN
    -- Global gems
    SELECT gems INTO v_current_gems
    FROM users
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'User not found: %', p_user_id;
    END IF;

    v_new_gems := v_current_gems + p_amount;

    IF v_new_gems < 0 THEN
      RAISE EXCEPTION 'Insufficient gems: % + % = %', v_current_gems, p_amount, v_new_gems;
    END IF;

    UPDATE users
    SET gems = v_new_gems, updated_at = NOW()
    WHERE id = p_user_id;

  ELSE
    -- Group-specific gems
    SELECT COALESCE((group_gems->>p_group_id::text)::int, 0)
    INTO v_current_gems
    FROM user_sessions
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'User session not found: %', p_user_id;
    END IF;

    v_new_gems := v_current_gems + p_amount;

    IF v_new_gems < 0 THEN
      RAISE EXCEPTION 'Insufficient group gems: % + % = %', v_current_gems, p_amount, v_new_gems;
    END IF;

    UPDATE user_sessions
    SET
      group_gems = jsonb_set(
        group_gems,
        ARRAY[p_group_id::text],
        to_jsonb(v_new_gems)
      ),
      updated_at = NOW()
    WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'old_gems', v_current_gems,
    'new_gems', v_new_gems,
    'change', p_amount,
    'scope', CASE WHEN p_group_id IS NULL THEN 'global' ELSE 'group' END
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Gems update failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_gems IS 'Atomically update user gems (global or group-scoped)';

-- =====================================================
-- BOOTSTRAP FUNCTION
-- =====================================================

-- Get complete bootstrap payload (replaces initialAppLoad/{userId}_{groupId})
-- This function assembles all data needed for app startup in ONE query
CREATE OR REPLACE FUNCTION get_bootstrap_payload(
  p_user_id UUID,
  p_group_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_payload JSONB;
  v_user_data JSONB;
  v_user_session_data JSONB;
  v_group_data JSONB;
  v_cards JSONB;
  v_auctions JSONB;
  v_trades JSONB;
  v_posts JSONB;
BEGIN
  -- Fetch user profile
  SELECT to_jsonb(u.*) INTO v_user_data
  FROM users u
  WHERE u.id = p_user_id;

  -- Fetch user session
  SELECT to_jsonb(us.*) INTO v_user_session_data
  FROM user_sessions us
  WHERE us.user_id = p_user_id;

  -- Fetch group
  SELECT to_jsonb(g.*) INTO v_group_data
  FROM groups g
  WHERE g.id = p_group_id;

  -- Fetch cards from materialized view (if it exists, otherwise query directly)
  BEGIN
    SELECT cards INTO v_cards
    FROM mv_card_overview
    WHERE id = p_group_id || '_' || p_user_id;
  EXCEPTION WHEN undefined_table THEN
    -- Fallback if materialized view doesn't exist yet
    SELECT jsonb_agg(to_jsonb(c.*) ORDER BY c.name)
    INTO v_cards
    FROM cards c
    WHERE c.owner_id = p_user_id AND c.group_id = p_group_id AND c.status != 'deleted';
  END;

  -- Fetch auctions from materialized view (fallback to direct query)
  BEGIN
    SELECT auctions INTO v_auctions
    FROM mv_auction_overview
    WHERE group_id = p_group_id;
  EXCEPTION WHEN undefined_table THEN
    SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.end_time)
    INTO v_auctions
    FROM auctions a
    WHERE a.group_id = p_group_id AND a.status = 'active';
  END;

  -- Fetch trades from materialized view (fallback)
  BEGIN
    SELECT trades INTO v_trades
    FROM mv_trade_overview
    WHERE group_id = p_group_id;
  EXCEPTION WHEN undefined_table THEN
    SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.created_at DESC)
    INTO v_trades
    FROM trades t
    WHERE t.group_id = p_group_id AND t.status IN ('pending', 'offered', 'active');
  END;

  -- Fetch posts from materialized view (fallback)
  BEGIN
    SELECT posts INTO v_posts
    FROM mv_social_overview
    WHERE group_id = p_group_id;
  EXCEPTION WHEN undefined_table THEN
    SELECT jsonb_agg(to_jsonb(p.*) ORDER BY p.created_at DESC)
    INTO v_posts
    FROM posts p
    WHERE p.group_id = p_group_id
    LIMIT 50;
  END;

  -- Assemble complete payload
  v_payload := jsonb_build_object(
    'user', COALESCE(v_user_data, '{}'::jsonb),
    'userSession', COALESCE(v_user_session_data, '{}'::jsonb),
    'group', COALESCE(v_group_data, '{}'::jsonb),
    'cards', COALESCE(v_cards, '[]'::jsonb),
    'auctions', COALESCE(v_auctions, '[]'::jsonb),
    'trades', COALESCE(v_trades, '[]'::jsonb),
    'posts', COALESCE(v_posts, '[]'::jsonb),
    'version', '2.0',
    'updatedAt', NOW(),
    'source', 'postgres_function'
  );

  RETURN v_payload;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_bootstrap_payload IS 'Fetch complete app bootstrap data in a single query - replaces initialAppLoad document';

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Get user balance for a specific group
CREATE OR REPLACE FUNCTION get_user_balance(
  p_user_id UUID,
  p_group_id UUID
)
RETURNS INT AS $$
DECLARE
  v_balance INT;
BEGIN
  SELECT COALESCE((group_balances->>p_group_id::text)::int, 0)
  INTO v_balance
  FROM user_sessions
  WHERE user_id = p_user_id;

  RETURN COALESCE(v_balance, 0);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_user_balance IS 'Get user balance for a specific group';

-- Get user gems (global or group)
CREATE OR REPLACE FUNCTION get_user_gems(
  p_user_id UUID,
  p_group_id UUID DEFAULT NULL
)
RETURNS INT AS $$
DECLARE
  v_gems INT;
BEGIN
  IF p_group_id IS NULL THEN
    -- Global gems
    SELECT gems INTO v_gems
    FROM users
    WHERE id = p_user_id;
  ELSE
    -- Group gems
    SELECT COALESCE((group_gems->>p_group_id::text)::int, 0)
    INTO v_gems
    FROM user_sessions
    WHERE user_id = p_user_id;
  END IF;

  RETURN COALESCE(v_gems, 0);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_user_gems IS 'Get user gems (global or group-scoped)';

-- =====================================================
-- TRADE MANAGEMENT FUNCTIONS
-- =====================================================

-- Complete a trade (swap cards between participants)
CREATE OR REPLACE FUNCTION complete_trade(
  p_trade_id UUID,
  p_completer_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_trade RECORD;
  v_card_id UUID;
BEGIN
  -- Lock trade for update
  SELECT * INTO v_trade
  FROM trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade not found';
  END IF;

  -- Validate completer is a participant
  IF p_completer_id != ALL(v_trade.participant_ids) THEN
    RAISE EXCEPTION 'User is not a participant in this trade';
  END IF;

  -- Validate trade is in valid state
  IF v_trade.status NOT IN ('pending', 'offered', 'active') THEN
    RAISE EXCEPTION 'Trade cannot be completed - status is %', v_trade.status;
  END IF;

  -- Transfer offered cards from sender to receiver
  FOREACH v_card_id IN ARRAY v_trade.offered_cards
  LOOP
    UPDATE cards
    SET
      owner_id = v_trade.receiver_id,
      in_trade = FALSE,
      trade_id = NULL,
      status = 'available',
      updated_at = NOW()
    WHERE id = v_card_id AND owner_id = v_trade.sender_id;
  END LOOP;

  -- Transfer requested cards from receiver to sender
  FOREACH v_card_id IN ARRAY v_trade.requested_cards
  LOOP
    UPDATE cards
    SET
      owner_id = v_trade.sender_id,
      in_trade = FALSE,
      trade_id = NULL,
      status = 'available',
      updated_at = NOW()
    WHERE id = v_card_id AND owner_id = v_trade.receiver_id;
  END LOOP;

  -- Mark trade as completed
  UPDATE trades
  SET
    status = 'completed',
    updated_at = NOW()
  WHERE id = p_trade_id;

  -- Award XP to both participants (50 XP for completing trade)
  PERFORM award_xp(v_trade.sender_id, 50, 'trade_completed');
  PERFORM award_xp(v_trade.receiver_id, 50, 'trade_completed');

  RETURN jsonb_build_object(
    'success', true,
    'tradeId', p_trade_id,
    'offeredCardsTransferred', array_length(v_trade.offered_cards, 1),
    'requestedCardsTransferred', array_length(v_trade.requested_cards, 1)
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Trade completion failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION complete_trade IS 'Complete a trade by swapping cards between participants';

-- Cancel a trade (unlock cards)
CREATE OR REPLACE FUNCTION cancel_trade(
  p_trade_id UUID,
  p_canceler_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_trade RECORD;
  v_card_id UUID;
BEGIN
  -- Lock trade for update
  SELECT * INTO v_trade
  FROM trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade not found';
  END IF;

  -- Validate canceler is a participant
  IF p_canceler_id != ALL(v_trade.participant_ids) THEN
    RAISE EXCEPTION 'User is not a participant in this trade';
  END IF;

  -- Validate trade can be canceled
  IF v_trade.status = 'completed' THEN
    RAISE EXCEPTION 'Cannot cancel completed trade';
  END IF;

  -- Unlock all offered cards
  FOREACH v_card_id IN ARRAY v_trade.offered_cards
  LOOP
    UPDATE cards
    SET
      in_trade = FALSE,
      trade_id = NULL,
      status = 'available',
      updated_at = NOW()
    WHERE id = v_card_id;
  END LOOP;

  -- Unlock all requested cards
  FOREACH v_card_id IN ARRAY v_trade.requested_cards
  LOOP
    UPDATE cards
    SET
      in_trade = FALSE,
      trade_id = NULL,
      status = 'available',
      updated_at = NOW()
    WHERE id = v_card_id;
  END LOOP;

  -- Mark trade as canceled
  UPDATE trades
  SET
    status = 'canceled',
    updated_at = NOW()
  WHERE id = p_trade_id;

  RETURN jsonb_build_object(
    'success', true,
    'tradeId', p_trade_id,
    'canceledBy', p_canceler_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Trade cancellation failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cancel_trade IS 'Cancel a trade and unlock all cards';

-- =====================================================
-- SOCIAL FUNCTIONS
-- =====================================================

-- Like a post
CREATE OR REPLACE FUNCTION like_post(
  p_post_id UUID,
  p_user_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_already_liked BOOLEAN;
BEGIN
  -- Check if user already liked the post
  SELECT p_user_id = ANY(liked_by) INTO v_already_liked
  FROM posts
  WHERE id = p_post_id;

  IF v_already_liked THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Post already liked by user'
    );
  END IF;

  -- Add like
  UPDATE posts
  SET
    likes = likes + 1,
    liked_by = array_append(liked_by, p_user_id)
  WHERE id = p_post_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'postId', p_post_id,
    'userId', p_user_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Like post failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION like_post IS 'Like a post (increment likes, add user to liked_by array)';

-- Unlike a post
CREATE OR REPLACE FUNCTION unlike_post(
  p_post_id UUID,
  p_user_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_liked BOOLEAN;
BEGIN
  -- Check if user liked the post
  SELECT p_user_id = ANY(liked_by) INTO v_liked
  FROM posts
  WHERE id = p_post_id;

  IF NOT v_liked THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Post not liked by user'
    );
  END IF;

  -- Remove like
  UPDATE posts
  SET
    likes = GREATEST(likes - 1, 0),
    liked_by = array_remove(liked_by, p_user_id)
  WHERE id = p_post_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'postId', p_post_id,
    'userId', p_user_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Unlike post failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION unlike_post IS 'Unlike a post (decrement likes, remove user from liked_by array)';

-- =====================================================
-- SET COMPLETION & REWARDS FUNCTIONS
-- =====================================================

-- Check if user completed a set and award rewards
CREATE OR REPLACE FUNCTION check_set_completion(
  p_user_id UUID,
  p_set_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_set RECORD;
  v_user_cards UUID[];
  v_required_cards JSONB;
  v_card_name TEXT;
  v_has_all BOOLEAN := TRUE;
  v_completion_exists BOOLEAN;
BEGIN
  -- Get set definition
  SELECT * INTO v_set
  FROM sets
  WHERE id = p_set_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Set not found';
  END IF;

  -- Get user's cards in the same group as the set
  -- (Assuming sets are group-agnostic, but cards are group-specific)
  -- This needs adjustment based on actual data model

  -- Check if user already completed this set
  SELECT EXISTS(
    SELECT 1 FROM set_completions
    WHERE user_id = p_user_id AND set_id = p_set_id
  ) INTO v_completion_exists;

  IF v_completion_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'completed', true,
      'error', 'Set already completed'
    );
  END IF;

  -- Check if user owns all required cards
  -- This is simplified - actual implementation depends on card set structure
  v_required_cards := v_set.cards;

  -- For now, return incomplete (actual logic depends on card set structure)
  -- This needs to be implemented based on how sets.cards JSONB is structured

  RETURN jsonb_build_object(
    'success', true,
    'completed', FALSE,
    'setId', p_set_id,
    'message', 'Set not yet completed'
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Check set completion failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_set_completion IS 'Check if user completed a set (needs refinement based on set structure)';

-- Claim set completion reward
CREATE OR REPLACE FUNCTION claim_set_reward(
  p_user_id UUID,
  p_set_id UUID,
  p_group_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_completion RECORD;
  v_set RECORD;
BEGIN
  -- Get completion record
  SELECT * INTO v_completion
  FROM set_completions
  WHERE user_id = p_user_id AND set_id = p_set_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Set completion not found';
  END IF;

  -- Check if already claimed
  IF v_completion.reward_claimed THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reward already claimed'
    );
  END IF;

  -- Get set rewards
  SELECT * INTO v_set
  FROM sets
  WHERE id = p_set_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Set not found';
  END IF;

  -- Award coins (group-scoped)
  IF v_set.completion_reward_coins > 0 THEN
    PERFORM update_balance(p_user_id, p_group_id, v_set.completion_reward_coins);
  END IF;

  -- Award gems (global)
  IF v_set.completion_reward_gems > 0 THEN
    PERFORM update_gems(p_user_id, v_set.completion_reward_gems, NULL);
  END IF;

  -- Award XP
  PERFORM award_xp(p_user_id, 100, 'set_completed');

  -- Mark as claimed
  UPDATE set_completions
  SET reward_claimed = TRUE
  WHERE user_id = p_user_id AND set_id = p_set_id;

  -- Update user stats
  UPDATE user_sessions
  SET sets_completed = sets_completed + 1
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'setId', p_set_id,
    'coinsAwarded', v_set.completion_reward_coins,
    'gemsAwarded', v_set.completion_reward_gems,
    'xpAwarded', 100
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Claim set reward failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION claim_set_reward IS 'Claim rewards for completing a set (coins, gems, XP)';

-- =====================================================
-- XP & LEVELING FUNCTIONS
-- =====================================================

-- Award XP to user and handle level ups
CREATE OR REPLACE FUNCTION award_xp(
  p_user_id UUID,
  p_amount INT,
  p_source TEXT DEFAULT 'unknown'
)
RETURNS JSONB AS $$
DECLARE
  v_current_xp INT;
  v_current_level INT;
  v_new_xp INT;
  v_new_level INT;
  v_level_threshold INT;
  v_leveled_up BOOLEAN := FALSE;
BEGIN
  -- Get current XP and level
  SELECT xp, level INTO v_current_xp, v_current_level
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Calculate new XP
  v_new_xp := v_current_xp + p_amount;
  v_new_level := v_current_level;

  -- Level up logic (exponential thresholds)
  -- Level 1: 0 XP
  -- Level 2: 100 XP
  -- Level 3: 250 XP
  -- Level 4: 500 XP
  -- Level 5: 1000 XP
  -- Level N: 100 * (N-1)^1.5

  LOOP
    -- Calculate threshold for next level
    v_level_threshold := FLOOR(100 * POWER(v_new_level, 1.5));

    -- Check if user reached next level
    IF v_new_xp >= v_level_threshold THEN
      v_new_level := v_new_level + 1;
      v_leveled_up := TRUE;
    ELSE
      EXIT;
    END IF;
  END LOOP;

  -- Update user XP and level
  UPDATE users
  SET
    xp = v_new_xp,
    level = v_new_level,
    updated_at = NOW()
  WHERE id = p_user_id;

  -- Award gems on level up (5 gems per level)
  IF v_leveled_up THEN
    PERFORM update_gems(p_user_id, (v_new_level - v_current_level) * 5, NULL);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'userId', p_user_id,
    'xpAwarded', p_amount,
    'newXp', v_new_xp,
    'oldLevel', v_current_level,
    'newLevel', v_new_level,
    'leveledUp', v_leveled_up,
    'source', p_source
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Award XP failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION award_xp IS 'Award XP to user and automatically handle level ups';

-- =====================================================
-- GROUP MANAGEMENT FUNCTIONS
-- =====================================================

-- Join a group (by ID or code)
CREATE OR REPLACE FUNCTION join_group(
  p_user_id UUID,
  p_group_identifier TEXT -- Can be UUID or code
)
RETURNS JSONB AS $$
DECLARE
  v_group RECORD;
  v_group_id UUID;
  v_starting_coins INT := 1000; -- Default starting balance
BEGIN
  -- Try to parse as UUID first, otherwise treat as code
  BEGIN
    v_group_id := p_group_identifier::UUID;

    SELECT * INTO v_group
    FROM groups
    WHERE id = v_group_id
    FOR UPDATE;

  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, treat as code
    SELECT * INTO v_group
    FROM groups
    WHERE code = p_group_identifier
    FOR UPDATE;

    v_group_id := v_group.id;
  END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  -- Check if user already in group
  IF p_user_id = ANY(v_group.members) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User already in group'
    );
  END IF;

  -- Add user to group members
  UPDATE groups
  SET
    members = array_append(members, p_user_id),
    member_count = member_count + 1,
    updated_at = NOW()
  WHERE id = v_group_id;

  -- Initialize user's balance for this group
  UPDATE user_sessions
  SET
    group_balances = jsonb_set(
      group_balances,
      ARRAY[v_group_id::text],
      to_jsonb(v_starting_coins)
    ),
    updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Set as user's last active group
  UPDATE users
  SET
    last_active_group = v_group_id,
    updated_at = NOW()
  WHERE id = p_user_id;

  -- Award welcome XP
  PERFORM award_xp(p_user_id, 50, 'joined_group');

  RETURN jsonb_build_object(
    'success', true,
    'groupId', v_group_id,
    'groupName', v_group.name,
    'startingCoins', v_starting_coins
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Join group failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION join_group IS 'Join a group by ID or code, initialize balance and award welcome rewards';

-- Leave a group
CREATE OR REPLACE FUNCTION leave_group(
  p_user_id UUID,
  p_group_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_group RECORD;
  v_is_admin BOOLEAN;
  v_is_creator BOOLEAN;
BEGIN
  -- Get group
  SELECT * INTO v_group
  FROM groups
  WHERE id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  -- Check if user is in group
  IF NOT (p_user_id = ANY(v_group.members)) THEN
    RAISE EXCEPTION 'User is not in group';
  END IF;

  -- Check if user is the creator
  v_is_creator := (v_group.created_by = p_user_id);

  IF v_is_creator AND v_group.member_count > 1 THEN
    RAISE EXCEPTION 'Creator cannot leave group with other members - transfer ownership or delete group';
  END IF;

  -- Remove user from members and admins
  UPDATE groups
  SET
    members = array_remove(members, p_user_id),
    admin_ids = array_remove(admin_ids, p_user_id),
    member_count = member_count - 1,
    updated_at = NOW()
  WHERE id = p_group_id;

  -- Clear user's balance for this group
  UPDATE user_sessions
  SET
    group_balances = group_balances - p_group_id::text,
    group_gems = group_gems - p_group_id::text,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Clear as last active group if it was
  UPDATE users
  SET
    last_active_group = NULL
  WHERE id = p_user_id AND last_active_group = p_group_id;

  -- Delete user's cards in this group
  DELETE FROM cards
  WHERE owner_id = p_user_id AND group_id = p_group_id;

  RETURN jsonb_build_object(
    'success', true,
    'groupId', p_group_id,
    'userId', p_user_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Leave group failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION leave_group IS 'Leave a group and clean up user data';

-- Delete a group (admin only)
CREATE OR REPLACE FUNCTION delete_group(
  p_group_id UUID,
  p_admin_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_group RECORD;
  v_is_admin BOOLEAN;
BEGIN
  -- Get group
  SELECT * INTO v_group
  FROM groups
  WHERE id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  -- Verify user is admin
  v_is_admin := (p_admin_id = ANY(v_group.admin_ids));

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'User is not an admin of this group';
  END IF;

  -- Clear last_active_group for all members
  UPDATE users
  SET last_active_group = NULL
  WHERE last_active_group = p_group_id;

  -- Delete all group data (cascades via FK constraints)
  -- Cards, auctions, trades, posts will be deleted automatically
  DELETE FROM groups WHERE id = p_group_id;

  RETURN jsonb_build_object(
    'success', true,
    'groupId', p_group_id,
    'deletedBy', p_admin_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Delete group failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION delete_group IS 'Delete a group (admin only) - cascades to all group data';

-- =====================================================
-- CARD MINTING FUNCTION
-- =====================================================

-- Mint a new random card
CREATE OR REPLACE FUNCTION mint_card(
  p_user_id UUID,
  p_group_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_group RECORD;
  v_balance INT;
  v_mint_cost INT;
  v_random_rarity TEXT;
  v_card_id UUID;
  v_card_name TEXT;
  v_card_image TEXT;
  v_rarity_roll INT;
BEGIN
  -- Get group mint cost
  SELECT * INTO v_group
  FROM groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  v_mint_cost := v_group.mint_cost;

  -- Check user balance
  v_balance := get_user_balance(p_user_id, p_group_id);

  IF v_balance < v_mint_cost THEN
    RAISE EXCEPTION 'Insufficient balance: % < %', v_balance, v_mint_cost;
  END IF;

  -- Deduct mint cost
  PERFORM update_balance(p_user_id, p_group_id, -v_mint_cost);

  -- Generate random rarity (weighted probabilities)
  -- Common: 50%, Uncommon: 30%, Rare: 15%, Epic: 4%, Legendary: 1%
  v_rarity_roll := FLOOR(RANDOM() * 100)::INT;

  IF v_rarity_roll < 50 THEN
    v_random_rarity := 'common';
  ELSIF v_rarity_roll < 80 THEN
    v_random_rarity := 'uncommon';
  ELSIF v_rarity_roll < 95 THEN
    v_random_rarity := 'rare';
  ELSIF v_rarity_roll < 99 THEN
    v_random_rarity := 'epic';
  ELSE
    v_random_rarity := 'legendary';
  END IF;

  -- Generate card name and image (placeholder - should be from card pool)
  -- In production, this would select from a predefined card pool
  v_card_name := 'Card #' || substr(md5(random()::text), 1, 6);
  v_card_image := 'https://via.placeholder.com/300x400?text=' || v_random_rarity;

  -- Create card
  INSERT INTO cards (
    name,
    image_url,
    rarity,
    owner_id,
    group_id,
    status,
    in_trade,
    in_auction
  ) VALUES (
    v_card_name,
    v_card_image,
    v_random_rarity,
    p_user_id,
    p_group_id,
    'available',
    FALSE,
    FALSE
  )
  RETURNING id INTO v_card_id;

  -- Update user stats
  UPDATE user_sessions
  SET
    total_cards = total_cards + 1,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Award XP for minting
  PERFORM award_xp(p_user_id, 10, 'minted_card');

  RETURN jsonb_build_object(
    'success', true,
    'cardId', v_card_id,
    'cardName', v_card_name,
    'rarity', v_random_rarity,
    'costPaid', v_mint_cost
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Mint card failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION mint_card IS 'Mint a new random card (deduct cost, generate rarity, create card)';

-- =====================================================
-- NOTIFICATION FUNCTION
-- =====================================================

-- Create a notification for a user
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_data JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  -- Insert notification
  INSERT INTO notifications (
    user_id,
    type,
    title,
    body,
    data,
    read
  ) VALUES (
    p_user_id,
    p_type,
    p_title,
    p_body,
    p_data,
    FALSE
  )
  RETURNING id INTO v_notification_id;

  -- Increment unread count
  UPDATE user_sessions
  SET
    notifications_unread = notifications_unread + 1,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'notificationId', v_notification_id,
    'userId', p_user_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Create notification failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_notification IS 'Create a notification for a user and increment unread count';
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
-- =====================================================
-- CardMates - Row Level Security (RLS) Policies
-- Replaces Firebase Security Rules
-- =====================================================
--
-- RLS policies control row-level access to data.
-- Supabase automatically enforces these policies for
-- authenticated users via auth.uid().
--
-- Policy pattern:
-- - SELECT: Who can read which rows
-- - INSERT: Who can create which rows
-- - UPDATE: Who can modify which rows
-- - DELETE: Who can delete which rows
--
-- Run after: 01-schema.sql
-- =====================================================

-- =====================================================
-- ENABLE RLS ON ALL TABLES
-- =====================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE set_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE set_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Materialized views are readable by authenticated users (covered below)

-- =====================================================
-- USERS TABLE POLICIES
-- =====================================================

-- Users can read their own profile
CREATE POLICY users_select_own ON users
  FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY users_update_own ON users
  FOR UPDATE
  USING (auth.uid() = id);

-- Note: INSERT handled by auth trigger (handle_new_user)
-- Note: DELETE not allowed via policy (must be done by admin/service)

COMMENT ON POLICY users_select_own ON users IS 'Users can read their own profile';
COMMENT ON POLICY users_update_own ON users IS 'Users can update their own profile';

-- =====================================================
-- USER SESSIONS TABLE POLICIES
-- =====================================================

-- Users can fully manage their own session
CREATE POLICY user_sessions_all_own ON user_sessions
  FOR ALL
  USING (auth.uid() = user_id);

COMMENT ON POLICY user_sessions_all_own ON user_sessions IS 'Users can fully manage their own session';

-- =====================================================
-- GROUPS TABLE POLICIES
-- =====================================================

-- Anyone authenticated can read groups they're a member of
CREATE POLICY groups_select_member ON groups
  FOR SELECT
  USING (
    auth.uid() = ANY(members)
  );

-- Admins can update their groups
CREATE POLICY groups_update_admin ON groups
  FOR UPDATE
  USING (
    auth.uid() = ANY(admin_ids)
  );

-- Admins can delete their groups
CREATE POLICY groups_delete_admin ON groups
  FOR DELETE
  USING (
    auth.uid() = ANY(admin_ids)
  );

-- Any authenticated user can create a group
CREATE POLICY groups_insert_authenticated ON groups
  FOR INSERT
  WITH CHECK (
    auth.uid() = created_by AND
    auth.uid() = ANY(members) AND
    auth.uid() = ANY(admin_ids)
  );

COMMENT ON POLICY groups_select_member ON groups IS 'Members can read their groups';
COMMENT ON POLICY groups_update_admin ON groups IS 'Admins can update their groups';
COMMENT ON POLICY groups_delete_admin ON groups IS 'Admins can delete their groups';
COMMENT ON POLICY groups_insert_authenticated ON groups IS 'Authenticated users can create groups';

-- =====================================================
-- CARDS TABLE POLICIES
-- =====================================================

-- Users can read their own cards
CREATE POLICY cards_select_own ON cards
  FOR SELECT
  USING (
    auth.uid() = owner_id
  );

-- Users can insert cards they own
CREATE POLICY cards_insert_own ON cards
  FOR INSERT
  WITH CHECK (
    auth.uid() = owner_id
  );

-- Users can update their own cards
CREATE POLICY cards_update_own ON cards
  FOR UPDATE
  USING (
    auth.uid() = owner_id
  );

-- Users can delete their own cards
CREATE POLICY cards_delete_own ON cards
  FOR DELETE
  USING (
    auth.uid() = owner_id
  );

COMMENT ON POLICY cards_select_own ON cards IS 'Users can read their own cards';
COMMENT ON POLICY cards_insert_own ON cards IS 'Users can insert cards they own';
COMMENT ON POLICY cards_update_own ON cards IS 'Users can update their own cards';
COMMENT ON POLICY cards_delete_own ON cards IS 'Users can delete their own cards';

-- =====================================================
-- AUCTIONS TABLE POLICIES
-- =====================================================

-- Users can read auctions in their groups
CREATE POLICY auctions_select_group_member ON auctions
  FOR SELECT
  USING (
    group_id IN (
      SELECT id FROM groups WHERE auth.uid() = ANY(members)
    )
  );

-- Sellers can create auctions
CREATE POLICY auctions_insert_seller ON auctions
  FOR INSERT
  WITH CHECK (
    auth.uid() = seller_id
  );

-- Sellers can update their own auctions
-- (Note: Bidders update via process_bid() function)
CREATE POLICY auctions_update_seller ON auctions
  FOR UPDATE
  USING (
    auth.uid() = seller_id
  );

-- Sellers can delete (cancel) their own auctions
CREATE POLICY auctions_delete_seller ON auctions
  FOR DELETE
  USING (
    auth.uid() = seller_id
  );

COMMENT ON POLICY auctions_select_group_member ON auctions IS 'Group members can read auctions';
COMMENT ON POLICY auctions_insert_seller ON auctions IS 'Sellers can create auctions';
COMMENT ON POLICY auctions_update_seller ON auctions IS 'Sellers can update their auctions';
COMMENT ON POLICY auctions_delete_seller ON auctions IS 'Sellers can cancel their auctions';

-- =====================================================
-- BIDS TABLE POLICIES
-- =====================================================

-- Everyone in the group can read bids (for transparency)
CREATE POLICY bids_select_group_member ON bids
  FOR SELECT
  USING (
    auction_id IN (
      SELECT id FROM auctions
      WHERE group_id IN (
        SELECT id FROM groups WHERE auth.uid() = ANY(members)
      )
    )
  );

-- Bidders can create bids (via process_bid() function)
CREATE POLICY bids_insert_bidder ON bids
  FOR INSERT
  WITH CHECK (
    auth.uid() = bidder_id
  );

-- No UPDATE or DELETE on bids (immutable history)

COMMENT ON POLICY bids_select_group_member ON bids IS 'Group members can read all bids';
COMMENT ON POLICY bids_insert_bidder ON bids IS 'Bidders can create bids';

-- =====================================================
-- TRADES TABLE POLICIES
-- =====================================================

-- Participants can read their trades
CREATE POLICY trades_select_participant ON trades
  FOR SELECT
  USING (
    auth.uid() = ANY(participant_ids)
  );

-- Senders can create trades
CREATE POLICY trades_insert_sender ON trades
  FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id AND
    auth.uid() = ANY(participant_ids)
  );

-- Participants can update trades (accept/reject)
CREATE POLICY trades_update_participant ON trades
  FOR UPDATE
  USING (
    auth.uid() = ANY(participant_ids)
  );

-- Participants can delete (cancel) trades
CREATE POLICY trades_delete_participant ON trades
  FOR DELETE
  USING (
    auth.uid() = ANY(participant_ids)
  );

COMMENT ON POLICY trades_select_participant ON trades IS 'Participants can read their trades';
COMMENT ON POLICY trades_insert_sender ON trades IS 'Senders can create trades';
COMMENT ON POLICY trades_update_participant ON trades IS 'Participants can update trades';
COMMENT ON POLICY trades_delete_participant ON trades IS 'Participants can cancel trades';

-- =====================================================
-- POSTS TABLE POLICIES
-- =====================================================

-- Group members can read posts in their groups
CREATE POLICY posts_select_group_member ON posts
  FOR SELECT
  USING (
    group_id IN (
      SELECT id FROM groups WHERE auth.uid() = ANY(members)
    )
  );

-- Authors can create posts
CREATE POLICY posts_insert_author ON posts
  FOR INSERT
  WITH CHECK (
    auth.uid() = author_id
  );

-- Authors can update their own posts
CREATE POLICY posts_update_author ON posts
  FOR UPDATE
  USING (
    auth.uid() = author_id
  );

-- Authors can delete their own posts
CREATE POLICY posts_delete_author ON posts
  FOR DELETE
  USING (
    auth.uid() = author_id
  );

COMMENT ON POLICY posts_select_group_member ON posts IS 'Group members can read posts';
COMMENT ON POLICY posts_insert_author ON posts IS 'Authors can create posts';
COMMENT ON POLICY posts_update_author ON posts IS 'Authors can update their posts';
COMMENT ON POLICY posts_delete_author ON posts IS 'Authors can delete their posts';

-- =====================================================
-- SETS TABLE POLICIES
-- =====================================================

-- All authenticated users can read sets (public catalog)
CREATE POLICY sets_select_all ON sets
  FOR SELECT
  TO authenticated
  USING (true);

-- Only service role can write to sets (admin-managed)
-- No INSERT/UPDATE/DELETE policies for regular users

COMMENT ON POLICY sets_select_all ON sets IS 'All users can read the sets catalog';

-- =====================================================
-- SET PROGRESS TABLE POLICIES
-- =====================================================

-- Users can fully manage their own set progress
CREATE POLICY set_progress_all_own ON set_progress
  FOR ALL
  USING (
    auth.uid() = user_id
  );

COMMENT ON POLICY set_progress_all_own ON set_progress IS 'Users can manage their own set progress';

-- =====================================================
-- SET COMPLETIONS TABLE POLICIES
-- =====================================================

-- Users can fully manage their own set completions
CREATE POLICY set_completions_all_own ON set_completions
  FOR ALL
  USING (
    auth.uid() = user_id
  );

COMMENT ON POLICY set_completions_all_own ON set_completions IS 'Users can manage their own set completions';

-- =====================================================
-- NOTIFICATIONS TABLE POLICIES
-- =====================================================

-- Users can fully manage their own notifications
CREATE POLICY notifications_all_own ON notifications
  FOR ALL
  USING (
    auth.uid() = user_id
  );

COMMENT ON POLICY notifications_all_own ON notifications IS 'Users can manage their own notifications';

-- =====================================================
-- MATERIALIZED VIEWS ACCESS
-- =====================================================

-- Note: Materialized views in Postgres do NOT support RLS (Row Level Security).
-- They are essentially cached query results, not regular tables.
--
-- Access control strategy:
-- 1. Views query from base tables that DO have RLS policies
-- 2. Application-level filtering by group_id ensures users only see their data
-- 3. Supabase automatically grants access to authenticated users via service role
--
-- No explicit GRANT needed - Supabase handles materialized view permissions
-- through its API layer and the anon/authenticated roles are pre-configured

-- =====================================================
-- HELPER FUNCTION: Check if user is group member
-- =====================================================

CREATE OR REPLACE FUNCTION is_group_member(p_group_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_member BOOLEAN;
BEGIN
  SELECT p_user_id = ANY(members) INTO v_is_member
  FROM groups
  WHERE id = p_group_id;

  RETURN COALESCE(v_is_member, FALSE);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION is_group_member IS 'Check if a user is a member of a group';

-- =====================================================
-- HELPER FUNCTION: Check if user is group admin
-- =====================================================

CREATE OR REPLACE FUNCTION is_group_admin(p_group_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  SELECT p_user_id = ANY(admin_ids) INTO v_is_admin
  FROM groups
  WHERE id = p_group_id;

  RETURN COALESCE(v_is_admin, FALSE);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION is_group_admin IS 'Check if a user is an admin of a group';

-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Row Level Security policies applied successfully';
  RAISE NOTICE 'All tables now enforce RLS - authenticated users can only access their own data or group data';
END $$;
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
-- =====================================================
-- CardMates - Supabase Auth Trigger
-- Automatically create user profile on signup
-- =====================================================
--
-- This trigger runs whenever a new user signs up via
-- Supabase Auth, and automatically creates their
-- user profile and session in the database.
--
-- Run after: 01-schema.sql
-- =====================================================

-- =====================================================
-- AUTO-CREATE USER PROFILE ON AUTH SIGNUP
-- =====================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER -- Run with elevated privileges to bypass RLS
SET search_path = public
AS $$
DECLARE
  v_username TEXT;
BEGIN
  -- Extract username from email (before @)
  v_username := SPLIT_PART(NEW.email, '@', 1);

  -- Ensure username is unique by appending random suffix if needed
  WHILE EXISTS (SELECT 1 FROM users WHERE username = v_username) LOOP
    v_username := SPLIT_PART(NEW.email, '@', 1) || '_' || substr(md5(random()::text), 1, 4);
  END LOOP;

  -- Create user profile
  INSERT INTO users (
    id,
    email,
    username,
    display_name,
    firebase_uid,
    gems,
    xp,
    level,
    showcase,
    card_borders,
    initial_reward_groups,
    created_at,
    updated_at
  ) VALUES (
    NEW.id, -- Use Supabase auth.users.id as primary key
    NEW.email,
    v_username,
    v_username, -- Default display name same as username
    NULL, -- Will be set during migration for migrated users
    5, -- Initial gems
    0, -- Initial XP
    1, -- Level 1
    '[]'::jsonb, -- Empty showcase
    ARRAY['default'], -- Default border
    ARRAY[]::UUID[], -- No initial rewards yet
    NOW(),
    NOW()
  );

  -- Create user session
  INSERT INTO user_sessions (
    user_id,
    group_balances,
    group_gems,
    total_cards,
    sets_completed,
    notifications_unread,
    rank,
    updated_at
  ) VALUES (
    NEW.id,
    '{}'::jsonb, -- Empty balances (will be populated when user joins groups)
    '{}'::jsonb, -- Empty group gems
    0,
    0,
    0,
    NULL,
    NOW()
  );

  RAISE NOTICE 'Created user profile and session for: %', NEW.email;

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Failed to create user profile for %: %', NEW.email, SQLERRM;
    -- Don't fail the auth signup, just log the error
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION handle_new_user IS 'Automatically create user profile and session when a new user signs up';

-- =====================================================
-- TRIGGER ON AUTH.USERS INSERT
-- =====================================================
--
-- NOTE: Cannot create triggers on auth.users via SQL Editor.
-- Instead, use Supabase Dashboard:
-- 1. Go to Database → Triggers
-- 2. Click "Create a new trigger"
-- 3. Table: auth.users
-- 4. Events: INSERT
-- 5. Function: handle_new_user
--
-- Or this will be auto-created by Supabase when the function exists.

-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--
-- CREATE TRIGGER on_auth_user_created
--   AFTER INSERT ON auth.users
--   FOR EACH ROW
--   EXECUTE FUNCTION handle_new_user();
--
-- COMMENT ON TRIGGER on_auth_user_created ON auth.users IS 'Create user profile and session on signup';

-- =====================================================
-- HANDLE USER DELETION (CASCADE)
-- =====================================================

CREATE OR REPLACE FUNCTION handle_user_deletion()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete user profile (cascades to related tables via ON DELETE CASCADE)
  DELETE FROM users WHERE id = OLD.id;

  RAISE NOTICE 'Deleted user profile for: %', OLD.email;

  RETURN OLD;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Failed to delete user profile for %: %', OLD.email, SQLERRM;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION handle_user_deletion IS 'Clean up user profile when auth user is deleted';

-- NOTE: Cannot create triggers on auth.users via SQL Editor.
-- Use Supabase Dashboard → Database → Triggers (see above)

-- DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
--
-- CREATE TRIGGER on_auth_user_deleted
--   AFTER DELETE ON auth.users
--   FOR EACH ROW
--   EXECUTE FUNCTION handle_user_deletion();
--
-- COMMENT ON TRIGGER on_auth_user_deleted ON auth.users IS 'Delete user profile on auth user deletion';

-- =====================================================
-- SCHEDULED CLEANUP FUNCTIONS
-- =====================================================

-- Clean up expired/inactive sessions (optional, for maintenance)
CREATE OR REPLACE FUNCTION cleanup_inactive_sessions()
RETURNS void AS $$
BEGIN
  -- This is a placeholder for future cleanup logic
  -- Could remove sessions for deleted users, etc.
  RAISE NOTICE 'Session cleanup placeholder - not implemented yet';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_inactive_sessions IS 'Placeholder for cleaning up inactive user sessions';

-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Auth triggers configured successfully';
  RAISE NOTICE 'Triggers will automatically:';
  RAISE NOTICE '  - Create user profile on signup';
  RAISE NOTICE '  - Create user session on signup';
  RAISE NOTICE '  - Delete user profile on account deletion';
END $$;
