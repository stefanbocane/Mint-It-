/**
 * Card Service - Supabase Implementation
 *
 * Provides card management functionality using Supabase Postgres.
 * Replaces Firebase Firestore-based cardService.
 *
 * Key Features:
 * - Card creation with Storage integration
 * - Collection queries with filtering
 * - Card status management (available, in_trade, in_auction)
 * - Card ownership transfers
 */

import { supabase } from './ReadTracking/SupabaseTracked';

class CardServiceSupabase {
  /**
   * Add a card to a user's collection
   * @param {Object} params - Parameters
   * @param {string} params.userId - User ID (UUID)
   * @param {string} params.groupId - Group ID (UUID)
   * @param {string} params.cardId - Card ID (UUID)
   * @param {Object} params.cardData - Card data
   * @param {string} params.timestamp - ISO timestamp (optional)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  static async addCardToCollection({ userId, groupId, cardId, cardData, timestamp }) {
    try {
      if (!userId || !groupId || !cardId) {
        return { success: false, error: 'Missing required parameters' };
      }

      console.log(`[Supabase] Adding card ${cardId} to user ${userId}'s collection in group ${groupId}`);

      const now = new Date().toISOString();

      // Insert or update card in Supabase
      const { data, error } = await supabase
        .from('cards')
        .upsert({
          id: cardId,
          owner_id: userId,
          group_id: groupId,
          name: cardData.name,
          image_url: cardData.imageUrl || cardData.image_url,
          rarity: cardData.rarity || 'common',
          set_name: cardData.setName || cardData.set_name,
          card_number: cardData.cardNumber || cardData.card_number,
          status: 'available',
          in_trade: false,
          in_auction: false,
          created_at: timestamp || cardData.createdAt || now,
          updated_at: now
        })
        .select()
        .single();

      if (error) {
        console.error('[Supabase] Error adding card to collection:', error);
        return { success: false, error: error.message };
      }

      console.log(`✅ [Supabase] Card ${cardId} added to collection`);
      return { success: true, card: data };

    } catch (error) {
      console.error('[Supabase] Error in addCardToCollection:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get a user's card collection for a specific group
   * @param {string} userId - User ID (UUID)
   * @param {string} groupId - Group ID (UUID)
   * @param {Object} options - Query options
   * @param {number} options.limit - Max cards to return (default: 100)
   * @param {string} options.status - Filter by status (available, in_trade, in_auction)
   * @returns {Promise<Array>} - Array of cards
   */
  static async getUserCards(userId, groupId, options = {}) {
    try {
      if (!userId || !groupId) {
        console.warn('[Supabase] getUserCards called without userId or groupId');
        return [];
      }

      const limit = options.limit || 100;

      let query = supabase
        .from('cards')
        .select('*')
        .eq('owner_id', userId)
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(limit);

      // Apply status filter if provided
      if (options.status) {
        query = query.eq('status', options.status);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[Supabase] Error fetching user cards:', error);
        return [];
      }

      // Transform to match Firebase format for compatibility
      const cards = (data || []).map(card => ({
        id: card.id,
        ownerId: card.owner_id,
        groupId: card.group_id,
        name: card.name,
        imageUrl: card.image_url,
        rarity: card.rarity,
        setName: card.set_name,
        cardNumber: card.card_number,
        status: card.status,
        inTrade: card.in_trade,
        inAuction: card.in_auction,
        auctionId: card.auction_id,
        tradeId: card.trade_id,
        borderType: card.border_type || 'default',
        createdAt: new Date(card.created_at),
        updatedAt: new Date(card.updated_at),
        // Keep snake_case for compatibility with some components
        created_at: card.created_at,
        updated_at: card.updated_at,
        image_url: card.image_url
      }));

      console.log(`✅ [Supabase] Fetched ${cards.length} cards for user ${userId}`);
      return cards;

    } catch (error) {
      console.error('[Supabase] Error in getUserCards:', error);
      return [];
    }
  }

