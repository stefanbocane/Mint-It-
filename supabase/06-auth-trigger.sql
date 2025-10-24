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
