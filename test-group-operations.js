/**
 * Quick diagnostic script to test group operations
 *
 * This will help diagnose why joining groups isn't working.
 *
 * Usage: node test-group-operations.js
 */

const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://REDACTED_SUPABASE_URL';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!SUPABASE_ANON_KEY) {
  console.error('❌ EXPO_PUBLIC_SUPABASE_ANON_KEY not found in environment');
  console.log('💡 Create a .env file with:');
  console.log('   EXPO_PUBLIC_SUPABASE_URL=your_url');
  console.log('   EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testGroupOperations() {
  console.log('🔍 Testing Supabase Group Operations\n');
  console.log(`📡 Connecting to: ${SUPABASE_URL}\n`);

  // Test 1: Can we connect to the groups table?
  console.log('Test 1: Checking groups table access...');
  try {
    const { data, error } = await supabase
      .from('groups')
      .select('id, name')
      .limit(1);

    if (error) {
      console.error('❌ Cannot access groups table');
      console.error(`   Error: ${error.message}`);
      console.log('\n💡 This means either:');
      console.log('   1. The groups table doesn\'t exist in your Supabase database');
      console.log('   2. RLS (Row Level Security) is blocking anonymous access');
      console.log('\n🔧 Fix:');
      console.log('   Run the SQL setup scripts in your Supabase SQL Editor');
      console.log('   Files: supabase/*.sql');
      return false;
    } else {
      console.log('✅ Groups table accessible');
    }
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    return false;
  }

  // Test 2: Are there any groups?
  console.log('\nTest 2: Checking for existing groups...');
  try {
    const { data: groups, error } = await supabase
      .from('groups')
      .select('*')
      .eq('is_private', false);

    if (error) {
      console.error('❌ Error querying groups:', error.message);
      return false;
    }

    console.log(`✅ Found ${groups?.length || 0} public groups`);

    if (groups && groups.length > 0) {
      console.log('\n📋 Public groups:');
      groups.forEach(g => {
        console.log(`   - ${g.name} (${g.member_count || 0} members)`);
      });
    } else {
      console.log('\n⚠️  No public groups exist yet');
      console.log('💡 You need to create a group first using the app');
    }
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    return false;
  }

  // Test 3: Check if RPC functions exist
  console.log('\nTest 3: Checking RPC functions...');
  try {
    // Test update_user_balance
    const { error: rpcError1 } = await supabase.rpc('update_user_balance', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_group_id: '00000000-0000-0000-0000-000000000000',
      p_amount: 0,
      p_context: 'test'
    });

    if (rpcError1 && rpcError1.message.includes('could not find')) {
      console.log('❌ update_user_balance() function not found');
      console.log('💡 Run the SQL migration scripts in Supabase');
    } else {
      console.log('✅ update_user_balance() function exists');
    }
  } catch (error) {
    console.log('⚠️  Could not test RPC functions');
  }

  console.log('\n✅ Diagnostic complete!\n');
  console.log('📝 Summary:');
  console.log('   1. Make sure your .env file has correct Supabase credentials');
  console.log('   2. Run SQL setup scripts in Supabase SQL Editor if needed');
  console.log('   3. Create at least one public group to test joining');
  console.log('   4. Check the app console logs when trying to join for detailed errors\n');

  return true;
}

testGroupOperations()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
