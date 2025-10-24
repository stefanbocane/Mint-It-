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

      -- Update card ownership AND rarity (set to final auction rarity)
      UPDATE cards
      SET
        owner_id = v_auction.current_bidder,
        rarity = v_auction.current_rarity,
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
