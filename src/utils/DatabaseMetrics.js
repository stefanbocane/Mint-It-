/**
 * DatabaseMetrics - Centralized database operation tracking and optimization
 * 
 * This service provides:
 * - Unified database read/write tracking
 * - Performance insights and alerts
 * - Cost optimization recommendations
 * - Real-time monitoring for development
 */

class DatabaseMetrics {
  constructor() {
    this.sessions = new Map(); // Track per-session metrics
    this.globalStats = {
      totalReads: 0,
      totalWrites: 0,
      cacheHits: 0,
      cacheMisses: 0,
      startTime: Date.now()
    };
    this.alerts = [];
    this.costThresholds = {
      SESSION_READ_WARNING: 100,
      SESSION_READ_CRITICAL: 200,
      GLOBAL_READ_WARNING: 1000,
      CACHE_HIT_RATE_MIN: 0.6 // 60% minimum hit rate
    };
  }

  /**
   * Track database read operation
   */
  trackRead(sessionId, operation, collection, useCache = false) {
    this.globalStats.totalReads++;
    
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        reads: 0,
        writes: 0,
        cacheHits: 0,
        cacheMisses: 0,
        operations: [],
        startTime: Date.now()
      });
    }
    
    const session = this.sessions.get(sessionId);
    session.reads++;
    
    if (useCache) {
      session.cacheHits++;
      this.globalStats.cacheHits++;
    } else {
      session.cacheMisses++;
      this.globalStats.cacheMisses++;
    }
    
    session.operations.push({
      type: 'read',
      operation,
      collection,
      timestamp: Date.now(),
      fromCache: useCache
    });
    
    // Check for alerts
    this.checkAlerts(sessionId, session);
    
    // Log performance insights periodically
    if (session.reads % 25 === 0) {
      this.logPerformanceInsights(sessionId);
    }
  }

  /**
   * Track database write operation
   */
  trackWrite(sessionId, operation, collection) {
    this.globalStats.totalWrites++;
    
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        reads: 0,
        writes: 0,
        cacheHits: 0,
        cacheMisses: 0,
        operations: [],
        startTime: Date.now()
      });
    }
    
    const session = this.sessions.get(sessionId);
    session.writes++;
    
    session.operations.push({
      type: 'write',
      operation,
      collection,
      timestamp: Date.now()
    });
  }

  /**
   * Check for performance alerts
   */
  checkAlerts(sessionId, session) {
    const now = Date.now();
    
    // Session read warnings
    if (session.reads >= this.costThresholds.SESSION_READ_CRITICAL) {
      this.addAlert('critical', `Session ${sessionId} has exceeded ${this.costThresholds.SESSION_READ_CRITICAL} reads`);
    } else if (session.reads >= this.costThresholds.SESSION_READ_WARNING) {
      this.addAlert('warning', `Session ${sessionId} approaching read limit (${session.reads} reads)`);
    }
    
    // Cache hit rate warnings
    const totalCacheRequests = session.cacheHits + session.cacheMisses;
    if (totalCacheRequests > 20) {
      const hitRate = session.cacheHits / totalCacheRequests;
      if (hitRate < this.costThresholds.CACHE_HIT_RATE_MIN) {
        this.addAlert('warning', `Low cache hit rate for session ${sessionId}: ${Math.round(hitRate * 100)}%`);
      }
    }
    
    // Global read warnings
    if (this.globalStats.totalReads >= this.costThresholds.GLOBAL_READ_WARNING) {
      this.addAlert('warning', `Global read count approaching limit: ${this.globalStats.totalReads}`);
    }
  }

  /**
   * Add performance alert
   */
  addAlert(level, message) {
    const alert = {
      level,
      message,
      timestamp: Date.now()
    };
    
    this.alerts.push(alert);
    
    // Keep only last 50 alerts
    if (this.alerts.length > 50) {
      this.alerts.shift();
    }
    
    // Log critical alerts immediately
    if (level === 'critical') {
      console.error('🚨 DatabaseMetrics CRITICAL:', message);
    } else if (level === 'warning') {
      console.warn('⚠️ DatabaseMetrics WARNING:', message);
    }
  }

  /**
   * Get performance insights for a session
   */
  getSessionInsights(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    const duration = Date.now() - session.startTime;
    const totalCacheRequests = session.cacheHits + session.cacheMisses;
    const cacheHitRate = totalCacheRequests > 0 ? session.cacheHits / totalCacheRequests : 0;
    
    return {
      sessionId,
      duration: Math.round(duration / 1000), // seconds
      reads: session.reads,
      writes: session.writes,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      readsPerMinute: duration > 0 ? Math.round((session.reads / duration) * 60 * 1000) : 0,
      efficiency: session.reads > 0 ? Math.round((session.cacheHits / session.reads) * 100) : 100,
      recommendations: this.getRecommendations(session)
    };
  }

  /**
   * Get optimization recommendations
   */
  getRecommendations(session) {
    const recommendations = [];
    const totalCacheRequests = session.cacheHits + session.cacheMisses;
    const cacheHitRate = totalCacheRequests > 0 ? session.cacheHits / totalCacheRequests : 0;
    
    if (session.reads > 150) {
      recommendations.push('Consider implementing more aggressive caching strategies');
    }
    
    if (cacheHitRate < 0.5) {
      recommendations.push('Cache hit rate is low - review cache TTL settings');
    }
    
    if (session.reads > session.writes * 10) {
      recommendations.push('High read-to-write ratio - consider denormalization');
    }
    
    return recommendations;
  }

  /**
   * Log performance insights
   */
  logPerformanceInsights(sessionId) {
    if (!__DEV__) return;
    
    const insights = this.getSessionInsights(sessionId);
    if (insights) {
      console.log(`📊 DatabaseMetrics [${sessionId}]:`, {
        duration: `${insights.duration}s`,
        reads: insights.reads,
        efficiency: `${insights.efficiency}%`,
        rpm: insights.readsPerMinute
      });
      
      if (insights.recommendations.length > 0) {
        console.log(`💡 Recommendations:`, insights.recommendations);
      }
    }
  }

  /**
   * Get global statistics
   */
  getGlobalStats() {
    const duration = Date.now() - this.globalStats.startTime;
    const totalCacheRequests = this.globalStats.cacheHits + this.globalStats.cacheMisses;
    const globalCacheHitRate = totalCacheRequests > 0 ? this.globalStats.cacheHits / totalCacheRequests : 0;
    
    return {
      ...this.globalStats,
      duration: Math.round(duration / 1000),
      globalCacheHitRate: Math.round(globalCacheHitRate * 100) / 100,
      activeSessions: this.sessions.size,
      recentAlerts: this.alerts.slice(-5)
    };
  }

  /**
   * Clear session data
   */
  clearSession(sessionId) {
    this.sessions.delete(sessionId);
    console.log(`🧹 DatabaseMetrics - Cleared session ${sessionId}`);
  }

  /**
   * Reset all metrics (development only)
   */
  reset() {
    if (!__DEV__) return;
    
    this.sessions.clear();
    this.globalStats = {
      totalReads: 0,
      totalWrites: 0,
      cacheHits: 0,
      cacheMisses: 0,
      startTime: Date.now()
    };
    this.alerts = [];
    console.log('🔄 DatabaseMetrics - All metrics reset');
  }
}

// Export singleton instance
export default new DatabaseMetrics(); 