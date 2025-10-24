/*
 * Cloud Function: Maintain auction overview documents
 * Each time an auction is created / updated / deleted we keep a lightweight
 * summary array inside auctionOverviews/{groupId}. The client will fetch
 * this document instead of running a collection listener, guaranteeing a
 * single read for the whole list.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

/**
 * helper – extracts minimal fields required by the list-view. Update this list
 * if the front-end adds new properties.
 */
function buildSummary(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    cardName: data.cardName || null,
    currentBid: data.currentBid || 0,
    currentBidder: data.currentBidder || null,
    currentBidderName: data.currentBidderName || null,
    endTime: data.endTime || null,
    status: data.status || 'active',
    sellerId: data.sellerId || null,
    sellerUsername: data.sellerUsername || null,
    sellerAvatarUrl: data.sellerAvatarUrl || null,
    currentRarity: data.currentRarity || null,
    uniqueBidderCount: data.uniqueBidderCount || 0,
    groupId: data.groupId || null,
    // any other small, list-level field can go here
  };
}

exports.syncAuctionOverview = functions.firestore
  .document('auctions/{auctionId}')
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;

    // Determine the group(s) affected. In most cases before and after share the same groupId.
    const groupIds = new Set();
    if (before?.groupId) groupIds.add(before.groupId);
    if (after?.groupId) groupIds.add(after.groupId);

    const batch = db.batch();

    for (const groupId of groupIds) {
      const overviewRef = db.doc(`auctionOverviews/${groupId}`);
      const overviewSnap = await overviewRef.get();
      const overviewData = overviewSnap.exists ? overviewSnap.data() : { auctions: [] };

      let auctions = overviewData.auctions || [];

      // Remove previous copy if it exists
      if (before && before.groupId === groupId) {
        auctions = auctions.filter(a => a.id !== context.params.auctionId);
      }

      // If the auction still exists & is active, insert/update the summary
      if (after && after.groupId === groupId && after.status === 'active') {
        auctions.push(buildSummary(change.after));
      }

      // Keep list sorted by endTime ascending (optional but handy)
      auctions.sort((a, b) => {
        const aTime = a.endTime?.toMillis ? a.endTime.toMillis() : a.endTime || 0;
        const bTime = b.endTime?.toMillis ? b.endTime.toMillis() : b.endTime || 0;
        return aTime - bTime;
      });

      batch.set(overviewRef, { auctions }, { merge: true });
    }

    await batch.commit();
    return null;
  });

/** CARD OVERVIEW FUNCTION **/
exports.syncCardOverview = functions.firestore
  .document('cards/{cardId}')
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;

    const groupId = after?.groupId || before?.groupId;
    const ownerId = after?.ownerId || before?.ownerId;
    if (!groupId || !ownerId) return null;

    const overviewId = `${groupId}_${ownerId}`;
    const overviewRef = db.doc(`cardOverviews/${overviewId}`);

    const overviewSnap = await overviewRef.get();
    let cards = overviewSnap.exists ? overviewSnap.data().cards || [] : [];

    // remove old
    if (before) {
      cards = cards.filter(c => c.id !== context.params.cardId);
    }

    // add/update new
    if (after && after.status !== 'deleted') {
      cards.push({
        id: context.params.cardId,
        name: after.name,
        rarity: after.rarity || 'common', // Ensure rarity defaults to common
        status: after.status,
        imageUrl: after.imageUrl || null,
        updatedAt: after.updatedAt || null,
        createdAt: after.createdAt || null,
      });
    }

    // sort alphabetically by name
    cards.sort((a,b)=> a.name.localeCompare(b.name));
    await overviewRef.set({ cards }, { merge: true });
    return null;
  });

