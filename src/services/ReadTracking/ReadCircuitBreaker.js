/**
 * ReadCircuitBreaker - Prevent Runaway Firestore Reads
 * 
 * PURPOSE: Protect against read explosions and gracefully degrade when budget exceeded
 * PATTERN: Circuit breaker with three states (CLOSED, OPEN, HALF_OPEN)
 * 
 * States:
 * - CLOSED: Normal operation, reads allowed
 * - OPEN: Budget exceeded, reads blocked (serve from cache)
 * - HALF_OPEN: Testing if system recovered
 * 
 * @version 1.0.0
 */

import CacheService from '../caching/CacheService';
import ReadMonitor from './ReadMonitor';

class ReadCircuitBreaker {
  constructor(config = {}) {
    // Configuration
    this.maxReads = config.maxReads || 10;
    this.resetTimeout = config.resetTimeout || 60000; // 1 minute
    this.halfOpenMaxAttempts = config.halfOpenMaxAttempts || 3;
    this.enableStaleCache = config.enableStaleCache !== false;
    
    // State
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.tripTime = null;
    this.halfOpenAttempts = 0;
    this.blockedRequests = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    
    // Reset timer
    this.resetTimer = null;
    
    console.log('⚡ ReadCircuitBreaker initialized', {
      maxReads: this.maxReads,
      resetTimeout: this.resetTimeout
    });
  }
  
  /**
   * Execute a Firestore read with circuit breaker protection
   * 
   * @param {Function} readFn - Function that performs the read
   * @param {string} source - Source identifier for tracking
   * @param {Object} options - Configuration options
   * @returns {Promise<Object>} - Result with data and metadata
   */
  async executeRead(readFn, source, options = {}) {
    const {
      cacheKey = null,
      operation = 'read',
      allowStale = true,
      fallbackValue = null,
      metadata = {}
    } = options;
    
    // Check if circuit should allow request
    const shouldAllow = this.shouldAllowRequest();
    
    if (!shouldAllow) {
      this.blockedRequests++;
      
      console.warn(
        `🚫 Circuit OPEN: Read blocked`,
        { source, operation, state: this.state, blockedTotal: this.blockedRequests }
      );
      
      // Try cache fallback
      if (cacheKey && this.enableStaleCache) {
        const cached = await this.tryCache(cacheKey, allowStale);
        
        if (cached.success) {
          this.cacheHits++;
          console.log(
            `📦 Circuit fallback: Serving ${cached.isStale ? 'stale' : 'valid'} cache`,
            { source, cacheKey }
          );
          
          return {
            data: cached.data,
            fromCache: true,
            isStale: cached.isStale,
            blocked: true,
            circuitState: this.state
          };
        } else {
          this.cacheMisses++;
        }
      }
      
      // No cache available: throw error with fallback value
      const error = new Error('Read budget exceeded. Circuit breaker OPEN.');
      error.circuitState = this.state;
      error.fallbackValue = fallbackValue;
      error.source = source;
      
      if (fallbackValue !== null) {
        console.log(`🔄 Using fallback value for ${source}`);
        return {
          data: fallbackValue,
          fromCache: false,
          isFallback: true,
          blocked: true,
          circuitState: this.state
        };
      }
      
      throw error;
    }
    
    // Circuit allows request - execute read
    try {
      // For HALF_OPEN state, track attempts
      if (this.state === 'HALF_OPEN') {
        this.halfOpenAttempts++;
        console.log(`🔍 Circuit HALF_OPEN: Test attempt ${this.halfOpenAttempts}`);
      }
      
      // Execute the read operation
      const data = await readFn();
      
      // Track read
      ReadMonitor.trackRead(source, operation, {
        ...metadata,
        circuitState: this.state,
        viaBraker: true
      });
      
      // Update circuit state on success
      this.onSuccess();
      
      // Cache the result if key provided
      if (cacheKey) {
        await CacheService.setValue(cacheKey, {
          data,
          timestamp: Date.now()
        }).catch(err => console.warn('Cache write failed:', err));
      }
      
      return {
        data,
        fromCache: false,
        isStale: false,
        blocked: false,
        circuitState: this.state
      };
      
    } catch (error) {
      console.error('❌ Circuit breaker read failed:', {
        source,
        operation,
        error: error.message
      });
      
      // Update circuit state on failure
      this.onFailure();
      
      // Try cache fallback on error
      if (cacheKey && this.enableStaleCache) {
        const cached = await this.tryCache(cacheKey, allowStale);
        
        if (cached.success) {
          this.cacheHits++;
          console.log(
            `📦 Error fallback: Serving ${cached.isStale ? 'stale' : 'valid'} cache`,
            { source, cacheKey }
          );
          
          return {
            data: cached.data,
            fromCache: true,
            isStale: cached.isStale,
            blocked: false,
            circuitState: this.state,
            error: error.message
          };
        }
      }
      
      // No recovery possible
      throw error;
    }
  }
  
  /**
   * Try to get data from cache
   */
  async tryCache(cacheKey, allowStale) {
    try {
      const cached = await CacheService.getValue(cacheKey);
      
      if (!cached) {
        return { success: false };
      }
      
      // Check if cache is still valid
      const age = Date.now() - (cached.timestamp || 0);
      const maxAge = 45 * 60 * 1000; // 45 minutes
      const isStale = age > maxAge;
      
      // Return even if stale when allowStale is true
      if (!isStale || allowStale) {
        return {
          success: true,
          data: cached.data || cached,
          isStale
        };
      }
      
      return { success: false };
      
    } catch (error) {
      console.warn('Cache read failed:', error);
      return { success: false };
    }
  }
  
