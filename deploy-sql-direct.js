#!/usr/bin/env node

/**
 * Direct SQL Deployment to Supabase
 *
 * Uses the Supabase PostgREST API to execute SQL directly
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://REDACTED_SUPABASE_URL';
const envContent = fs.readFileSync(path.join(__dirname, '.env.supabase'), 'utf8');
const SERVICE_ROLE_KEY = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();

async function executeSQLDirect(sql, description) {
  console.log(`\n📄 Executing: ${description}`);

  try {
    // Use Supabase's query endpoint
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ query: sql })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log(`   ✅ ${description} completed successfully`);
    return { success: true, result };

  } catch (error) {
    console.log(`   ⚠️  ${description}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function deployViaPsql(sqlFile, description) {
  console.log(`\n📄 Deploying: ${description}`);

  const { execSync } = require('child_process');

  // Get connection string from Supabase Dashboard → Settings → Database
  // Format: postgresql://postgres:[PASSWORD]@db.REDACTED_SUPABASE_URL:5432/postgres

  console.log(`   ℹ️  SQL file ready: ${sqlFile}`);
  console.log('   📋 To deploy manually:');
  console.log('       1. Open: https://supabase.com/dashboard/project/ikizpnzgknmfhdituyyk/sql');
  console.log('       2. Click "New Query"');
  console.log(`       3. Copy contents of: ${path.basename(sqlFile)}`);
  console.log('       4. Paste and click RUN');

  return { success: false, manual: true };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📤 Deploying SQL to Supabase');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Deploy migrations
  const migrationsSQL = fs.readFileSync(path.join(__dirname, 'temp-migrations.sql'), 'utf8');
  await deployViaPsql('temp-migrations.sql', 'User Profile & Daily Claims Migrations');

  // Deploy storage policies
  const policiesSQL = fs.readFileSync(path.join(__dirname, 'temp-storage-policies.sql'), 'utf8');
  await deployViaPsql('temp-storage-policies.sql', 'Storage RLS Policies');

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📋 Manual Deployment Required');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('🔗 Open Supabase SQL Editor:');
  console.log('   https://supabase.com/dashboard/project/ikizpnzgknmfhdituyyk/sql\n');

  console.log('📝 Step 1: Deploy Migrations (temp-migrations.sql)');
  console.log('   - Creates ensure_user_profile() function');
  console.log('   - Adds last_daily_claim column\n');

  console.log('📝 Step 2: Deploy Storage Policies (temp-storage-policies.sql)');
  console.log('   - Upload, Read, Update, Delete policies for cards bucket\n');

  console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
