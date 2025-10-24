/**
 * Supabase Realtime Service
 *
 * Replaces Firebase onSnapshot listeners with Supabase Realtime subscriptions.
 * Uses Postgres LISTEN/NOTIFY for efficient real-time updates.
 *
 * Features:
 * - Table-level subscriptions (INSERT, UPDATE, DELETE)
 * - Row-level filtering (RLS policies enforced)
 * - Channel multiplexing (multiple subscriptions per channel)
 * - Automatic reconnection
 * - Memory efficient (no FCM overhead)
 */

import { supabase } from './ReadTracking/SupabaseTracked';

class SupabaseRealtimeService {
  constructor() {
    this.channels = new Map(); // channelName -> channel instance
    this.subscriptions = new Map(); // subscriptionId -> { channel, callback }
  }

  /**
   * Subscribe to auction changes in a group
   * @param {string} groupId - Group ID
   * @param {function} callback - Callback function (payload) => void
   * @returns {function} Unsubscribe function
   */
  subscribeToAuctions(groupId, callback) {
    const channelName = `auctions:${groupId}`;
    const subscriptionId = `${channelName}:${Date.now()}`;

    // Get or create channel
    let channel = this.channels.get(channelName);
    if (!channel) {
      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*', // INSERT, UPDATE, DELETE
            schema: 'public',
            table: 'auctions',
            filter: `group_id=eq.${groupId}`
          },
          (payload) => {
            console.log('🔴 Auction change:', payload);
            this._notifySubscribers(channelName, payload);
          }
        )
        .subscribe((status) => {
          console.log(`📡 Auction subscription status: ${status}`);
        });

      this.channels.set(channelName, channel);
    }

    // Store subscription
    this.subscriptions.set(subscriptionId, { channel: channelName, callback });

    // Return unsubscribe function
    return () => {
      this.subscriptions.delete(subscriptionId);

      // If no more subscribers, unsubscribe channel
      const remainingSubscribers = Array.from(this.subscriptions.values()).filter(
        (sub) => sub.channel === channelName
      );
      if (remainingSubscribers.length === 0) {
        channel.unsubscribe();
        this.channels.delete(channelName);
        console.log(`🧹 Unsubscribed from ${channelName}`);
      }
    };
  }

  /**
   * Subscribe to user balance changes
   * @param {string} userId - User ID
   * @param {function} callback - Callback function (payload) => void
   * @returns {function} Unsubscribe function
   */
  subscribeToBalance(userId, callback) {
    const channelName = `balance:${userId}`;
    const subscriptionId = `${channelName}:${Date.now()}`;

    let channel = this.channels.get(channelName);
    if (!channel) {
      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'user_sessions',
            filter: `user_id=eq.${userId}`
          },
          (payload) => {
            console.log('💰 Balance change:', payload);
            this._notifySubscribers(channelName, payload);
          }
        )
        .subscribe();

      this.channels.set(channelName, channel);
    }

    this.subscriptions.set(subscriptionId, { channel: channelName, callback });

    return () => {
      this.subscriptions.delete(subscriptionId);
      const remainingSubscribers = Array.from(this.subscriptions.values()).filter(
        (sub) => sub.channel === channelName
      );
      if (remainingSubscribers.length === 0) {
        channel.unsubscribe();
        this.channels.delete(channelName);
      }
    };
  }

  /**
   * Subscribe to trade changes
   * @param {string} userId - User ID
   * @param {function} callback - Callback function (payload) => void
   * @returns {function} Unsubscribe function
   */
  subscribeToTrades(userId, callback) {
    const channelName = `trades:${userId}`;
    const subscriptionId = `${channelName}:${Date.now()}`;

    let channel = this.channels.get(channelName);
    if (!channel) {
      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'trades',
            filter: `sender_id=eq.${userId}`
          },
          (payload) => {
            console.log('🔄 Trade change (sender):', payload);
            this._notifySubscribers(channelName, payload);
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'trades',
            filter: `receiver_id=eq.${userId}`
          },
          (payload) => {
            console.log('🔄 Trade change (receiver):', payload);
            this._notifySubscribers(channelName, payload);
          }
        )
        .subscribe();

      this.channels.set(channelName, channel);
    }

    this.subscriptions.set(subscriptionId, { channel: channelName, callback });

    return () => {
      this.subscriptions.delete(subscriptionId);
      const remainingSubscribers = Array.from(this.subscriptions.values()).filter(
        (sub) => sub.channel === channelName
      );
      if (remainingSubscribers.length === 0) {
        channel.unsubscribe();
        this.channels.delete(channelName);
      }
    };
  }

  /**
   * Subscribe to social feed posts
   * @param {string} groupId - Group ID
   * @param {function} callback - Callback function (payload) => void
   * @returns {function} Unsubscribe function
   */
  subscribeToSocialFeed(groupId, callback) {
    const channelName = `posts:${groupId}`;
    const subscriptionId = `${channelName}:${Date.now()}`;

    let channel = this.channels.get(channelName);
    if (!channel) {
      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'posts',
            filter: `group_id=eq.${groupId}`
          },
          (payload) => {
            console.log('📱 Post change:', payload);
            this._notifySubscribers(channelName, payload);
          }
        )
        .subscribe();

      this.channels.set(channelName, channel);
    }

    this.subscriptions.set(subscriptionId, { channel: channelName, callback });

    return () => {
      this.subscriptions.delete(subscriptionId);
      const remainingSubscribers = Array.from(this.subscriptions.values()).filter(
        (sub) => sub.channel === channelName
      );
      if (remainingSubscribers.length === 0) {
        channel.unsubscribe();
        this.channels.delete(channelName);
      }
    };
  }

  /**
   * Notify all subscribers for a channel
   * @private
   */
  _notifySubscribers(channelName, payload) {
    const subscribers = Array.from(this.subscriptions.entries())
      .filter(([_, sub]) => sub.channel === channelName)
      .map(([_, sub]) => sub.callback);

    subscribers.forEach((callback) => {
      try {
        callback(payload);
      } catch (error) {
        console.error('Error in Realtime callback:', error);
      }
    });
  }

  /**
   * Unsubscribe all channels (cleanup)
   */
  cleanup() {
    this.channels.forEach((channel, channelName) => {
      channel.unsubscribe();
      console.log(`🧹 Cleaned up channel: ${channelName}`);
    });
    this.channels.clear();
    this.subscriptions.clear();
  }
}

// Singleton instance
const realtimeService = new SupabaseRealtimeService();

export default realtimeService;
