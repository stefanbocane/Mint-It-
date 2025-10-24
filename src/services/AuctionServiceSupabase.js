/**
 * Auction Service - Supabase Version
 *
 * Replaces Firebase Firestore transactions with Supabase Postgres functions.
 * All complex auction logic (bidding, rarity calculation) handled server-side.
 */

import { supabase } from './ReadTracking/SupabaseTracked';

class AuctionService {
  /**
   * Get active auctions for a group
   * @param {string} groupId - Group ID
   * @param {Object} options - Query options
   * @param {number} options.limit - Maximum number of auctions (default: 50)
   * @returns {Promise<Array>} - Array of active auctions with card data
   */
  static async getActiveAuctions(groupId, options = {}) {
    try {
      if (!groupId) {
        console.warn('getActiveAuctions called without groupId');
        return [];
      }

      const limit = options.limit || 50;
      const now = new Date().toISOString();

      // Query with card data join
      // Use explicit foreign key name to avoid ambiguity
      const { data, error } = await supabase
        .from('auctions')
        .select(`
          *,
          card:cards!auctions_card_id_fkey (
            id,
            name,
            image_url,
            rarity
          ),
          seller:users!auctions_seller_id_fkey (
            id,
            username,
            display_name
          )
        `)
        .eq('group_id', groupId)
        .eq('status', 'active')
        .gt('end_time', now)
        .order('end_time', { ascending: true })
        .limit(limit);

      if (error) {
        console.error('Error in getActiveAuctions:', error);
        return [];
      }

      // Transform to match Firebase format for compatibility
      const auctions = (data || []).map(auction => ({
        id: auction.id,
        cardId: auction.card_id,
        groupId: auction.group_id,
        sellerId: auction.seller_id,
        sellerName: auction.seller?.username || auction.seller_username || 'Unknown',
        cardName: auction.card?.name || auction.card_name || 'Unknown',
        cardImageUrl: auction.card?.image_url || auction.card_image_url,
        currentBid: auction.current_bid,
        currentBidder: auction.current_bidder,
        currentBidderName: auction.current_bidder_name,
        currentRarity: auction.current_rarity,
        startingBid: auction.starting_bid || 0,
        uniqueBidderCount: auction.unique_bidder_count || 0,
        status: auction.status,
        startTime: new Date(auction.start_time),
        endTime: new Date(auction.end_time),
        lastBidTime: auction.last_bid_time ? new Date(auction.last_bid_time) : null,
        createdAt: new Date(auction.created_at),
        updatedAt: new Date(auction.updated_at),
        // Card data
        card: auction.card ? {
          id: auction.card.id,
          name: auction.card.name,
          imageUrl: auction.card.image_url,
          rarity: auction.card.rarity
        } : null
      }));

      console.log(`✅ [Supabase] Fetched ${auctions.length} active auctions`);
      return auctions;

    } catch (error) {
      console.error('Error in getActiveAuctions:', error);
      return [];
    }
  }

