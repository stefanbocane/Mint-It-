/**
 * Auction Completion Service - Supabase Version
 *
 * Periodically checks for expired auctions and processes them.
 * Calls the Postgres function `complete_auctions()` to handle:
 * - Card ownership transfer to winner
 * - Seller payment
 * - Card return to seller if no bids
 */

import { supabase } from '../config/supabase';

class AuctionCompletionService {
  static intervalId = null;
  static isProcessing = false;
  static CHECK_INTERVAL = 30 * 1000; // Check every 30 seconds

  /**
   * Start the background auction completion checker
   */
  static start() {
    if (this.intervalId) {
      console.log('⏰ [AuctionCompletion] Already running');
      return;
    }

    console.log('⏰ [AuctionCompletion] Starting background checker (every 30s)');

    // Run immediately on start
    this.checkAndCompleteAuctions();

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.checkAndCompleteAuctions();
    }, this.CHECK_INTERVAL);
  }

  /**
   * Stop the background checker
   */
  static stop() {
    if (this.intervalId) {
      console.log('⏰ [AuctionCompletion] Stopping background checker');
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Check for and complete expired auctions
   */
  static async checkAndCompleteAuctions() {
    if (this.isProcessing) {
      console.log('⏰ [AuctionCompletion] Already processing, skipping...');
      return;
    }

    this.isProcessing = true;

    try {
      console.log('⏰ [AuctionCompletion] Checking for expired auctions...');

      // Call the Postgres function
      const { data, error } = await supabase.rpc('complete_auctions');

      if (error) {
        console.error('❌ [AuctionCompletion] Error:', error.message);
        return;
      }

      if (data && data.length > 0) {
        console.log(`✅ [AuctionCompletion] Processed ${data.length} expired auction(s)`);

        data.forEach((result) => {
          if (result.winner_id) {
            console.log(`  - Auction ${result.auction_id}: Winner ${result.winner_id}, paid ${result.final_bid} coins`);
          } else {
            console.log(`  - Auction ${result.auction_id}: No bids, card returned to seller`);
          }
        });

        // Notify listeners that auctions were completed
        this.notifyAuctionCompletions(data);
      } else {
        console.log('⏰ [AuctionCompletion] No expired auctions to process');
      }

    } catch (error) {
      console.error('❌ [AuctionCompletion] Unexpected error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Notify listeners about completed auctions
   * This can be used to refresh UI, clear caches, etc.
   */
  static notifyAuctionCompletions(completedAuctions) {
    // Dispatch a custom event that can be listened to by components
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      const event = new CustomEvent('auctionsCompleted', {
        detail: { auctions: completedAuctions }
      });
      window.dispatchEvent(event);
    }
  }

  /**
   * Manually trigger auction completion check
   * Useful for testing or forcing a check
   */
  static async forceCheck() {
    console.log('⏰ [AuctionCompletion] Force checking auctions...');
    await this.checkAndCompleteAuctions();
  }
}

export default AuctionCompletionService;
