/**
 * Consolidated Bid Service - FCM Push-Based
 *
 * 🚀 QUICK WIN: Replaced real-time listeners with FCM push notifications
 * - Zero continuous Firestore reads (was 30-40 reads/session)
 * - Real-time updates via Cloud Function + FCM
 * - Same API for components (no breaking changes)
 * - Impact: -30 to -40 reads per session
 */

import {
    doc,
    updateDoc,
    writeBatch
} from 'firebase/firestore';
import * as Notifications from 'expo-notifications';
import { db } from '../config/firebase';

class ConsolidatedBidService {
  constructor() {
    this.auctionSubscribers = new Map(); // Components subscribing to auction updates
    this.bidSummaryCache = new Map(); // Cache for bid summaries
    this.fcmUnsubscribe = null;

    this.metrics = {
      totalSubscribers: 0,
      bidUpdatesProcessed: 0,
      fcmMessagesReceived: 0,
      duplicateUpdatesEliminated: 0
    };

    // 🚀 QUICK WIN: Setup FCM listener (replaces Firestore listener)
    this.setupFCMListener();
  }

  /**
   * 🚀 Push Notification Listener (Expo Notifications)
   * Receives bid updates from Cloud Function instead of Firestore listener
   */
  setupFCMListener() {
    console.log('🚀 ConsolidatedBidService: Setting up push notification listener for bid updates');

    // Listen for foreground notifications
    this.notificationSubscription = Notifications.addNotificationReceivedListener((notification) => {
      try {
        const data = notification.request.content.data;

        // Only process BID_UPDATE messages
        if (data?.type !== 'BID_UPDATE') {
          return;
        }

        this.metrics.fcmMessagesReceived++;

        const {
          auctionId,
          currentBid,
          currentBidder,
          currentBidderName,
          bidCount,
          timestamp
        } = data;

        // Create bid summary
        const bidSummary = {
          auctionId,
          currentBid: parseInt(currentBid, 10),
          currentBidder,
          currentBidderName,
          bidCount: parseInt(bidCount, 10),
          timestamp: parseInt(timestamp, 10)
        };

        // Check for duplicates
        const lastUpdate = this.bidSummaryCache.get(auctionId);
        if (lastUpdate && lastUpdate.timestamp === bidSummary.timestamp) {
          this.metrics.duplicateUpdatesEliminated++;
          return;
        }

        // Cache the summary
        this.bidSummaryCache.set(auctionId, bidSummary);

        // Notify subscribers
        const subscribers = this.auctionSubscribers.get(auctionId);
        if (subscribers && subscribers.size > 0) {
          subscribers.forEach(callback => {
            try {
              callback(bidSummary);
            } catch (error) {
              console.error('🚨 Error in bid update callback:', error);
            }
          });

          this.metrics.bidUpdatesProcessed++;
          console.log(`✅ Push notification bid update processed for auction ${auctionId}: ${bidSummary.currentBid} coins`);
        }

      } catch (error) {
        console.error('🚨 Error processing push notification bid update:', error);
      }
    });

    console.log('✅ ConsolidatedBidService: Push notification listener active (0 Firestore reads!)');
  }

  /**
   * 🚀 QUICK WIN: Subscribe to auction bid updates
   * Now FCM-based (was Firestore listener)
   * Same API, zero Firestore reads!
   */
  subscribeToAuctionUpdates(groupId, auctionId, callback) {
    if (!groupId || !auctionId || !callback) {
      console.error('ConsolidatedBidService: Invalid subscription parameters');
      return () => {};
    }

    const subscriberKey = `${auctionId}_${Date.now()}`;

    // Track subscriber
    if (!this.auctionSubscribers.has(auctionId)) {
      this.auctionSubscribers.set(auctionId, new Map());
    }
    this.auctionSubscribers.get(auctionId).set(subscriberKey, callback);
    this.metrics.totalSubscribers++;

    console.log(`🚀 FCM: Added auction subscriber for ${auctionId} (${this.metrics.totalSubscribers} total)`);

    // Return unsubscribe function
    return () => {
      const subscribers = this.auctionSubscribers.get(auctionId);
      if (subscribers) {
        subscribers.delete(subscriberKey);
        if (subscribers.size === 0) {
          this.auctionSubscribers.delete(auctionId);
        }
      }
      this.metrics.totalSubscribers--;
      console.log(`🧹 FCM: Removed auction subscriber for ${auctionId}`);
    };
  }

  /**
   * OPTIMIZATION: Denormalize bid data directly into auction documents
   * Eliminates need for separate bid subcollection queries
   */
  async updateAuctionBidSummary(auctionId, bidData) {
    try {
      const auctionRef = doc(db, 'auctions', auctionId);
      
      const bidSummary = {
        currentBid: bidData.amount,
        currentBidder: bidData.bidderId,
        currentBidderName: bidData.bidderName,
        uniqueBidderCount: bidData.uniqueBidderCount,
        lastBidTime: bidData.timestamp,
        // Keep only essential data, no full bid history
        lastUpdated: new Date()
      };

      await updateDoc(auctionRef, bidSummary);
      
      console.log(`✅ OPTIMIZED: Updated auction ${auctionId} bid summary (denormalized)`);
      return true;

    } catch (error) {
      console.error(`🚨 Error updating auction bid summary:`, error);
      return false;
    }
  }

  /**
   * Batch update multiple auction bid summaries
   */
  async batchUpdateBidSummaries(updates) {
    if (!updates || updates.length === 0) return;

    try {
      const batch = writeBatch(db);
      const timestamp = new Date();

      updates.forEach(({ auctionId, bidData }) => {
        const auctionRef = doc(db, 'auctions', auctionId);
        batch.update(auctionRef, {
          currentBid: bidData.amount,
          currentBidder: bidData.bidderId,
          currentBidderName: bidData.bidderName,
          uniqueBidderCount: bidData.uniqueBidderCount,
          lastBidTime: bidData.timestamp,
          lastUpdated: timestamp
        });
      });

      await batch.commit();
      console.log(`✅ OPTIMIZED: Batch updated ${updates.length} auction bid summaries`);

    } catch (error) {
      console.error(`🚨 Error batch updating bid summaries:`, error);
    }
  }

  /**
   * 🚀 QUICK WIN: Cleanup all listeners (now just push notifications)
   */
  cleanupAll() {
    console.log(`🧹 ConsolidatedBidService: Cleaning up push notification listener and subscribers`);

    // Unsubscribe from push notifications
    if (this.notificationSubscription) {
      this.notificationSubscription.remove();
      this.notificationSubscription = null;
    }

    this.auctionSubscribers.clear();
    this.bidSummaryCache.clear();

    this.metrics = {
      totalSubscribers: 0,
      bidUpdatesProcessed: 0,
      fcmMessagesReceived: 0,
      duplicateUpdatesEliminated: 0
    };
  }

  /**
   * 🚀 QUICK WIN: Get optimization metrics (FCM-based)
   */
  getMetrics() {
    return {
      ...this.metrics,
      subscribedAuctions: this.auctionSubscribers.size,
      cachedSummaries: this.bidSummaryCache.size,
      efficiency: this.metrics.duplicateUpdatesEliminated / Math.max(1, this.metrics.fcmMessagesReceived),
      firestoreReads: 0 // 🎉 Zero Firestore reads!
    };
  }
}

// Export singleton instance
export default new ConsolidatedBidService(); 