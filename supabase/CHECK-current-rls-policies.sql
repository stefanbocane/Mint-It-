-- Check what RLS policies currently exist on the users table

SELECT
  policyname,
  cmd,
  permissive,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'users'
ORDER BY policyname;
