/**
 * Production Monitoring Service
 * 
 * PURPOSE: Track and alert on read performance in production
 * GOAL: Proactive detection and alerting for read budget violations
 * 
 * FEATURES:
 * 1. Session read tracking and reporting
 * 2. Anomaly detection (spikes in reads)
 * 3. Performance metrics (screen load times, cache hit rates)
 * 4. User-level analytics (high-read users)
 * 5. Alert system (thresholds, notifications)
 * 
 * INTEGRATION:
 * - Works with ReadMonitor for real-time tracking
 * - Sends data to analytics services (Firebase Analytics, Mixpanel, etc.)
 * - Triggers alerts via email/Slack/Firebase Cloud Messaging
 * 
 * @version 1.0.0
 */


class ProductionMonitor {
  constructor() {
    this.sessionMetrics = {
      sessionId: null,
      startTime: null,
      userId: null,
      reads: {
        total: 0,
        byScreen: {},
        bySource: {},
        timeline: []
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0
      },
      performance: {
        screenLoadTimes: {},
        bootTime: 0
      },
      alerts: []
    };

    this.config = {
      // Alert thresholds
      readBudget: 10,
      warningThreshold: 8, // 80% of budget
      criticalThreshold: 15, // 150% of budget (emergency)
      
      // Sampling (don't track every session in production)
      samplingRate: 0.1, // 10% of sessions
      
      // Reporting
      reportInterval: 5 * 60 * 1000, // 5 minutes
      enableAutoReporting: true,
      
      // Alerting
      enableAlerts: true,
      alertCooldown: 10 * 60 * 1000 // 10 minutes between similar alerts
    };

    this.lastAlertTimes = {};
    this.reportingInterval = null;
    this.isEnabled = false;
  }

  /**
   * Initialize monitoring for current session
   */
  initialize(userId, options = {}) {
    const {
      sessionId = this.generateSessionId(),
      enableSampling = true
    } = options;

    // Sampling: Only track a percentage of sessions
    if (enableSampling && Math.random() > this.config.samplingRate) {
      console.log('📊 [ProductionMonitor] Session not sampled, monitoring disabled');
      this.isEnabled = false;
      return { enabled: false, reason: 'not_sampled' };
    }

    this.isEnabled = true;
    this.sessionMetrics.sessionId = sessionId;
    this.sessionMetrics.startTime = Date.now();
    this.sessionMetrics.userId = userId;

    console.log(`📊 [ProductionMonitor] Initialized for session ${sessionId}`);
    console.log(`   User: ${userId}`);
    console.log(`   Sampling: ${this.config.samplingRate * 100}%`);

    // Start automatic reporting
    if (this.config.enableAutoReporting) {
      this.startAutoReporting();
    }

    return { enabled: true, sessionId };
  }

  /**
   * Track a Firestore read
   */
  trackRead(source, screen = null, metadata = {}) {
    if (!this.isEnabled) return;

    this.sessionMetrics.reads.total++;
    
    // By source
    this.sessionMetrics.reads.bySource[source] = 
      (this.sessionMetrics.reads.bySource[source] || 0) + 1;
    
    // By screen
    if (screen) {
      this.sessionMetrics.reads.byScreen[screen] = 
        (this.sessionMetrics.reads.byScreen[screen] || 0) + 1;
    }

    // Timeline
    this.sessionMetrics.reads.timeline.push({
      timestamp: Date.now(),
      source,
      screen,
      metadata
    });

    // Check for alerts
    this.checkAlerts();

    if (__DEV__) {
      console.log(`📊 [ProductionMonitor] Read tracked: ${source} (Total: ${this.sessionMetrics.reads.total})`);
    }
  }

  /**
   * Track cache hit/miss
   */
  trackCacheAccess(hit, key, metadata = {}) {
    if (!this.isEnabled) return;

    if (hit) {
      this.sessionMetrics.cache.hits++;
    } else {
      this.sessionMetrics.cache.misses++;
    }

    const total = this.sessionMetrics.cache.hits + this.sessionMetrics.cache.misses;
    this.sessionMetrics.cache.hitRate = total > 0 
      ? (this.sessionMetrics.cache.hits / total) * 100 
      : 0;

    if (__DEV__) {
      console.log(`📊 [ProductionMonitor] Cache ${hit ? 'HIT' : 'MISS'}: ${key} (Rate: ${this.sessionMetrics.cache.hitRate.toFixed(1)}%)`);
    }
  }

