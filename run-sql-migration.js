#!/usr/bin/env node

/**
 * Direct SQL Migration Runner for Supabase
 *
 * Uses Supabase client to run SQL migrations directly
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Your Supabase credentials
const SUPABASE_URL = 'https://REDACTED_SUPABASE_URL';
const SERVICE_ROLE_KEY = 'REDACTED_SUPABASE_SERVICE_ROLE_KEY';

// Create Supabase client with service role
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function runSQLFile(filePath, name) {
  console.log(`\n🔄 Running: ${name}...`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return false;
  }

  const sql = fs.readFileSync(filePath, 'utf8');

  try {
    // Use the SQL query endpoint
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ sql })
    });

    if (!response.ok) {
      const errorText = await response.text();

      // Try alternative approach using the SQL editor endpoint
      console.log('  Trying alternative method...');

      const { data, error } = await supabase.rpc('exec_sql', { query: sql });

      if (error) {
        console.error(`❌ Failed: ${error.message}`);
        return false;
      }
    }

    console.log(`✅ ${name} completed successfully`);
    return true;
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Supabase SQL Migration Runner');
  console.log(`📍 Target: ${SUPABASE_URL}`);

  const migrations = [
    {
      file: path.join(__dirname, 'supabase', '09-user-profile-init.sql'),
      name: 'User Profile Initialization Function'
    },
    {
      file: path.join(__dirname, 'supabase', '10-add-daily-claim-column.sql'),
      name: 'Daily Claim Column Addition'
    }
  ];

  let successCount = 0;

  for (const migration of migrations) {
    const success = await runSQLFile(migration.file, migration.name);
    if (success) successCount++;
  }

  console.log('');
  console.log(`📊 Results: ${successCount}/${migrations.length} migrations succeeded`);

  if (successCount === migrations.length) {
    console.log('');
    console.log('✅ All migrations completed!');
    console.log('');
    console.log('📝 Next steps:');
    console.log('  1. Set up Storage bucket (see SUPABASE_STORAGE_SETUP.md)');
    console.log('  2. Test card minting');
  } else {
    console.log('');
    console.log('⚠️  Some migrations failed. Please run them manually in Supabase Dashboard.');
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
