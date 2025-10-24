-- Verify the user profile was actually created

-- 1. Check with RLS disabled (as superuser)
SELECT
  'Users table (bypassing RLS)' as check,
  COUNT(*) as total_users
FROM users;

-- 2. Check for specific user
SELECT
  'Specific user check' as check,
  id,
  email,
  username,
  display_name,
  created_at
FROM users
WHERE id = 'ae08a446-e1a0-44f0-aefa-e5cf81e1ad3c';

-- 3. Check if RLS is enabled on users table
SELECT
  'RLS status' as check,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'users';

-- 4. Show all RLS policies on users table
SELECT
  'RLS policies on users table' as check,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users';

-- 5. Try to select all users (this might be blocked by RLS)
SELECT
  'All users (may be filtered by RLS)' as check,
  id,
  email,
  username,
  display_name
FROM users
ORDER BY created_at DESC
LIMIT 10;
