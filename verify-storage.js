#!/usr/bin/env node

/**
 * Verify Supabase Storage Setup
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://REDACTED_SUPABASE_URL';
const envContent = fs.readFileSync(path.join(__dirname, '.env.supabase'), 'utf8');
const SERVICE_ROLE_KEY = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function verifySetup() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔍 Verifying Storage Setup');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check bucket exists
  console.log('1️⃣ Checking bucket...');
  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();

  if (bucketsError) {
    console.error('❌ Error:', bucketsError.message);
    return;
  }

  const cardsBucket = buckets?.find(b => b.name === 'cards');
  if (!cardsBucket) {
    console.error('❌ Bucket "cards" not found!');
    return;
  }

  console.log('✅ Bucket "cards" exists');
  console.log('   - Public:', cardsBucket.public);
  console.log('   - Size limit:', cardsBucket.file_size_limit / 1024 / 1024, 'MB');

  // Check policies via SQL query
  console.log('\n2️⃣ Checking storage policies...');

  const { data: policies, error: policiesError } = await supabase
    .from('pg_policies')
    .select('policyname, tablename')
    .eq('schemaname', 'storage')
    .eq('tablename', 'objects');

  if (policiesError) {
    console.log('⚠️  Cannot query policies directly');
    console.log('   Checking via rpc...');

    // Try alternative method
    const { data: policyData, error: rpcError } = await supabase.rpc('exec', {
      sql: "SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';"
    }).catch(() => ({ data: null, error: { message: 'RPC not available' } }));

    if (rpcError || !policyData) {
      console.log('⚠️  Cannot verify policies programmatically');
      console.log('   Please check manually in dashboard');
    }
  } else if (policies) {
    console.log(`✅ Found ${policies.length} storage policies:`);
    policies.forEach(p => console.log(`   - ${p.policyname}`));
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📋 Manual Verification Steps');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('1. Open: https://supabase.com/dashboard/project/ikizpnzgknmfhdituyyk/storage/policies');
  console.log('2. You should see 4 policies for storage.objects:');
  console.log('   ✓ Users can upload to own folder');
  console.log('   ✓ Public read access');
  console.log('   ✓ Users can update own files');
  console.log('   ✓ Users can delete own files');
  console.log('\n3. If missing, re-run temp-storage-policies.sql in SQL Editor\n');
}

verifySetup().catch(console.error);
