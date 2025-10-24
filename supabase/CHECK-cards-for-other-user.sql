-- Check if the other user has cards and why they're not showing

-- 1. Check all cards in the group (bypassing app filters)
SELECT
  'All cards in group' as info,
  owner_id,
  COUNT(*) as card_count,
  array_agg(DISTINCT rarity) as rarities,
  array_agg(DISTINCT status) as statuses
FROM cards
WHERE group_id = '10198c7b-2718-499f-84b5-4a8aa7964e4d'
GROUP BY owner_id;

-- 2. Check cards for the specific user showing 0 cards
SELECT
  'Cards for user ae08a446' as info,
  id,
  name,
  rarity,
  status,
  in_auction,
  in_trade,
  owner_id
FROM cards
WHERE owner_id = 'ae08a446-e1a0-44f0-aefa-e5cf81e1ad3c'
  AND group_id = '10198c7b-2718-499f-84b5-4a8aa7964e4d';

-- 3. Check RLS policies on cards table
SELECT
  'Cards RLS policies' as info,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'cards'
ORDER BY policyname;
