-- =====================================================
-- Fix Specific Missing User Profile
-- =====================================================
-- This creates a profile for user ae08a446-e1a0-44f0-aefa-e5cf81e1ad3c
-- and any other auth users that are missing profiles
-- =====================================================

DO $$
DECLARE
  v_user_id UUID := 'ae08a446-e1a0-44f0-aefa-e5cf81e1ad3c';
  v_auth_user RECORD;
  v_username TEXT;
BEGIN
  -- Check if this user exists in auth.users
  SELECT id, email INTO v_auth_user
  FROM auth.users
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE NOTICE '❌ User % does not exist in auth.users - this is an orphaned group membership', v_user_id;
    RAISE NOTICE 'You should remove this user from the group members array';
  ELSE
    RAISE NOTICE '✓ Found user in auth.users: %', v_auth_user.email;

    -- Check if profile already exists
    IF EXISTS (SELECT 1 FROM users WHERE id = v_user_id) THEN
      RAISE NOTICE '✓ User profile already exists';
    ELSE
      RAISE NOTICE '⚠️ User profile missing, creating now...';

      -- Generate unique username
      v_username := COALESCE(SPLIT_PART(v_auth_user.email, '@', 1), 'user');

      WHILE EXISTS (SELECT 1 FROM users WHERE username = v_username) LOOP
        v_username := COALESCE(SPLIT_PART(v_auth_user.email, '@', 1), 'user') || '_' || substr(md5(random()::text), 1, 4);
      END LOOP;

      -- Create user profile
      INSERT INTO users (
        id,
        email,
        username,
        display_name,
        gems,
        xp,
        level,
        showcase,
        card_borders,
        initial_reward_groups,
        created_at,
        updated_at
      ) VALUES (
        v_user_id,
        v_auth_user.email,
        v_username,
        v_username,
        5,
        0,
        1,
        '[]'::jsonb,
        ARRAY['default'],
        ARRAY[]::UUID[],
        NOW(),
        NOW()
      );

      RAISE NOTICE '✅ Created user profile: % (username: %)', v_auth_user.email, v_username;

      -- Create user session
      INSERT INTO user_sessions (
        user_id,
        group_balances,
        group_gems,
        total_cards,
        sets_completed,
        notifications_unread,
        updated_at
      ) VALUES (
        v_user_id,
        '{}'::jsonb,
        '{}'::jsonb,
        0,
        0,
        0,
        NOW()
      )
      ON CONFLICT (user_id) DO NOTHING;

      RAISE NOTICE '✅ Created user session';
    END IF;
  END IF;
END $$;

-- Now run the full migration for ALL missing profiles
DO $$
DECLARE
  v_auth_user RECORD;
  v_username TEXT;
  v_count INT := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Checking ALL auth users for missing profiles...';
  RAISE NOTICE '========================================';

  FOR v_auth_user IN (
    SELECT au.id, au.email
    FROM auth.users au
    LEFT JOIN users u ON u.id = au.id
    WHERE u.id IS NULL
  ) LOOP
    -- Generate unique username
    v_username := COALESCE(SPLIT_PART(v_auth_user.email, '@', 1), 'user');

    WHILE EXISTS (SELECT 1 FROM users WHERE username = v_username) LOOP
      v_username := COALESCE(SPLIT_PART(v_auth_user.email, '@', 1), 'user') || '_' || substr(md5(random()::text), 1, 4);
    END LOOP;

    -- Create user profile
    INSERT INTO users (
      id,
      email,
      username,
      display_name,
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
      v_username,
      5,
      0,
      1,
      '[]'::jsonb,
      ARRAY['default'],
      ARRAY[]::UUID[],
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
      updated_at
    ) VALUES (
      v_auth_user.id,
      '{}'::jsonb,
      '{}'::jsonb,
      0,
      0,
      0,
      NOW()
    )
    ON CONFLICT (user_id) DO NOTHING;

    v_count := v_count + 1;
    RAISE NOTICE '  ✓ Created profile for: % (username: %)', v_auth_user.email, v_username;
  END LOOP;

  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Created % missing profile(s)', v_count;
  RAISE NOTICE '========================================';
END $$;
