/**
 * ReadMonitor - Central Firestore Read Tracking System
 * 
 * PURPOSE: Single source of truth for ALL Firestore read operations
 * GOAL: Keep reads under 10 per session
 * 
 * Features:
 * - Real-time read counting
 * - Source attribution
 * - Budget management
 * - Performance analytics
 * - Alert system
 * 
 * @version 1.0.0
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

class ReadMonitor {
  constructor() {
    // Core tracking
    this.sessionReads = 0;
    this.sessionStart = Date.now();
    this.readLog = [];
    this.readsBySource = new Map();
    this.readsByScreen = new Map();
    this.readsByOperation = new Map();
    
    // Budget configuration
    this.budget = 10; // Target: single digit reads
    this.warningThreshold = 8; // Warn at 80%
    this.criticalThreshold = 10; // Error at 100%
    
    // State management
    this.isMonitoring = true;
    this.lastAlert = null;
    this.sessionId = this.generateSessionId();
    
    // Persistent storage keys
    this.STORAGE_KEYS = {
      SESSION_READS: 'readmonitor_session_reads',
      SESSION_ID: 'readmonitor_session_id',
      LIFETIME_READS: 'readmonitor_lifetime_reads',
      LAST_SESSION: 'readmonitor_last_session'
    };
    
    // Simple event listeners (replacing EventEmitter)
    this.listeners = {
      warning: [],
      critical: [],
      read: []
    };
    
    // Load persisted data
    this.loadPersistedData();
    
    console.log(`📊 ReadMonitor initialized [Session: ${this.sessionId}]`);
  }
  
  /**
   * Simple event emitter (replaces Node.js EventEmitter)
   */
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }
  
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
    
    // Also call handler methods directly for internal events
    if (event === 'warning' && this.handleWarning) {
      this.handleWarning(data);
    } else if (event === 'critical' && this.handleCritical) {
      this.handleCritical(data);
    } else if (event === 'read' && this.handleRead) {
      this.handleRead(data);
    }
  }
  
  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Load persisted tracking data
   */
  async loadPersistedData() {
    try {
      const [savedSessionId, savedReads, lifetimeReads, lastSession] = await Promise.all([
        AsyncStorage.getItem(this.STORAGE_KEYS.SESSION_ID),
        AsyncStorage.getItem(this.STORAGE_KEYS.SESSION_READS),
        AsyncStorage.getItem(this.STORAGE_KEYS.LIFETIME_READS),
        AsyncStorage.getItem(this.STORAGE_KEYS.LAST_SESSION)
      ]);
      
      // Check if this is a new session (15 minutes threshold)
      const isNewSession = !savedSessionId || 
        !lastSession || 
        (Date.now() - parseInt(lastSession)) > 15 * 60 * 1000;
      
      if (isNewSession) {
        // New session: reset counters
        this.sessionId = this.generateSessionId();
        this.sessionReads = 0;
        this.sessionStart = Date.now();
        
        await this.persistData();
        
        console.log('📊 New session started:', this.sessionId);
      } else {
        // Continuing session: restore counters
        this.sessionId = savedSessionId;
        this.sessionReads = parseInt(savedReads) || 0;
        
        console.log(`📊 Restored session: ${this.sessionId} (${this.sessionReads} reads)`);
      }
      
      // Always load lifetime stats
      const lifetime = parseInt(lifetimeReads) || 0;
      console.log(`📈 Lifetime reads: ${lifetime.toLocaleString()}`);
      
    } catch (error) {
      console.error('❌ Failed to load persisted read data:', error);
    }
  }
  
  /**
   * Persist current state to AsyncStorage
   */
  async persistData() {
    try {
      await Promise.all([
        AsyncStorage.setItem(this.STORAGE_KEYS.SESSION_ID, this.sessionId),
        AsyncStorage.setItem(this.STORAGE_KEYS.SESSION_READS, this.sessionReads.toString()),
        AsyncStorage.setItem(this.STORAGE_KEYS.LAST_SESSION, Date.now().toString())
      ]);
    } catch (error) {
      console.error('❌ Failed to persist read data:', error);
    }
  }
  
  /**
   * Track a Firestore read operation
   * 
   * @param {string} source - Source component/service (e.g., 'CollectionScreen', 'AuctionService')
   * @param {string} operation - Operation type (e.g., 'initial_load', 'refresh', 'pagination')
   * @param {Object} metadata - Additional context
   * @returns {number} - Current session read count
   */
  trackRead(source, operation, metadata = {}) {
    if (!this.isMonitoring) return this.sessionReads;
    
    // Increment counters
    this.sessionReads++;
    
    // Create detailed log entry
    const entry = {
      id: `read_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      source,
      operation,
      timestamp: Date.now(),
      sessionTime: Date.now() - this.sessionStart,
      readNumber: this.sessionReads,
      metadata,
      stack: this.captureStack()
    };
    
    // Add to log
    this.readLog.push(entry);
    
    // Update source tracking
    this.readsBySource.set(source, (this.readsBySource.get(source) || 0) + 1);
    
    // Update operation tracking
    this.readsByOperation.set(operation, (this.readsByOperation.get(operation) || 0) + 1);
    
    // Extract screen from source if present
    const screen = this.extractScreen(source);
    if (screen) {
      this.readsByScreen.set(screen, (this.readsByScreen.get(screen) || 0) + 1);
    }
    
    // Emit read event
    this.emit('read', entry);
    
    // Check thresholds
    if (this.sessionReads === this.warningThreshold) {
      this.emit('warning', {
        reads: this.sessionReads,
        budget: this.budget,
        message: `⚠️ APPROACHING READ BUDGET: ${this.sessionReads}/${this.budget}`
      });
    }
    
    if (this.sessionReads >= this.criticalThreshold) {
      this.emit('critical', {
        reads: this.sessionReads,
        budget: this.budget,
        message: `🚨 READ BUDGET EXCEEDED: ${this.sessionReads}/${this.budget}`
      });
    }
    
    // Persist periodically
    if (this.sessionReads % 5 === 0) {
      this.persistData();
      this.persistLifetimeRead();
    }
    
    // Log in development
    if (__DEV__) {
      console.log(
        `📖 Read #${this.sessionReads}: ${source}.${operation}`,
        metadata,
        `[${this.getBudgetStatus()}]`
      );
    }
    
    return this.sessionReads;
  }
  
  /**
   * Track multiple reads (batch operation)
   */
  trackBatchReads(source, operation, count, metadata = {}) {
    for (let i = 0; i < count; i++) {
      this.trackRead(source, operation, { ...metadata, batchIndex: i, batchSize: count });
    }
  }
  
  /**
   * Increment lifetime read counter
   */
  async persistLifetimeRead() {
    try {
      const current = await AsyncStorage.getItem(this.STORAGE_KEYS.LIFETIME_READS);
      const lifetime = (parseInt(current) || 0) + 1;
      await AsyncStorage.setItem(this.STORAGE_KEYS.LIFETIME_READS, lifetime.toString());
    } catch (error) {
      console.error('Failed to persist lifetime read:', error);
    }
  }
  
  /**
   * Capture stack trace for debugging
   */
  captureStack() {
    try {
      const stack = new Error().stack;
      // Extract relevant frames (skip monitor internals)
      const lines = stack.split('\n').slice(3, 6);
      return lines.join('\n');
    } catch {
      return 'Stack unavailable';
    }
  }
  
  /**
   * Extract screen name from source
   */
  extractScreen(source) {
    const screenMatch = source.match(/(\w+)Screen/);
    return screenMatch ? screenMatch[0] : null;
  }
  
  /**
   * Get budget status string
   */
  getBudgetStatus() {
    const percentage = (this.sessionReads / this.budget) * 100;
    const remaining = Math.max(0, this.budget - this.sessionReads);
    
    if (percentage >= 100) return `🔴 OVER BUDGET (${remaining} over)`;
    if (percentage >= 80) return `🟡 WARNING (${remaining} remaining)`;
    return `🟢 OK (${remaining} remaining)`;
  }
  
  /**
   * Handle warning threshold reached
   */
  handleWarning(data) {
    console.warn(data.message);
    
    // Prevent alert spam
    if (this.lastAlert && Date.now() - this.lastAlert < 10000) return;
    this.lastAlert = Date.now();
    
    if (__DEV__) {
      // Show warning banner in development
      this.showDevWarning(data.message);
    }
  }
  
  /**
   * Handle critical threshold reached
   */
  handleCritical(data) {
    console.error(data.message);
    console.error('📊 Read breakdown:', this.getBreakdownSummary());
    
    if (__DEV__) {
      // Show critical alert in development
      this.showDevAlert(data.message);
    }
    
    // Log to analytics/crashlytics in production
    this.logCriticalEvent(data);
  }
  
  /**
   * Handle read event (for real-time updates)
   */
  handleRead(data) {
    // Emit for dashboard updates
    // Can be consumed by React components via event listeners
  }
  
  /**
   * Show development warning (placeholder - implement with actual UI)
   */
  showDevWarning(message) {
    // TODO: Integrate with actual toast/banner component
    console.warn('DEV WARNING:', message);
  }
  
  /**
   * Show development alert (placeholder - implement with actual UI)
   */
  showDevAlert(message) {
    // TODO: Integrate with actual alert component
    console.error('DEV ALERT:', message);
  }
  
  /**
   * Log critical event to analytics
   */
  async logCriticalEvent(data) {
    // TODO: Integrate with Firebase Analytics / Crashlytics
    console.error('CRITICAL READ EVENT:', data);
    
    try {
      // Save critical event log
      const criticalLogs = await AsyncStorage.getItem('readmonitor_critical_logs');
      const logs = criticalLogs ? JSON.parse(criticalLogs) : [];
      
      logs.push({
        ...data,
        timestamp: Date.now(),
        sessionId: this.sessionId,
        breakdown: this.getBreakdownSummary()
      });
      
      // Keep only last 10 critical events
      await AsyncStorage.setItem(
        'readmonitor_critical_logs',
        JSON.stringify(logs.slice(-10))
      );
    } catch (error) {
      console.error('Failed to log critical event:', error);
    }
  }
  
  /**
   * Get comprehensive report
   */
  getReport() {
    const sessionDuration = Date.now() - this.sessionStart;
    const percentage = (this.sessionReads / this.budget) * 100;
    
    return {
      // Session info
      sessionId: this.sessionId,
      sessionStart: this.sessionStart,
      sessionDuration,
      
      // Read counts
      totalReads: this.sessionReads,
      budget: this.budget,
      remaining: Math.max(0, this.budget - this.sessionReads),
      overBudget: Math.max(0, this.sessionReads - this.budget),
      percentage: Math.round(percentage),
      
      // Status
      status: this.getBudgetStatus(),
      isOverBudget: this.sessionReads > this.budget,
      isWarning: this.sessionReads >= this.warningThreshold,
      
      // Breakdowns
      bySource: Object.fromEntries(this.readsBySource),
      byScreen: Object.fromEntries(this.readsByScreen),
      byOperation: Object.fromEntries(this.readsByOperation),
      
      // Recent activity
      recentReads: this.readLog.slice(-10),
      allReads: this.readLog,
      
      // Performance metrics
      averageTimePerRead: sessionDuration / Math.max(1, this.sessionReads),
      readsPerMinute: (this.sessionReads / (sessionDuration / 60000)).toFixed(2)
    };
  }
  
  /**
   * Get breakdown summary
   */
  getBreakdownSummary() {
    const bySource = Object.fromEntries(this.readsBySource);
    const byScreen = Object.fromEntries(this.readsByScreen);
    const byOperation = Object.fromEntries(this.readsByOperation);
    
    return { bySource, byScreen, byOperation };
  }
  
  /**
   * Get detailed analytics
   */
  getAnalytics() {
    const report = this.getReport();
    
    // Calculate additional metrics
    const sources = Array.from(this.readsBySource.entries());
    const topSource = sources.reduce((max, curr) => 
      curr[1] > max[1] ? curr : max, ['none', 0]
    );
    
    const operations = Array.from(this.readsByOperation.entries());
    const topOperation = operations.reduce((max, curr) =>
      curr[1] > max[1] ? curr : max, ['none', 0]
    );
    
    return {
      ...report,
      insights: {
        topSource: { name: topSource[0], reads: topSource[1] },
        topOperation: { name: topOperation[0], reads: topOperation[1] },
        uniqueSources: this.readsBySource.size,
        uniqueOperations: this.readsByOperation.size,
        efficiency: ((this.budget - this.sessionReads) / this.budget * 100).toFixed(1)
      }
    };
  }
  
  /**
   * Reset session (for testing or manual reset)
   */
  async reset() {
    console.log('🔄 ReadMonitor: Resetting session');
    
    // Save final report before reset
    const finalReport = this.getReport();
    console.log('📊 Final session report:', finalReport);
    
    // Reset counters
    this.sessionReads = 0;
    this.sessionStart = Date.now();
    this.readLog = [];
    this.readsBySource.clear();
    this.readsByScreen.clear();
    this.readsByOperation.clear();
    this.sessionId = this.generateSessionId();
    this.lastAlert = null;
    
    // Persist reset state
    await this.persistData();
    
    console.log(`📊 New session started: ${this.sessionId}`);
  }
  
  /**
   * Enable/disable monitoring
   */
  setMonitoring(enabled) {
    this.isMonitoring = enabled;
    console.log(`📊 ReadMonitor: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }
  
  /**
   * Update budget
   */
  setBudget(newBudget) {
    const oldBudget = this.budget;
    this.budget = newBudget;
    this.warningThreshold = Math.floor(newBudget * 0.8);
    this.criticalThreshold = newBudget;
    
    console.log(`📊 Budget updated: ${oldBudget} → ${newBudget}`);
  }
  
  /**
   * Export session data for analysis
   */
  exportSession() {
    const report = this.getAnalytics();
    
    return {
      ...report,
      exportedAt: Date.now(),
      exportVersion: '1.0.0'
    };
  }
  
  /**
   * Get critical event logs
   */
  async getCriticalLogs() {
    try {
      const logs = await AsyncStorage.getItem('readmonitor_critical_logs');
      return logs ? JSON.parse(logs) : [];
    } catch (error) {
      console.error('Failed to get critical logs:', error);
      return [];
    }
  }
  
  /**
   * Clear all data (for testing)
   */
  async clearAll() {
    await Promise.all([
      AsyncStorage.removeItem(this.STORAGE_KEYS.SESSION_READS),
      AsyncStorage.removeItem(this.STORAGE_KEYS.SESSION_ID),
      AsyncStorage.removeItem(this.STORAGE_KEYS.LIFETIME_READS),
      AsyncStorage.removeItem(this.STORAGE_KEYS.LAST_SESSION),
      AsyncStorage.removeItem('readmonitor_critical_logs')
    ]);
    
    await this.reset();
    console.log('🧹 ReadMonitor: All data cleared');
  }
}

// Export singleton instance
export default new ReadMonitor();

