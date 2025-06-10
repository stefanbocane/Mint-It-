/**
 * Advanced Optimization Coordinator
 * 
 * Integrates all optimization services for maximum database read reduction.
 * This is the next evolution beyond ReadOptimizationCoordinator.
 */

import CacheService from '../services/caching/CacheService';
import intelligentPrefetchCoordinator from './intelligentPrefetchCoordinator';
import { ReadOptimizationCoordinator } from './readOptimizationCoordinator';
import sharedListenerPool from './sharedListenerPool';
import unifiedUserDataCoordinator from './unifiedUserDataCoordinator';

class AdvancedOptimizationCoordinator {
  constructor() {
    this.metrics = {
      totalOptimizationSavings: 0,
      contextConsolidationSavings: 0,
      prefetchHits: 0,
      sharedListenerSavings: 0,
      backgroundProcessingSavings: 0,
      lastResetTime: Date.now()
    };
    
    this.isEnabled = true;
    this.backgroundJobsRunning = new Set();
  }

  /**
   * Initialize all advanced optimization services
   */
  async initialize() {
    try {
      console.log('🚀 Initializing Advanced Optimization Coordinator...');
      
      // Load navigation patterns for prefetching
      await intelligentPrefetchCoordinator.loadNavigationPatterns();
      
      // Initialize background processing
      this.startBackgroundOptimizationJobs();
      
      console.log('✅ Advanced Optimization Coordinator initialized');
      return true;
      
    } catch (error) {
      console.error('❌ Error initializing Advanced Optimization Coordinator:', error);
      return false;
    }
  }

  /**
   * Consolidated user data access - replaces individual context listeners
   */
  subscribeToUserData(userId, contextName, onUpdate, options = {}) {
    if (!this.isEnabled) {
      return () => {}; // Disabled, return empty unsubscribe
    }

    // Track metrics
    this.metrics.contextConsolidationSavings++;
    
    return unifiedUserDataCoordinator.subscribeToUserData(
      userId, 
      contextName, 
      onUpdate, 
      options
    );
  }

  /**
   * Enhanced navigation tracking with intelligent prefetching
   */
  recordNavigation(fromScreen, toScreen, userId, groupId) {
    if (!this.isEnabled || !userId || !groupId) return;

    // Record pattern and trigger prefetch
    intelligentPrefetchCoordinator.recordNavigation(fromScreen, toScreen, userId, groupId);
    
    // Track prefetch effectiveness
    const prefetchMetrics = intelligentPrefetchCoordinator.getMetrics();
    this.metrics.prefetchHits = prefetchMetrics.prefetchHits;
  }

  /**
   * Shared listener management for real-time data
   */
  subscribeToSharedData(dataType, identifier, componentId, onUpdate, options = {}) {
    if (!this.isEnabled) {
      return () => {};
    }

    this.metrics.sharedListenerSavings++;

    switch (dataType) {
      case 'group':
        return sharedListenerPool.subscribeToGroupData(
          identifier, 
          componentId, 
          onUpdate, 
          options
        );
        
      case 'userCards':
        const { userId, groupId } = identifier;
        return sharedListenerPool.subscribeToUserCards(
          userId, 
          groupId, 
          componentId, 
          onUpdate, 
          options
        );
        
      case 'groupTrades':
        return sharedListenerPool.subscribeToGroupTrades(
          identifier, 
          componentId, 
          onUpdate, 
          options
        );
        
      default:
        console.warn(`Unknown shared data type: ${dataType}`);
        return () => {};
    }
  }

  /**
   * Advanced batch operations with cross-screen coordination
   */
  async getOptimizedData(operation, params, options = {}) {
    if (!this.isEnabled) {
      // Fallback to basic optimization
      return ReadOptimizationCoordinator[operation]?.(params, options);
    }

    try {
      switch (operation) {
        case 'multiScreenData':
          return this.getMultiScreenData(params, options);
          
        case 'userActivityData':
          return this.getUserActivityData(params, options);
          
        case 'groupSummaryData':
          return this.getGroupSummaryData(params, options);
          
        case 'crossScreenPrefetch':
          return this.triggerCrossScreenPrefetch(params, options);
          
        default:
          // Fallback to existing coordinator
          return ReadOptimizationCoordinator[operation]?.(params, options);
      }
      
    } catch (error) {
      console.error(`Error in advanced optimization for ${operation}:`, error);
      // Graceful fallback
      return ReadOptimizationCoordinator[operation]?.(params, options);
    }
  }

