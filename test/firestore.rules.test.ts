import * as firebase from '@firebase/rules-unit-testing';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { Timestamp } from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ID = 'cardmates-test';
const RULES_PATH = path.resolve(__dirname, '../firestore.rules');
const FIRESTORE_EMULATOR_HOST = 'localhost';
const FIRESTORE_EMULATOR_PORT = 8080;

// Test users
const ALICE = { uid: 'alice', email: 'alice@example.com' };
const BOB = { uid: 'bob', email: 'bob@example.com' };
const CHARLIE = { uid: 'charlie', email: 'charlie@example.com' };

// Test data
const GROUP_ID = 'test-group';
const CARD_ID = 'test-card';
const TRADE_ID = 'test-trade';
const AUCTION_ID = 'test-auction';
const NOTIFICATION_ID = 'test-notification';

describe('Firestore Security Rules', () => {
  let testEnv: firebase.RulesTestEnvironment;
  let aliceDb: firebase.RulesTestContext;
  let bobDb: firebase.RulesTestContext;
  let charlieDb: firebase.RulesTestContext;
  let adminDb: firebase.RulesTestContext;

  beforeAll(async () => {
    testEnv = await firebase.initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: fs.readFileSync(RULES_PATH, 'utf8'),
        host: FIRESTORE_EMULATOR_HOST,
        port: FIRESTORE_EMULATOR_PORT,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    
    // Initialize test users
    aliceDb = testEnv.authenticatedContext(ALICE.uid);
    bobDb = testEnv.authenticatedContext(BOB.uid);
    charlieDb = testEnv.authenticatedContext(CHARLIE.uid);
    adminDb = testEnv.unauthenticatedContext();

    // Setup test data
    await adminDb.firestore().collection('groups').doc(GROUP_ID).set({
      name: 'Test Group',
      createdAt: Timestamp.now(),
    });

    // Add Alice and Bob as group members
    await adminDb.firestore()
      .collection('groups').doc(GROUP_ID)
      .collection('members').doc(ALICE.uid).set({ joinedAt: Timestamp.now() });
    
    await adminDb.firestore()
      .collection('groups').doc(GROUP_ID)
      .collection('members').doc(BOB.uid).set({ joinedAt: Timestamp.now() });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  describe('User Documents', () => {
    it('allows users to read their own profile', async () => {
      await assertSucceeds(
        aliceDb.firestore().collection('users').doc(ALICE.uid).get()
      );
    });

    it('prevents users from reading other profiles', async () => {
      await assertFails(
        aliceDb.firestore().collection('users').doc(BOB.uid).get()
      );
    });
  });

  describe('Group Documents', () => {
    it('allows group members to read group data', async () => {
      await assertSucceeds(
        aliceDb.firestore().collection('groups').doc(GROUP_ID).get()
      );
    });

    it('prevents non-members from reading group data', async () => {
      await assertFails(
        charlieDb.firestore().collection('groups').doc(GROUP_ID).get()
      );
    });
  });

  describe('Cards', () => {
    beforeEach(async () => {
      // Create a test card owned by Alice
      await adminDb.firestore()
        .collection('groups').doc(GROUP_ID)
        .collection('cards').doc(CARD_ID)
        .set({
          ownerId: ALICE.uid,
          rarity: 'common',
          imageUrl: 'https://example.com/card.jpg',
          mintedAt: Timestamp.now(),
        });
    });

    it('allows card owner to update their card', async () => {
      await assertSucceeds(
        aliceDb.firestore()
          .collection('groups').doc(GROUP_ID)
          .collection('cards').doc(CARD_ID)
          .update({ rarity: 'rare' })
      );
    });

    it('prevents non-owners from updating cards', async () => {
      await assertFails(
        bobDb.firestore()
          .collection('groups').doc(GROUP_ID)
          .collection('cards').doc(CARD_ID)
          .update({ rarity: 'rare' })
      );
    });
  });

  describe('Trades', () => {
    beforeEach(async () => {
      // Create a test card owned by Alice
      await adminDb.firestore()
        .collection('groups').doc(GROUP_ID)
        .collection('cards').doc(CARD_ID)
        .set({
          ownerId: ALICE.uid,
          rarity: 'common',
          imageUrl: 'https://example.com/card.jpg',
          mintedAt: Timestamp.now(),
        });
    });

    it('allows card owner to create trade offer', async () => {
      await assertSucceeds(
        aliceDb.firestore()
          .collection('groups').doc(GROUP_ID)
          .collection('trades').doc(TRADE_ID)
          .set({
            fromUser: ALICE.uid,
            toUser: BOB.uid,
            cardId: CARD_ID,
            status: 'pending',
            createdAt: Timestamp.now(),
          })
      );
    });

    it('prevents creating trade with non-member', async () => {
      await assertFails(
        aliceDb.firestore()
          .collection('groups').doc(GROUP_ID)
          .collection('trades').doc(TRADE_ID)
          .set({
            fromUser: ALICE.uid,
            toUser: CHARLIE.uid,
            cardId: CARD_ID,
            status: 'pending',
            createdAt: Timestamp.now(),
          })
      );
    });
  });

  describe('Auctions', () => {
    beforeEach(async () => {
      // Create a test card owned by Alice
      await adminDb.firestore()
        .collection('groups').doc(GROUP_ID)
        .collection('cards').doc(CARD_ID)
        .set({
          ownerId: ALICE.uid,
          rarity: 'common',
          imageUrl: 'https://example.com/card.jpg',
          mintedAt: Timestamp.now(),
        });
    });

    it('allows card owner to create auction', async () => {
      await assertSucceeds(
        aliceDb.firestore()
          .collection('groups').doc(GROUP_ID)
          .collection('auctions').doc(AUCTION_ID)
          .set({
            sellerId: ALICE.uid,
            cardId: CARD_ID,
            startPrice: 100,
            buyNowPrice: 200,
            highestBid: 100,
            highestBidderId: null,
            endTime: Timestamp.fromDate(new Date(Date.now() + 86400000)), // 24 hours from now
            status: 'active',
          })
      );
    });

    it('prevents creating auction with invalid end time', async () => {
      await assertFails(
        aliceDb.firestore()
          .collection('groups').doc(GROUP_ID)
          .collection('auctions').doc(AUCTION_ID)
          .set({
            sellerId: ALICE.uid,
            cardId: CARD_ID,
            startPrice: 100,
            buyNowPrice: 200,
            highestBid: 100,
            highestBidderId: null,
            endTime: Timestamp.fromDate(new Date(Date.now() - 86400000)), // 24 hours ago
            status: 'active',
          })
      );
    });

    it('allows valid bid updates', async () => {
      // First create an auction
      await adminDb.firestore()
        .collection('groups').doc(GROUP_ID)
        .collection('auctions').doc(AUCTION_ID)
        .set({
          sellerId: ALICE.uid,
          cardId: CARD_ID,
          startPrice: 100,
          buyNowPrice: 200,
          highestBid: 100,
          highestBidderId: null,
          endTime: Timestamp.fromDate(new Date(Date.now() + 86400000)),
          status: 'active',
        });

      // Then try to place a higher bid
      await assertSucceeds(
        bobDb.firestore()
          .collection('groups').doc(GROUP_ID)
          .collection('auctions').doc(AUCTION_ID)
          .update({
            highestBid: 150,
            highestBidderId: BOB.uid,
          })
      );
    });

    it('prevents invalid bid updates', async () => {
      // First create an auction
      await adminDb.firestore()
        .collection('groups').doc(GROUP_ID)
        .collection('auctions').doc(AUCTION_ID)
        .set({
          sellerId: ALICE.uid,
          cardId: CARD_ID,
          startPrice: 100,
          buyNowPrice: 200,
          highestBid: 100,
          highestBidderId: null,
          endTime: Timestamp.fromDate(new Date(Date.now() + 86400000)),
          status: 'active',
        });

      // Try to place a lower bid
      await assertFails(
        bobDb.firestore()
          .collection('groups').doc(GROUP_ID)
          .collection('auctions').doc(AUCTION_ID)
          .update({
            highestBid: 50,
            highestBidderId: BOB.uid,
          })
      );
    });
  });

  describe('Notifications', () => {
    it('allows users to read their own notifications', async () => {
      // First create a notification
      await adminDb.firestore()
        .collection('groups').doc(GROUP_ID)
        .collection('notifications').doc(NOTIFICATION_ID)
        .set({
          userId: ALICE.uid,
          type: 'trade_request',
          payload: { tradeId: 'test-trade' },
          read: false,
          createdAt: Timestamp.now(),
        });

      // Then try to read it
      await assertSucceeds(
        aliceDb.firestore()
          .collection('groups').doc(GROUP_ID)
          .collection('notifications').doc(NOTIFICATION_ID)
          .get()
      );
    });

    it('prevents users from reading others notifications', async () => {
      // First create a notification
      await adminDb.firestore()
        .collection('groups').doc(GROUP_ID)
        .collection('notifications').doc(NOTIFICATION_ID)
        .set({
          userId: ALICE.uid,
          type: 'trade_request',
          payload: { tradeId: 'test-trade' },
          read: false,
          createdAt: Timestamp.now(),
        });

      // Then try to read it as Bob
      await assertFails(
        bobDb.firestore()
          .collection('groups').doc(GROUP_ID)
          .collection('notifications').doc(NOTIFICATION_ID)
          .get()
      );
    });
  });
}); 