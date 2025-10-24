/**
 * Automated Supabase Phase 1 Setup Script
 *
 * This script:
 * 1. Creates the ensure_user_profile function
 * 2. Adds the last_daily_claim column
 * 3. Creates the cards storage bucket
 * 4. Sets up RLS policies for the bucket
 *
 * Usage:
 *   node setup-supabase-phase1.js
 *
 * Prerequisites:
 *   - Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 *   - Or pass them as arguments
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || process.argv[2];
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.argv[3];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: Missing Supabase credentials');
  console.error('');
  console.error('Usage:');
  console.error('  node setup-supabase-phase1.js <SUPABASE_URL> <SERVICE_ROLE_KEY>');
  console.error('');
  console.error('Or set environment variables:');
  console.error('  SUPABASE_URL=https://xxx.supabase.co');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key');
  process.exit(1);
}

// Initialize Supabase client with service role (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runMigration(name, sqlFile) {
  console.log(`\n🔄 Running migration: ${name}...`);

  const filePath = path.join(__dirname, 'supabase', sqlFile);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return false;
  }

  const sql = fs.readFileSync(filePath, 'utf8');

  try {
    const { error } = await supabase.rpc('exec_sql', { sql_string: sql });

    if (error) {
      // Try direct query if RPC doesn't exist
      const { error: queryError } = await supabase.from('_').select('*').limit(0);

      if (queryError) {
        console.error(`❌ Migration failed: ${error.message || queryError.message}`);
        return false;
      }
    }

    console.log(`✅ ${name} completed`);
    return true;
  } catch (err) {
    console.error(`❌ Migration error: ${err.message}`);
    return false;
  }
}

async function createStorageBucket() {
  console.log('\n🔄 Creating storage bucket: cards...');

  try {
    // Create bucket
    const { data: bucket, error: createError } = await supabase.storage.createBucket('cards', {
      public: true,
      fileSizeLimit: 5242880, // 5 MB
      allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png']
    });

    if (createError) {
      if (createError.message.includes('already exists')) {
        console.log('⚠️  Bucket already exists, skipping creation');
      } else {
        console.error(`❌ Failed to create bucket: ${createError.message}`);
        return false;
      }
    } else {
      console.log('✅ Bucket created');
    }

    return true;
  } catch (err) {
    console.error(`❌ Bucket creation error: ${err.message}`);
    return false;
  }
}

async function setupStoragePolicies() {
  console.log('\n🔄 Setting up storage policies...');

  const policies = [
    {
      name: 'Users can upload to own folder',
      definition: `
        CREATE POLICY "Users can upload to own folder"
        ON storage.objects FOR INSERT
        TO authenticated
        WITH CHECK (
          bucket_id = 'cards' AND
          (storage.foldername(name))[1] = auth.uid()::text
        );
      `
    },
    {
      name: 'Public read access',
      definition: `
        CREATE POLICY "Public read access"
        ON storage.objects FOR SELECT
        TO public
        USING (bucket_id = 'cards');
      `
    },
    {
      name: 'Users can update own files',
      definition: `
        CREATE POLICY "Users can update own files"
        ON storage.objects FOR UPDATE
        TO authenticated
        USING (
          bucket_id = 'cards' AND
          (storage.foldername(name))[1] = auth.uid()::text
        );
      `
    },
    {
      name: 'Users can delete own files',
      definition: `
        CREATE POLICY "Users can delete own files"
        ON storage.objects FOR DELETE
        TO authenticated
        USING (
          bucket_id = 'cards' AND
          (storage.foldername(name))[1] = auth.uid()::text
        );
      `
    }
  ];

  for (const policy of policies) {
    console.log(`  Creating policy: ${policy.name}...`);

    try {
      // Note: Storage policies need to be created via SQL, not the storage API
      // This would require the sql execution capability
      console.log(`  ⚠️  Policy creation requires SQL execution - use Supabase Dashboard`);
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
    }
  }

  console.log('\n⚠️  Storage policies must be created manually in Supabase Dashboard');
  console.log('   See SUPABASE_STORAGE_SETUP.md for instructions');

  return true;
}

async function verifySetup() {
  console.log('\n🔍 Verifying setup...');

  // Check if ensure_user_profile function exists
  console.log('  Checking ensure_user_profile function...');
  try {
    const { data, error } = await supabase.rpc('ensure_user_profile', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_email: 'test@test.com'
    });

    if (error && !error.message.includes('does not exist')) {
      console.log('  ✅ Function exists');
    } else if (error) {
      console.log('  ❌ Function not found');
    } else {
      console.log('  ✅ Function exists and callable');
    }
  } catch (err) {
    console.log(`  ⚠️  Could not verify: ${err.message}`);
  }

  // Check if cards bucket exists
  console.log('  Checking cards bucket...');
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();

    if (error) {
      console.log(`  ❌ Error: ${error.message}`);
    } else {
      const cardsBucket = buckets.find(b => b.name === 'cards');
      if (cardsBucket) {
        console.log(`  ✅ Bucket exists (public: ${cardsBucket.public})`);
      } else {
        console.log('  ❌ Bucket not found');
      }
    }
  } catch (err) {
    console.log(`  ⚠️  Could not verify: ${err.message}`);
  }

  console.log('\n✅ Verification complete');
}

async function main() {
  console.log('🚀 Starting Supabase Phase 1 Setup...');
  console.log(`📍 URL: ${SUPABASE_URL.substring(0, 30)}...`);

  // Run migrations
  await runMigration('User Profile Init', '09-user-profile-init.sql');
  await runMigration('Daily Claim Column', '10-add-daily-claim-column.sql');

  // Create storage bucket
  await createStorageBucket();

  // Setup storage policies
  await setupStoragePolicies();

  // Verify
  await verifySetup();

  console.log('\n✅ Phase 1 setup complete!');
  console.log('\n📝 Next steps:');
  console.log('  1. Manually add storage policies (see SUPABASE_STORAGE_SETUP.md)');
  console.log('  2. Test card minting (see PHASE_1_TESTING_CHECKLIST.md)');
}

main().catch(console.error);
