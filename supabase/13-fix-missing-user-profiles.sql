-- =====================================================
-- Fix Missing User Profiles
-- =====================================================
-- This migration creates user profiles for any auth.users
-- that don't have corresponding entries in the users table.
--
-- Run this ONCE to fix existing users who signed up
-- before the app-side profile creation was implemented.
-- =====================================================

DO $$
DECLARE
  v_auth_user RECORD;
  v_username TEXT;
  v_profile_count INT := 0;
  v_session_count INT := 0;
  v_error_count INT := 0;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Starting migration: Fix Missing User Profiles';
  RAISE NOTICE '========================================';

  RAISE NOTICE 'Step 1: Checking for auth users without profiles...';

  -- Find all auth users without profiles
  FOR v_auth_user IN (
    SELECT au.id, au.email
    FROM auth.users au
    LEFT JOIN users u ON u.id = au.id
    WHERE u.id IS NULL
    ORDER BY au.created_at
  ) LOOP
    BEGIN
      -- Extract username from email
      v_username := COALESCE(SPLIT_PART(v_auth_user.email, '@', 1), 'user');

      -- Ensure username is unique
      WHILE EXISTS (SELECT 1 FROM users WHERE username = v_username) LOOP
        v_username := COALESCE(SPLIT_PART(v_auth_user.email, '@', 1), 'user') || '_' || substr(md5(random()::text), 1, 4);
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
        v_auth_user.id,
        v_auth_user.email,
        v_username,
        v_username, -- Default display name same as username
        NULL,
        5, -- Initial gems
        0, -- Initial XP
        1, -- Level 1
        '[]'::jsonb, -- Empty showcase
        ARRAY['default'], -- Default border
        ARRAY[]::UUID[], -- No initial rewards yet
        NOW(),
        NOW()
      );

      v_profile_count := v_profile_count + 1;
      RAISE NOTICE '  ✓ Created profile for: % (username: %)', v_auth_user.email, v_username;

      -- Create user session if it doesn't exist
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
        v_auth_user.id,
        '{}'::jsonb,
        '{}'::jsonb,
        0,
        0,
        0,
        NULL,
        NOW()
      )
      ON CONFLICT (user_id) DO NOTHING; -- Skip if session already exists

      IF NOT FOUND THEN
        v_session_count := v_session_count + 1;
        RAISE NOTICE '  ✓ Created session for: %', v_auth_user.email;
      END IF;

    EXCEPTION
      WHEN OTHERS THEN
        v_error_count := v_error_count + 1;
        RAISE WARNING '  ✗ Failed to create profile for %: %', v_auth_user.email, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Migration complete!';
  RAISE NOTICE '  - User profiles created: %', v_profile_count;
  RAISE NOTICE '  - User sessions created: %', v_session_count;
  RAISE NOTICE '  - Errors encountered: %', v_error_count;
  RAISE NOTICE '========================================';
END $$;
