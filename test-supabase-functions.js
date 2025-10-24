/**
 * Supabase Function Testing Script
 *
 * Automated tests for all Postgres functions.
 * Run after database setup to verify everything works.
 *
 * Usage: node test-supabase-functions.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.supabase' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

// Helper to run test
async function test(name, fn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await fn();
    console.log('✅ PASS');
    results.passed++;
    results.tests.push({ name, status: 'PASS' });
  } catch (error) {
    console.log('❌ FAIL');
    console.log(`   Error: ${error.message}`);
    results.failed++;
    results.tests.push({ name, status: 'FAIL', error: error.message });
  }
}

// Cleanup helper
async function cleanup(userId, groupId, cardId, auctionId) {
  if (auctionId) await supabase.from('auctions').delete().eq('id', auctionId);
  if (cardId) await supabase.from('cards').delete().eq('id', cardId);
  if (groupId) await supabase.from('groups').delete().eq('id', groupId);
  if (userId) {
    await supabase.from('user_sessions').delete().eq('user_id', userId);
    await supabase.from('users').delete().eq('id', userId);
  }
}

// Test: update_balance()
async function testUpdateBalance() {
  const userId = crypto.randomUUID();
  const groupId = crypto.randomUUID();

  try {
    // Create user and session
    await supabase.from('users').insert({
      id: userId,
      email: 'balancetest@test.com',
      username: 'balancetest'
    });

    await supabase.from('user_sessions').insert({
      user_id: userId,
      group_balances: { [groupId]: 1000 }
    });

    // Test add coins
    const { data: addResult, error: addError } = await supabase.rpc('update_balance', {
      p_user_id: userId,
      p_group_id: groupId,
      p_amount: 100
    });

    if (addError) throw addError;
    if (!addResult.success) throw new Error('Add coins failed');

    // Test subtract coins
    const { data: subResult, error: subError } = await supabase.rpc('update_balance', {
      p_user_id: userId,
      p_group_id: groupId,
      p_amount: -50
    });

    if (subError) throw subError;
    if (!subResult.success) throw new Error('Subtract coins failed');

    // Verify balance
    const { data: session } = await supabase
      .from('user_sessions')
      .select('group_balances')
      .eq('user_id', userId)
      .single();

    if (session.group_balances[groupId] !== 1050) {
      throw new Error(`Expected balance 1050, got ${session.group_balances[groupId]}`);
    }
  } finally {
    await cleanup(userId);
  }
}

// Test: update_gems()
async function testUpdateGems() {
  const userId = crypto.randomUUID();

  try {
    await supabase.from('users').insert({
      id: userId,
      email: 'gemstest@test.com',
      username: 'gemstest',
      gems: 100
    });

    // Test add gems
    const { data, error } = await supabase.rpc('update_gems', {
      p_user_id: userId,
      p_amount: 50,
      p_group_id: null
    });

    if (error) throw error;
    if (!data.success) throw new Error('Add gems failed');

    // Verify
    const { data: user } = await supabase
      .from('users')
      .select('gems')
      .eq('id', userId)
      .single();

    if (user.gems !== 150) {
      throw new Error(`Expected 150 gems, got ${user.gems}`);
    }
  } finally {
    await cleanup(userId);
  }
}

// Test: process_bid()
async function testProcessBid() {
  const sellerId = crypto.randomUUID();
  const bidderId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const cardId = crypto.randomUUID();
  let auctionId;

  try {
    // Setup users
    await supabase.from('users').insert([
      { id: sellerId, email: 'seller@test.com', username: 'seller' },
      { id: bidderId, email: 'bidder@test.com', username: 'bidder' }
    ]);

    await supabase.from('user_sessions').insert([
      { user_id: sellerId, group_balances: { [groupId]: 500 } },
      { user_id: bidderId, group_balances: { [groupId]: 1000 } }
    ]);

    // Setup group
    await supabase.from('groups').insert({
      id: groupId,
      name: 'Test Group',
      created_by: sellerId,
      members: [sellerId, bidderId]
    });

    // Setup card
    await supabase.from('cards').insert({
      id: cardId,
      name: 'Test Card',
      image_url: 'https://test.com/card.jpg',
      rarity: 'common',
      owner_id: sellerId,
      group_id: groupId
    });

    // Setup auction
    const { data: auction, error: auctionError } = await supabase.from('auctions').insert({
      card_id: cardId,
      seller_id: sellerId,
      seller_username: 'seller',
      group_id: groupId,
      card_name: 'Test Card',
      card_image_url: 'https://test.com/card.jpg',
      current_bid: 10,
      end_time: new Date(Date.now() + 3600000).toISOString(),
      status: 'active'
    }).select().single();

    if (auctionError) throw auctionError;
    if (!auction) throw new Error('Failed to create auction');

    auctionId = auction.id;

    // Test bid
    const { data, error } = await supabase.rpc('process_bid', {
      p_auction_id: auctionId,
      p_bidder_id: bidderId,
      p_bidder_name: 'bidder',
      p_bid_amount: 50,
      p_group_id: groupId
    });

    if (error) throw error;
    if (!data.success) throw new Error('Bid failed');

    // Verify auction updated
    const { data: updatedAuction } = await supabase
      .from('auctions')
      .select('current_bid, current_bidder')
      .eq('id', auctionId)
      .single();

    if (updatedAuction.current_bid !== 50) {
      throw new Error(`Expected current_bid 50, got ${updatedAuction.current_bid}`);
    }

    if (updatedAuction.current_bidder !== bidderId) {
      throw new Error('Current bidder not updated');
    }

    // Verify balance decreased (50 + 1 tax)
    const { data: bidderSession } = await supabase
      .from('user_sessions')
      .select('group_balances')
      .eq('user_id', bidderId)
      .single();

    if (bidderSession.group_balances[groupId] !== 949) {
      throw new Error(`Expected balance 949, got ${bidderSession.group_balances[groupId]}`);
    }
  } finally {
    await cleanup(bidderId, groupId, cardId, auctionId);
    await cleanup(sellerId);
  }
}

// Test: award_xp()
async function testAwardXP() {
  const userId = crypto.randomUUID();

  try {
    await supabase.from('users').insert({
      id: userId,
      email: 'xptest@test.com',
      username: 'xptest',
      xp: 0,
      level: 1
    });

    // Award 500 XP (should level up)
    const { data, error } = await supabase.rpc('award_xp', {
      p_user_id: userId,
      p_amount: 500,
      p_source: 'test'
    });

    if (error) throw error;
    if (!data.success) throw new Error('Award XP failed');

    // Verify level up
    const { data: user } = await supabase
      .from('users')
      .select('xp, level')
      .eq('id', userId)
      .single();

    if (user.level <= 1) {
      throw new Error('User should have leveled up');
    }
  } finally {
    await cleanup(userId);
  }
}

// Test: get_bootstrap_payload()
async function testBootstrap() {
  const userId = crypto.randomUUID();
  const groupId = crypto.randomUUID();

  try {
    await supabase.from('users').insert({
      id: userId,
      email: 'bootstrap@test.com',
      username: 'bootstrap'
    });

    await supabase.from('user_sessions').insert({
      user_id: userId,
      group_balances: { [groupId]: 1000 }
    });

    await supabase.from('groups').insert({
      id: groupId,
      name: 'Bootstrap Group',
      created_by: userId,
      members: [userId]
    });

    // Test bootstrap
    const { data, error } = await supabase.rpc('get_bootstrap_payload', {
      p_user_id: userId,
      p_group_id: groupId
    });

    if (error) throw error;
    if (!data.user) throw new Error('Missing user in payload');
    if (!data.group) throw new Error('Missing group in payload');
  } finally {
    await cleanup(userId, groupId);
  }
}

// Main test runner
async function runTests() {
  console.log('🧪 Running Supabase Function Tests\n');

  await test('update_balance()', testUpdateBalance);
  await test('update_gems()', testUpdateGems);
  await test('process_bid()', testProcessBid);
  await test('award_xp()', testAwardXP);
  await test('get_bootstrap_payload()', testBootstrap);

  console.log('\n📊 Test Results:');
  console.log(`   Passed: ${results.passed}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   Total:  ${results.passed + results.failed}`);

  if (results.failed > 0) {
    console.log('\n❌ Some tests failed:');
    results.tests.filter(t => t.status === 'FAIL').forEach(t => {
      console.log(`   - ${t.name}: ${t.error}`);
    });
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

runTests();
