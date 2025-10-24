/**
 * Firebase Firestore → Supabase Postgres Migration Script
 *
 * Migrates all data from Firebase Firestore to Supabase Postgres.
 * Maintains data integrity and relationships.
 *
 * Usage:
 *   node migrate-firestore-to-postgres.js
 *
 * Requirements:
 *   - Firebase service account credentials
 *   - Supabase service role key in .env.supabase
 */

const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '.env.supabase' });

// Initialize Firebase Admin
const serviceAccount = require('./service-account-key.json'); // You'll need this
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Migration statistics
const stats = {
  users: 0,
  sessions: 0,
  groups: 0,
  cards: 0,
  auctions: 0,
  bids: 0,
  trades: 0,
  posts: 0,
  sets: 0,
  notifications: 0,
  errors: []
};

/**
 * Migrate users collection
 */
async function migrateUsers() {
  console.log('\n📦 Migrating users...');
  const snapshot = await db.collection('users').get();

  for (const doc of snapshot.docs) {
    const data = doc.data();

    try {
      // Insert into users table
      const { error: userError } = await supabase
        .from('users')
        .insert({
          id: doc.id,
          email: data.email,
          username: data.username || data.email?.split('@')[0],
          display_name: data.displayName || data.username,
          avatar_url: data.avatarUrl || null,
          xp: data.xp || 0,
          level: data.level || 1,
          gems: data.gems || 0,
          showcase: data.showcase || [],
          card_borders: data.cardBorders || ['default'],
          initial_reward_groups: data.initialRewardGroups || [],
          created_at: data.createdAt?.toDate?.() || new Date(),
          last_active_group: data.lastActiveGroup || null
        });

      if (userError) throw userError;

      // Get sessions/main subcollection for balances
      const sessionDoc = await db.collection('users').doc(doc.id).collection('sessions').doc('main').get();
      if (sessionDoc.exists()) {
        const sessionData = sessionDoc.data();

        const { error: sessionError } = await supabase
          .from('user_sessions')
          .insert({
            user_id: doc.id,
            group_balances: sessionData.groupBalances || {},
            group_gems: sessionData.groupGems || {},
            last_updated: sessionData.lastUpdated?.toDate?.() || new Date()
          });

        if (sessionError) throw sessionError;
        stats.sessions++;
      }

      stats.users++;
      console.log(`✅ Migrated user: ${data.email || doc.id}`);
    } catch (error) {
      console.error(`❌ Error migrating user ${doc.id}:`, error.message);
      stats.errors.push({ type: 'user', id: doc.id, error: error.message });
    }
  }
}

/**
 * Migrate groups collection
 */
async function migrateGroups() {
  console.log('\n📦 Migrating groups...');
  const snapshot = await db.collection('groups').get();

  for (const doc of snapshot.docs) {
    const data = doc.data();

    try {
      const { error } = await supabase
        .from('groups')
        .insert({
          id: doc.id,
          name: data.name,
          code: data.code,
          created_by: data.createdBy,
          members: data.members || [],
          admin_ids: data.adminIds || [data.createdBy],
          settings: data.settings || {},
          created_at: data.createdAt?.toDate?.() || new Date()
        });

      if (error) throw error;

      stats.groups++;
      console.log(`✅ Migrated group: ${data.name}`);
    } catch (error) {
      console.error(`❌ Error migrating group ${doc.id}:`, error.message);
      stats.errors.push({ type: 'group', id: doc.id, error: error.message });
    }
  }
}

/**
 * Migrate cards collection
 */
async function migrateCards() {
  console.log('\n📦 Migrating cards...');
  const snapshot = await db.collection('cards').get();

  for (const doc of snapshot.docs) {
    const data = doc.data();

    try {
      const { error } = await supabase
        .from('cards')
        .insert({
          id: doc.id,
          name: data.name,
          image_url: data.imageUrl,
          rarity: data.rarity,
          owner_id: data.ownerId,
          group_id: data.groupId,
          set_id: data.setId || null,
          border: data.border || 'default',
          status: data.inTrade ? 'in_trade' : (data.inAuction ? 'in_auction' : 'available'),
          created_at: data.createdAt?.toDate?.() || new Date()
        });

      if (error) throw error;

      stats.cards++;
      if (stats.cards % 100 === 0) {
        console.log(`✅ Migrated ${stats.cards} cards...`);
      }
    } catch (error) {
      console.error(`❌ Error migrating card ${doc.id}:`, error.message);
      stats.errors.push({ type: 'card', id: doc.id, error: error.message });
    }
  }
}

