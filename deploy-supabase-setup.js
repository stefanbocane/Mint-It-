/**
 * Supabase Setup Deployment Script
 *
 * This script:
 * 1. Deploys SQL migrations (09-user-profile-init.sql, 10-add-daily-claim-column.sql)
 * 2. Creates the 'cards' storage bucket
 * 3. Sets up RLS policies for the storage bucket
 *
 * Run with: node deploy-supabase-setup.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://REDACTED_SUPABASE_URL';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// We need the service role key for admin operations
// This should be in your .env file or Supabase dashboard -> Settings -> API
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in environment variables');
  console.log('📝 To fix this:');
  console.log('   1. Go to Supabase Dashboard → Settings → API');
  console.log('   2. Copy the "service_role" key (NOT the anon key)');
  console.log('   3. Add to .env file: SUPABASE_SERVICE_ROLE_KEY=your_service_role_key');
  console.log('');
  console.log('⚠️  Falling back to manual deployment instructions...\n');

  printManualInstructions();
  process.exit(0);
}

// Create Supabase client with service role key for admin operations
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function deploySQLMigration(filePath, migrationName) {
  console.log(`\n📄 Deploying ${migrationName}...`);

  try {
    const sqlContent = fs.readFileSync(filePath, 'utf8');

    // Execute SQL using Supabase's RPC endpoint
    // Note: Supabase client doesn't have a direct SQL execution method
    // We need to use the REST API directly
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ query: sqlContent })
    });

    if (!response.ok) {
      // If RPC method doesn't exist, we need to use the SQL Editor via Management API
      console.log('⚠️  Direct SQL execution not available via client');
      console.log('📋 Migration SQL ready at:', filePath);
      return { success: false, method: 'manual' };
    }

    console.log(`✅ ${migrationName} deployed successfully`);
    return { success: true };

  } catch (error) {
    console.error(`❌ Error deploying ${migrationName}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function createStorageBucket() {
  console.log('\n🗂️  Creating storage bucket "cards"...');

  try {
    const { data, error } = await supabase.storage.createBucket('cards', {
      public: true,
      fileSizeLimit: 5242880, // 5 MB in bytes
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/jpg']
    });

    if (error) {
      if (error.message.includes('already exists')) {
        console.log('✅ Bucket "cards" already exists');
        return { success: true, alreadyExists: true };
      }
      throw error;
    }

    console.log('✅ Storage bucket "cards" created successfully');
    return { success: true };

  } catch (error) {
    console.error('❌ Error creating storage bucket:', error.message);
    return { success: false, error: error.message };
  }
}

async function setupStoragePolicies() {
  console.log('\n🔐 Setting up storage RLS policies...');

  // Storage policies need to be created via SQL
  const policies = [
    {
      name: 'users_upload_own_folder',
      sql: `
        CREATE POLICY IF NOT EXISTS "Users can upload to own folder"
        ON storage.objects FOR INSERT
        TO authenticated
        WITH CHECK (
          bucket_id = 'cards' AND
          (storage.foldername(name))[1] = auth.uid()::text
        );
      `
    },
    {
      name: 'public_read_access',
      sql: `
        CREATE POLICY IF NOT EXISTS "Public read access"
        ON storage.objects FOR SELECT
        TO public
        USING (bucket_id = 'cards');
      `
    },
    {
      name: 'users_update_own_files',
      sql: `
        CREATE POLICY IF NOT EXISTS "Users can update own files"
        ON storage.objects FOR UPDATE
        TO authenticated
        USING (
          bucket_id = 'cards' AND
          (storage.foldername(name))[1] = auth.uid()::text
        );
      `
    },
    {
      name: 'users_delete_own_files',
      sql: `
        CREATE POLICY IF NOT EXISTS "Users can delete own files"
        ON storage.objects FOR DELETE
        TO authenticated
        USING (
          bucket_id = 'cards' AND
          (storage.foldername(name))[1] = auth.uid()::text
        );
      `
    }
  ];

  console.log('⚠️  Storage policies must be created via SQL Editor');
  console.log('📋 Copy and paste these policies in Supabase Dashboard → SQL Editor:\n');

  policies.forEach((policy, index) => {
    console.log(`-- Policy ${index + 1}: ${policy.name}`);
    console.log(policy.sql);
    console.log('');
  });

  return { success: false, method: 'manual', policies };
}

function printManualInstructions() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📋 MANUAL DEPLOYMENT INSTRUCTIONS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('🔧 Step 1: Deploy SQL Migrations');
  console.log('   Navigate to: Supabase Dashboard → SQL Editor → New Query\n');

  console.log('   Migration 1: supabase/09-user-profile-init.sql');
  console.log('   - Copy entire file contents');
  console.log('   - Paste into SQL Editor');
  console.log('   - Click RUN\n');

  console.log('   Migration 2: supabase/10-add-daily-claim-column.sql');
  console.log('   - Copy entire file contents');
  console.log('   - Paste into SQL Editor');
  console.log('   - Click RUN\n');

  console.log('───────────────────────────────────────────────────────────\n');

  console.log('🗂️  Step 2: Create Storage Bucket');
  console.log('   Navigate to: Supabase Dashboard → Storage\n');
  console.log('   1. Click "New bucket"');
  console.log('   2. Name: cards');
  console.log('   3. Public bucket: ✅ YES');
  console.log('   4. File size limit: 5 MB');
  console.log('   5. Allowed MIME types: image/jpeg, image/png, image/jpg');
  console.log('   6. Click "Create bucket"\n');

  console.log('───────────────────────────────────────────────────────────\n');

  console.log('🔐 Step 3: Add Storage RLS Policies');
  console.log('   Navigate to: Storage → Policies → cards bucket\n');
  console.log('   Run these SQL statements in SQL Editor:\n');

  const policies = [
    `-- Policy 1: Upload
CREATE POLICY "Users can upload to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'cards' AND
  (storage.foldername(name))[1] = auth.uid()::text
);`,
    `-- Policy 2: Read
CREATE POLICY "Public read access"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'cards');`,
    `-- Policy 3: Update
CREATE POLICY "Users can update own files"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'cards' AND
  (storage.foldername(name))[1] = auth.uid()::text
);`,
    `-- Policy 4: Delete
CREATE POLICY "Users can delete own files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'cards' AND
  (storage.foldername(name))[1] = auth.uid()::text
);`
  ];

  policies.forEach(policy => {
    console.log(policy);
    console.log('');
  });

  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ After completing these steps, your Supabase setup is ready!');
  console.log('═══════════════════════════════════════════════════════════\n');
}

async function main() {
  console.log('🚀 Starting Supabase Setup Deployment...\n');
  console.log('Project URL:', SUPABASE_URL);
  console.log('Using Service Role Key:', SUPABASE_SERVICE_ROLE_KEY ? '✅ Found' : '❌ Missing');
  console.log('');

  // Try to create storage bucket
  const bucketResult = await createStorageBucket();

  if (bucketResult.success) {
    console.log('\n📋 Next: Set up storage policies manually');
    await setupStoragePolicies();
  }

  console.log('\n📋 SQL Migrations need to be deployed manually');
  console.log('   Files to deploy:');
  console.log('   - supabase/09-user-profile-init.sql');
  console.log('   - supabase/10-add-daily-claim-column.sql');
  console.log('');
  console.log('See SUPABASE_MIGRATION_COMPLETE.md for detailed instructions');

  printManualInstructions();
}

main().catch(console.error);
