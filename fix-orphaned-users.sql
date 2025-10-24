-- =====================================================
-- Fix Orphaned Users (Auth exists but no profile)
-- =====================================================
-- This script creates user profiles for any auth.users
-- that don't have a corresponding entry in the users table
-- =====================================================

-- STEP 1: Identify orphaned users
-- Run this to see which users need to be fixed
SELECT
  au.id,
  au.email,
  au.created_at,
  au.last_sign_in_at,
  CASE
    WHEN u.id IS NULL THEN '❌ Missing Profile'
    ELSE '✅ Has Profile'
  END as status
FROM auth.users au
LEFT JOIN users u ON u.id = au.id
ORDER BY au.created_at DESC;

-- =====================================================
-- STEP 2: Create profiles for orphaned users
-- =====================================================
-- This will call handle_new_user for each orphaned user

DO $$
DECLARE
  v_orphaned_user RECORD;
  v_username TEXT;
  v_count INT := 0;
BEGIN
  -- Loop through all auth users without profiles
  FOR v_orphaned_user IN
    SELECT au.id, au.email
    FROM auth.users au
    LEFT JOIN users u ON u.id = au.id
    WHERE u.id IS NULL
  LOOP
    -- Generate unique username from email
    v_username := SPLIT_PART(v_orphaned_user.email, '@', 1);

    -- Make it unique if needed
    WHILE EXISTS (SELECT 1 FROM users WHERE username = v_username) LOOP
      v_username := SPLIT_PART(v_orphaned_user.email, '@', 1) || '_' || substr(md5(random()::text), 1, 4);
    END LOOP;

    -- Create user profile
    INSERT INTO users (
      id,
      email,
      username,
      display_name,
      created_at,
      updated_at
    ) VALUES (
      v_orphaned_user.id,
      v_orphaned_user.email,
      v_username,
      v_username,
      NOW(),
      NOW()
    );

    -- Create user session
    INSERT INTO user_sessions (
      user_id,
      group_balances,
      group_gems,
      coins,
      gems,
      xp,
      last_active_group,
      updated_at
    ) VALUES (
      v_orphaned_user.id,
      '{}'::jsonb,
      '{}'::jsonb,
      0,
      0,
      0,
      NULL,
      NOW()
    );

    v_count := v_count + 1;
    RAISE NOTICE 'Created profile for: % (username: %)', v_orphaned_user.email, v_username;
  END LOOP;

  RAISE NOTICE 'Fixed % orphaned user(s)', v_count;
END $$;

-- =====================================================
-- STEP 3: Verify the fix
-- =====================================================
-- Run this to confirm all users now have profiles

SELECT
  'Total auth users' as metric,
  COUNT(*) as count
FROM auth.users
UNION ALL
SELECT
  'Users with profiles' as metric,
  COUNT(*) as count
FROM auth.users au
INNER JOIN users u ON u.id = au.id
UNION ALL
SELECT
  'Orphaned users' as metric,
  COUNT(*) as count
FROM auth.users au
LEFT JOIN users u ON u.id = au.id
WHERE u.id IS NULL;

-- =====================================================
-- CLEANUP: Remove users from groups if they don't exist
-- =====================================================
-- Optional: Clean up group memberships for deleted auth users

DO $$
DECLARE
  v_group RECORD;
  v_valid_members UUID[];
  v_cleaned_count INT := 0;
BEGIN
  FOR v_group IN SELECT id, members FROM groups LOOP
    -- Filter to only members that exist in auth.users
    SELECT ARRAY_AGG(m)
    INTO v_valid_members
    FROM unnest(v_group.members) m
    WHERE m IN (SELECT id FROM auth.users);

    -- Update if there are invalid members
    IF COALESCE(array_length(v_valid_members, 1), 0) < COALESCE(array_length(v_group.members, 1), 0) THEN
      UPDATE groups
      SET
        members = COALESCE(v_valid_members, ARRAY[]::UUID[]),
        member_count = COALESCE(array_length(v_valid_members, 1), 0),
        updated_at = NOW()
      WHERE id = v_group.id;

      v_cleaned_count := v_cleaned_count + 1;
      RAISE NOTICE 'Cleaned group %: % -> % members',
        v_group.id,
        array_length(v_group.members, 1),
        COALESCE(array_length(v_valid_members, 1), 0);
    END IF;
  END LOOP;

  RAISE NOTICE 'Cleaned % group(s)', v_cleaned_count;
END $$;
