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
  border_type TEXT DEFAULT 'default', -- Custom border type from store

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