/**
 * Migrate auctions collection
 */
async function migrateAuctions() {
  console.log('\n📦 Migrating auctions...');
  const snapshot = await db.collection('auctions').get();

  for (const doc of snapshot.docs) {
    const data = doc.data();

    try {
      const { error } = await supabase
        .from('auctions')
        .insert({
          id: doc.id,
          card_id: data.cardId,
          seller_id: data.sellerId,
          group_id: data.groupId,
          starting_bid: data.startingBid || 0,
          current_bid: data.currentBid || 0,
          current_bidder: data.currentBidder || null,
          current_bidder_name: data.currentBidderName || null,
          current_rarity: data.currentRarity || 'common',
          unique_bidder_count: data.uniqueBidderCount || 0,
          bid_count: data.bidCount || 0,
          end_time: data.endTime?.toDate?.() || new Date(),
          status: data.status || 'active',
          created_at: data.createdAt?.toDate?.() || new Date()
        });

      if (error) throw error;

      stats.auctions++;
      console.log(`✅ Migrated auction: ${doc.id}`);
    } catch (error) {
      console.error(`❌ Error migrating auction ${doc.id}:`, error.message);
      stats.errors.push({ type: 'auction', id: doc.id, error: error.message });
    }
  }
}

/**
 * Migrate trades collection
 */
async function migrateTrades() {
  console.log('\n📦 Migrating trades...');
  const snapshot = await db.collection('trades').get();

  for (const doc of snapshot.docs) {
    const data = doc.data();

    try {
      const { error } = await supabase
        .from('trades')
        .insert({
          id: doc.id,
          sender_id: data.senderId,
          receiver_id: data.receiverId,
          group_id: data.groupId,
          offered_cards: data.offeredCards || [],
          requested_cards: data.requestedCards || [],
          status: data.status || 'pending',
          created_at: data.createdAt?.toDate?.() || new Date(),
          completed_at: data.completedAt?.toDate?.() || null
        });

      if (error) throw error;

      stats.trades++;
      console.log(`✅ Migrated trade: ${doc.id}`);
    } catch (error) {
      console.error(`❌ Error migrating trade ${doc.id}:`, error.message);
      stats.errors.push({ type: 'trade', id: doc.id, error: error.message });
    }
  }
}

/**
 * Migrate posts collection
 */
async function migratePosts() {
  console.log('\n📦 Migrating posts...');
  const snapshot = await db.collection('posts').get();

  for (const doc of snapshot.docs) {
    const data = doc.data();

    try {
      const { error } = await supabase
        .from('posts')
        .insert({
          id: doc.id,
          author_id: data.authorId,
          group_id: data.groupId,
          text: data.text,
          image_url: data.imageUrl || null,
          likes: data.likes || 0,
          liked_by: data.likedBy || [],
          created_at: data.createdAt?.toDate?.() || new Date()
        });

      if (error) throw error;

      stats.posts++;
      console.log(`✅ Migrated post: ${doc.id}`);
    } catch (error) {
      console.error(`❌ Error migrating post ${doc.id}:`, error.message);
      stats.errors.push({ type: 'post', id: doc.id, error: error.message });
    }
  }
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('🚀 Starting Firebase → Supabase migration...\n');
  const startTime = Date.now();

  try {
    // Migrate in dependency order
    await migrateUsers();
    await migrateGroups();
    await migrateCards();
    await migrateAuctions();
    await migrateTrades();
    await migratePosts();

    // Refresh materialized views
    console.log('\n🔄 Refreshing materialized views...');
    await supabase.rpc('refresh_all_views'); // You'll need to create this function

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n✅ Migration complete!');
    console.log('\n📊 Migration Statistics:');
    console.log(`   Users: ${stats.users}`);
    console.log(`   Sessions: ${stats.sessions}`);
    console.log(`   Groups: ${stats.groups}`);
    console.log(`   Cards: ${stats.cards}`);
    console.log(`   Auctions: ${stats.auctions}`);
    console.log(`   Trades: ${stats.trades}`);
    console.log(`   Posts: ${stats.posts}`);
    console.log(`   Duration: ${duration}s`);
    console.log(`   Errors: ${stats.errors.length}`);

    if (stats.errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      stats.errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.type} ${err.id}: ${err.error}`);
      });

      // Write errors to file
      fs.writeFileSync(
        'migration-errors.json',
        JSON.stringify(stats.errors, null, 2)
      );
      console.log('\n📄 Error details written to migration-errors.json');
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run migration
migrate();
