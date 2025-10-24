/**
 * Performance Monitor Service
 * Tracks reads, timing, and errors for optimization analysis
 */

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      reads: {},
      timing: {},
      errors: {},
      sessions: []
    };
    this.sessionStart = Date.now();
  }

  /**
   * Track a Firestore read operation
   * @param {string} operation - Name of the operation (e.g., 'coin_operation', 'collection_fetch')
   * @param {number} count - Number of reads (default: 1)
   */
  trackRead(operation, count = 1) {
    if (!this.metrics.reads[operation]) {
      this.metrics.reads[operation] = 0;
    }
    this.metrics.reads[operation] += count;

    if (__DEV__) {
      console.log(`[ReadMonitor] ${operation}: ${count} reads (total: ${this.metrics.reads[operation]})`);
    }
  }

  /**
   * Track an operation's execution time
   * @param {string} name - Operation name
   * @param {Function} operation - Async operation to track
   * @returns {Promise<any>} - Result of the operation
   */
  async trackOperation(name, operation) {
    const startTime = Date.now();

    try {
      const result = await operation();
      const duration = Date.now() - startTime;

      if (!this.metrics.timing[name]) {
        this.metrics.timing[name] = [];
      }
      this.metrics.timing[name].push(duration);

      if (__DEV__) {
        console.log(`[PerfMonitor] ${name}: ${duration}ms`);
      }

      return result;
    } catch (error) {
      if (!this.metrics.errors[name]) {
        this.metrics.errors[name] = 0;
      }
      this.metrics.errors[name]++;

      if (__DEV__) {
        console.error(`[PerfMonitor] ${name} failed:`, error);
      }

      throw error;
    }
  }

  /**
   * Get a comprehensive performance report
   * @returns {Object} Performance metrics report
   */
  getReport() {
    const totalReads = Object.values(this.metrics.reads).reduce((a, b) => a + b, 0);
    const avgTimings = {};

    for (const [op, times] of Object.entries(this.metrics.timing)) {
      if (times.length > 0) {
        const sorted = [...times].sort((a, b) => a - b);
        avgTimings[op] = {
          avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
          min: Math.min(...times),
          max: Math.max(...times),
          p50: sorted[Math.floor(times.length * 0.5)],
          p95: sorted[Math.floor(times.length * 0.95)],
          count: times.length,
        };
      }
    }

    const sessionDuration = Math.round((Date.now() - this.sessionStart) / 1000);

    return {
      sessionDuration: `${sessionDuration}s`,
      totalReads,
      readsByOperation: this.metrics.reads,
      timings: avgTimings,
      errors: this.metrics.errors,
      readsPerMinute: sessionDuration > 0 ? Math.round((totalReads / sessionDuration) * 60) : 0
    };
  }

  /**
   * Print a formatted report to console
   */
  printReport() {
    const report = this.getReport();

    console.log('\n========== PERFORMANCE REPORT ==========');
    console.log(`Session Duration: ${report.sessionDuration}`);
    console.log(`Total Reads: ${report.totalReads}`);
    console.log(`Reads/Minute: ${report.readsPerMinute}`);

    console.log('\n--- Reads by Operation ---');
    for (const [op, count] of Object.entries(report.readsByOperation)) {
      console.log(`  ${op}: ${count} reads`);
    }

    console.log('\n--- Operation Timings ---');
    for (const [op, stats] of Object.entries(report.timings)) {
      console.log(`  ${op}:`);
      console.log(`    avg: ${stats.avg}ms, p95: ${stats.p95}ms, count: ${stats.count}`);
    }

    if (Object.keys(report.errors).length > 0) {
      console.log('\n--- Errors ---');
      for (const [op, count] of Object.entries(report.errors)) {
        console.log(`  ${op}: ${count} errors`);
      }
    }

    console.log('=======================================\n');
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics = {
      reads: {},
      timing: {},
      errors: {},
      sessions: []
    };
    this.sessionStart = Date.now();

    if (__DEV__) {
      console.log('[PerfMonitor] Metrics reset');
    }
  }

  /**
   * Track cache hit/miss
   * @param {string} operation - Operation name
   * @param {boolean} isHit - Whether it was a cache hit
   */
  trackCache(operation, isHit) {
    if (!this.metrics.cache) {
      this.metrics.cache = {
        hits: {},
        misses: {}
      };
    }

    const target = isHit ? 'hits' : 'misses';
    if (!this.metrics.cache[target][operation]) {
      this.metrics.cache[target][operation] = 0;
    }
    this.metrics.cache[target][operation]++;

    if (__DEV__) {
      console.log(`[CacheMonitor] ${operation}: ${isHit ? 'HIT' : 'MISS'}`);
    }
  }

  /**
   * Get cache hit rate for an operation
   * @param {string} operation - Operation name
   * @returns {number} Hit rate as percentage (0-100)
   */
  getCacheHitRate(operation) {
    if (!this.metrics.cache) return 0;

    const hits = this.metrics.cache.hits[operation] || 0;
    const misses = this.metrics.cache.misses[operation] || 0;
    const total = hits + misses;

    return total > 0 ? Math.round((hits / total) * 100) : 0;
  }
}

// Export singleton instance
const performanceMonitor = new PerformanceMonitor();

// Make it globally accessible for debugging
if (__DEV__ && typeof global !== 'undefined') {
  global.PerformanceMonitor = performanceMonitor;
}

export default performanceMonitor;
