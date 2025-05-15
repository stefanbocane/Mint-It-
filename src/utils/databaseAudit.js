/**
 * Database usage audit utility to identify optimization opportunities
 */

import { getCacheStats } from './cacheMaintenanceUtils';
import { getCacheKeys } from './cacheUtils';
import { getCacheMetrics } from './globalCacheManager';

/**
 * Get a detailed audit of database usage and caching patterns
 * @returns {Promise<Object>} Audit results
 */
export const getDatabaseUsageAudit = async () => {
  // Gather metrics from different sources
  const memoryMetrics = getCacheMetrics();
  const cacheKeys = await getCacheKeys();
  const cacheStats = await getCacheStats();
  
  // Analyze cache usage patterns
  const collectionUsage = {};
  const documentUsage = {};
  
  // Count occurrences of each collection and document
  for (const key of cacheKeys) {
    if (key.startsWith('query_')) {
      // Extract collection from query cache keys
      const collectionName = key.split('_')[1]?.split('/')[0];
      if (collectionName) {
        collectionUsage[collectionName] = (collectionUsage[collectionName] || 0) + 1;
      }
    } else if (key.startsWith('doc_')) {
      // Extract collection and doc ID from document cache keys
      const parts = key.replace('doc_', '').split('/');
      if (parts.length >= 2) {
        const collectionName = parts[0];
        documentUsage[collectionName] = (documentUsage[collectionName] || 0) + 1;
      }
    }
  }
  
  // Identify heavy database users by collection
  const heavyUsageCollections = Object.entries(collectionUsage)
    .filter(([_, count]) => count > 10)
    .sort((a, b) => b[1] - a[1]);
  
  // Calculate cache efficiency by collection
  const cacheEfficiency = {};
  Object.entries(memoryMetrics.collections || {}).forEach(([collection, stats]) => {
    if (stats.hits + stats.misses > 0) {
      cacheEfficiency[collection] = {
        hitRate: Math.round((stats.hits / (stats.hits + stats.misses)) * 100),
        usage: stats.hits + stats.misses
      };
    }
  });
  
  // Generate optimization recommendations
  const recommendations = [];
  
  // Check for collections with low hit rates
  Object.entries(cacheEfficiency).forEach(([collection, { hitRate, usage }]) => {
    if (hitRate < 50 && usage > 20) {
      recommendations.push({
        collection,
        issue: 'Low cache hit rate',
        description: `Collection '${collection}' has a low cache hit rate (${hitRate}%) with high usage (${usage} accesses)`,
        recommendation: 'Consider increasing TTL or preloading more data'
      });
    }
  });
  
  // Check for very active collections that might benefit from more aggressive caching
  heavyUsageCollections.slice(0, 5).forEach(([collection, count]) => {
    if (count > 30) {
      recommendations.push({
        collection,
        issue: 'High query volume',
        description: `Collection '${collection}' has ${count} cached queries`,
        recommendation: 'Consider denormalizing data or implementing aggregation queries'
      });
    }
  });
  
  return {
    memoryCache: {
      size: memoryMetrics.size,
      hitRate: memoryMetrics.hitRate,
      hits: memoryMetrics.hits,
      misses: memoryMetrics.misses
    },
    collections: {
      usage: collectionUsage,
      efficiency: cacheEfficiency
    },
    documents: {
      usage: documentUsage
    },
    recommendations
  };
};

/**
 * Log database usage audit results to console
 */
export const logDatabaseAudit = async () => {
  console.log('--------- DATABASE USAGE AUDIT ---------');
  
  try {
    const audit = await getDatabaseUsageAudit();
    
    console.log(`Memory Cache: ${audit.memoryCache.size} items, ${audit.memoryCache.hitRate}% hit rate`);
    console.log('Top 5 Collections by Usage:');
    
    const topCollections = Object.entries(audit.collections.usage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    topCollections.forEach(([collection, count]) => {
      const efficiency = audit.collections.efficiency[collection]?.hitRate || 'unknown';
      console.log(`- ${collection}: ${count} queries, ${efficiency}% cache efficiency`);
    });
    
    console.log('\nOptimization Recommendations:');
    audit.recommendations.forEach((rec, i) => {
      console.log(`${i+1}. ${rec.collection}: ${rec.issue}`);
      console.log(`   ${rec.description}`);
      console.log(`   Recommendation: ${rec.recommendation}`);
    });
    
    console.log('---------------------------------------');
    
    return audit;
  } catch (error) {
    console.error('Error generating database audit:', error);
    return null;
  }
}; 