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
        rarity: after.rarity,
        status: after.status,
        imageUrl: after.imageUrl || null,
        updatedAt: after.updatedAt || null,
      });
    }

    // sort alphabetically by name
    cards.sort((a,b)=> a.name.localeCompare(b.name));
    await overviewRef.set({ cards }, { merge: true });
    return null;
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