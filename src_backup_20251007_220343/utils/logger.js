/**
 * Production Logger
 * 
 * Centralized logging utility for production apps
 * Provides different log levels and environment-based configuration
 */

// Log levels
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4
};

// Default configuration
const DEFAULT_CONFIG = {
  level: __DEV__ ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN,
  enableConsole: __DEV__,
  enableRemoteLogging: !__DEV__, // Enable remote logging in production
  maxLogEntries: 1000,
  includeTimestamp: true,
  includeLevel: true
};

class Logger {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logHistory = [];
    this.remoteLogQueue = [];
    this.isRemoteLoggingSetup = false;
  }

  /**
   * Setup remote logging service (e.g., Sentry, LogRocket, etc.)
   */
  setupRemoteLogging() {
    if (this.config.enableRemoteLogging && !this.isRemoteLoggingSetup) {
      try {
        // Initialize remote logging service here
        this.isRemoteLoggingSetup = true;
      } catch (error) {
        // Fallback to console in case of remote logging setup failure
        if (__DEV__) {
          console.warn('Failed to setup remote logging:', error);
        }
      }
    }
  }

  /**
   * Format log message with timestamp and level
   */
  formatMessage(level, message, context = {}) {
    const parts = [];
    
    if (this.config.includeTimestamp) {
      parts.push(new Date().toISOString());
    }
    
    if (this.config.includeLevel) {
      parts.push(`[${level}]`);
    }
    
    if (context.component) {
      parts.push(`[${context.component}]`);
    }
    
    if (context.operation) {
      parts.push(`(${context.operation})`);
    }
    
    parts.push(message);
    
    return parts.join(' ');
  }

  /**
   * Add log entry to history
   */
  addToHistory(level, message, data, context) {
    if (this.logHistory.length >= this.config.maxLogEntries) {
      this.logHistory.shift(); // Remove oldest entry
    }
    
    this.logHistory.push({
      timestamp: Date.now(),
      level,
      message,
      data,
      context
    });
  }

  /**
   * Send log to remote service
   */
  sendToRemote(level, message, data, context) {
    if (!this.config.enableRemoteLogging) return;
    
    const logEntry = {
      timestamp: Date.now(),
      level,
      message,
      data,
      context,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      url: typeof window !== 'undefined' ? window.location?.href : null
    };
    
    // Queue for batch sending
    this.remoteLogQueue.push(logEntry);
    
    // Send immediately for errors
    if (level === 'ERROR') {
      this.flushRemoteLogs();
    }
  }

  /**
   * Flush queued remote logs
   */
  async flushRemoteLogs() {
    if (this.remoteLogQueue.length === 0) return;
    
    const logsToSend = [...this.remoteLogQueue];
    this.remoteLogQueue = [];
    
    try {
      // Send to remote logging service
      // Implementation depends on chosen service (Sentry, LogRocket, etc.)
    } catch (error) {
      // Re-queue on failure
      this.remoteLogQueue.unshift(...logsToSend);
    }
  }

  /**
   * Check if log level should be processed
   */
  shouldLog(level) {
    return LOG_LEVELS[level] >= this.config.level;
  }

  /**
   * Core logging method
   */
  log(level, message, data = null, context = {}) {
    if (!this.shouldLog(level)) return;
    
    const formattedMessage = this.formatMessage(level, message, context);
    
    // Add to history
    this.addToHistory(level, message, data, context);
    
    // Console output (development)
    if (this.config.enableConsole) {
      const logMethod = {
        DEBUG: console.log,
        INFO: console.info,
        WARN: console.warn,
        ERROR: console.error
      }[level] || console.log;
      
      if (data) {
        logMethod(formattedMessage, data);
      } else {
        logMethod(formattedMessage);
      }
    }
    
    // Remote logging (production)
    this.sendToRemote(level, message, data, context);
  }

  /**
   * Debug level logging
   */
  debug(message, data, context) {
    this.log('DEBUG', message, data, context);
  }

  /**
   * Info level logging
   */
  info(message, data, context) {
    this.log('INFO', message, data, context);
  }

  /**
   * Warning level logging
   */
  warn(message, data, context) {
    this.log('WARN', message, data, context);
  }

  /**
   * Error level logging
   */
  error(message, data, context) {
    this.log('ERROR', message, data, context);
  }

  /**
   * Get log history
   */
  getHistory(level = null, limit = 100) {
    let logs = this.logHistory;
    
    if (level) {
      logs = logs.filter(log => log.level === level);
    }
    
    return logs.slice(-limit);
  }

  /**
   * Clear log history
   */
  clearHistory() {
    this.logHistory = [];
  }

  /**
   * Get logger statistics
   */
  getStats() {
    const stats = {
      totalEntries: this.logHistory.length,
      levels: {},
      queuedRemoteLogs: this.remoteLogQueue.length
    };
    
    this.logHistory.forEach(log => {
      stats.levels[log.level] = (stats.levels[log.level] || 0) + 1;
    });
    
    return stats;
  }

  /**
   * Update logger configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }
}

// Create default logger instance
const logger = new Logger();

// Setup remote logging
logger.setupRemoteLogging();

// Export convenience methods
export const debug = (message, data, context) => logger.debug(message, data, context);
export const info = (message, data, context) => logger.info(message, data, context);
export const warn = (message, data, context) => logger.warn(message, data, context);
export const error = (message, data, context) => logger.error(message, data, context);

// Export logger instance for advanced usage
export default logger;

// Export log levels for configuration
export { LOG_LEVELS };

/**
 * Legacy console.log replacement
 * Use this for quick migration from console.log statements
 */
export const log = (...args) => {
  if (args.length === 1 && typeof args[0] === 'string') {
    logger.info(args[0]);
  } else if (args.length === 2) {
    logger.info(args[0], args[1]);
  } else {
    logger.info('Log message', args);
  }
}; 