/** TRADE OVERVIEW FUNCTION **/
exports.syncTradeOverview = functions.firestore
  .document('trades/{tradeId}')
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;

    const groupId = after?.groupId || before?.groupId;
    if (!groupId) return null;

    const overviewRef = db.doc(`tradeOverviews/${groupId}`);
    
    try {
      // Fetch all active trades for this group
      const tradesSnap = await db.collection('trades')
        .where('groupId', '==', groupId)
        .where('status', 'in', ['pending', 'offered', 'active'])
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      const trades = tradesSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          senderId: data.senderId,
          senderName: data.senderName || 'Unknown',
          senderAvatar: data.senderAvatar || null,
          receiverId: data.receiverId,
          receiverName: data.receiverName || 'Unknown',
          receiverAvatar: data.receiverAvatar || null,
          status: data.status,
          offeredCards: data.offeredCards || [],
          requestedCards: data.requestedCards || [],
          createdAt: data.createdAt,
          updatedAt: data.updatedAt || data.createdAt,
          // Only essential fields for list view
        };
      });

      await overviewRef.set({ 
        trades,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        count: trades.length
      }, { merge: true });

      console.log(`✅ Trade overview updated for group ${groupId}: ${trades.length} trades`);
      return null;

    } catch (error) {
      console.error(`❌ Error updating trade overview for group ${groupId}:`, error);
      return null;
    }
  });

/** SOCIAL FEED OVERVIEW FUNCTION **/
exports.syncSocialOverview = functions.firestore
  .document('posts/{postId}')
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;

    const groupId = after?.groupId || before?.groupId;
    if (!groupId) return null;

    const overviewRef = db.doc(`socialOverviews/${groupId}`);
    
    try {
      // Fetch latest 50 posts for this group
      const postsSnap = await db.collection('posts')
        .where('groupId', '==', groupId)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      const posts = postsSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          text: data.text || '',
          authorId: data.authorId,
          authorName: data.authorName || 'Unknown',
          authorAvatar: data.authorAvatar || null,
          imageUrl: data.imageUrl || null,
          createdAt: data.createdAt,
          likes: data.likes || 0,
          likedBy: data.likedBy || [],
          commentCount: data.commentCount || 0,
          // Only essential fields for feed view
        };
      });

      await overviewRef.set({ 
        posts,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        count: posts.length
      }, { merge: true });

      console.log(`✅ Social overview updated for group ${groupId}: ${posts.length} posts`);
      return null;

    } catch (error) {
      console.error(`❌ Error updating social overview for group ${groupId}:`, error);
      return null;
    }
  });

/** LEADERBOARD OVERVIEW FUNCTION **/
exports.syncLeaderboard = functions.firestore
  .document('users/{userId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    if (!after || !after.groupId) return null;

    const groupId = after.groupId;
    const leaderboardRef = db.doc(`leaderboard/${groupId}`);
    const leaderboardSnap = await leaderboardRef.get();
    let entries = leaderboardSnap.exists ? leaderboardSnap.data().entries || [] : [];

    // remove old entry
    entries = entries.filter(e => e.userId !== context.params.userId);
    // push updated entry
    entries.push({
      userId: context.params.userId,
      displayName: after.displayName || after.username || 'User',
      xp: after.xp || 0,
      coins: after.balance || 0
    });

    // sort by xp desc
    entries.sort((a,b)=> b.xp - a.xp);
    await leaderboardRef.set({ entries }, { merge: true });
    return null;
  });

/** USER SESSION AGGREGATION FUNCTION **/
exports.syncUserSession = functions.firestore
  .document('users/{userId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    if (!after) return null;

    // Build lightweight session payload (extend as needed by client)
    const sessionPayload = {
      displayName: after.displayName || after.username || 'User',
      level: after.level || 1,
      coinBalance: after.coinBalance || 0,
      gems: after.gems || 0,
      totalCards: after.totalCards || 0,
      setsCompleted: after.setsCompleted || 0,
      notificationsUnread: after.notificationsUnread || 0,
      rank: after.rank || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const sessionRef = db.doc(`users/${context.params.userId}/sessions/main`);
    await sessionRef.set(sessionPayload, { merge: true });
    return null;
  });

