// Export all optimization hooks and utilities
export { useUserData } from './useUserData';

// Re-export cache service for convenience
export { default as CacheService } from '../services/caching/CacheService';

// Export optimized query utilities
export { UnifiedUserDataProvider, useUnifiedUserData } from '../contexts/UnifiedUserDataContextSupabase';
export { BatchOperationManager, batchedUpdateDoc } from '../utils/enhancedBatchOperations';
export { fetchUserCardsOptimized } from '../utils/queryOptimizer';
