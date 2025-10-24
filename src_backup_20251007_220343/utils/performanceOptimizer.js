/**
 * Performance Optimizer Utility
 * 
 * Provides tools for:
 * - Performance monitoring and metrics
 * - Memory optimization suggestions
 * - Database operation tracking
 * - Component render optimization
 * - Cache effectiveness analysis
 */

// Performance metrics storage
const metrics = {
  databaseReads: 0,
  renderTimes: [],
  cacheHits: 0,
  cacheMisses: 0,
  componentMounts: 0,
  memoryWarnings: 0,
  errorCount: 0,
  sessionStart: Date.now()
};

// Performance thresholds
const THRESHOLDS = {
  MAX_DB_READS: 10000,
  MAX_RENDER_TIME: 16, // 60fps = 16ms per frame
  MAX_MEMORY_MB: 100,
  CACHE_HIT_RATIO_MIN: 0.7, // 70% cache hit ratio
  MAX_ERRORS_PER_SESSION: 50
};

// Performance monitoring utilities
export const PerformanceOptimizer = {
  
  /**
   * Track database read operations
   */
  trackDatabaseRead: (operation = 'unknown', collection = 'unknown') => {
    metrics.databaseReads++;
    
    if (metrics.databaseReads % 100 === 0) {
      console.log(`📊 Performance: ${metrics.databaseReads} DB reads (${operation}:${collection})`);
    }
    
    if (metrics.databaseReads > THRESHOLDS.MAX_DB_READS) {
      console.warn('⚠️ Performance Warning: High database read count detected');
    }
  },

  /**
   * Track render performance
   */
  trackRender: (componentName, renderTime) => {
    metrics.renderTimes.push({ componentName, renderTime, timestamp: Date.now() });
    
    // Keep only last 100 render times
    if (metrics.renderTimes.length > 100) {
      metrics.renderTimes = metrics.renderTimes.slice(-100);
    }
    
    if (renderTime > THRESHOLDS.MAX_RENDER_TIME) {
      console.warn(`⚠️ Slow Render: ${componentName} took ${renderTime}ms`);
    }
  },

  /**
   * Track cache performance
   */
  trackCacheHit: (key, isHit) => {
    if (isHit) {
      metrics.cacheHits++;
    } else {
      metrics.cacheMisses++;
    }
    
    const total = metrics.cacheHits + metrics.cacheMisses;
    if (total % 50 === 0) {
      const hitRatio = metrics.cacheHits / total;
      console.log(`📈 Cache Performance: ${(hitRatio * 100).toFixed(1)}% hit ratio`);
      
      if (hitRatio < THRESHOLDS.CACHE_HIT_RATIO_MIN) {
        console.warn('⚠️ Performance Warning: Low cache hit ratio');
      }
    }
  },

  /**
   * Track component lifecycle
   */
  trackComponentMount: (componentName) => {
    metrics.componentMounts++;
    console.log(`🔄 Component Mount: ${componentName} (Total: ${metrics.componentMounts})`);
  },

  /**
   * Track errors
   */
  trackError: (error, context = 'unknown') => {
    metrics.errorCount++;
    console.error(`❌ Error tracked: ${error.message} in ${context}`);
    
    if (metrics.errorCount > THRESHOLDS.MAX_ERRORS_PER_SESSION) {
      console.warn('⚠️ Performance Warning: High error count in session');
    }
  },

  /**
   * Get current performance metrics
   */
  getMetrics: () => {
    const sessionDuration = Date.now() - metrics.sessionStart;
    const cacheTotal = metrics.cacheHits + metrics.cacheMisses;
    const cacheHitRatio = cacheTotal > 0 ? metrics.cacheHits / cacheTotal : 0;
    
    return {
      ...metrics,
      sessionDurationMs: sessionDuration,
      dbReadsPerMinute: (metrics.databaseReads / (sessionDuration / 60000)).toFixed(2),
      cacheHitRatio: (cacheHitRatio * 100).toFixed(1) + '%',
      averageRenderTime: metrics.renderTimes.length > 0 
        ? (metrics.renderTimes.reduce((sum, r) => sum + r.renderTime, 0) / metrics.renderTimes.length).toFixed(2) + 'ms'
        : '0ms'
    };
  },

  /**
   * Get performance recommendations
   */
  getRecommendations: () => {
    const recommendations = [];
    const sessionDuration = Date.now() - metrics.sessionStart;
    const dbReadsPerMinute = metrics.databaseReads / (sessionDuration / 60000);
    const cacheTotal = metrics.cacheHits + metrics.cacheMisses;
    const cacheHitRatio = cacheTotal > 0 ? metrics.cacheHits / cacheTotal : 0;
    
    // Database optimization recommendations
    if (dbReadsPerMinute > 10) {
      recommendations.push({
        type: 'database',
        priority: 'high',
        message: 'High database read rate detected. Consider implementing more aggressive caching.',
        metric: `${dbReadsPerMinute.toFixed(1)} reads/minute`
      });
    }
    
    // Cache optimization recommendations
    if (cacheHitRatio < 0.7 && cacheTotal > 20) {
      recommendations.push({
        type: 'cache',
        priority: 'medium',
        message: 'Low cache hit ratio. Review cache TTL settings and invalidation strategy.',
        metric: `${(cacheHitRatio * 100).toFixed(1)}% hit ratio`
      });
    }
    
    // Render performance recommendations
    const slowRenders = metrics.renderTimes.filter(r => r.renderTime > THRESHOLDS.MAX_RENDER_TIME);
    if (slowRenders.length > 5) {
      recommendations.push({
        type: 'render',
        priority: 'medium',
        message: 'Multiple slow renders detected. Consider optimizing component memoization.',
        metric: `${slowRenders.length} slow renders`
      });
    }
    
    // Error rate recommendations
    if (metrics.errorCount > 10) {
      recommendations.push({
        type: 'error',
        priority: 'high',
        message: 'High error rate detected. Review error handling and data validation.',
        metric: `${metrics.errorCount} errors`
      });
    }
    
    return recommendations;
  },

  /**
   * Generate performance report
   */
  generateReport: () => {
    const metrics = PerformanceOptimizer.getMetrics();
    const recommendations = PerformanceOptimizer.getRecommendations();
    
    console.group('📊 Performance Report');
    console.log('Session Duration:', (metrics.sessionDurationMs / 1000 / 60).toFixed(1), 'minutes');
    console.log('Database Reads:', metrics.databaseReads, `(${metrics.dbReadsPerMinute}/min)`);
    console.log('Cache Performance:', metrics.cacheHitRatio);
    console.log('Component Mounts:', metrics.componentMounts);
    console.log('Average Render Time:', metrics.averageRenderTime);
    console.log('Errors:', metrics.errorCount);
    
    if (recommendations.length > 0) {
      console.group('💡 Recommendations');
      recommendations.forEach(rec => {
        const priority = rec.priority === 'high' ? '🔴' : '🟡';
        console.log(`${priority} ${rec.type.toUpperCase()}: ${rec.message} (${rec.metric})`);
      });
      console.groupEnd();
    } else {
      console.log('✅ No performance issues detected');
    }
    
    console.groupEnd();
    
    return { metrics, recommendations };
  },

  /**
   * Reset metrics (useful for testing)
   */
  resetMetrics: () => {
    Object.keys(metrics).forEach(key => {
      if (key === 'sessionStart') {
        metrics[key] = Date.now();
      } else if (Array.isArray(metrics[key])) {
        metrics[key] = [];
      } else {
        metrics[key] = 0;
      }
    });
  },

  /**
   * Measure execution time of async functions
   */
  measureAsync: async (fn, label = 'operation') => {
    const startTime = performance.now();
    try {
      const result = await fn();
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`⏱️ ${label}: ${duration.toFixed(2)}ms`);
      return result;
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;
      console.error(`❌ ${label} failed after ${duration.toFixed(2)}ms:`, error.message);
      PerformanceOptimizer.trackError(error, label);
      throw error;
    }
  },

  /**
   * Memory usage monitoring (React Native specific)
   */
  trackMemoryUsage: () => {
    if (global.performance && global.performance.memory) {
      const memoryInfo = global.performance.memory;
      const usedMB = memoryInfo.usedJSHeapSize / (1024 * 1024);
      
      console.log(`💾 Memory Usage: ${usedMB.toFixed(1)}MB`);
      
      if (usedMB > THRESHOLDS.MAX_MEMORY_MB) {
        metrics.memoryWarnings++;
        console.warn(`⚠️ High memory usage detected: ${usedMB.toFixed(1)}MB`);
      }
      
      return usedMB;
    }
    return null;
  }
};