/** ========== GROUP SESSION HELPERS ========== */
function updateGroupSession(groupId, userId, patch) {
  const ref = db.doc(`groups/${groupId}/sessions/${userId}`);
  return ref.set({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...patch
  }, { merge: true });
}

/** CARD WRITE → update group session */
exports.updateGroupSessionOnCard = functions.firestore
  .document('cards/{cardId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;

    const ownerId = after?.ownerId || before?.ownerId;
    const groupId = after?.groupId || before?.groupId;
    if (!ownerId || !groupId) return null;

    await updateGroupSession(groupId, ownerId, {
      lastCardUpdate: admin.firestore.FieldValue.serverTimestamp()
    });
    return null;
  });

/** AUCTION WRITE → update group session for seller & bidders */
exports.updateGroupSessionOnAuction = functions.firestore
  .document('auctions/{auctionId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;

    const groupId = after?.groupId || before?.groupId;
    if (!groupId) return null;

    const userIds = new Set();
    if (after?.sellerId) userIds.add(after.sellerId);
    if (before?.sellerId) userIds.add(before.sellerId);
    if (Array.isArray(after?.bidderIds)) after.bidderIds.forEach(id => userIds.add(id));
    if (Array.isArray(before?.bidderIds)) before.bidderIds.forEach(id => userIds.add(id));

    const updates = [];
    for (const uid of userIds) {
      updates.push(updateGroupSession(groupId, uid, {
        lastAuctionUpdate: admin.firestore.FieldValue.serverTimestamp()
      }));
    }
    await Promise.all(updates);
    return null;
  });

/** TRADE WRITE → update group session for participants */
exports.updateGroupSessionOnTrade = functions.firestore
  .document('trades/{tradeId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;

    const groupId = after?.groupId || before?.groupId;
    if (!groupId) return null;

    const users = new Set();
    if (Array.isArray(after?.participantIds)) after.participantIds.forEach(u => users.add(u));
    if (Array.isArray(before?.participantIds)) before.participantIds.forEach(u => users.add(u));

    await Promise.all(Array.from(users).map(uid => updateGroupSession(groupId, uid, {
      lastTradeUpdate: admin.firestore.FieldValue.serverTimestamp()
    })));
    return null;
  });

/**
 * Scheduled task – close auctions whose endTime has passed.
 * Runs every minute. Read cost: (# of auctions ending per minute) instead of scanning all active auctions.
 */
exports.processEndingAuctions = functions.pubsub.schedule('every 1 minutes').onRun(async (context) => {
  const now = admin.firestore.Timestamp.now();
  const oneMinuteAgo = admin.firestore.Timestamp.fromMillis(now.toMillis() - 60 * 1000);

  // Query only the subset that could have ended in the last minute.
  const endingQuery = db.collection('auctions')
    .where('status', '==', 'active')
    .where('endTime', '<=', now)
    .where('endTime', '>', oneMinuteAgo);

  const snapshot = await endingQuery.get();
  if (snapshot.empty) {
    console.log('processEndingAuctions – no auctions to close');
    return null;
  }

  console.log(`processEndingAuctions – closing ${snapshot.size} auctions`);
  const batch = db.batch();

  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    const auctionRef = docSnap.ref;

    // Mark auction completed
    batch.update(auctionRef, {
      status: 'completed',
      completedAt: now,
    });

    // Transfer card to winner (if any) and mark available
    if (data.cardId) {
      const cardRef = db.doc(`cards/${data.cardId}`);

      // Determine winner – prefer explicit highestBidder / currentBidder field
      const winnerId = data.currentBidder || data.winnerId || null;

      batch.update(cardRef, {
        inAuction: false,
        auctionId: null,
        status: 'available',
        statusUpdateTime: now,
        ...(winnerId ? { ownerId: winnerId, userId: winnerId } : {})
      });

      // Reward seller with coins and update balances via a transaction (out of batch)
      if (winnerId) {
        const sellerId = data.sellerId;
        const bidAmount = data.currentBid || 0;

        // Update balances in separate operations to avoid contention
        if (bidAmount > 0 && sellerId) {
          const sellerRef = db.doc(`users/${sellerId}`);
          batch.update(sellerRef, {
            [`groupBalances.${data.groupId}`]: admin.firestore.FieldValue.increment(bidAmount)
          });
        }
      }
    }
  });

  await batch.commit();
  console.log('processEndingAuctions – batch commit complete');
  return null;
});