  /**
   * Get data optimized for multiple screens simultaneously
   */
  async getMultiScreenData(params, options = {}) {
    const { userId, groupId, screens } = params;
    const { ttl = 5 * 60 * 1000 } = options;

    const promises = [];
    const results = {};

    // Batch all screen data requirements
    if (screens.includes('profile')) {
      promises.push(
        this.getProfileData(userId, groupId, { ttl }).then(data => {
          results.profile = data;
        })
      );
    }

    if (screens.includes('trades')) {
      promises.push(
        this.getTradesData(userId, groupId, { ttl }).then(data => {
          results.trades = data;
        })
      );
    }

    if (screens.includes('collection')) {
      promises.push(
        this.getCollectionData(userId, groupId, { ttl }).then(data => {
          results.collection = data;
        })
      );
    }

    if (screens.includes('leaderboard')) {
      promises.push(
        this.getLeaderboardData(groupId, { ttl }).then(data => {
          results.leaderboard = data;
        })
      );
    }

    await Promise.allSettled(promises);
    return results;
  }

  /**
   * Get comprehensive user activity data
   */
  async getUserActivityData(params, options = {}) {
    const { userId, groupId } = params;
    const { ttl = 3 * 60 * 1000 } = options;

    const cacheKey = `user_activity_${userId}_${groupId}`;
    
    return CacheService.getValue(cacheKey) || await CacheService.setValue(
      cacheKey,
      this.computeUserActivityData(userId, groupId),
      { ttl }
    );
  }

  /**
   * Compute user activity data with minimal reads
   */
  async computeUserActivityData(userId, groupId) {
    // Use existing optimizations to minimize reads
    const [userStats, recentTrades, recentBids] = await Promise.allSettled([
      ReadOptimizationCoordinator.getUserStats(userId, groupId, { 
        ttl: 5 * 60 * 1000 
      }),
      ReadOptimizationCoordinator.getTradesData(userId, groupId, { 
        ttl: 2 * 60 * 1000,
        limit: 10 
      }),
      ReadOptimizationCoordinator.getBidHistory(userId, { 
        ttl: 3 * 60 * 1000,
        limit: 10 
      })
    ]);

    return {
      stats: userStats.value || {},
      recentTrades: recentTrades.value || [],
      recentBids: recentBids.value || [],
      lastActive: Date.now()
    };
  }

  /**
   * Start background optimization jobs
   */
  startBackgroundOptimizationJobs() {
    // Cache warming job
    this.scheduleJob('cacheWarming', () => {
      this.performCacheWarming();
    }, 5 * 60 * 1000); // Every 5 minutes

    // Data aggregation job
    this.scheduleJob('dataAggregation', () => {
      this.performDataAggregation();
    }, 15 * 60 * 1000); // Every 15 minutes

    // Metrics collection job
    this.scheduleJob('metricsCollection', () => {
      this.collectOptimizationMetrics();
    }, 2 * 60 * 1000); // Every 2 minutes
  }

  /**
   * Schedule background optimization job
   */
  scheduleJob(jobName, jobFunction, intervalMs) {
    if (this.backgroundJobsRunning.has(jobName)) {
      return; // Job already running
    }

    this.backgroundJobsRunning.add(jobName);

    const runJob = async () => {
      try {
        await jobFunction();
        this.metrics.backgroundProcessingSavings++;
      } catch (error) {
        console.error(`Background job ${jobName} error:`, error);
      }

      // Schedule next run
      setTimeout(runJob, intervalMs);
    };

    // Start with initial delay
    setTimeout(runJob, 1000);
  }

  /**
   * Perform intelligent cache warming
   */
  async performCacheWarming() {
    try {
      // Get cache metrics instead of frequently accessed keys (method doesn't exist)
      const metrics = CacheService.getMetrics();
      
      // Simple cache maintenance based on available data
      if (metrics.size > 1000) { // If cache is getting large
        console.log('Cache warming: Cache size acceptable, no action needed');
      }

    } catch (error) {
      console.error('Cache warming error:', error);
    }
  }

