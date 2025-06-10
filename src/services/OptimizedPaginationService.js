/**
 * Optimized Pagination Service
 * 
 * Replaces offset-based pagination with cursor-based pagination for:
 * - Better performance at scale
 * - Consistent results during real-time updates
 * - Reduced database load
 * 
 * Step 3.C.1: All Paginated Lists - Replace Offset with Cursors
 */

import {
    collection,
    endBefore,
    getDocs,
    limit,
    limitToLast,
    orderBy,
    query,
    startAfter,
    where
} from 'firebase/firestore';
import { db } from '../config/firebase';
import CacheService from './caching/CacheService';

class OptimizedPaginationService {
  constructor() {
    this.pageCache = new Map(); // Cache for pagination cursors
    this.metrics = {
      paginationRequests: 0,
      cacheHits: 0,
      cursorOptimizations: 0
    };
  }

  /**
   * STEP 3.C.1: Cursor-based pagination for any collection
   * Replaces offset() with startAfter() for better performance
   */
  async paginateCollection(params) {
    const {
      collectionPath,
      orderByField = 'createdAt',
      orderDirection = 'desc',
      pageSize = 20,
      cursor = null, // Document snapshot or field value
      cacheKey = null,
      cacheTTL = 60000 // 1 minute default cache
    } = params;

    this.metrics.paginationRequests++;

    try {
      console.log(`📄 OPTIMIZED: Cursor pagination for ${collectionPath} (size: ${pageSize})`);

      // Check cache first if cache key provided
      if (cacheKey) {
        const cached = await this.getCachedPage(cacheKey);
        if (cached) {
          this.metrics.cacheHits++;
          console.log(`🎯 OPTIMIZED: Cache hit for pagination ${cacheKey}`);
          return cached;
        }
      }

      // Build query with cursor-based pagination
      let paginationQuery = query(
        collection(db, collectionPath),
        orderBy(orderByField, orderDirection),
        limit(pageSize)
      );

      // Add cursor for pagination (startAfter for next page)
      if (cursor) {
        paginationQuery = query(paginationQuery, startAfter(cursor));
        this.metrics.cursorOptimizations++;
        console.log(`🔄 OPTIMIZED: Using cursor pagination instead of offset`);
      }

      // Execute query
      const snapshot = await getDocs(paginationQuery);
      
      // Extract documents and metadata
      const documents = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        _docSnapshot: doc // Store for next cursor
      }));

      // Pagination metadata
      const hasMore = snapshot.docs.length === pageSize;
      const nextCursor = hasMore ? snapshot.docs[snapshot.docs.length - 1] : null;
      const firstCursor = snapshot.docs.length > 0 ? snapshot.docs[0] : null;

      const result = {
        documents,
        pagination: {
          hasMore,
          nextCursor,
          firstCursor,
          currentPageSize: documents.length,
          requestedPageSize: pageSize
        },
        metadata: {
          collectionPath,
          orderByField,
          orderDirection,
          timestamp: Date.now()
        }
      };

      // Cache result if cache key provided
      if (cacheKey) {
        await this.setCachedPage(cacheKey, result, cacheTTL);
      }

      console.log(`✅ OPTIMIZED: Fetched ${documents.length} documents with cursor pagination`);
      
      return result;

    } catch (error) {
      console.error(`🚨 Error in cursor pagination for ${collectionPath}:`, error);
      throw error;
    }
  }

  /**
   * Helper function to process trades client-side (eliminates all composite index requirements)
   */
  async processTradesClientSide(trades, filterStatus, pageSize, cacheKey, cacheTTL, userId = null) {
    // CLIENT-SIDE PARTICIPANT FILTERING (only if userId provided)
    if (userId) {
      trades = trades.filter(trade => 
        trade.participants && Array.isArray(trade.participants) && trade.participants.includes(userId)
      );
    }

    // CLIENT-SIDE STATUS FILTERING 
    if (filterStatus && Array.isArray(filterStatus)) {
      trades = trades.filter(trade => filterStatus.includes(trade.status));
    }

    // CLIENT-SIDE SORTING (eliminates orderBy composite index requirement)
    trades.sort((a, b) => {
      const aTime = a.updatedAt?.toDate?.() || new Date(0);
      const bTime = b.updatedAt?.toDate?.() || new Date(0);
      return bTime - aTime; // Desc order
    });

    // Limit to requested page size after all filtering
    const hasMore = trades.length >= pageSize;
    trades = trades.slice(0, pageSize);

    const result = {
      trades,
      pagination: {
        hasMore,
        nextCursor: hasMore && trades.length > 0 ? trades[trades.length - 1]._docSnapshot : null,
        currentPageSize: trades.length
      }
    };

    // Cache the result
    if (cacheKey) {
      await this.setCachedPage(cacheKey, result, cacheTTL);
    }

    console.log(`✅ ULTRA-OPT: Client-side processing complete - ${trades.length} trades (${trades.length < pageSize ? 'last page' : 'has more'})`);

    return result;
  }

  /**
   * ULTRA-OPTIMIZED: Index-free trade history pagination 
   */
  async paginateTradeHistory(groupId, options = {}) {
    const {
      pageSize = 10,
      cursor = null,
      filterStatus = null,
      userId = null,
      cacheKey = null,
      cacheTTL = 60000
    } = options;

    const finalCacheKey = cacheKey || `trades_${groupId}_${filterStatus || 'all'}_${pageSize}_${cursor?.id || 'initial'}`;

    try {
      console.log(`🚀 ULTRA-OPT: Index-free trade pagination - Group: ${groupId}, User: ${userId?.slice(0,8)}...`);

      // Check cache first
      const cached = await this.getCachedPage(finalCacheKey);
      if (cached) {
        console.log(`🎯 ULTRA-OPT: Cache hit for trade pagination`);
        return cached;
      }

      // APPROACH 1: Try user-centric query first (no composite index needed)
      try {
        console.log(`📋 ULTRA-OPT: Attempting user-centric trade lookup`);
        
        // Query trades where user is sender OR receiver (separate queries to avoid composite index)
        const senderQuery = query(
          collection(db, `groups/${groupId}/trades`),
          where('senderId', '==', userId),
          limit(Math.ceil(pageSize * 1.5))
        );
        
        const receiverQuery = query(
          collection(db, `groups/${groupId}/trades`),
          where('receiverId', '==', userId),
          limit(Math.ceil(pageSize * 1.5))
        );

        const [senderSnapshot, receiverSnapshot] = await Promise.all([
          getDocs(senderQuery),
          getDocs(receiverQuery)
        ]);

        // Combine and deduplicate trades
        const tradesMap = new Map();
        
        [...senderSnapshot.docs, ...receiverSnapshot.docs].forEach(doc => {
          if (!tradesMap.has(doc.id)) {
            tradesMap.set(doc.id, {
              id: doc.id,
              ...doc.data(),
              _docSnapshot: doc
            });
          }
        });

        let trades = Array.from(tradesMap.values());
        
        if (trades.length > 0) {
          console.log(`✅ ULTRA-OPT: User-centric lookup successful - ${trades.length} trades found`);
          return await this.processTradesClientSide(trades, filterStatus, pageSize, finalCacheKey, cacheTTL);
        }
      } catch (userQueryError) {
        console.warn(`⚠️ ULTRA-OPT: User-centric query failed, falling back to group query:`, userQueryError);
      }

      // APPROACH 2: Fallback to simplified group query with extensive client-side filtering
      console.log(`📋 ULTRA-OPT: Using group-level query with client-side filtering`);
      
      let queryConstraints = [
        limit(pageSize * 4) // Fetch even more to allow extensive client-side filtering
      ];

      // Add cursor if provided
      if (cursor) {
        queryConstraints.push(startAfter(cursor));
      }

      const snapshot = await getDocs(
        query(collection(db, `groups/${groupId}/trades`), ...queryConstraints)
      );

      let trades = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        _docSnapshot: doc
      }));

      return await this.processTradesClientSide(trades, filterStatus, pageSize, finalCacheKey, cacheTTL, userId);

    } catch (error) {
      console.error('🚨 ULTRA-OPT: Error in index-free trade pagination:', error);
      
      // Last resort: return empty result instead of throwing
      console.log('🛟 ULTRA-OPT: Returning empty result as last resort');
      return {
        trades: [],
        pagination: {
          hasMore: false,
          nextCursor: null,
          currentPageSize: 0
        }
      };
    }
  }

  /**
   * Paginate auction list with optimized cursors
   */
  async paginateAuctions(groupId, options = {}) {
    const {
      pageSize = 15,
      cursor = null,
      filterStatus = 'active',
      sortBy = 'endTime'
    } = options;

    try {
      console.log(`🏷️ OPTIMIZED: Auction pagination - ${filterStatus} auctions`);

      let queryConstraints = [
        orderBy(sortBy, 'asc'), // For auctions, usually want soonest ending first
        limit(pageSize)
      ];

      if (cursor) {
        queryConstraints.push(startAfter(cursor));
      }

      // Filter by status
      if (filterStatus !== 'all') {
        queryConstraints.push(where('status', '==', filterStatus));
      }

      const snapshot = await getDocs(
        query(collection(db, `groups/${groupId}/auctions`), ...queryConstraints)
      );

      const auctions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        _docSnapshot: doc
      }));

      console.log(`🎯 OPTIMIZED: Auction pagination - ${auctions.length} auctions loaded`);

      return {
        auctions,
        pagination: {
          hasMore: auctions.length === pageSize,
          nextCursor: auctions.length === pageSize ? auctions[auctions.length - 1]._docSnapshot : null,
          currentPageSize: auctions.length
        }
      };

    } catch (error) {
      console.error('🚨 Error paginating auctions:', error);
      throw error;
    }
  }

  /**
   * Paginate collection items with optimized cursors
   */
  async paginateUserCollection(userId, groupId, options = {}) {
    const {
      pageSize = 20,
      cursor = null,
      sortBy = 'acquiredAt',
      sortDirection = 'desc',
      rarityFilter = null
    } = options;

    try {
      console.log(`🃏 OPTIMIZED: Collection pagination for user ${userId}`);

      let queryConstraints = [
        orderBy(sortBy, sortDirection),
        limit(pageSize)
      ];

      if (cursor) {
        queryConstraints.push(startAfter(cursor));
      }

      // Add rarity filter if specified
      if (rarityFilter) {
        queryConstraints.push(where('rarity', '==', rarityFilter));
      }

      // Query user's cards in the group
      const snapshot = await getDocs(
        query(
          collection(db, `groups/${groupId}/userCards`),
          where('userId', '==', userId),
          ...queryConstraints
        )
      );

      const cards = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        _docSnapshot: doc
      }));

      console.log(`🎴 OPTIMIZED: Collection pagination - ${cards.length} cards loaded`);

      return {
        cards,
        pagination: {
          hasMore: cards.length === pageSize,
          nextCursor: cards.length === pageSize ? cards[cards.length - 1]._docSnapshot : null,
          currentPageSize: cards.length
        }
      };

    } catch (error) {
      console.error('🚨 Error paginating user collection:', error);
      throw error;
    }
  }

  /**
   * Reverse pagination (for going to previous page)
   */
  async paginateReverse(params) {
    const {
      collectionPath,
      orderByField = 'createdAt',
      orderDirection = 'desc',
      pageSize = 20,
      cursor = null, // Document snapshot to end before
      cacheKey = null
    } = params;

    try {
      console.log(`⬅️ OPTIMIZED: Reverse cursor pagination for ${collectionPath}`);

      // For reverse pagination, we need to reverse the order and use endBefore
      const reverseDirection = orderDirection === 'desc' ? 'asc' : 'desc';
      
      let paginationQuery = query(
        collection(db, collectionPath),
        orderBy(orderByField, reverseDirection),
        limitToLast(pageSize)
      );

      if (cursor) {
        paginationQuery = query(paginationQuery, endBefore(cursor));
      }

      const snapshot = await getDocs(paginationQuery);
      
      // Reverse the results to match original order
      const documents = snapshot.docs.reverse().map(doc => ({
        id: doc.id,
        ...doc.data(),
        _docSnapshot: doc
      }));

      return {
        documents,
        pagination: {
          hasPrevious: snapshot.docs.length === pageSize,
          previousCursor: snapshot.docs.length === pageSize ? documents[0]._docSnapshot : null,
          currentPageSize: documents.length
        }
      };

    } catch (error) {
      console.error(`🚨 Error in reverse pagination for ${collectionPath}:`, error);
      throw error;
    }
  }

  /**
   * Cache management for pagination
   */
  async getCachedPage(cacheKey) {
    try {
      const cached = await CacheService.getValue(`pagination_${cacheKey}`);
      if (cached && cached.timestamp > Date.now() - cached.ttl) {
        return cached.data;
      }
      return null;
    } catch (error) {
      console.warn('⚠️ Error getting cached pagination:', error);
      return null;
    }
  }

  async setCachedPage(cacheKey, data, ttl) {
    try {
      await CacheService.setValue(`pagination_${cacheKey}`, {
        data,
        timestamp: Date.now(),
        ttl
      });
    } catch (error) {
      console.warn('⚠️ Error setting cached pagination:', error);
    }
  }

  /**
   * Get pagination metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      cacheHitRate: this.metrics.paginationRequests > 0 
        ? (this.metrics.cacheHits / this.metrics.paginationRequests * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      paginationRequests: 0,
      cacheHits: 0,
      cursorOptimizations: 0
    };
  }
}

// Export singleton instance
export default new OptimizedPaginationService(); 