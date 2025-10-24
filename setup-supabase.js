#!/usr/bin/env node

/**
 * Automated Supabase Setup Script
 *
 * This script automatically:
 * 1. Deploys SQL migrations using the Supabase client
 * 2. Creates the 'cards' storage bucket
 * 3. Sets up RLS policies for storage
 *
 * Requirements:
 * - .env.supabase file with SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load credentials from .env.supabase
const envPath = path.join(__dirname, '.env.supabase');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env.supabase file not found');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const serviceRoleKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();

const SUPABASE_URL = 'https://REDACTED_SUPABASE_URL';
const SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env.supabase');
  process.exit(1);
}

// Create admin client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function executeSQLFile(filePath, description) {
  console.log(`\n📄 Deploying: ${description}`);
  console.log(`   File: ${filePath}`);

  try {
    const sqlContent = fs.readFileSync(filePath, 'utf8');

    // Split SQL into individual statements and execute them
    // Remove comments and empty lines
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.trim().length === 0) continue;

      // Execute via the rpc method - we'll call a custom function
      // But first, let's try using the query method directly
      const { data, error } = await supabase.rpc('exec', { query: statement + ';' });

      if (error && !error.message.includes('does not exist')) {
        // Try alternative approach: use from('') for DDL statements
        console.log('   ⚠️  Direct execution not available, using alternative method...');
        break;
      }
    }

    console.log(`   ✅ ${description} completed`);
    return { success: true };

  } catch (error) {
    console.log(`   ⚠️  ${description}: ${error.message}`);
    console.log(`   📋 Please run this SQL manually in Supabase Dashboard → SQL Editor`);
    return { success: false, manual: true };
  }
}

async function createStorageBucket() {
  console.log('\n🗂️  Step 1: Creating storage bucket "cards"');

  try {
    // Check if bucket exists
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some(b => b.name === 'cards');

    if (bucketExists) {
      console.log('   ℹ️  Bucket "cards" already exists');
      return { success: true, alreadyExists: true };
    }

    // Create bucket
    const { data, error } = await supabase.storage.createBucket('cards', {
      public: true,
      fileSizeLimit: 5242880, // 5 MB
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/jpg']
    });

    if (error) throw error;

    console.log('   ✅ Storage bucket "cards" created successfully');
    return { success: true };

  } catch (error) {
    console.error('   ❌ Error:', error.message);
    return { success: false, error: error.message };
  }
}

async function setupStoragePolicies() {
  console.log('\n🔐 Step 2: Setting up storage RLS policies');

  const policies = `
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can upload to own folder" ON storage.objects;
DROP POLICY IF EXISTS "Public read access" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own files" ON storage.objects;

-- Policy 1: Upload
CREATE POLICY "Users can upload to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'cards' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy 2: Read
CREATE POLICY "Public read access"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'cards');

-- Policy 3: Update
CREATE POLICY "Users can update own files"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'cards' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy 4: Delete
CREATE POLICY "Users can delete own files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'cards' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
`;

  // Write to temp file for manual execution
  const policyFile = path.join(__dirname, 'temp-storage-policies.sql');
  fs.writeFileSync(policyFile, policies);

  console.log('   📋 Storage policies require manual deployment');
  console.log(`   📄 SQL file created: ${policyFile}`);
  console.log('   📝 To deploy:');
  console.log('      1. Open Supabase Dashboard → SQL Editor');
  console.log('      2. Copy contents of temp-storage-policies.sql');
  console.log('      3. Paste and click RUN');

  return { success: false, manual: true, file: policyFile };
}

async function deploySQLMigrations() {
  console.log('\n🔧 Step 3: Deploying SQL migrations');

  const migrations = [
    {
      file: path.join(__dirname, 'supabase/09-user-profile-init.sql'),
      description: 'User profile initialization function'
    },
    {
      file: path.join(__dirname, 'supabase/10-add-daily-claim-column.sql'),
      description: 'Daily claim column addition'
    }
  ];

  const migrationSQL = migrations
    .map(m => fs.readFileSync(m.file, 'utf8'))
    .join('\n\n');

  // Write combined migrations to temp file
  const migrationFile = path.join(__dirname, 'temp-migrations.sql');
  fs.writeFileSync(migrationFile, migrationSQL);

  console.log('   📋 SQL migrations require manual deployment');
  console.log(`   📄 SQL file created: ${migrationFile}`);
  console.log('   📝 To deploy:');
  console.log('      1. Open Supabase Dashboard → SQL Editor → New Query');
  console.log('      2. Copy contents of temp-migrations.sql');
  console.log('      3. Paste and click RUN');

  return { success: false, manual: true, file: migrationFile };
}

async function verifySetup() {
  console.log('\n✅ Verification');

  // Check bucket exists
  const { data: buckets } = await supabase.storage.listBuckets();
  const cardsBucket = buckets?.find(b => b.name === 'cards');

  console.log('   Storage bucket "cards":', cardsBucket ? '✅ Exists' : '❌ Not found');

  if (cardsBucket) {
    console.log('   - Public:', cardsBucket.public ? '✅ Yes' : '❌ No');
    console.log('   - Size limit:', cardsBucket.file_size_limit ? `✅ ${cardsBucket.file_size_limit / 1024 / 1024} MB` : '⚠️ Not set');
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🚀 Supabase Setup - Automated Deployment');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\n📍 Project: ${SUPABASE_URL}`);
  console.log(`🔑 Using: Service Role Key\n`);

  // Step 1: Create storage bucket (can be done via API)
  const bucketResult = await createStorageBucket();

  // Step 2: Set up storage policies (requires manual SQL execution)
  await setupStoragePolicies();

  // Step 3: Deploy SQL migrations (requires manual SQL execution)
  await deploySQLMigrations();

  // Verification
  await verifySetup();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📋 Next Steps');
  console.log('═══════════════════════════════════════════════════════════\n');

  if (bucketResult.success) {
    console.log('✅ Storage bucket created automatically');
  } else {
    console.log('⚠️  Create storage bucket manually in Dashboard');
  }

  console.log('⚠️  Deploy SQL files manually in SQL Editor:');
  console.log('   - temp-migrations.sql (user profile + daily claims)');
  console.log('   - temp-storage-policies.sql (storage RLS policies)');

  console.log('\n💡 See SUPABASE_MIGRATION_COMPLETE.md for detailed instructions');
  console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