  /**
   * Get all cards in a group
   * @param {string} groupId - Group ID (UUID)
   * @param {Object} options - Query options
   * @param {number} options.limit - Max cards to return (default: 200)
   * @returns {Promise<Array>} - Array of cards
   */
  static async getGroupCards(groupId, options = {}) {
    try {
      if (!groupId) {
        console.warn('[Supabase] getGroupCards called without groupId');
        return [];
      }

      const limit = options.limit || 200;

      const { data, error } = await supabase
        .from('cards')
        .select(`
          *,
          owner:users!cards_owner_id_fkey (
            id,
            username,
            display_name
          )
        `)
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Supabase] Error fetching group cards:', error);
        return [];
      }

      // Transform data
      const cards = (data || []).map(card => ({
        id: card.id,
        ownerId: card.owner_id,
        ownerName: card.owner?.username || 'Unknown',
        groupId: card.group_id,
        name: card.name,
        imageUrl: card.image_url,
        rarity: card.rarity,
        setName: card.set_name,
        cardNumber: card.card_number,
        status: card.status,
        inTrade: card.in_trade,
        inAuction: card.in_auction,
        createdAt: new Date(card.created_at),
        updatedAt: new Date(card.updated_at)
      }));

      console.log(`✅ [Supabase] Fetched ${cards.length} cards for group ${groupId}`);
      return cards;

    } catch (error) {
      console.error('[Supabase] Error in getGroupCards:', error);
      return [];
    }
  }

  /**
   * Get a single card by ID
   * @param {string} cardId - Card ID (UUID)
   * @returns {Promise<Object|null>} - Card object or null
   */
  static async getCardById(cardId) {
    try {
      if (!cardId) {
        console.warn('[Supabase] getCardById called without cardId');
        return null;
      }

      const { data, error } = await supabase
        .from('cards')
        .select(`
          *,
          owner:users!cards_owner_id_fkey (
            id,
            username,
            display_name
          )
        `)
        .eq('id', cardId)
        .single();

      if (error) {
        console.error('[Supabase] Error fetching card:', error);
        return null;
      }

      if (!data) return null;

      // Transform to Firebase format
      return {
        id: data.id,
        ownerId: data.owner_id,
        ownerName: data.owner?.username || 'Unknown',
        groupId: data.group_id,
        name: data.name,
        imageUrl: data.image_url,
        rarity: data.rarity,
        setName: data.set_name,
        cardNumber: data.card_number,
        status: data.status,
        inTrade: data.in_trade,
        inAuction: data.in_auction,
        auctionId: data.auction_id,
        tradeId: data.trade_id,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at)
      };

    } catch (error) {
      console.error('[Supabase] Error in getCardById:', error);
      return null;
    }
  }

  /**
   * Update card status
   * @param {string} cardId - Card ID (UUID)
   * @param {Object} updates - Updates to apply
   * @param {string} updates.status - New status (available, in_trade, in_auction)
   * @param {boolean} updates.inTrade - In trade flag
   * @param {boolean} updates.inAuction - In auction flag
   * @param {string} updates.tradeId - Trade ID (optional)
   * @param {string} updates.auctionId - Auction ID (optional)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  static async updateCardStatus(cardId, updates) {
    try {
      if (!cardId) {
        return { success: false, error: 'Missing cardId' };
      }

      const updateData = {
        updated_at: new Date().toISOString()
      };

      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.inTrade !== undefined) updateData.in_trade = updates.inTrade;
      if (updates.inAuction !== undefined) updateData.in_auction = updates.inAuction;
      if (updates.tradeId !== undefined) updateData.trade_id = updates.tradeId;
      if (updates.auctionId !== undefined) updateData.auction_id = updates.auctionId;

      const { data, error } = await supabase
        .from('cards')
        .update(updateData)
        .eq('id', cardId)
        .select()
        .single();

      if (error) {
        console.error('[Supabase] Error updating card status:', error);
        return { success: false, error: error.message };
      }

      console.log(`✅ [Supabase] Updated card ${cardId} status`);
      return { success: true, card: data };

    } catch (error) {
      console.error('[Supabase] Error in updateCardStatus:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Transfer card ownership (for trades/auctions)
   * @param {string} cardId - Card ID (UUID)
   * @param {string} newOwnerId - New owner ID (UUID)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  static async transferOwnership(cardId, newOwnerId) {
    try {
      if (!cardId || !newOwnerId) {
        return { success: false, error: 'Missing required parameters' };
      }

      const { data, error } = await supabase
        .from('cards')
        .update({
          owner_id: newOwnerId,
          status: 'available',
          in_trade: false,
          in_auction: false,
          trade_id: null,
          auction_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', cardId)
        .select()
        .single();

      if (error) {
        console.error('[Supabase] Error transferring card ownership:', error);
        return { success: false, error: error.message };
      }

      console.log(`✅ [Supabase] Transferred card ${cardId} to user ${newOwnerId}`);
      return { success: true, card: data };

    } catch (error) {
      console.error('[Supabase] Error in transferOwnership:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete a card
   * @param {string} cardId - Card ID (UUID)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  static async deleteCard(cardId) {
    try {
      if (!cardId) {
        return { success: false, error: 'Missing cardId' };
      }

      const { error } = await supabase
        .from('cards')
        .delete()
        .eq('id', cardId);

      if (error) {
        console.error('[Supabase] Error deleting card:', error);
        return { success: false, error: error.message };
      }

      console.log(`✅ [Supabase] Deleted card ${cardId}`);
      return { success: true };

    } catch (error) {
      console.error('[Supabase] Error in deleteCard:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get card count for a user in a group
   * @param {string} userId - User ID (UUID)
   * @param {string} groupId - Group ID (UUID)
   * @returns {Promise<number>} - Card count
   */
  static async getUserCardCount(userId, groupId) {
    try {
      if (!userId || !groupId) {
        console.warn('[Supabase] getUserCardCount called without userId or groupId');
        return 0;
      }

      const { count, error } = await supabase
        .from('cards')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', userId)
        .eq('group_id', groupId);

      if (error) {
        console.error('[Supabase] Error counting user cards:', error);
        return 0;
      }

      return count || 0;

    } catch (error) {
      console.error('[Supabase] Error in getUserCardCount:', error);
      return 0;
    }
  }

  /**
   * Upload card image to Supabase Storage
   * @param {string} imageUri - Local image URI
   * @param {string} userId - User ID (UUID)
   * @returns {Promise<{success: boolean, url?: string, error?: string}>}
   */
  static async uploadCardImage(imageUri, userId) {
    try {
      if (!imageUri || !userId) {
        return { success: false, error: 'Missing imageUri or userId' };
      }

      // This method is for reference - actual upload happens in CoinScreenSupabase
      // using expo-file-system to read and decode the image

      const FileSystem = require('expo-file-system');
      const { decode } = require('base64-arraybuffer');

      // Read file as base64
      const base64 = await FileSystem.readAsStringAsync(imageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Generate unique filename
      const fileExt = 'jpg';
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
      const filePath = `${userId}/${fileName}`;

      // Convert base64 to ArrayBuffer
      const arrayBuffer = decode(base64);

      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from('cards')
        .upload(filePath, arrayBuffer, {
          contentType: 'image/jpeg',
          upsert: false
        });

      if (error) {
        console.error('[Supabase] Error uploading image:', error);
        return { success: false, error: error.message };
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('cards')
        .getPublicUrl(filePath);

      console.log(`✅ [Supabase] Uploaded card image: ${publicUrl}`);
      return { success: true, url: publicUrl, path: filePath };

    } catch (error) {
      console.error('[Supabase] Error in uploadCardImage:', error);
      return { success: false, error: error.message };
    }
  }
}

export default CardServiceSupabase;
