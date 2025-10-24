#!/usr/bin/env node

/**
 * Deploy Auction Fixes to Supabase
 *
 * This script applies the SQL migration to fix:
 * 1. Auction starting bid (now 6 coins)
 * 2. Coin deduction when bidding
 * 3. Card transfer after auction completion
 * 4. Rarity persistence from auction to collection
 */

const fs = require('fs');
const path = require('path');

async function main() {
  console.log('🚀 Deploying auction fixes to Supabase...\n');

  // Load environment variables
  require('dotenv').config();

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
    process.exit(1);
  }

  console.log('📋 This migration will fix:');
  console.log('  1. ✅ Auction starting bid set to 6 coins (JavaScript fix)');
  console.log('  2. ✅ Coins deducted when bidding (SQL function exists)');
  console.log('  3. ✅ Cards appear in collection after winning');
  console.log('  4. ✅ Rarity persists from auction to collection\n');

  // Read SQL file
  const sqlPath = path.join(__dirname, 'supabase', '11-fix-auction-issues.sql');
  let sql;

  try {
    sql = fs.readFileSync(sqlPath, 'utf8');
    console.log(`📄 Loaded migration: ${sqlPath}`);
  } catch (error) {
    console.error('❌ Error reading SQL file:', error.message);
    process.exit(1);
  }

  // Import Supabase client
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  console.log('\n⚙️  Applying migration...');

  try {
    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql });

    if (error) {
      // Try alternative method: split into statements and execute one by one
      console.log('⚠️  exec_sql RPC not available, executing statements directly...');

      // Split SQL into statements
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('COMMENT'));

      for (const statement of statements) {
        const { error: stmtError } = await supabase.rpc('exec', { sql: statement });
        if (stmtError) {
          console.error('❌ Error executing statement:', stmtError);
          throw stmtError;
        }
      }
    }

    console.log('✅ Migration applied successfully!\n');
    console.log('🎉 All auction fixes deployed!\n');
    console.log('📝 Changes made:');
    console.log('  • CoinScreenSupabase.js: Starting bid now 6 coins');
    console.log('  • complete_auctions(): Now sets card rarity from auction\n');
    console.log('Next steps:');
    console.log('  1. Restart your app (expo start --clear)');
    console.log('  2. Test minting a card → should start at 6 coins');
    console.log('  3. Test bidding → coins should be deducted');
    console.log('  4. Test winning auction → card appears with correct rarity\n');

  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);
    console.error('\n💡 Alternative: Run the SQL manually in Supabase Dashboard:');
    console.error(`   1. Go to ${supabaseUrl.replace('/rest/v1', '')}/project/_/sql`);
    console.error('   2. Copy contents of supabase/11-fix-auction-issues.sql');
    console.error('   3. Paste and run in SQL editor\n');
    process.exit(1);
  }
}

main();