/**
 * Higher-order component for performance monitoring
 */
export const withPerformanceMonitoring = (WrappedComponent, componentName) => {
  return React.memo((props) => {
    React.useEffect(() => {
      PerformanceOptimizer.trackComponentMount(componentName);
    }, []);
    
    const startTime = performance.now();
    const result = <WrappedComponent {...props} />;
    const endTime = performance.now();
    
    PerformanceOptimizer.trackRender(componentName, endTime - startTime);
    
    return result;
  });
};

/**
 * Hook for performance monitoring in functional components
 */
export const usePerformanceMonitoring = (componentName) => {
  React.useEffect(() => {
    PerformanceOptimizer.trackComponentMount(componentName);
    
    return () => {
      // Component unmount - could track this too
      console.log(`🔄 Component Unmount: ${componentName}`);
    };
  }, [componentName]);
  
  const measureRender = React.useCallback((renderFn) => {
    const startTime = performance.now();
    const result = renderFn();
    const endTime = performance.now();
    
    PerformanceOptimizer.trackRender(componentName, endTime - startTime);
    return result;
  }, [componentName]);
  
  return {
    measureRender,
    trackError: (error, context) => PerformanceOptimizer.trackError(error, `${componentName}:${context}`),
    trackDatabaseRead: (operation) => PerformanceOptimizer.trackDatabaseRead(operation, componentName),
    getMetrics: PerformanceOptimizer.getMetrics
  };
};

export default PerformanceOptimizer; 