  /**
   * Track screen load time
   */
  trackScreenLoad(screenName, duration) {
    if (!this.isEnabled) return;

    if (!this.sessionMetrics.performance.screenLoadTimes[screenName]) {
      this.sessionMetrics.performance.screenLoadTimes[screenName] = [];
    }

    this.sessionMetrics.performance.screenLoadTimes[screenName].push({
      duration,
      timestamp: Date.now()
    });

    if (__DEV__) {
      console.log(`📊 [ProductionMonitor] Screen load: ${screenName} (${duration}ms)`);
    }
  }

  /**
   * Track boot time
   */
  trackBootTime(duration) {
    if (!this.isEnabled) return;

    this.sessionMetrics.performance.bootTime = duration;
    console.log(`📊 [ProductionMonitor] Boot time: ${duration}ms`);
  }

  /**
   * Check alert conditions and trigger if needed
   */
  checkAlerts() {
    if (!this.config.enableAlerts) return;

    const totalReads = this.sessionMetrics.reads.total;
    
    // Critical threshold (immediate action needed)
    if (totalReads >= this.config.criticalThreshold) {
      this.triggerAlert('CRITICAL', 
        `Read budget critically exceeded: ${totalReads}/${this.config.readBudget}`,
        {
          severity: 'critical',
          reads: totalReads,
          budget: this.config.readBudget,
          bySource: this.sessionMetrics.reads.bySource
        }
      );
    }
    // Warning threshold (approaching limit)
    else if (totalReads >= this.config.warningThreshold) {
      this.triggerAlert('WARNING', 
        `Read budget warning: ${totalReads}/${this.config.readBudget}`,
        {
          severity: 'warning',
          reads: totalReads,
          budget: this.config.readBudget,
          bySource: this.sessionMetrics.reads.bySource
        }
      );
    }
  }

  /**
   * Trigger an alert
   */
  triggerAlert(level, message, data = {}) {
    const alertKey = `${level}_${message}`;
    const lastAlertTime = this.lastAlertTimes[alertKey];

    // Check cooldown
    if (lastAlertTime && Date.now() - lastAlertTime < this.config.alertCooldown) {
      return; // Skip duplicate alert
    }

    const alert = {
      level,
      message,
      data,
      timestamp: Date.now(),
      sessionId: this.sessionMetrics.sessionId,
      userId: this.sessionMetrics.userId
    };

    this.sessionMetrics.alerts.push(alert);
    this.lastAlertTimes[alertKey] = Date.now();

    console.warn(`🚨 [ProductionMonitor] ALERT [${level}]: ${message}`);
    console.warn(`   Data:`, data);

    // Send to analytics/alerting services
    this.sendAlert(alert);
  }

  /**
   * Send alert to external services
   */
  async sendAlert(alert) {
    try {
      // In production, send to:
      // 1. Firebase Analytics
      // 2. Crashlytics
      // 3. Slack/Email notifications
      // 4. Custom analytics endpoint

      if (__DEV__) {
        console.log('📤 [ProductionMonitor] Would send alert in production:', alert);
      } else {
        // Example: Firebase Analytics
        // analytics().logEvent('read_budget_alert', {
        //   level: alert.level,
        //   reads: alert.data.reads,
        //   budget: alert.data.budget,
        //   userId: alert.userId,
        //   sessionId: alert.sessionId
        // });

        // Example: Custom endpoint
        // await fetch('https://your-api.com/alerts', {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify(alert)
        // });
      }
    } catch (error) {
      console.error('❌ [ProductionMonitor] Failed to send alert:', error);
    }
  }

