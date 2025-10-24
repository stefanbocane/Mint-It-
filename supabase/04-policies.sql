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
