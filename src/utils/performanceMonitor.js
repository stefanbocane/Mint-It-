/**
 * Lightweight performance monitoring utility
 * Only active in development mode to prevent production overhead
 */

class LightweightPerformanceMonitor {
  constructor() {
    this.isEnabled = __DEV__ && process.env.NODE_ENV === 'development';
    this.metrics = this.isEnabled ? {
      cacheHits: 0,
      cacheMisses: 0,
      dbReads: 0,
      queryOptimizations: 0,
      startTime: Date.now()
    } : null;
    
    // Minimal session tracking - keep only essentials
    this.sessionEvents = this.isEnabled ? [] : null;
    this.lastReportTime = Date.now();
  }

  /**
   * Record a cache hit (no-op in production)
   */
  recordCacheHit(key, source = 'unknown') {
    if (!this.isEnabled) return;
    this.metrics.cacheHits++;
  }

  /**
   * Record a cache miss (no-op in production)
   */
  recordCacheMiss(key, source = 'unknown') {
    if (!this.isEnabled) return;
    this.metrics.cacheMisses++;
  }

  /**
   * Record a database read (no-op in production)
   */
  recordDbRead(collection, operation = 'getDoc') {
    if (!this.isEnabled) return;
    this.metrics.dbReads++;
  }

  /**
   * Record a query optimization (no-op in production)
   */
  recordQueryOptimization(type, savedReads = 0) {
    if (!this.isEnabled) return;
    this.metrics.queryOptimizations++;
  }

  /**
   * Get current performance statistics (returns null in production)
   */
  getStats() {
    if (!this.isEnabled) return null;
    
    const totalOperations = this.metrics.cacheHits + this.metrics.cacheMisses;
    const cacheHitRate = totalOperations > 0 ? 
      (this.metrics.cacheHits / totalOperations * 100).toFixed(1) : 0;
    
    return {
      cacheHitRate: `${cacheHitRate}%`,
      dbReads: this.metrics.dbReads,
      estimatedSavings: this.metrics.cacheHits + (this.metrics.queryOptimizations * 2)
    };
  }

  /**
   * Generate a brief optimization report (only in development)
   */
  generateReport() {
    if (!this.isEnabled) return null;

    const now = Date.now();
    // Only generate reports every 5 minutes to reduce overhead
    if (now - this.lastReportTime < 300000) return null;
    
    const stats = this.getStats();
    
    // Simple console log instead of complex report
    if (stats.dbReads > 20) {
      console.log(`📊 Performance: ${stats.cacheHitRate} cache hit rate, ${stats.dbReads} DB reads, ~${stats.estimatedSavings} reads saved`);
    }
    
    this.lastReportTime = now;
    return stats;
  }

  /**
   * Reset metrics (no-op in production)
   */
  reset() {
    if (!this.isEnabled) return;
    
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      dbReads: 0,
      queryOptimizations: 0,
      startTime: Date.now()
    };
  }
}

// Create singleton instance
const performanceMonitor = new LightweightPerformanceMonitor();

/**
 * React hook for performance monitoring (lightweight)
 */
export const usePerformanceMonitoring = () => {
  if (!__DEV__) {
    // Return no-op functions in production
    return {
      recordCacheHit: () => {},
      recordCacheMiss: () => {},
      recordDbRead: () => {},
      getStats: () => null,
      generateReport: () => null,
    };
  }

  return {
    recordCacheHit: (key, source) => performanceMonitor.recordCacheHit(key, source),
    recordCacheMiss: (key, source) => performanceMonitor.recordCacheMiss(key, source),
    recordDbRead: (collection, operation) => performanceMonitor.recordDbRead(collection, operation),
    getStats: () => performanceMonitor.getStats(),
    generateReport: () => performanceMonitor.generateReport(),
  };
};

// Simple timer utility for measuring operation duration
export const createPerformanceTimer = (operationName) => {
  if (!__DEV__) {
    return {
      end: () => {},
      measure: () => 0
    };
  }

  const startTime = Date.now();
  
  return {
    end: () => {
      const duration = Date.now() - startTime;
      if (duration > 1000) {
        console.log(`⚡ ${operationName}: ${duration}ms`);
      }
      return duration;
    },
    measure: () => Date.now() - startTime
  };
};

export default performanceMonitor; 