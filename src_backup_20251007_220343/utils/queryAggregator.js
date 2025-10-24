/**
 * Query results aggregator - optimizes cases where we need data from multiple queries 
 * by reducing both database reads and combining results efficiently
 */

import { getCachedQuery } from './firestoreUtils';

/**
 * Get data from multiple Firestore queries efficiently, combining and deduplicating results
 * 
 * @param {Array} queryConfigs - Array of query configurations { query, options, resultMap }
 * @param {Object} globalOptions - Global options for all queries
 * @returns {Promise<Array>} - Combined and deduplicated results
 */
export const aggregateQueryResults = async (queryConfigs, globalOptions = {}) => {
  if (!queryConfigs || !queryConfigs.length) return [];
  
  // Process all queries with Promise.all for maximum efficiency
  const queryPromises = queryConfigs.map(config => 
    getCachedQuery(config.query, { ...globalOptions, ...config.options })
  );
  
  try {
    const allResults = await Promise.all(queryPromises);
    
    // Use a Map to eliminate duplicates by ID
    const resultMap = new Map();
    
    // Combine all results, processing each batch with its associated mapping function
    allResults.forEach((batchResults, index) => {
      if (!batchResults || !batchResults.length) return;
      
      const processFn = queryConfigs[index]?.resultMap;
      
      batchResults.forEach(item => {
        // If there's a mapping function, use it to transform the item
        const processedItem = processFn ? processFn(item) : item;
        
        // Only add if not already in the map, or if we need to merge properties
        if (resultMap.has(processedItem.id)) {
          // Merge with existing item - useful when different properties come from different queries
          const existingItem = resultMap.get(processedItem.id);
          resultMap.set(processedItem.id, { ...existingItem, ...processedItem });
        } else {
          resultMap.set(processedItem.id, processedItem);
        }
      });
    });
    
    // Convert map back to array
    return Array.from(resultMap.values());
  } catch (error) {
    console.error('Error aggregating query results:', error);
    return [];
  }
};

/**
 * Helper to create a query configuration for aggregateQueryResults
 * 
 * @param {Object} query - Firestore query object
 * @param {Object} options - Query options
 * @param {Function} resultMap - Optional mapping function for results
 * @returns {Object} - Query configuration
 */
export const createQueryConfig = (query, options = {}, resultMap = null) => {
  return { query, options, resultMap };
}; 