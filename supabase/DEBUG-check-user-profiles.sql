-- =====================================================
-- Debug: Check User Profiles Status
-- =====================================================
-- This script helps diagnose why users show as "Incomplete"
-- =====================================================

-- Step 1: Count auth users vs profiles
SELECT
  'Total auth users' as metric,
  COUNT(*) as count
FROM auth.users
UNION ALL
SELECT
  'Total user profiles' as metric,
  COUNT(*) as count
FROM users
UNION ALL
SELECT
  'Auth users WITHOUT profiles' as metric,
  COUNT(*) as count
FROM auth.users au
LEFT JOIN users u ON u.id = au.id
WHERE u.id IS NULL;

-- Step 2: Show auth users without profiles (if any)
SELECT
  '--- Auth users WITHOUT profiles ---' as section,
  au.id,
  au.email,
  au.created_at
FROM auth.users au
LEFT JOIN users u ON u.id = au.id
WHERE u.id IS NULL
ORDER BY au.created_at DESC;

-- Step 3: Show user profiles with their data
SELECT
  '--- User profiles (first 20) ---' as section,
  u.id,
  u.email,
  u.username,
  u.display_name,
  CASE
    WHEN u.username IS NULL THEN 'MISSING USERNAME'
    WHEN u.display_name IS NULL THEN 'MISSING DISPLAY_NAME'
    ELSE 'OK'
  END as status
FROM users u
ORDER BY u.created_at DESC
LIMIT 20;

-- Step 4: Check if members in groups have profiles
-- (This checks if group members are pointing to users that don't have profiles)
SELECT
  '--- Checking group members ---' as section,
  g.id as group_id,
  g.name as group_name,
  array_length(g.members, 1) as member_count,
  (
    SELECT COUNT(*)
    FROM unnest(g.members) AS member_id
    LEFT JOIN users u ON u.id = member_id
    WHERE u.id IS NULL
  ) as members_without_profiles
FROM groups g
ORDER BY g.created_at DESC
LIMIT 10;

-- Step 5: Show actual members and their profile status for first group
SELECT
  '--- Detailed member check for first group ---' as section,
  g.name as group_name,
  member_id,
  u.username,
  u.display_name,
  u.email,
  CASE
    WHEN u.id IS NULL THEN '❌ NO PROFILE'
    WHEN u.username IS NULL THEN '⚠️ MISSING USERNAME'
    WHEN u.display_name IS NULL THEN '⚠️ MISSING DISPLAY_NAME'
    ELSE '✅ OK'
  END as profile_status
FROM (
  SELECT g.name, unnest(g.members) as member_id
  FROM groups g
  ORDER BY g.created_at DESC
  LIMIT 1
) g
LEFT JOIN users u ON u.id = g.member_id;
