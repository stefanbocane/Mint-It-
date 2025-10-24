/**
 * Intelligent Boot Service
 * 
 * PURPOSE: Load ALL essential app data with a SINGLE Firestore read
 * GOAL: Zero additional reads after boot for immediate screen readiness
 * 
 * STRATEGY:
 * 1. Fetch comprehensive boot payload (1 read)
 * 2. Pre-warm ALL caches simultaneously
 * 3. Make all screens instantly ready
 * 4. Cloud Function maintains payload freshness
 * 
 * IMPACT:
 * - Boot reads: 5-10 → 1 (90% reduction)
 * - First screen: Instant (cache hit)
 * - Subsequent screens: Instant (cache hit)
 * - Session total: 1-3 reads (vs 10-20)
 * 
 * @version 1.0.0
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import CacheService from '../caching/CacheService';
import ReadMonitor from '../ReadTracking/ReadMonitor';

class IntelligentBootService {
  constructor() {
    this.bootPayload = null;
    this.isBootComplete = false;
    this.bootStartTime = null;
    this.bootMetrics = {
      totalTime: 0,
      cacheWarmed: 0,
      readsSaved: 0,
      success: false
    };
  }

  /**
   * Load essential data with single read and warm all caches
   * 
   * @param {string} userId - Current user ID
   * @param {string} groupId - Current group ID
   * @returns {Promise<Object>} Boot payload with all essential data
   */
  async loadEssentialData(userId, groupId) {
    if (!userId || !groupId) {
      console.warn('⚠️ BootService: Missing userId or groupId');
      return null;
    }

    this.bootStartTime = Date.now();
    console.log('🚀 [BootService] Starting intelligent boot sequence');
    console.log(`   User: ${userId} | Group: ${groupId}`);

    try {
      // SINGLE READ: Fetch comprehensive boot payload
      const bootPayloadRef = doc(db, 'initialAppLoad', `${userId}_${groupId}`);
      const bootSnap = await getDoc(bootPayloadRef);
      
      // Track the single read
      ReadMonitor.trackRead('BootService', 'initial_payload', {
        userId,
        groupId,
        exists: bootSnap.exists()
      });

      if (!bootSnap.exists()) {
        console.log('⚙️ [BootService] No boot payload found, creating...');
        const created = await this.createBootPayload(userId, groupId);
        if (created) {
          // Recursive call with newly created payload
          return this.loadEssentialData(userId, groupId);
        }
        return null;
      }

      const payload = bootSnap.data();
      this.bootPayload = payload;

      // Validate payload structure
      if (!this.validatePayload(payload)) {
        console.warn('⚠️ [BootService] Invalid payload structure, recreating...');
        await this.createBootPayload(userId, groupId);
        return this.loadEssentialData(userId, groupId);
      }

      console.log('✅ [BootService] Boot payload loaded (1 read)');
      console.log(`   Version: ${payload.version || 'unknown'}`);
      console.log(`   Updated: ${this.formatTimestamp(payload.updatedAt)}`);

      // PRE-WARM ALL CACHES (zero additional reads)
      await this.warmAllCaches(userId, groupId, payload);

      // Calculate metrics
      this.bootMetrics.totalTime = Date.now() - this.bootStartTime;
      this.bootMetrics.success = true;
      this.isBootComplete = true;

      console.log('🎉 [BootService] Boot sequence complete!');
      console.log(`   Total time: ${this.bootMetrics.totalTime}ms`);
      console.log(`   Caches warmed: ${this.bootMetrics.cacheWarmed}`);
      console.log(`   Reads saved: ${this.bootMetrics.readsSaved}`);

      return payload;

    } catch (error) {
      console.error('❌ [BootService] Boot sequence failed:', error);
      this.bootMetrics.success = false;
      return null;
    }
  }

  /**
   * Validate boot payload structure
   */
  validatePayload(payload) {
    if (!payload || typeof payload !== 'object') return false;
    
    // Check for required top-level fields
    const hasUser = payload.user && typeof payload.user === 'object';
    const hasGroup = payload.group && typeof payload.group === 'object';
    const hasVersion = payload.version;
    
    return hasUser && hasGroup && hasVersion;
  }

  /**
   * Pre-warm ALL caches with boot payload data
   * This makes all screens instantly ready with zero additional reads
   */
  async warmAllCaches(userId, groupId, payload) {
    console.log('🔥 [BootService] Warming all caches...');

    const cacheOperations = [];
    let warmedCount = 0;

    try {
      // 1. User Profile Cache (2-hour TTL)
      if (payload.user) {
        cacheOperations.push(
          CacheService.setValue(`unified_user_${userId}`, {
            data: payload.user,
            timestamp: Date.now()
          }, { ttl: 2 * 60 * 60 * 1000 })
          .then(() => {
            warmedCount++;
            console.log('   ✓ User profile cache warmed');
          })
        );
      }

      // 2. Group Info Cache (2-hour TTL)
      if (payload.group) {
        cacheOperations.push(
          CacheService.setValue(`ultra_collection_group_info_${groupId}`, {
            data: payload.group,
            timestamp: Date.now()
          }, { ttl: 2 * 60 * 60 * 1000 })
          .then(() => {
            warmedCount++;
            console.log('   ✓ Group info cache warmed');
          })
        );
      }

      // 3. Cards Cache (45-min TTL)
      if (payload.cards) {
        cacheOperations.push(
          CacheService.setValue(`ultra_collection_all_cards_${userId}_${groupId}`, {
            cards: payload.cards,
            hasMoreCards: false,
            totalCards: payload.cards.length,
            timestamp: Date.now()
          }, { ttl: 45 * 60 * 1000 })
          .then(() => {
            warmedCount++;
            console.log(`   ✓ Cards cache warmed (${payload.cards.length} cards)`);
          })
        );
      }

      // 4. Auctions Cache (45-min TTL)
      if (payload.auctions) {
        cacheOperations.push(
          CacheService.setValue(`auctions_${groupId}`, {
            data: payload.auctions,
            timestamp: Date.now()
          }, { ttl: 45 * 60 * 1000 })
          .then(() => {
            warmedCount++;
            console.log(`   ✓ Auctions cache warmed (${payload.auctions.length} auctions)`);
          })
        );
      }

      // 5. Trades Cache (45-min TTL)
      if (payload.trades) {
        cacheOperations.push(
          CacheService.setValue(`tradeOverviews_${groupId}`, {
            data: payload.trades,
            timestamp: Date.now()
          }, { ttl: 45 * 60 * 1000 })
          .then(() => {
            warmedCount++;
            console.log(`   ✓ Trades cache warmed (${payload.trades.length} trades)`);
          })
        );
      }

      // 6. Social Feed Cache (45-min TTL)
      if (payload.posts) {
        cacheOperations.push(
          CacheService.setValue(`socialOverviews_${groupId}`, {
            data: payload.posts,
            timestamp: Date.now()
          }, { ttl: 45 * 60 * 1000 })
          .then(() => {
            warmedCount++;
            console.log(`   ✓ Social feed cache warmed (${payload.posts.length} posts)`);
          })
        );
      }

      // Execute all cache operations in parallel
      await Promise.allSettled(cacheOperations);

      this.bootMetrics.cacheWarmed = warmedCount;
      this.bootMetrics.readsSaved = warmedCount; // Each cache warm saves 1 read

      console.log(`✅ [BootService] ${warmedCount} caches warmed successfully`);
      console.log(`   Estimated reads saved: ${this.bootMetrics.readsSaved}`);

    } catch (error) {
      console.error('❌ [BootService] Cache warming error:', error);
      // Non-fatal - app can still function with cache misses
    }
  }

  /**
   * Create comprehensive boot payload (one-time setup per user/group)
   * This should only run once, then Cloud Function maintains it
   */
  async createBootPayload(userId, groupId) {
    console.log('⚙️ [BootService] Creating boot payload...');
    console.log('   Note: This is a one-time operation');
    console.log('   Cloud Functions will maintain it afterward');

    try {
      // Fetch all overview documents in parallel
      const [userDoc, groupDoc, cardsDoc, auctionsDoc, tradesDoc, postsDoc] = await Promise.all([
        getDoc(doc(db, 'users', userId)),
        getDoc(doc(db, 'groups', groupId)),
        getDoc(doc(db, 'cardOverviews', `${groupId}_${userId}`)),
        getDoc(doc(db, 'auctionOverviews', groupId)),
        getDoc(doc(db, 'tradeOverviews', groupId)),
        getDoc(doc(db, 'socialOverviews', groupId))
      ]);

      // Track reads (one-time setup)
      ReadMonitor.trackRead('BootService', 'create_payload', {
        userId,
        groupId,
        reads: 6
      });

      console.log('   Fetched all overview documents (6 reads - one-time)');

      // Build comprehensive payload
      const payload = {
        // User data
        user: userDoc.exists() ? { id: userDoc.id, ...userDoc.data() } : null,
        
        // Group data
        group: groupDoc.exists() ? { id: groupDoc.id, ...groupDoc.data() } : null,
        
        // Cards (from overview)
        cards: cardsDoc.exists() ? cardsDoc.data().cards || [] : [],
        
        // Auctions (from overview)
        auctions: auctionsDoc.exists() ? auctionsDoc.data().auctions || [] : [],
        
        // Trades (from overview)
        trades: tradesDoc.exists() ? tradesDoc.data().trades || [] : [],
        
        // Social posts (from overview)
        posts: postsDoc.exists() ? postsDoc.data().posts || [] : [],
        
        // Metadata
        createdAt: new Date(),
        updatedAt: new Date(),
        version: '2.0',
        source: 'client_setup'
      };

      // Save boot payload
      const bootPayloadRef = doc(db, 'initialAppLoad', `${userId}_${groupId}`);
      await setDoc(bootPayloadRef, payload);

      console.log('✅ [BootService] Boot payload created successfully');
      console.log('   Cloud Functions will maintain it going forward');

      return true;

    } catch (error) {
      console.error('❌ [BootService] Failed to create boot payload:', error);
      return false;
    }
  }

  /**
   * Get boot metrics for analytics
   */
  getMetrics() {
    return {
      ...this.bootMetrics,
      isComplete: this.isBootComplete,
      payload: this.bootPayload ? {
        version: this.bootPayload.version,
        hasUser: !!this.bootPayload.user,
        hasGroup: !!this.bootPayload.group,
        cardCount: this.bootPayload.cards?.length || 0,
        auctionCount: this.bootPayload.auctions?.length || 0,
        tradeCount: this.bootPayload.trades?.length || 0,
        postCount: this.bootPayload.posts?.length || 0
      } : null
    };
  }

  /**
   * Reset boot state (for testing)
   */
  reset() {
    this.bootPayload = null;
    this.isBootComplete = false;
    this.bootStartTime = null;
    this.bootMetrics = {
      totalTime: 0,
      cacheWarmed: 0,
      readsSaved: 0,
      success: false
    };
    console.log('🔄 [BootService] State reset');
  }

  /**
   * Check if boot is complete
   */
  isReady() {
    return this.isBootComplete && this.bootPayload !== null;
  }

  /**
   * Get cached boot payload
   */
  getBootPayload() {
    return this.bootPayload;
  }

  /**
   * Format timestamp for logging
   */
  formatTimestamp(timestamp) {
    if (!timestamp) return 'unknown';
    
    try {
      if (timestamp.toDate) {
        return timestamp.toDate().toLocaleString();
      }
      if (timestamp instanceof Date) {
        return timestamp.toLocaleString();
      }
      return new Date(timestamp).toLocaleString();
    } catch {
      return 'invalid';
    }
  }
}

// Export singleton instance
export default new IntelligentBootService();

