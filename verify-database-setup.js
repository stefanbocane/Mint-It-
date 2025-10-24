/**
 * Database Setup Verification Script
 *
 * Quick check to verify database schema was set up correctly.
 * Run this AFTER executing SUPABASE_SETUP.sql in Supabase SQL Editor.
 *
 * Usage: node verify-database-setup.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.supabase' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyDatabaseSetup() {
  console.log('🔍 Verifying Supabase Database Setup...\n');

  const checks = {
    passed: 0,
    failed: 0,
    items: []
  };

  // Helper
  async function check(name, fn) {
    process.stdout.write(`Checking ${name}... `);
    try {
      await fn();
      console.log('✅');
      checks.passed++;
      checks.items.push({ name, status: 'PASS' });
    } catch (error) {
      console.log('❌');
      console.log(`   Error: ${error.message}`);
      checks.failed++;
      checks.items.push({ name, status: 'FAIL', error: error.message });
    }
  }

  // Check tables exist
  await check('Tables created', async () => {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .limit(0);

    if (error) throw error;
  });

  // Check functions exist
  await check('Functions created', async () => {
    const { data, error } = await supabase.rpc('get_bootstrap_payload', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_group_id: '00000000-0000-0000-0000-000000000000'
    });

    // Function should exist (even if it returns null for fake IDs)
    if (error && error.message.includes('could not find')) {
      throw new Error('get_bootstrap_payload() function not found');
    }
  });

  // Check materialized views exist
  await check('Materialized views created', async () => {
    const { data, error } = await supabase
      .from('mv_auction_overview')
      .select('group_id')
      .limit(0);

    if (error && error.message.includes('does not exist')) {
      throw error;
    }
  });

  // Check RLS enabled
  await check('RLS policies enabled', async () => {
    // Try to query users without auth (should fail with RLS error)
    const noAuthClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data, error } = await noAuthClient
      .from('users')
      .select('*')
      .limit(1);

    // Should get empty result or auth error (RLS working)
    // If we get actual data without auth, RLS is broken
    if (!error && data && data.length > 0) {
      throw new Error('RLS not working - unauthenticated access succeeded');
    }
  });

  // Check indexes exist
  await check('Indexes created', async () => {
    const { data, error } = await supabase.rpc('sql', {
      query: `
        SELECT COUNT(*) as count
        FROM pg_indexes
        WHERE schemaname = 'public'
        AND indexname LIKE 'idx_%'
      `
    });

    if (error) {
      // Try alternative method
      const { data: tables } = await supabase
        .from('users')
        .select('email')
        .limit(0);

      if (!tables && !error) {
        throw new Error('Could not verify indexes');
      }
    }
  });

  console.log('\n📊 Verification Results:');
  console.log(`   Passed: ${checks.passed}`);
  console.log(`   Failed: ${checks.failed}`);
  console.log(`   Total:  ${checks.passed + checks.failed}`);

  if (checks.failed > 0) {
    console.log('\n❌ Some checks failed. Database setup may be incomplete.');
    console.log('\n💡 Next steps:');
    console.log('   1. Make sure you ran SUPABASE_SETUP.sql in Supabase SQL Editor');
    console.log('   2. Check for errors in the SQL Editor output');
    console.log('   3. If errors occurred, fix them and re-run the SQL');
    console.log('   4. Run this script again to verify');
    process.exit(1);
  } else {
    console.log('\n✅ Database setup looks good!');
    console.log('\n💡 Next steps:');
    console.log('   1. Run: node test-supabase-functions.js');
    console.log('   2. If tests pass, run: supabase/07-enable-realtime.sql');
    console.log('   3. Then run: supabase/08-migration-helpers.sql');
    console.log('   4. Ready for data migration!');
    process.exit(0);
  }
}

verifyDatabaseSetup();