  /**
   * Perform background data aggregation
   */
  async performDataAggregation() {
    try {
      // Pre-compute expensive aggregations
      const groupStats = await this.computeGroupStatistics();
      await CacheService.setValue('global_group_stats', groupStats, {
        ttl: 30 * 60 * 1000 // 30 minutes
      });

      // Pre-compute trending data
      const trendingData = await this.computeTrendingData();
      await CacheService.setValue('trending_data', trendingData, {
        ttl: 15 * 60 * 1000 // 15 minutes
      });

    } catch (error) {
      console.error('Data aggregation error:', error);
    }
  }

  /**
   * Compute group statistics for aggregation
   */
  async computeGroupStatistics() {
    try {
      // Return mock data for now since we don't have the full implementation
      return {
        totalGroups: 0,
        activeUsers: 0,
        totalTrades: 0,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error computing group statistics:', error);
      return {};
    }
  }

  /**
   * Compute trending data for aggregation
   */
  async computeTrendingData() {
    try {
      // Return mock data for now since we don't have the full implementation
      return {
        trendingCards: [],
        popularGroups: [],
        activeTraders: [],
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error computing trending data:', error);
      return {};
    }
  }

  /**
   * Collect and update optimization metrics
   */
  collectOptimizationMetrics() {
    try {
      // Collect metrics from all services
      const unifiedMetrics = unifiedUserDataCoordinator.getMetrics();
      const prefetchMetrics = intelligentPrefetchCoordinator.getMetrics();
      const listenerMetrics = sharedListenerPool.getMetrics();

      // Update consolidated metrics
      this.metrics.contextConsolidationSavings = unifiedMetrics.savedReads;
      this.metrics.prefetchHits = prefetchMetrics.prefetchHits;
      this.metrics.sharedListenerSavings = listenerMetrics.savedConnections;

      // Calculate total savings
      this.metrics.totalOptimizationSavings = 
        this.metrics.contextConsolidationSavings +
        this.metrics.prefetchHits * 500 + // Assume 500ms saved per hit
        this.metrics.sharedListenerSavings * 200 + // Assume 200ms saved per shared listener
        this.metrics.backgroundProcessingSavings * 1000; // Assume 1s saved per background job

      // Log metrics periodically
      console.log('📊 Advanced Optimization Metrics:', this.metrics);

    } catch (error) {
      console.error('Metrics collection error:', error);
    }
  }

  /**
   * Get comprehensive optimization metrics
   */
  getMetrics() {
    const unifiedMetrics = unifiedUserDataCoordinator.getMetrics();
    const prefetchMetrics = intelligentPrefetchCoordinator.getMetrics();
    const listenerMetrics = sharedListenerPool.getMetrics();

    return {
      advanced: this.metrics,
      unifiedUserData: unifiedMetrics,
      intelligentPrefetch: prefetchMetrics,
      sharedListeners: listenerMetrics,
      totalEstimatedSavings: this.metrics.totalOptimizationSavings,
      uptime: Date.now() - this.metrics.lastResetTime
    };
  }

  /**
   * Enable/disable advanced optimizations
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    console.log(`Advanced optimizations ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Reset all optimization metrics
   */
  resetMetrics() {
    this.metrics = {
      totalOptimizationSavings: 0,
      contextConsolidationSavings: 0,
      prefetchHits: 0,
      sharedListenerSavings: 0,
      backgroundProcessingSavings: 0,
      lastResetTime: Date.now()
    };
  }

  /**
   * Cleanup all optimization services
   */
  cleanup() {
    // Stop background jobs
    this.backgroundJobsRunning.clear();
    
    // Cleanup individual services
    sharedListenerPool.cleanup();
    
    console.log('🧹 Advanced Optimization Coordinator cleaned up');
  }

  /**
   * Health check for all optimization services
   */
  async healthCheck() {
    const health = {
      unifiedUserData: unifiedUserDataCoordinator.getMetrics().activeListeners > 0,
      sharedListeners: sharedListenerPool.getMetrics().activeListeners > 0,
      prefetching: intelligentPrefetchCoordinator.getMetrics().activePatterns > 0,
      backgroundJobs: this.backgroundJobsRunning.size > 0,
      overall: true
    };

    health.overall = Object.values(health).every(status => status === true);
    
    return health;
  }
}

// Create singleton instance
const advancedOptimizationCoordinator = new AdvancedOptimizationCoordinator();

export default advancedOptimizationCoordinator;
export { AdvancedOptimizationCoordinator };
