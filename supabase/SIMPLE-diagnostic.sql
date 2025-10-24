-- Quick diagnostic to see the exact issue

-- 1. Show first group's members
SELECT
  'Group members array' as info,
  id as group_id,
  name as group_name,
  members
FROM groups
LIMIT 1;

-- 2. For each member in that group, check if they have a profile
WITH first_group AS (
  SELECT id, name, members
  FROM groups
  LIMIT 1
)
SELECT
  'Member profile check' as info,
  member_id,
  u.id IS NOT NULL as has_profile,
  u.username,
  u.display_name,
  u.email
FROM first_group fg
CROSS JOIN unnest(fg.members) as member_id
LEFT JOIN users u ON u.id = member_id;
