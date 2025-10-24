-- Check why the migration might have missed this user

-- 1. Does this user exist in auth.users?
SELECT
  'Check auth.users' as step,
  id,
  email,
  created_at,
  email_confirmed_at,
  deleted_at
FROM auth.users
WHERE id = 'ae08a446-e1a0-44f0-aefa-e5cf81e1ad3c';

-- 2. Does this user have a profile?
SELECT
  'Check users table' as step,
  id,
  email,
  username,
  display_name,
  created_at
FROM users
WHERE id = 'ae08a446-e1a0-44f0-aefa-e5cf81e1ad3c';

-- 3. Show ALL auth users without profiles
SELECT
  'All auth users without profiles' as step,
  au.id,
  au.email,
  au.created_at,
  au.email_confirmed_at
FROM auth.users au
LEFT JOIN users u ON u.id = au.id
WHERE u.id IS NULL;
