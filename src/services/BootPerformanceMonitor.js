/**
 * Boot Performance Monitor
 * 
 * Tracks and reports on database read optimization results
 * Provides real-time metrics on boot performance improvements
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

class BootPerformanceMonitor {
  constructor() {
    this.metrics = {
      totalBootSessions: 0,
      totalReadsSaved: 0,
      totalBootTime: 0,
      averageBootTime: 0,
      optimizationEfficiency: 0,
      lastBootMetrics: null,
      historicalData: []
    };
    
    this.currentSession = null;
    this.isMonitoring = false;
  }

  /**
   * Start monitoring a boot session
   */
  async startBootSession(sessionId = null) {
    this.currentSession = {
      sessionId: sessionId || `boot_${Date.now()}`,
      startTime: Date.now(),
      readsBeforeOptimization: 78, // Original read count
      readsAfterOptimization: 0,
      readsSaved: 0,
      bootTime: 0,
      optimizationSteps: [],
      errors: []
    };
    
    this.isMonitoring = true;
    console.log(`📊 Boot performance monitoring started: ${this.currentSession.sessionId}`);
    
    return this.currentSession.sessionId;
  }

  /**
   * Record optimization step
   */
  recordOptimizationStep(stepName, readsSaved, description = '') {
    if (!this.isMonitoring || !this.currentSession) return;

    const step = {
      stepName,
      readsSaved,
      description,
      timestamp: Date.now(),
      timeFromStart: Date.now() - this.currentSession.startTime
    };

    this.currentSession.optimizationSteps.push(step);
    this.currentSession.readsSaved += readsSaved;
    
    console.log(`🎯 Optimization step: ${stepName} saved ${readsSaved} reads - ${description}`);
  }

  /**
   * Record actual database reads performed
   */
  recordActualReads(readCount, source = 'unknown') {
    if (!this.isMonitoring || !this.currentSession) return;

    this.currentSession.readsAfterOptimization += readCount;
    
    console.log(`📖 Database reads recorded: ${readCount} from ${source}`);
  }

  /**
   * End boot session and calculate final metrics
   */
  async endBootSession() {
    if (!this.isMonitoring || !this.currentSession) return null;

    this.currentSession.bootTime = Date.now() - this.currentSession.startTime;
    this.currentSession.readsSaved = this.currentSession.readsBeforeOptimization - this.currentSession.readsAfterOptimization;
    
    // Calculate efficiency
    const efficiency = (this.currentSession.readsSaved / this.currentSession.readsBeforeOptimization) * 100;
    this.currentSession.optimizationEfficiency = Math.round(efficiency);

    // Update global metrics
    await this.updateGlobalMetrics(this.currentSession);
    
    // Save session data
    await this.saveSessionData(this.currentSession);
    
    // Log final results
    this.logBootResults(this.currentSession);
    
    const sessionData = { ...this.currentSession };
    this.currentSession = null;
    this.isMonitoring = false;
    
    return sessionData;
  }

  /**
   * Update global performance metrics
   */
  async updateGlobalMetrics(sessionData) {
    this.metrics.totalBootSessions++;
    this.metrics.totalReadsSaved += sessionData.readsSaved;
    this.metrics.totalBootTime += sessionData.bootTime;
    this.metrics.averageBootTime = Math.round(this.metrics.totalBootTime / this.metrics.totalBootSessions);
    this.metrics.optimizationEfficiency = Math.round(
      (this.metrics.totalReadsSaved / (this.metrics.totalBootSessions * 78)) * 100
    );
    this.metrics.lastBootMetrics = sessionData;

    // Keep last 10 sessions in history
    this.metrics.historicalData.push({
      sessionId: sessionData.sessionId,
      bootTime: sessionData.bootTime,
      readsSaved: sessionData.readsSaved,
      efficiency: sessionData.optimizationEfficiency,
      timestamp: sessionData.startTime
    });

    if (this.metrics.historicalData.length > 10) {
      this.metrics.historicalData.shift();
    }

    // Save to persistent storage
    try {
      await AsyncStorage.setItem('bootPerformanceMetrics', JSON.stringify(this.metrics));
    } catch (error) {
      console.error('Error saving boot performance metrics:', error);
    }
  }

  /**
   * Save detailed session data
   */
  async saveSessionData(sessionData) {
    try {
      const key = `bootSession_${sessionData.sessionId}`;
      await AsyncStorage.setItem(key, JSON.stringify(sessionData));
    } catch (error) {
      console.error('Error saving boot session data:', error);
    }
  }

  /**
   * Load metrics from storage
   */
  async loadMetrics() {
    try {
      const stored = await AsyncStorage.getItem('bootPerformanceMetrics');
      if (stored) {
        this.metrics = { ...this.metrics, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.error('Error loading boot performance metrics:', error);
    }
  }

  /**
   * Log boot results to console
   */
  logBootResults(sessionData) {
    console.log('\n🎉 BOOT OPTIMIZATION RESULTS 🎉');
    console.log('=====================================');
    console.log(`Session ID: ${sessionData.sessionId}`);
    console.log(`Boot Time: ${sessionData.bootTime}ms`);
    console.log(`Reads Before Optimization: ${sessionData.readsBeforeOptimization}`);
    console.log(`Reads After Optimization: ${sessionData.readsAfterOptimization}`);
    console.log(`Reads Saved: ${sessionData.readsSaved} (${sessionData.optimizationEfficiency}% reduction)`);
    console.log('\nOptimization Steps:');
    
    sessionData.optimizationSteps.forEach((step, index) => {
      console.log(`  ${index + 1}. ${step.stepName}: ${step.readsSaved} reads saved`);
      if (step.description) {
        console.log(`     ${step.description}`);
      }
    });
    
    console.log('\nGlobal Performance:');
    console.log(`Total Sessions: ${this.metrics.totalBootSessions}`);
    console.log(`Average Boot Time: ${this.metrics.averageBootTime}ms`);
    console.log(`Total Reads Saved: ${this.metrics.totalReadsSaved}`);
    console.log(`Overall Efficiency: ${this.metrics.optimizationEfficiency}%`);
    console.log('=====================================\n');
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Get detailed session data
   */
  async getSessionData(sessionId) {
    try {
      const key = `bootSession_${sessionId}`;
      const stored = await AsyncStorage.getItem(key);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.error('Error loading session data:', error);
      return null;
    }
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport() {
    const report = {
      summary: {
        totalSessions: this.metrics.totalBootSessions,
        averageBootTime: this.metrics.averageBootTime,
        totalReadsSaved: this.metrics.totalReadsSaved,
        overallEfficiency: this.metrics.optimizationEfficiency
      },
      
      trends: {
        bootTimeImprovement: this.calculateBootTimeImprovement(),
        readReductionTrend: this.calculateReadReductionTrend(),
        consistencyScore: this.calculateConsistencyScore()
      },
      
      recommendations: this.generateRecommendations(),
      
      historicalData: this.metrics.historicalData
    };

    return report;
  }

  /**
   * Calculate boot time improvement trend
   */
  calculateBootTimeImprovement() {
    if (this.metrics.historicalData.length < 2) return 0;

    const recent = this.metrics.historicalData.slice(-3);
    const older = this.metrics.historicalData.slice(0, 3);

    const recentAvg = recent.reduce((sum, session) => sum + session.bootTime, 0) / recent.length;
    const olderAvg = older.reduce((sum, session) => sum + session.bootTime, 0) / older.length;

    return Math.round(((olderAvg - recentAvg) / olderAvg) * 100);
  }

  /**
   * Calculate read reduction trend
   */
  calculateReadReductionTrend() {
    if (this.metrics.historicalData.length < 2) return 0;

    const recent = this.metrics.historicalData.slice(-3);
    const recentAvgEfficiency = recent.reduce((sum, session) => sum + session.efficiency, 0) / recent.length;

    return Math.round(recentAvgEfficiency);
  }

  /**
   * Calculate consistency score
   */
  calculateConsistencyScore() {
    if (this.metrics.historicalData.length < 3) return 100;

    const bootTimes = this.metrics.historicalData.map(session => session.bootTime);
    const avg = bootTimes.reduce((sum, time) => sum + time, 0) / bootTimes.length;
    const variance = bootTimes.reduce((sum, time) => sum + Math.pow(time - avg, 2), 0) / bootTimes.length;
    const stdDev = Math.sqrt(variance);
    
    // Lower standard deviation = higher consistency
    const consistencyScore = Math.max(0, 100 - (stdDev / avg) * 100);
    return Math.round(consistencyScore);
  }

  /**
   * Generate optimization recommendations
   */
  generateRecommendations() {
    const recommendations = [];

    if (this.metrics.averageBootTime > 5000) {
      recommendations.push({
        type: 'performance',
        priority: 'high',
        message: 'Boot time is above 5 seconds. Consider implementing more aggressive lazy loading.'
      });
    }

    if (this.metrics.optimizationEfficiency < 70) {
      recommendations.push({
        type: 'optimization',
        priority: 'medium',
        message: 'Read reduction efficiency is below 70%. Review UnifiedBootstrapService configuration.'
      });
    }

    const consistencyScore = this.calculateConsistencyScore();
    if (consistencyScore < 80) {
      recommendations.push({
        type: 'consistency',
        priority: 'medium',
        message: 'Boot time consistency is low. Check for network-dependent operations in critical path.'
      });
    }

    if (this.metrics.totalBootSessions > 10 && this.metrics.optimizationEfficiency > 80) {
      recommendations.push({
        type: 'success',
        priority: 'info',
        message: 'Excellent optimization performance! Consider sharing these patterns with other parts of the app.'
      });
    }

    return recommendations;
  }

  /**
   * Reset all metrics (for testing)
   */
  async resetMetrics() {
    this.metrics = {
      totalBootSessions: 0,
      totalReadsSaved: 0,
      totalBootTime: 0,
      averageBootTime: 0,
      optimizationEfficiency: 0,
      lastBootMetrics: null,
      historicalData: []
    };

    try {
      await AsyncStorage.removeItem('bootPerformanceMetrics');
      console.log('🔄 Boot performance metrics reset');
    } catch (error) {
      console.error('Error resetting metrics:', error);
    }
  }
}

// Export singleton instance
export default new BootPerformanceMonitor(); 