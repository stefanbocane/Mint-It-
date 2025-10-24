/**
 * Trade Service - Supabase Implementation
 *
 * Provides trade functionality using Supabase Postgres.
 * Replaces Firebase Firestore-based trade service.
 *
 * Key Features:
 * - Trade creation and management
 * - Trade acceptance/rejection
 * - Card ownership transfer on trade completion
 * - Trade history and queries
 */

import { supabase } from './ReadTracking/SupabaseTracked';
import CardServiceSupabase from './CardServiceSupabase';

class TradeServiceSupabase {
  /**
   * Create a new trade offer
   * @param {Object} tradeData - Trade data
   * @param {string} tradeData.senderId - Sender user ID (UUID)
   * @param {string} tradeData.senderName - Sender username
   * @param {string} tradeData.receiverId - Receiver user ID (UUID)
   * @param {string} tradeData.receiverName - Receiver username
   * @param {string} tradeData.groupId - Group ID (UUID)
   * @param {string[]} tradeData.offeredCards - Card IDs sender is offering
   * @param {string[]} tradeData.requestedCards - Card IDs sender wants
   * @returns {Promise<{success: boolean, tradeId?: string, error?: string}>}
   */
  static async createTrade(tradeData) {
    try {
      const {
        senderId,
        senderName,
        receiverId,
        receiverName,
        groupId,
        offeredCards = [],
        requestedCards = []
      } = tradeData;

      if (!senderId || !receiverId || !groupId) {
        return { success: false, error: 'Missing required trade data' };
      }

      if (senderId === receiverId) {
        return { success: false, error: 'Cannot trade with yourself' };
      }

      if (offeredCards.length === 0 && requestedCards.length === 0) {
        return { success: false, error: 'Must offer or request at least one card' };
      }

      console.log(`[Supabase] Creating trade from ${senderName} to ${receiverName}`);

      // Create trade
      const { data, error } = await supabase
        .from('trades')
        .insert({
          group_id: groupId,
          sender_id: senderId,
          sender_name: senderName,
          receiver_id: receiverId,
          receiver_name: receiverName,
          participant_ids: [senderId, receiverId],
          offered_cards: offeredCards,
          requested_cards: requestedCards,
          status: 'pending'
        })
        .select()
        .single();

      if (error) {
        console.error('[Supabase] Error creating trade:', error);
        return { success: false, error: error.message };
      }

      // Mark offered cards as in_trade
      if (offeredCards.length > 0) {
        for (const cardId of offeredCards) {
          await CardServiceSupabase.updateCardStatus(cardId, {
            status: 'in_trade',
            inTrade: true,
            tradeId: data.id
          });
        }
      }

      console.log(`✅ [Supabase] Created trade ${data.id}`);
      return { success: true, tradeId: data.id, trade: data };

    } catch (error) {
      console.error('[Supabase] Error in createTrade:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get trades for a user
   * @param {string} userId - User ID (UUID)
   * @param {string} groupId - Group ID (UUID)
   * @param {Object} options - Query options
   * @param {string} options.status - Filter by status (pending, completed, etc.)
   * @param {number} options.limit - Max trades to return (default: 50)
   * @returns {Promise<Array>} - Array of trades
   */
  static async getUserTrades(userId, groupId, options = {}) {
    try {
      if (!userId || !groupId) {
        console.warn('[Supabase] getUserTrades called without userId or groupId');
        return [];
      }

      const limit = options.limit || 50;

      let query = supabase
        .from('trades')
        .select(`
          *,
          sender:users!trades_sender_id_fkey (
            id,
            username,
            display_name,
            avatar_url
          ),
          receiver:users!trades_receiver_id_fkey (
            id,
            username,
            display_name,
            avatar_url
          )
        `)
        .eq('group_id', groupId)
        .contains('participant_ids', [userId])
        .order('created_at', { ascending: false })
        .limit(limit);

      // Apply status filter if provided
      if (options.status) {
        query = query.eq('status', options.status);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[Supabase] Error fetching user trades:', error);
        return [];
      }

      // Transform to match Firebase format
      const trades = (data || []).map(trade => ({
        id: trade.id,
        groupId: trade.group_id,
        senderId: trade.sender_id,
        senderName: trade.sender_name || trade.sender?.username,
        senderAvatar: trade.sender_avatar || trade.sender?.avatar_url,
        receiverId: trade.receiver_id,
        receiverName: trade.receiver_name || trade.receiver?.username,
        receiverAvatar: trade.receiver_avatar || trade.receiver?.avatar_url,
        offeredCards: trade.offered_cards || [],
        requestedCards: trade.requested_cards || [],
        status: trade.status,
        createdAt: new Date(trade.created_at),
        updatedAt: new Date(trade.updated_at)
      }));

      console.log(`✅ [Supabase] Fetched ${trades.length} trades for user ${userId}`);
      return trades;

    } catch (error) {
      console.error('[Supabase] Error in getUserTrades:', error);
      return [];
    }
  }

  /**
   * Get a single trade by ID
   * @param {string} tradeId - Trade ID (UUID)
   * @returns {Promise<Object|null>} - Trade object or null
   */
  static async getTradeById(tradeId) {
    try {
      if (!tradeId) {
        console.warn('[Supabase] getTradeById called without tradeId');
        return null;
      }

      const { data, error } = await supabase
        .from('trades')
        .select(`
          *,
          sender:users!trades_sender_id_fkey (
            id,
            username,
            display_name,
            avatar_url
          ),
          receiver:users!trades_receiver_id_fkey (
            id,
            username,
            display_name,
            avatar_url
          )
        `)
        .eq('id', tradeId)
        .single();

      if (error) {
        console.error('[Supabase] Error fetching trade:', error);
        return null;
      }

      if (!data) return null;

      // Transform to Firebase format
      return {
        id: data.id,
        groupId: data.group_id,
        senderId: data.sender_id,
        senderName: data.sender_name || data.sender?.username,
        senderAvatar: data.sender_avatar || data.sender?.avatar_url,
        receiverId: data.receiver_id,
        receiverName: data.receiver_name || data.receiver?.username,
        receiverAvatar: data.receiver_avatar || data.receiver?.avatar_url,
        offeredCards: data.offered_cards || [],
        requestedCards: data.requested_cards || [],
        status: data.status,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at)
      };

    } catch (error) {
      console.error('[Supabase] Error in getTradeById:', error);
      return null;
    }
  }

  /**
   * Accept a trade
   * Transfers card ownership and updates trade status
   * @param {string} tradeId - Trade ID (UUID)
   * @param {string} userId - User ID accepting the trade (must be receiver)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  static async acceptTrade(tradeId, userId) {
    try {
      if (!tradeId || !userId) {
        return { success: false, error: 'Missing tradeId or userId' };
      }

      console.log(`[Supabase] User ${userId} accepting trade ${tradeId}`);

      // Get trade details
      const trade = await this.getTradeById(tradeId);
      if (!trade) {
        return { success: false, error: 'Trade not found' };
      }

      // Validate user is the receiver
      if (trade.receiverId !== userId) {
        return { success: false, error: 'Only the receiver can accept this trade' };
      }

      // Validate trade is still pending
      if (trade.status !== 'pending') {
        return { success: false, error: `Trade is already ${trade.status}` };
      }

      // Transfer cards
      // Sender's offered cards go to receiver
      for (const cardId of trade.offeredCards) {
        const result = await CardServiceSupabase.transferOwnership(cardId, trade.receiverId);
        if (!result.success) {
          console.error(`Failed to transfer card ${cardId}:`, result.error);
          return { success: false, error: `Failed to transfer card: ${result.error}` };
        }
      }

      // Receiver's requested cards go to sender
      for (const cardId of trade.requestedCards) {
        const result = await CardServiceSupabase.transferOwnership(cardId, trade.senderId);
        if (!result.success) {
          console.error(`Failed to transfer card ${cardId}:`, result.error);
          return { success: false, error: `Failed to transfer card: ${result.error}` };
        }
      }

      // Update trade status
      const { error } = await supabase
        .from('trades')
        .update({
          status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', tradeId);

      if (error) {
        console.error('[Supabase] Error updating trade status:', error);
        return { success: false, error: error.message };
      }

      console.log(`✅ [Supabase] Trade ${tradeId} accepted and completed`);
      return { success: true };

    } catch (error) {
      console.error('[Supabase] Error in acceptTrade:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reject a trade
   * @param {string} tradeId - Trade ID (UUID)
   * @param {string} userId - User ID rejecting the trade (must be receiver)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  static async rejectTrade(tradeId, userId) {
    try {
      if (!tradeId || !userId) {
        return { success: false, error: 'Missing tradeId or userId' };
      }

      console.log(`[Supabase] User ${userId} rejecting trade ${tradeId}`);

      // Get trade details
      const trade = await this.getTradeById(tradeId);
      if (!trade) {
        return { success: false, error: 'Trade not found' };
      }

      // Validate user is the receiver
      if (trade.receiverId !== userId) {
        return { success: false, error: 'Only the receiver can reject this trade' };
      }

      // Validate trade is still pending
      if (trade.status !== 'pending') {
        return { success: false, error: `Trade is already ${trade.status}` };
      }

      // Release offered cards from in_trade status
      for (const cardId of trade.offeredCards) {
        await CardServiceSupabase.updateCardStatus(cardId, {
          status: 'available',
          inTrade: false,
          tradeId: null
        });
      }

      // Update trade status
      const { error } = await supabase
        .from('trades')
        .update({
          status: 'rejected',
          updated_at: new Date().toISOString()
        })
        .eq('id', tradeId);

      if (error) {
        console.error('[Supabase] Error updating trade status:', error);
        return { success: false, error: error.message };
      }

      console.log(`✅ [Supabase] Trade ${tradeId} rejected`);
      return { success: true };

    } catch (error) {
      console.error('[Supabase] Error in rejectTrade:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cancel a trade
   * @param {string} tradeId - Trade ID (UUID)
   * @param {string} userId - User ID canceling the trade (must be sender)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  static async cancelTrade(tradeId, userId) {
    try {
      if (!tradeId || !userId) {
        return { success: false, error: 'Missing tradeId or userId' };
      }

      console.log(`[Supabase] User ${userId} canceling trade ${tradeId}`);

      // Get trade details
      const trade = await this.getTradeById(tradeId);
      if (!trade) {
        return { success: false, error: 'Trade not found' };
      }

      // Validate user is the sender
      if (trade.senderId !== userId) {
        return { success: false, error: 'Only the sender can cancel this trade' };
      }

      // Validate trade is still pending
      if (trade.status !== 'pending') {
        return { success: false, error: `Trade is already ${trade.status}` };
      }

      // Release offered cards from in_trade status
      for (const cardId of trade.offeredCards) {
        await CardServiceSupabase.updateCardStatus(cardId, {
          status: 'available',
          inTrade: false,
          tradeId: null
        });
      }

      // Update trade status
      const { error } = await supabase
        .from('trades')
        .update({
          status: 'canceled',
          updated_at: new Date().toISOString()
        })
        .eq('id', tradeId);

      if (error) {
        console.error('[Supabase] Error updating trade status:', error);
        return { success: false, error: error.message };
      }

      console.log(`✅ [Supabase] Trade ${tradeId} canceled`);
      return { success: true };

    } catch (error) {
      console.error('[Supabase] Error in cancelTrade:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get active trades count for a user
   * @param {string} userId - User ID (UUID)
   * @param {string} groupId - Group ID (UUID)
   * @returns {Promise<number>} - Active trades count
   */
  static async getActiveTradesCount(userId, groupId) {
    try {
      if (!userId || !groupId) {
        console.warn('[Supabase] getActiveTradesCount called without userId or groupId');
        return 0;
      }

      const { count, error } = await supabase
        .from('trades')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupId)
        .contains('participant_ids', [userId])
        .eq('status', 'pending');

      if (error) {
        console.error('[Supabase] Error counting active trades:', error);
        return 0;
      }

      return count || 0;

    } catch (error) {
      console.error('[Supabase] Error in getActiveTradesCount:', error);
      return 0;
    }
  }
}

export default TradeServiceSupabase;
