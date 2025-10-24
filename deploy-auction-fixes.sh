#!/bin/bash

# Deploy Auction Fixes to Supabase
# This script applies the auction fix migration to your Supabase database

echo "🚀 Deploying auction fixes to Supabase..."
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found"
    echo "Please create a .env file with your Supabase credentials:"
    echo "  SUPABASE_URL=your_supabase_url"
    echo "  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key"
    exit 1
fi

# Load environment variables
export $(cat .env | grep -v '^#' | xargs)

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "❌ Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env"
    exit 1
fi

echo "📋 Migration will fix:"
echo "  1. Auction starting bid set to 6 coins"
echo "  2. Coins properly deducted when bidding"
echo "  3. Cards appear in collection after winning auction"
echo "  4. Rarity persists from auction to collection"
echo ""

read -p "Do you want to proceed? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled"
    exit 1
fi

# Execute the migration
echo "⚙️  Applying migration 11-fix-auction-issues.sql..."

node -e "
const fs = require('fs');
const https = require('https');
const url = require('url');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const sql = fs.readFileSync('supabase/11-fix-auction-issues.sql', 'utf8');

const parsedUrl = new url.URL(supabaseUrl + '/rest/v1/rpc/exec_sql');

const options = {
  hostname: parsedUrl.hostname,
  port: parsedUrl.port,
  path: parsedUrl.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': serviceRoleKey,
    'Authorization': 'Bearer ' + serviceRoleKey
  }
};

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log('✅ Migration applied successfully!');
      console.log('');
      console.log('🎉 Auction fixes deployed!');
      console.log('');
      console.log('Next steps:');
      console.log('  1. Restart your app to load the new JavaScript changes');
      console.log('  2. Test minting a card (should start at 6 coins)');
      console.log('  3. Test bidding (coins should be deducted)');
      console.log('  4. Test winning an auction (card should appear with correct rarity)');
      process.exit(0);
    } else {
      console.error('❌ Migration failed:', res.statusCode);
      console.error(data);
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});

// Write SQL to request
req.write(JSON.stringify({ query: sql }));
req.end();
"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ All fixes deployed successfully!"
else
    echo ""
    echo "❌ Deployment failed. Please check the error messages above."
    exit 1
fi
