import { collection, getDocs, limit, orderBy, query, startAfter, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { CACHE_TTL, createQueryCacheKey, updateCache } from './cacheUtils';

/**
 * Pagination Cache Service
 * 
 * This service optimizes Firebase pagination to:
 * 1. Cache paginated results
 * 2. Pre-fetch next pages when appropriate
 * 3. Enable client-side pagination from already-downloaded data
 * 4. Coalesce multiple pagination requests
 */

// Store page caches by collection and query
const paginatedDataCache = new Map();

// Default page size if not specified
const DEFAULT_PAGE_SIZE = 10;

// Number of pages to prefetch beyond current request
const DEFAULT_PREFETCH_PAGES = 1;

/**
 * Get a paginated result with efficient caching
 * 
 * @param {string} collectionName - Collection name to query
 * @param {object} options - Query options
 * @returns {Promise<object>} - Paginated results and pagination info
 */
export const getPaginatedData = async (collectionName, options = {}) => {
  const {
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
    whereConditions = [],
    orderByField = null,
    orderDirection = 'asc',
    prefetchPages = DEFAULT_PREFETCH_PAGES,
    forceRefresh = false,
    ttl = CACHE_TTL.DEFAULT,
    useCachedPagesOnly = false // If true, uses only already cached pages
  } = options;
  
  // Validate inputs
  if (page < 1) throw new Error('Page must be at least 1');
  if (pageSize < 1) throw new Error('Page size must be at least 1');
  
  // Create a cache key for this collection+query combo
  const baseQueryKey = createQueryCacheKey(collectionName, {
    where: whereConditions,
    orderBy: orderByField ? [orderByField, orderDirection] : null,
    pageSize
  });
  
  // Initialize or get the collection's pagination cache
  if (!paginatedDataCache.has(baseQueryKey)) {
    paginatedDataCache.set(baseQueryKey, {
      allData: [],          // All data across all pages (client-side for pagination)
      cachedPages: new Set(),  // Set of pages that have been cached
      lastPageWithData: null,  // Highest page with data
      lastDocSnapshot: null,   // Last document for server-side cursor-based pagination
      lastFetchTime: null,     // When the data was last fetched
      hasMore: true           // Whether there is more data to fetch
    });
  }
  
  const paginationCache = paginatedDataCache.get(baseQueryKey);
  
  // Check if we can use already downloaded data for client-side pagination
  const canUseExistingData = !forceRefresh && 
    paginationCache.allData.length > 0 && 
    paginationCache.cachedPages.has(page);
  
  // If useCachedPagesOnly is true, we won't fetch any new pages from the server
  if (useCachedPagesOnly && !canUseExistingData) {
    return {
      data: [],
      pagination: {
        page,
        pageSize,
        hasMore: paginationCache.hasMore,
        totalPages: paginationCache.cachedPages.size,
        isFromCache: true
      }
    };
  }
  
  // If we can use cached data, return it
  if (canUseExistingData) {
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const pageData = paginationCache.allData.slice(startIndex, endIndex);
    
    // Check if we need to prefetch more pages
    if (paginationCache.hasMore && 
        prefetchPages > 0 && 
        page + prefetchPages > Math.max(...Array.from(paginationCache.cachedPages))) {
      // Start prefetching in the background
      setTimeout(() => {
        prefetchNextPages(collectionName, baseQueryKey, page, options);
      }, 100);
    }
    
    return {
      data: pageData,
      pagination: {
        page,
        pageSize,
        hasMore: paginationCache.hasMore && (endIndex < paginationCache.allData.length || paginationCache.lastDocSnapshot !== null),
        totalItems: paginationCache.allData.length,
        totalPages: Math.ceil(paginationCache.allData.length / pageSize),
        isFromCache: true
      }
    };
  }
  
  // We need to fetch from the server
  try {
    // If it's the first page, we'll start fresh
    if (page === 1 || forceRefresh) {
      const { data, lastDoc, hasMore } = await fetchInitialPage(collectionName, options);
      
      // Update the pagination cache
      paginationCache.allData = data;
      paginationCache.cachedPages = new Set([1]);
      paginationCache.lastPageWithData = 1;
      paginationCache.lastDocSnapshot = lastDoc;
      paginationCache.lastFetchTime = Date.now();
      paginationCache.hasMore = hasMore;
      
      // Cache the results
      const pageKey = `${baseQueryKey}_page=${page}`;
      updateCache(pageKey, data, true);
      
      // Start prefetching next pages if needed
      if (hasMore && prefetchPages > 0) {
        setTimeout(() => {
          prefetchNextPages(collectionName, baseQueryKey, page, options);
        }, 200);
      }
      
      return {
        data,
        pagination: {
          page: 1,
          pageSize,
          hasMore,
          totalItems: data.length,
          totalPages: hasMore ? null : 1,
          isFromCache: false
        }
      };
    } 
    // For non-first pages, we need to fetch incrementally
    else {
      // Check if we need to incrementally fetch to reach the desired page
      if (!paginationCache.cachedPages.has(page) && page > paginationCache.lastPageWithData) {
        // We need to fetch all pages between lastPageWithData and page
        let currentPage = paginationCache.lastPageWithData || 1;
        let currentLastDoc = paginationCache.lastDocSnapshot;
        let currentData = paginationCache.allData || [];
        let currentHasMore = paginationCache.hasMore;
        
        while (currentPage < page && currentHasMore) {
          // Fetch the next page
          const { data, lastDoc, hasMore } = await fetchNextPage(
            collectionName, 
            currentLastDoc, 
            options
          );
          
          // If we got data, add it to our dataset
          if (data.length > 0) {
            currentData = [...currentData, ...data];
            currentLastDoc = lastDoc;
            currentHasMore = hasMore;
            currentPage++;
            
            // Cache this page
            paginationCache.cachedPages.add(currentPage);
            
            // Cache the page data
            const pageKey = `${baseQueryKey}_page=${currentPage}`;
            const pageData = data;
            updateCache(pageKey, pageData, true);
          } else {
            // No more data
            currentHasMore = false;
            break;
          }
        }
        
        // Update the pagination cache
        paginationCache.allData = currentData;
        paginationCache.lastPageWithData = currentPage;
        paginationCache.lastDocSnapshot = currentLastDoc;
        paginationCache.lastFetchTime = Date.now();
        paginationCache.hasMore = currentHasMore;
        
        // Now extract the requested page data
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const pageData = currentData.slice(startIndex, endIndex);
        
        // Start prefetching next pages if needed
        if (currentHasMore && prefetchPages > 0) {
          setTimeout(() => {
            prefetchNextPages(collectionName, baseQueryKey, page, options);
          }, 200);
        }
        
        return {
          data: pageData,
          pagination: {
            page,
            pageSize,
            hasMore: currentHasMore && endIndex < currentData.length,
            totalItems: currentData.length,
            totalPages: currentHasMore ? null : Math.ceil(currentData.length / pageSize),
            isFromCache: false
          }
        };
      } 
      // If the page is out of range, return empty data
      else if (page > paginationCache.lastPageWithData && !paginationCache.hasMore) {
        return {
          data: [],
          pagination: {
            page,
            pageSize,
            hasMore: false,
            totalItems: paginationCache.allData.length,
            totalPages: Math.ceil(paginationCache.allData.length / pageSize),
            isFromCache: true
          }
        };
      }
      // Check if the page is already available in our dataset
      else {
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const pageData = paginationCache.allData.slice(startIndex, endIndex);
        
        return {
          data: pageData,
          pagination: {
            page,
            pageSize,
            hasMore: paginationCache.hasMore && endIndex < paginationCache.allData.length,
            totalItems: paginationCache.allData.length,
            totalPages: Math.ceil(paginationCache.allData.length / pageSize),
            isFromCache: true
          }
        };
      }
    }
  } catch (error) {
    console.error(`Error fetching paginated data for ${collectionName}:`, error);
    throw error;
  }
};

/**
 * Prefetch next pages in the background
 * 
 * @param {string} collectionName - Collection name
 * @param {string} baseQueryKey - Base query key for caching
 * @param {number} currentPage - Current page number
 * @param {object} options - Original query options
 */
const prefetchNextPages = async (collectionName, baseQueryKey, currentPage, options) => {
  try {
    const { prefetchPages = DEFAULT_PREFETCH_PAGES, pageSize = DEFAULT_PAGE_SIZE } = options;
    
    const paginationCache = paginatedDataCache.get(baseQueryKey);
    if (!paginationCache || !paginationCache.hasMore) return;
    
    // Calculate which pages to prefetch
    const pagesToPrefetch = [];
    for (let i = 1; i <= prefetchPages; i++) {
      const pageNum = currentPage + i;
      if (!paginationCache.cachedPages.has(pageNum)) {
        pagesToPrefetch.push(pageNum);
      }
    }
    
    if (pagesToPrefetch.length === 0) return;
    
    // Start from the last known document
    let lastDoc = paginationCache.lastDocSnapshot;
    let currentData = [...paginationCache.allData];
    let lastPageWithData = paginationCache.lastPageWithData;
    let hasMore = paginationCache.hasMore;
    
    // If we don't have a lastDoc but we have data, use the last item's position
    if (!lastDoc && currentData.length > 0) {
      // We can't directly get a snapshot, so we'll need to refresh from the beginning
      // This is a fallback and shouldn't happen with proper usage
      console.warn('Missing last document reference for pagination - fetching from start');
      const { data, lastDoc: newLastDoc, hasMore: newHasMore } = await fetchInitialPage(
        collectionName, 
        { ...options, pageSize: currentData.length }
      );
      
      // Update cache and continue
      currentData = data;
      lastDoc = newLastDoc;
      hasMore = newHasMore;
    }
    
    // Now fetch each additional page
    for (const pageNum of pagesToPrefetch) {
      if (!hasMore) break;
      
      // Calculate how many documents we need to skip
      const itemsToSkip = (pageNum - lastPageWithData - 1) * pageSize;
      
      if (itemsToSkip > 0) {
        // We need to skip some documents first
        let skipRemaining = itemsToSkip;
        
        while (skipRemaining > 0 && hasMore) {
          // Skip in chunks of pageSize
          const skipSize = Math.min(skipRemaining, pageSize);
          const { lastDoc: newLastDoc, hasMore: newHasMore } = await skipDocuments(
            collectionName,
            lastDoc,
            { ...options, pageSize: skipSize }
          );
          
          lastDoc = newLastDoc;
          hasMore = newHasMore;
          skipRemaining -= skipSize;
          
          if (!hasMore) break;
        }
      }
      
      if (hasMore) {
        // Now fetch the actual page
        const { data, lastDoc: newLastDoc, hasMore: newHasMore } = await fetchNextPage(
          collectionName,
          lastDoc,
          options
        );
        
        // If we got data, add it to our dataset
        if (data.length > 0) {
          currentData = [...currentData, ...data];
          lastDoc = newLastDoc;
          hasMore = newHasMore;
          lastPageWithData++;
          
          // Cache this page
          paginationCache.cachedPages.add(pageNum);
          
          // Cache the page data
          const pageKey = `${baseQueryKey}_page=${pageNum}`;
          updateCache(pageKey, data, true);
        } else {
          // No more data
          hasMore = false;
          break;
        }
      }
    }
    
    // Update the pagination cache with what we've fetched
    paginationCache.allData = currentData;
    paginationCache.lastPageWithData = lastPageWithData;
    paginationCache.lastDocSnapshot = lastDoc;
    paginationCache.lastFetchTime = Date.now();
    paginationCache.hasMore = hasMore;
    
    console.log(`Prefetched pages ${pagesToPrefetch.join(', ')} for ${baseQueryKey}`);
  } catch (error) {
    console.error(`Error prefetching pages for ${baseQueryKey}:`, error);
  }
};

/**
 * Skip a number of documents without retrieving them (for pagination)
 * 
 * @param {string} collectionName - Collection name
 * @param {object} startAfterDoc - Document to start after
 * @param {object} options - Query options
 * @returns {Promise<object>} - Last document and hasMore flag
 */
const skipDocuments = async (collectionName, startAfterDoc, options) => {
  const {
    pageSize = DEFAULT_PAGE_SIZE,
    whereConditions = [],
    orderByField = null,
    orderDirection = 'asc'
  } = options;
  
  try {
    const collectionRef = collection(db, collectionName);
    
    // Build query constraints
    const queryConstraints = [];
    
    // Add where conditions
    whereConditions.forEach(condition => {
      if (Array.isArray(condition) && condition.length === 3) {
        const [field, operator, value] = condition;
        queryConstraints.push(where(field, operator, value));
      }
    });
    
    // Add order by
    if (orderByField) {
      queryConstraints.push(orderBy(orderByField, orderDirection));
    }
    
    // Add cursor if we have a starting document
    if (startAfterDoc) {
      queryConstraints.push(startAfter(startAfterDoc));
    }
    
    // Add limit
    queryConstraints.push(limit(pageSize));
    
    // Execute query
    const q = query(collectionRef, ...queryConstraints);
    const querySnapshot = await getDocs(q);
    
    // We're just fetching to get the last document
    const hasMore = querySnapshot.size === pageSize;
    const lastDoc = querySnapshot.docs[querySnapshot.size - 1] || null;
    
    return { lastDoc, hasMore };
  } catch (error) {
    console.error(`Error skipping documents in ${collectionName}:`, error);
    throw error;
  }
};

/**
 * Fetch the first page of results
 * 
 * @param {string} collectionName - Collection name
 * @param {object} options - Query options
 * @returns {Promise<object>} - Data, last document, and hasMore flag
 */
const fetchInitialPage = async (collectionName, options) => {
  const {
    pageSize = DEFAULT_PAGE_SIZE,
    whereConditions = [],
    orderByField = null,
    orderDirection = 'asc'
  } = options;
  
  try {
    const collectionRef = collection(db, collectionName);
    
    // Build query constraints
    const queryConstraints = [];
    
    // Add where conditions
    whereConditions.forEach(condition => {
      if (Array.isArray(condition) && condition.length === 3) {
        const [field, operator, value] = condition;
        queryConstraints.push(where(field, operator, value));
      }
    });
    
    // Add order by
    if (orderByField) {
      queryConstraints.push(orderBy(orderByField, orderDirection));
    }
    
    // Add limit
    queryConstraints.push(limit(pageSize));
    
    // Execute query
    const q = query(collectionRef, ...queryConstraints);
    const querySnapshot = await getDocs(q);
    
    // Convert to array of data
    const data = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    // Check if there are potentially more results
    const hasMore = querySnapshot.size === pageSize;
    const lastDoc = querySnapshot.docs[querySnapshot.size - 1] || null;
    
    return { data, lastDoc, hasMore };
  } catch (error) {
    console.error(`Error fetching initial page from ${collectionName}:`, error);
    throw error;
  }
};

/**
 * Fetch the next page of results
 * 
 * @param {string} collectionName - Collection name
 * @param {object} startAfterDoc - Document to start after
 * @param {object} options - Query options
 * @returns {Promise<object>} - Data, last document, and hasMore flag
 */
const fetchNextPage = async (collectionName, startAfterDoc, options) => {
  const {
    pageSize = DEFAULT_PAGE_SIZE,
    whereConditions = [],
    orderByField = null,
    orderDirection = 'asc'
  } = options;
  
  if (!startAfterDoc) {
    return fetchInitialPage(collectionName, options);
  }
  
  try {
    const collectionRef = collection(db, collectionName);
    
    // Build query constraints
    const queryConstraints = [];
    
    // Add where conditions
    whereConditions.forEach(condition => {
      if (Array.isArray(condition) && condition.length === 3) {
        const [field, operator, value] = condition;
        queryConstraints.push(where(field, operator, value));
      }
    });
    
    // Add order by
    if (orderByField) {
      queryConstraints.push(orderBy(orderByField, orderDirection));
    }
    
    // Add cursor
    queryConstraints.push(startAfter(startAfterDoc));
    
    // Add limit
    queryConstraints.push(limit(pageSize));
    
    // Execute query
    const q = query(collectionRef, ...queryConstraints);
    const querySnapshot = await getDocs(q);
    
    // Convert to array of data
    const data = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    // Check if there are potentially more results
    const hasMore = querySnapshot.size === pageSize;
    const lastDoc = querySnapshot.docs[querySnapshot.size - 1] || null;
    
    return { data, lastDoc, hasMore };
  } catch (error) {
    console.error(`Error fetching next page from ${collectionName}:`, error);
    throw error;
  }
};

/**
 * Reset the pagination cache for a specific collection and query
 * 
 * @param {string} collectionName - Collection name
 * @param {object} options - Query options to identify the cache
 * @returns {boolean} - Whether the cache was reset
 */
export const resetPaginationCache = (collectionName, options = {}) => {
  const {
    whereConditions = [],
    orderByField = null,
    orderDirection = 'asc',
    pageSize = DEFAULT_PAGE_SIZE
  } = options;
  
  const baseQueryKey = createQueryCacheKey(collectionName, {
    where: whereConditions,
    orderBy: orderByField ? [orderByField, orderDirection] : null,
    pageSize
  });
  
  if (paginatedDataCache.has(baseQueryKey)) {
    paginatedDataCache.delete(baseQueryKey);
    return true;
  }
  
  return false;
};

/**
 * Clear all pagination caches
 */
export const clearAllPaginationCaches = () => {
  paginatedDataCache.clear();
};

/**
 * Get statistics about the pagination cache
 * 
 * @returns {object} - Cache statistics
 */
export const getPaginationCacheStats = () => {
  const stats = {
    totalCaches: paginatedDataCache.size,
    caches: []
  };
  
  for (const [key, cache] of paginatedDataCache.entries()) {
    stats.caches.push({
      key,
      totalItems: cache.allData.length,
      cachedPages: Array.from(cache.cachedPages),
      lastPageWithData: cache.lastPageWithData,
      hasMore: cache.hasMore,
      lastFetchTime: cache.lastFetchTime
    });
  }
  
  return stats;
};

export default {
  getPaginatedData,
  resetPaginationCache,
  clearAllPaginationCaches,
  getPaginationCacheStats
}; 