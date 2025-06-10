// Centralized exports for all optimization utilities
// This reduces import statements across the app

// Caching utilities
export { default as CacheService } from '../services/caching/CacheService';

// Batch operations
export {
    BatchOperationManager, batchFetchRelatedData,
    batchVerifyConsistency, batchedGetDoc,
    batchedSetDoc, batchedUpdateDoc, optimisticBatchUpdate,
    retryableBatchUpdate
} from './enhancedBatchOperations';

// Query optimization
export {
    analyzeQueryPerformance, batchExecuteQueries, executeOptimizedQuery, fetchUserCardsOptimized, mergeQueryResults, smartQueryDeduplicator
} from './queryOptimizer';

// User data hooks and contexts
export { UnifiedUserDataProvider, useUnifiedUserData } from '../contexts/UnifiedUserDataContext';
export { useUserData } from '../hooks/useUserData';

// Database utilities (existing)
export { batchUpdateWithCache } from './dbOptimizationUtils';

// Query aggregation (existing)
export { aggregateQueryResults, createQueryConfig } from './queryAggregator';

// Firestore utilities (existing)
export { setupCachedQueryListenerWithChanges } from './firestoreUtils';

// Performance monitoring
export { default as performanceMonitor, usePerformanceMonitoring } from './performanceMonitor';

// Smart cache warming
export {
    backgroundCacheMaintenance, smartCacheWarm, warmCollectionCaches, warmUserCaches
} from './smartCacheWarming';

// Optimization health checking


