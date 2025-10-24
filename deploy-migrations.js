#!/usr/bin/env node

/**
 * Deploy Supabase Migrations
 *
 * This script deploys SQL migrations to Supabase using the Management API
 *
 * Usage:
 *   node deploy-migrations.js
 *
 * You'll be prompted for your SERVICE_ROLE_KEY if not in environment
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SUPABASE_URL = 'https://REDACTED_SUPABASE_URL';

async function promptForKey() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('Enter your Supabase SERVICE_ROLE_KEY: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function runSQL(sql, serviceRoleKey) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`
      },
      body: JSON.stringify({ query: sql })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }

    return await response.json();
  } catch (error) {
    throw new Error(`Failed to execute SQL: ${error.message}`);
  }
}

async function deployMigration(filePath, name, serviceRoleKey) {
  console.log(`\n🔄 Deploying: ${name}...`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return false;
  }

  const sql = fs.readFileSync(filePath, 'utf8');

  try {
    await runSQL(sql, serviceRoleKey);
    console.log(`✅ ${name} deployed successfully`);
    return true;
  } catch (error) {
    console.error(`❌ ${name} failed: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Supabase Migration Deployment');
  console.log(`📍 Target: ${SUPABASE_URL}`);
  console.log('');

  // Get service role key
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || await promptForKey();

  if (!serviceRoleKey) {
    console.error('❌ SERVICE_ROLE_KEY is required');
    process.exit(1);
  }

  console.log('✅ Credentials provided');

  // Deploy migrations
  const migrations = [
    {
      file: path.join(__dirname, 'supabase', '09-user-profile-init.sql'),
      name: 'User Profile Initialization'
    },
    {
      file: path.join(__dirname, 'supabase', '10-add-daily-claim-column.sql'),
      name: 'Daily Claim Column'
    }
  ];

  let successCount = 0;
  for (const migration of migrations) {
    const success = await deployMigration(migration.file, migration.name, serviceRoleKey);
    if (success) successCount++;
  }

  console.log('');
  console.log(`✅ Deployed ${successCount}/${migrations.length} migrations`);

  if (successCount === migrations.length) {
    console.log('');
    console.log('📝 Next steps:');
    console.log('  1. Set up Storage bucket: node setup-storage.js');
    console.log('  2. Test card minting');
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
