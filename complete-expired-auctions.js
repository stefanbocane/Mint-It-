#!/usr/bin/env node

/**
 * Complete Expired Auctions
 *
 * This script calls the Postgres function to process all expired auctions.
 * Run this manually to process any auctions that ended.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://REDACTED_SUPABASE_URL';
const envContent = fs.readFileSync(path.join(__dirname, '.env.supabase'), 'utf8');
const SERVICE_ROLE_KEY = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();

if (!SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env.supabase');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function completeExpiredAuctions() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('⏰ Processing Expired Auctions');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // Call the complete_auctions() function
    const { data, error } = await supabase.rpc('complete_auctions');

    if (error) {
      console.error('❌ Error calling complete_auctions():', error.message);
      console.error('Details:', error);
      process.exit(1);
    }

    if (!data || data.length === 0) {
      console.log('✅ No expired auctions to process');
      return;
    }

    console.log(`✅ Processed ${data.length} expired auction(s):\n`);

    data.forEach((result, index) => {
      console.log(`${index + 1}. Auction ID: ${result.auction_id}`);
      console.log(`   Card ID: ${result.card_id}`);
      console.log(`   Seller: ${result.seller_id}`);

      if (result.winner_id) {
        console.log(`   Winner: ${result.winner_id}`);
        console.log(`   Final Bid: ${result.final_bid} coins`);
        console.log(`   Result: ✅ Card transferred to winner, seller paid`);
      } else {
        console.log(`   Result: 🔄 No bids, card returned to seller`);
      }
      console.log(`   Status: ${result.result_status}`);
      console.log('');
    });

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ Auction completion process finished!');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

completeExpiredAuctions();