  /**
   * Check if request should be allowed based on circuit state
   */
  shouldAllowRequest() {
    const currentReads = ReadMonitor.sessionReads;
    const now = Date.now();
    
    switch (this.state) {
      case 'CLOSED':
        // Normal operation - check budget
        if (currentReads >= this.maxReads) {
          this.trip('Budget exceeded');
          return false;
        }
        return true;
        
      case 'OPEN':
        // Circuit open - check if timeout elapsed
        if (this.tripTime && (now - this.tripTime > this.resetTimeout)) {
          this.attemptReset();
          return true; // Allow one test request
        }
        return false;
        
      case 'HALF_OPEN':
        // Testing recovery - allow limited requests
        return this.halfOpenAttempts < this.halfOpenMaxAttempts;
        
      default:
        return true;
    }
  }
  
  /**
   * Trip the circuit breaker
   */
  trip(reason = 'Unknown') {
    if (this.state === 'OPEN') return; // Already tripped
    
    this.state = 'OPEN';
    this.tripTime = Date.now();
    this.blockedRequests = 0;
    this.halfOpenAttempts = 0;
    
    console.error('⚡ CIRCUIT BREAKER TRIPPED', {
      reason,
      reads: ReadMonitor.sessionReads,
      budget: this.maxReads
    });
    
    // Schedule automatic reset attempt
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    
    this.resetTimer = setTimeout(() => {
      this.attemptReset();
    }, this.resetTimeout);
    
    // Emit event for monitoring
    this.emit('trip', {
      reason,
      reads: ReadMonitor.sessionReads,
      timestamp: this.tripTime
    });
  }
  
  /**
   * Attempt to reset circuit breaker
   */
  attemptReset() {
    if (this.state !== 'OPEN') return;
    
    this.state = 'HALF_OPEN';
    this.halfOpenAttempts = 0;
    
    console.log('🔄 Circuit breaker entering HALF_OPEN state (testing recovery)');
  }
  
  /**
   * Handle successful read
   */
  onSuccess() {
    if (this.state === 'HALF_OPEN') {
      // Test successful - close circuit
      this.close('Recovery test successful');
    }
    // If already CLOSED, no action needed
  }
  
  /**
   * Handle failed read
   */
  onFailure() {
    if (this.state === 'HALF_OPEN') {
      // Test failed - reopen circuit
      this.trip('Recovery test failed');
    }
    // If CLOSED, failure doesn't trip circuit (budget does)
  }
  
  /**
   * Close the circuit breaker
   */
  close(reason = 'Manual reset') {
    const wasOpen = this.state !== 'CLOSED';
    
    this.state = 'CLOSED';
    this.tripTime = null;
    this.halfOpenAttempts = 0;
    
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    
    if (wasOpen) {
      console.log('✅ Circuit breaker CLOSED', { reason });
      
      // Emit event for monitoring
      this.emit('close', {
        reason,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Force open circuit (for testing/emergency)
   */
  forceOpen(reason = 'Manual trip') {
    this.trip(reason);
  }
  
  /**
   * Get circuit breaker status
   */
  getStatus() {
    const currentReads = ReadMonitor.sessionReads;
    const remaining = Math.max(0, this.maxReads - currentReads);
    const timeSinceTrip = this.tripTime ? Date.now() - this.tripTime : null;
    
    return {
      state: this.state,
      isOpen: this.state === 'OPEN',
      isHalfOpen: this.state === 'HALF_OPEN',
      isClosed: this.state === 'CLOSED',
      
      budget: {
        max: this.maxReads,
        current: currentReads,
        remaining,
        percentage: (currentReads / this.maxReads) * 100
      },
      
      trip: {
        time: this.tripTime,
        timeSinceTrip,
        resetIn: this.tripTime ? Math.max(0, this.resetTimeout - timeSinceTrip) : null
      },
      
      stats: {
        blockedRequests: this.blockedRequests,
        cacheHits: this.cacheHits,
        cacheMisses: this.cacheMisses,
        halfOpenAttempts: this.halfOpenAttempts
      }
    };
  }
  
  /**
   * Get metrics for monitoring
   */
  getMetrics() {
    return {
      state: this.state,
      blockedRequests: this.blockedRequests,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate: this.cacheHits + this.cacheMisses > 0 
        ? (this.cacheHits / (this.cacheHits + this.cacheMisses) * 100).toFixed(1)
        : '0.0'
    };
  }
  
  /**
   * Reset all state (for testing)
   */
  reset() {
    this.close('Full reset');
    this.blockedRequests = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    
    console.log('🔄 Circuit breaker fully reset');
  }
  
  /**
   * Update configuration
   */
  updateConfig(config = {}) {
    if (config.maxReads !== undefined) this.maxReads = config.maxReads;
    if (config.resetTimeout !== undefined) this.resetTimeout = config.resetTimeout;
    if (config.halfOpenMaxAttempts !== undefined) {
      this.halfOpenMaxAttempts = config.halfOpenMaxAttempts;
    }
    
    console.log('⚙️ Circuit breaker config updated:', config);
  }
  
  /**
   * Event emitter stub (can be enhanced with actual EventEmitter)
   */
  emit(event, data) {
    // TODO: Integrate with actual event system
    console.log(`🔔 Circuit breaker event: ${event}`, data);
  }
}

// Export singleton instance
export default new ReadCircuitBreaker({
  maxReads: 10,
  resetTimeout: 60000,
  halfOpenMaxAttempts: 3,
  enableStaleCache: true
});