  /**
   * Place a bid on an auction
   * Uses Postgres function `process_bid()` for atomic transaction
   *
   * @param {string} auctionId - Auction ID
   * @param {number} bidAmount - Bid amount (NOT including tax)
   * @param {string} userId - User ID
   * @param {string} displayName - User display name
   * @param {string} groupId - Group ID
   * @returns {Promise<{success: boolean, error?: string, rarity?: string}>} - Result object
   */
  static async placeBid(auctionId, bidAmount, userId, displayName, groupId) {
    try {
      if (!auctionId || !userId || !bidAmount || !groupId) {
        return { success: false, error: 'Missing required parameters' };
      }

      console.log(`🎯 [Supabase] Placing bid: ${bidAmount} coins on auction ${auctionId}`);

      // Call Postgres function for atomic bidding transaction
      const { data, error } = await supabase.rpc('process_bid', {
        p_auction_id: auctionId,
        p_bidder_id: userId,
        p_bidder_name: displayName,
        p_bid_amount: bidAmount,
        p_group_id: groupId
      });

      if (error) {
        console.error('❌ [Supabase] Bid failed:', error);

        // Parse Postgres error messages into user-friendly text
        let errorMessage = error.message || 'Failed to place bid';

        if (errorMessage.includes('Insufficient balance')) {
          errorMessage = 'Insufficient coins. You need ' + (bidAmount + 1) + ' coins (bid + 1 tax).';
        } else if (errorMessage.includes('Auction has ended')) {
          errorMessage = 'This auction has already ended.';
        } else if (errorMessage.includes('Auction is no longer active')) {
          errorMessage = 'This auction is no longer active.';
        } else if (errorMessage.includes('Bid must be higher')) {
          errorMessage = 'Your bid must be higher than the current bid.';
        } else if (errorMessage.includes('Auction not found')) {
          errorMessage = 'Auction not found.';
        }

        return {
          success: false,
          error: errorMessage,
          needsRefresh: errorMessage.includes('higher than') || errorMessage.includes('ended')
        };
      }

      console.log(`✅ [Supabase] Bid placed: ${bidAmount} on ${auctionId} by ${displayName} - Rarity: ${data?.new_rarity || 'common'}`);

      return {
        success: true,
        rarity: data?.new_rarity || data?.rarity || 'common',
        totalCost: bidAmount + 1, // Bid + 1 coin tax
        refunded: data?.refunded_amount || 0,
        data: data
      };
    } catch (error) {
      console.error('❌ [Supabase] placeBid exception:', error);
      return {
        success: false,
        error: error.message || 'An unexpected error occurred while placing your bid'
      };
    }
  }

  /**
   * Create a new auction
   * @param {Object} auctionData - Auction data
   * @param {string} auctionData.cardId - Card ID (UUID)
   * @param {string} auctionData.groupId - Group ID (UUID)
   * @param {string} auctionData.ownerId - Owner ID (UUID)
   * @param {number} auctionData.startingBid - Starting bid amount
   * @param {number} auctionData.durationSeconds - Auction duration in seconds
   * @returns {Promise<{success: boolean, auctionId?: string, error?: string}>}
   */
  static async createAuction(auctionData) {
    try {
      const { cardId, groupId, ownerId, startingBid, durationSeconds } = auctionData;

      if (!cardId || !groupId || !ownerId || startingBid === undefined || !durationSeconds) {
        return { success: false, error: 'Missing required auction data' };
      }

      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + durationSeconds * 1000);

      const { data, error } = await supabase
        .from('auctions')
        .insert([{
          card_id: cardId,
          group_id: groupId,
          owner_id: ownerId,
          starting_bid: startingBid,
          current_bid: startingBid,
          current_rarity: 'common',
          status: 'active',
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          unique_bidder_count: 0
        }])
        .select()
        .single();

      if (error) {
        console.error('❌ [Supabase] Error creating auction:', error);
        return { success: false, error: error.message };
      }

      console.log(`✅ [Supabase] Created auction ${data.id} for card ${cardId}`);
      return { success: true, auctionId: data.id };

    } catch (error) {
      console.error('Error in createAuction:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Complete an auction
   * @param {string} auctionId - Auction ID
   * @returns {Promise<boolean>} - Success status
   */
  static async completeAuction(auctionId) {
    try {
      const { error } = await supabase
        .from('auctions')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', auctionId);

      if (error) {
        console.error('Error completing auction:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error completing auction:', error);
      return false;
    }
  }

  /**
   * Cancel an auction
   * @param {string} auctionId - Auction ID
   * @returns {Promise<boolean>} - Success status
   */
  static async cancelAuction(auctionId) {
    try {
      const { error } = await supabase
        .from('auctions')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString()
        })
        .eq('id', auctionId);

      if (error) {
        console.error('Error cancelling auction:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error cancelling auction:', error);
      return false;
    }
  }
}

export default AuctionService;
