-- =====================================================
-- CardMates - User Profile Initialization Function
-- Creates user profile when missing (bypasses RLS)
-- =====================================================
--
-- This function is needed because:
-- 1. auth.users (Supabase Auth) is separate from users (custom table)
-- 2. The auth trigger might not be configured in all environments
-- 3. RLS policies prevent direct INSERT on users table
-- 4. SECURITY DEFINER allows this function to bypass RLS
--
-- =====================================================

-- =====================================================
-- ENSURE USER PROFILE EXISTS
-- =====================================================

CREATE OR REPLACE FUNCTION ensure_user_profile(
  p_user_id UUID,
  p_email TEXT
)
RETURNS JSONB
SECURITY DEFINER -- Run with elevated privileges to bypass RLS
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_username TEXT;
  v_user_exists BOOLEAN;
  v_result JSONB;
BEGIN
  -- Check if user already exists
  SELECT EXISTS(SELECT 1 FROM users WHERE id = p_user_id) INTO v_user_exists;

  IF v_user_exists THEN
    -- User already exists, return success
    RETURN jsonb_build_object(
      'success', true,
      'created', false,
      'message', 'User profile already exists'
    );
  END IF;

  -- User doesn't exist, create it
  RAISE NOTICE 'Creating user profile for: %', p_email;

  -- Extract username from email (before @)
  v_username := SPLIT_PART(p_email, '@', 1);

  -- Ensure username is unique by appending random suffix if needed
  WHILE EXISTS (SELECT 1 FROM users WHERE username = v_username) LOOP
    v_username := SPLIT_PART(p_email, '@', 1) || '_' || substr(md5(random()::text), 1, 4);
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
    p_user_id,
    p_email,
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
    p_user_id,
    '{}'::jsonb, -- Empty balances (will be populated when user joins groups)
    '{}'::jsonb, -- Empty group gems
    0,
    0,
    0,
    NULL,
    NOW()
  );

  RAISE NOTICE 'Created user profile and session for: %', p_email;

  RETURN jsonb_build_object(
    'success', true,
    'created', true,
    'username', v_username,
    'message', 'User profile created successfully'
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Failed to create user profile for %: %', p_email, SQLERRM;
    RETURN jsonb_build_object(
      'success', false,
      'created', false,
      'error', SQLERRM,
      'message', 'Failed to create user profile'
    );
END;
$$;

COMMENT ON FUNCTION ensure_user_profile IS 'Creates user profile if missing, bypassing RLS (SECURITY DEFINER)';

-- =====================================================
-- GRANT EXECUTE TO AUTHENTICATED USERS
-- =====================================================

GRANT EXECUTE ON FUNCTION ensure_user_profile TO authenticated;

-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ User profile initialization function created';
  RAISE NOTICE 'Function: ensure_user_profile(user_id, email)';
  RAISE NOTICE 'Returns: { success, created, username?, error? }';
END $$;


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