/** 
 * 🚀 OPTIMIZED BOOT PAYLOAD FUNCTION
 * Maintains comprehensive boot payload using overview documents
 * Client fetches this SINGLE document for instant app boot
 * 
 * Triggers: Any change to user/group/overview documents
 * Output: initialAppLoad/{userId}_{groupId} with ALL essential data
 */
exports.syncBootPayload = functions.firestore
  .document('{collectionId}/{docId}')
  .onWrite(async (change, context) => {
    const { collectionId, docId } = context.params;

    // Only respond to changes in these collections
    const TRIGGER_COLLECTIONS = [
      'users',
      'groups', 
      'auctionOverviews',
      'tradeOverviews',
      'socialOverviews',
      'cardOverviews'
    ];
    
    if (!TRIGGER_COLLECTIONS.includes(collectionId)) return null;

    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;

    let userId, groupId;

    // Extract user and group IDs based on collection type
    if (collectionId === 'users') {
      userId = docId;
      groupId = after?.lastActiveGroup || before?.lastActiveGroup;
    } else if (collectionId === 'groups') {
      groupId = docId;
      // Update for all active users in this group (optional enhancement)
      // For now, we'll skip this to avoid too many writes
      return null;
    } else if (collectionId === 'cardOverviews') {
      // Format: {groupId}_{userId}
      const parts = docId.split('_');
      if (parts.length !== 2) return null;
      groupId = parts[0];
      userId = parts[1];
    } else {
      // auctionOverviews, tradeOverviews, socialOverviews use groupId as docId
      groupId = docId;
      // We need to update boot payloads for ALL users in this group
      // For efficiency, we'll do this via a query
      const activeUsersSnap = await db.collection('users')
        .where('lastActiveGroup', '==', groupId)
        .limit(50) // Reasonable limit
        .get();
      
      const promises = activeUsersSnap.docs.map(userDoc => 
        rebuildBootPayload(userDoc.id, groupId)
      );
      
      await Promise.all(promises);
      return null;
    }

    if (!userId || !groupId) {
      console.log(`⚠️ [syncBootPayload] Missing userId or groupId for ${collectionId}/${docId}`);
      return null;
    }

    // Rebuild boot payload for this user/group
    return rebuildBootPayload(userId, groupId);
  });

/**
 * 🚀 QUICK WIN: Expo Push Notifications for Bid Updates
 * Replaces ConsolidatedBidService listener with push notifications
 *
 * Triggers: When a bid is placed on an auction
 * Output: Expo push notification to all group members
 * Impact: -30 to -40 reads per session (eliminates real-time listener)
 */
