-- =====================================================
-- CardMates - Master Setup Script
-- Run ALL migration scripts in correct order
-- =====================================================
--
-- This script runs all database setup scripts in the
-- correct order to fully configure the Supabase database.
--
-- ⚠️  WARNING: This will CREATE all tables, functions,
--     views, policies, and indexes. Only run on a
--     FRESH database or one you want to reset.
--
-- Usage:
-- 1. Open Supabase SQL Editor
-- 2. Copy/paste this entire file
-- 3. Click "Run" to execute
-- 4. Verify completion messages
--
-- =====================================================

-- Enable transaction mode for safety
BEGIN;

-- =====================================================
-- STEP 1: SCHEMA (Tables & Relationships)
-- =====================================================

\echo '📦 Step 1/6: Creating schema (tables, constraints, triggers)...'

-- Include 01-schema.sql contents here
\i 01-schema.sql

\echo '✅ Schema created successfully'
\echo ''

-- =====================================================
-- STEP 2: FUNCTIONS (Business Logic)
-- =====================================================

\echo '🔧 Step 2/6: Creating database functions...'

-- Include 02-functions.sql contents here
\i 02-functions.sql

\echo '✅ Functions created successfully'
\echo ''

-- =====================================================
-- STEP 3: MATERIALIZED VIEWS (Overview Aggregations)
-- =====================================================

\echo '📊 Step 3/6: Creating materialized views...'

-- Include 03-materialized-views.sql contents here
\i 03-materialized-views.sql

\echo '✅ Materialized views created successfully'
\echo ''

-- =====================================================
-- STEP 4: ROW LEVEL SECURITY (Policies)
-- =====================================================

\echo '🔐 Step 4/6: Setting up Row Level Security...'

-- Include 04-policies.sql contents here
\i 04-policies.sql

\echo '✅ RLS policies created successfully'
\echo ''

-- =====================================================
-- STEP 5: INDEXES (Performance Optimization)
-- =====================================================

\echo '⚡ Step 5/6: Creating performance indexes...'

-- Include 05-indexes.sql contents here
\i 05-indexes.sql

\echo '✅ Indexes created successfully'
\echo ''

-- =====================================================
-- STEP 6: AUTH TRIGGERS (Auto User Creation)
-- =====================================================

\echo '👤 Step 6/6: Setting up auth triggers...'

-- Include 06-auth-trigger.sql contents here
\i 06-auth-trigger.sql

\echo '✅ Auth triggers created successfully'
\echo ''

-- =====================================================
-- FINAL VALIDATION
-- =====================================================

DO $$
DECLARE
  v_table_count INT;
  v_view_count INT;
  v_function_count INT;
  v_index_count INT;
  v_policy_count INT;
BEGIN
  -- Count tables
  SELECT COUNT(*) INTO v_table_count
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

  -- Count materialized views
  SELECT COUNT(*) INTO v_view_count
  FROM pg_matviews;

  -- Count functions
  SELECT COUNT(*) INTO v_function_count
  FROM information_schema.routines
  WHERE routine_schema = 'public' AND routine_type = 'FUNCTION';

  -- Count indexes
  SELECT COUNT(*) INTO v_index_count
  FROM pg_indexes
  WHERE schemaname = 'public';

  -- Count policies
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies;

  -- Display summary
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '🎉 CARDMATES DATABASE SETUP COMPLETE!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Summary:';
  RAISE NOTICE '  📦 Tables: %', v_table_count;
  RAISE NOTICE '  📊 Materialized Views: %', v_view_count;
  RAISE NOTICE '  🔧 Functions: %', v_function_count;
  RAISE NOTICE '  ⚡ Indexes: %', v_index_count;
  RAISE NOTICE '  🔐 RLS Policies: %', v_policy_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '  1. Enable Supabase Auth (email/password)';
  RAISE NOTICE '  2. Test authentication flow';
  RAISE NOTICE '  3. Run data migration from Firebase';
  RAISE NOTICE '  4. Update client code to use Supabase';
  RAISE NOTICE '  5. Test in staging environment';
  RAISE NOTICE '  6. Deploy to production';
  RAISE NOTICE '';
  RAISE NOTICE 'Database is ready for use! 🚀';
  RAISE NOTICE '';

  -- Validate expected counts
  IF v_table_count < 12 THEN
    RAISE WARNING 'Expected at least 12 tables, found %', v_table_count;
  END IF;

  IF v_view_count < 5 THEN
    RAISE WARNING 'Expected at least 5 materialized views, found %', v_view_count;
  END IF;

  IF v_function_count < 15 THEN
    RAISE WARNING 'Expected at least 15 functions, found %', v_function_count;
  END IF;

  IF v_policy_count < 20 THEN
    RAISE WARNING 'Expected at least 20 RLS policies, found %', v_policy_count;
  END IF;

END $$;

-- Commit transaction if everything succeeded
COMMIT;

-- =====================================================
-- POST-SETUP VERIFICATION QUERIES
-- =====================================================

-- Uncomment these to verify setup after running:

-- List all tables
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
-- ORDER BY table_name;

-- List all materialized views
-- SELECT matviewname, ispopulated FROM pg_matviews;

-- List all functions
-- SELECT routine_name, routine_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
-- ORDER BY routine_name;

-- List all indexes
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE schemaname = 'public'
-- ORDER BY tablename, indexname;

-- List all RLS policies
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- ORDER BY tablename, policyname;

-- Test bootstrap function (requires test data)
-- SELECT get_bootstrap_payload(
--   '00000000-0000-0000-0000-000000000001'::uuid,
--   '00000000-0000-0000-0000-000000000002'::uuid
-- );
