#!/usr/bin/env node

/**
 * Execute SQL directly on Supabase using service role key
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://REDACTED_SUPABASE_URL';
const envContent = fs.readFileSync(path.join(__dirname, '.env.supabase'), 'utf8');
const SERVICE_ROLE_KEY = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'public' }
});

async function executeSQL(sqlContent, description) {
  console.log(`\n🔧 Executing: ${description}`);

  try {
    // Split SQL into statements (handle complex splitting)
    const statements = sqlContent
      .split(/;\s*$$/m)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.match(/^--/));

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (!statement || statement.length < 5) continue;

      console.log(`   [${i + 1}/${statements.length}] Executing...`);

      // Use raw SQL execution via the rpc endpoint
      const { data, error } = await supabase.rpc('exec', { sql: statement });

      if (error) {
        // If exec doesn't exist, we need to execute via fetch
        throw error;
      }
    }

    console.log(`   ✅ ${description} completed successfully`);
    return { success: true };

  } catch (error) {
    console.log(`   ⚠️  Standard method failed: ${error.message}`);
    console.log(`   🔄 Trying direct API method...`);

    // Try direct fetch to postgres
    return await executeSQLDirect(sqlContent, description);
  }
}

async function executeSQLDirect(sqlContent, description) {
  try {
    // Use the postgres REST API directly
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        name: 'exec',
        args: { sql: sqlContent }
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    console.log(`   ✅ ${description} completed via direct API`);
    return { success: true };

  } catch (error) {
    console.log(`   ❌ Direct API also failed: ${error.message}`);
    console.log(`   📋 Will write individual statements to separate files...`);
    return { success: false, error: error.message };
  }
}

async function executeSQLViaPostgres(sqlContent, description) {
  console.log(`\n🗄️  Executing via direct postgres connection: ${description}`);

  try {
    const { Client } = require('pg');

    // Connection string format from Supabase
    const connectionString = `postgresql://postgres.ikizpnzgknmfhdituyyk:${process.env.SUPABASE_DB_PASSWORD || '[PASSWORD]'}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;

    const client = new Client({ connectionString });
    await client.connect();

    // Execute the SQL
    await client.query(sqlContent);
    await client.end();

    console.log(`   ✅ ${description} completed via postgres`);
    return { success: true };

  } catch (error) {
    console.log(`   ⚠️  Postgres method failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🚀 Deploying SQL to Supabase');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\n📍 Project: ${SUPABASE_URL}`);
  console.log(`🔑 Service Role: ${SERVICE_ROLE_KEY ? '✅ Loaded' : '❌ Missing'}\n`);

  // Read SQL files
  const migrationsSQL = fs.readFileSync(path.join(__dirname, 'temp-migrations.sql'), 'utf8');
  const policiesSQL = fs.readFileSync(path.join(__dirname, 'temp-storage-policies.sql'), 'utf8');

  // Try to execute
  const migrationResult = await executeSQL(migrationsSQL, 'User Profile & Daily Claims');
  const policiesResult = await executeSQL(policiesSQL, 'Storage RLS Policies');

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 Deployment Summary');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Migrations:', migrationResult.success ? '✅ Success' : '❌ Failed');
  console.log('Policies:', policiesResult.success ? '✅ Success' : '❌ Failed');

  if (!migrationResult.success || !policiesResult.success) {
    console.log('\n⚠️  Automated deployment not fully successful');
    console.log('📋 Please use manual deployment via SQL Editor');
    console.log('🔗 https://supabase.com/dashboard/project/ikizpnzgknmfhdituyyk/sql\n');
  } else {
    console.log('\n✅ All SQL deployed successfully!\n');
  }
}

main().catch(console.error);