exports.onBidPlaced = functions.firestore
  .document('auctions/{auctionId}/bids/{bidId}')
  .onCreate(async (snap, context) => {
    const { auctionId, bidId } = context.params;
    const bid = snap.data();

    try {
      // Get auction details
      const auctionSnap = await db.doc(`auctions/${auctionId}`).get();
      if (!auctionSnap.exists) {
        console.log(`⚠️ Auction ${auctionId} not found for bid ${bidId}`);
        return null;
      }

      const auction = auctionSnap.data();
      const groupId = auction.groupId;

      if (!groupId) {
        console.log(`⚠️ No groupId for auction ${auctionId}`);
        return null;
      }

      // Update auction with latest bid info (denormalized)
      await db.doc(`auctions/${auctionId}`).update({
        currentBid: bid.amount,
        currentBidder: bid.bidderId,
        currentBidderName: bid.bidderName || 'Unknown',
        uniqueBidderCount: admin.firestore.FieldValue.increment(1),
        lastBidTime: admin.firestore.FieldValue.serverTimestamp(),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });

      // Get all group members' Expo push tokens
      const membersSnap = await db.collection('users')
        .where('groups', 'array-contains', groupId)
        .get();

      const messages = [];
      membersSnap.forEach(doc => {
        const expoPushToken = doc.data().expoPushToken;
        if (expoPushToken && doc.id !== bid.bidderId) { // Don't notify the bidder
          messages.push({
            to: expoPushToken,
            sound: 'default',
            title: `New bid on ${auction.cardName || 'auction'}`,
            body: `${bid.bidderName || 'Someone'} bid ${bid.amount} coins`,
            data: {
              type: 'BID_UPDATE',
              auctionId,
              cardName: auction.cardName || 'Unknown Card',
              currentBid: String(bid.amount),
              currentBidder: bid.bidderId,
              currentBidderName: bid.bidderName || 'Unknown',
              bidCount: String((auction.uniqueBidderCount || 0) + 1),
              groupId,
              timestamp: String(Date.now())
            },
          });
        }
      });

      if (messages.length === 0) {
        console.log(`⚠️ No Expo push tokens found for group ${groupId}`);
        return null;
      }

      // Send Expo push notifications
      const fetch = require('node-fetch');
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });

      const result = await response.json();

      console.log(`✅ Expo push notifications sent for auction ${auctionId}: ${messages.length} messages`);
      console.log(`   Result:`, JSON.stringify(result, null, 2));

      return null;

    } catch (error) {
      console.error(`❌ Error in onBidPlaced for ${auctionId}:`, error);
      return null;
    }
  });

/**
 * Helper: Rebuild comprehensive boot payload from overview documents
 */
async function rebuildBootPayload(userId, groupId) {
  try {
    console.log(`🔄 [syncBootPayload] Rebuilding for user ${userId}, group ${groupId}`);

    // Fetch ALL overview documents in parallel (efficient)
    const [
      userSnap,
      groupSnap,
      cardOverviewSnap,
      auctionOverviewSnap,
      tradeOverviewSnap,
      socialOverviewSnap
    ] = await Promise.all([
      db.doc(`users/${userId}`).get(),
      db.doc(`groups/${groupId}`).get(),
      db.doc(`cardOverviews/${groupId}_${userId}`).get(),
      db.doc(`auctionOverviews/${groupId}`).get(),
      db.doc(`tradeOverviews/${groupId}`).get(),
      db.doc(`socialOverviews/${groupId}`).get()
    ]);

    // Build comprehensive payload
    const payload = {
      // User profile data
      user: userSnap.exists ? {
        id: userSnap.id,
        ...userSnap.data(),
        // Include session data if needed
      } : null,

      // Group data
      group: groupSnap.exists ? {
        id: groupSnap.id,
        ...groupSnap.data()
      } : null,

      // User's cards (from cardOverview)
      cards: cardOverviewSnap.exists ? cardOverviewSnap.data().cards || [] : [],

      // Active auctions (from auctionOverview)
      auctions: auctionOverviewSnap.exists ? auctionOverviewSnap.data().auctions || [] : [],

      // Active trades (from tradeOverview)
      trades: tradeOverviewSnap.exists ? tradeOverviewSnap.data().trades || [] : [],

      // Recent social posts (from socialOverview)
      posts: socialOverviewSnap.exists ? socialOverviewSnap.data().posts || [] : [],

      // Metadata
      version: '2.0',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'cloud_function'
    };

    // Save boot payload
    const bootPayloadRef = db.doc(`initialAppLoad/${userId}_${groupId}`);
    await bootPayloadRef.set(payload, { merge: true });

    console.log(`✅ [syncBootPayload] Updated for ${userId} in ${groupId}`);
    console.log(`   Cards: ${payload.cards.length}, Auctions: ${payload.auctions.length}, Trades: ${payload.trades.length}, Posts: ${payload.posts.length}`);

    return null;

  } catch (error) {
    console.error(`❌ [syncBootPayload] Error for ${userId}/${groupId}:`, error);
    return null;
  }
}