  /**
   * Generate session report
   */
  generateReport() {
    const sessionDuration = Date.now() - this.sessionMetrics.startTime;
    const avgScreenLoadTime = this.calculateAvgScreenLoadTime();

    return {
      session: {
        id: this.sessionMetrics.sessionId,
        userId: this.sessionMetrics.userId,
        startTime: new Date(this.sessionMetrics.startTime).toISOString(),
        duration: sessionDuration
      },
      reads: {
        total: this.sessionMetrics.reads.total,
        budget: this.config.readBudget,
        compliance: this.sessionMetrics.reads.total <= this.config.readBudget,
        byScreen: this.sessionMetrics.reads.byScreen,
        bySource: this.sessionMetrics.reads.bySource,
        timeline: this.sessionMetrics.reads.timeline.slice(-20) // Last 20 reads
      },
      cache: {
        hits: this.sessionMetrics.cache.hits,
        misses: this.sessionMetrics.cache.misses,
        hitRate: this.sessionMetrics.cache.hitRate
      },
      performance: {
        bootTime: this.sessionMetrics.performance.bootTime,
        avgScreenLoadTime,
        screenLoadTimes: this.sessionMetrics.performance.screenLoadTimes
      },
      alerts: this.sessionMetrics.alerts,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Calculate average screen load time
   */
  calculateAvgScreenLoadTime() {
    const allLoadTimes = [];
    
    for (const times of Object.values(this.sessionMetrics.performance.screenLoadTimes)) {
      for (const record of times) {
        allLoadTimes.push(record.duration);
      }
    }

    if (allLoadTimes.length === 0) return 0;

    const sum = allLoadTimes.reduce((acc, t) => acc + t, 0);
    return sum / allLoadTimes.length;
  }

  /**
   * Start automatic reporting
   */
  startAutoReporting() {
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
    }

    this.reportingInterval = setInterval(() => {
      const report = this.generateReport();
      this.sendReport(report);
    }, this.config.reportInterval);

    console.log(`📊 [ProductionMonitor] Auto-reporting started (interval: ${this.config.reportInterval / 1000}s)`);
  }

  /**
   * Stop automatic reporting
   */
  stopAutoReporting() {
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
      this.reportingInterval = null;
      console.log('📊 [ProductionMonitor] Auto-reporting stopped');
    }
  }

  /**
   * Send report to analytics service
   */
  async sendReport(report) {
    try {
      if (__DEV__) {
        console.log('📊 [ProductionMonitor] Session Report:', report);
      } else {
        // In production, send to analytics service
        // Example: Store in Firestore for analysis
        // await setDoc(doc(db, 'sessionMetrics', report.session.id), report);

        // Example: Send to custom analytics endpoint
        // await fetch('https://your-api.com/metrics', {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify(report)
        // });
      }
    } catch (error) {
      console.error('❌ [ProductionMonitor] Failed to send report:', error);
    }
  }

  /**
   * Get current session metrics
   */
  getMetrics() {
    return { ...this.sessionMetrics };
  }

  /**
   * Update configuration
   */
  configure(updates = {}) {
    this.config = { ...this.config, ...updates };
    console.log('📊 [ProductionMonitor] Configuration updated:', updates);
  }

  /**
   * Generate session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Reset monitoring state
   */
  reset() {
    this.stopAutoReporting();
    this.sessionMetrics = {
      sessionId: null,
      startTime: null,
      userId: null,
      reads: {
        total: 0,
        byScreen: {},
        bySource: {},
        timeline: []
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0
      },
      performance: {
        screenLoadTimes: {},
        bootTime: 0
      },
      alerts: []
    };
    this.lastAlertTimes = {};
    this.isEnabled = false;
    console.log('📊 [ProductionMonitor] State reset');
  }

  /**
   * End session and generate final report
   */
  async endSession() {
    if (!this.isEnabled) return null;

    console.log('📊 [ProductionMonitor] Ending session');
    
    // Generate final report
    const finalReport = this.generateReport();
    
    // Send final report
    await this.sendReport(finalReport);
    
    // Stop auto-reporting
    this.stopAutoReporting();
    
    return finalReport;
  }
}

// Export singleton instance
export default new ProductionMonitor();

