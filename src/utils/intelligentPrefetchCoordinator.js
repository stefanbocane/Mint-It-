/**
 * Intelligent Prefetch Coordinator
 * 
 * Analyzes user navigation patterns and intelligently prefetches data
 * for screens users are likely to visit next, reducing load times
 * and database reads.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import CacheService from '../services/caching/CacheService';
import consolidatedQueryService from './consolidatedQueryService';
import { ReadOptimizationCoordinator } from './readOptimizationCoordinator';

class IntelligentPrefetchCoordinator {
  constructor() {
    this.navigationPatterns = new Map();
    this.prefetchQueue = new Set();
    this.metrics = {
      prefetchHits: 0,
      prefetchMisses: 0,
      savedLoadTime: 0,
      backgroundFetches: 0
    };
    
    // Navigation probability thresholds
    this.PREFETCH_THRESHOLD = 0.4; // 40% probability
    this.HIGH_PRIORITY_THRESHOLD = 0.7; // 70% probability
    
    // Load saved patterns on initialization
    this.loadNavigationPatterns();
  }

  /**
   * Record navigation event and update patterns
   */
  recordNavigation(fromScreen, toScreen, userId, groupId) {
    const patternKey = `${fromScreen}_${toScreen}`;
    const userPatternKey = `${userId}_${patternKey}`;
    
    // Update global patterns
    if (!this.navigationPatterns.has(patternKey)) {
      this.navigationPatterns.set(patternKey, {
        count: 0,
        probability: 0,
        lastUpdate: Date.now(),
        recentOccurrences: []
      });
    }
    
    const pattern = this.navigationPatterns.get(patternKey);
    pattern.count++;
    pattern.lastUpdate = Date.now();
    
    // Track recent occurrences for decay calculation
    const now = Date.now();
    pattern.recentOccurrences.push(now);
    
    // Remove occurrences older than 7 days
    pattern.recentOccurrences = pattern.recentOccurrences.filter(
      time => now - time < 7 * 24 * 60 * 60 * 1000
    );
    
    // Calculate probability based on recent activity
    pattern.probability = this.calculateNavigationProbability(pattern);
    
    // Save patterns periodically
    this.saveNavigationPatterns();
    
    // Trigger prefetch for likely next screens
    this.triggerPrefetchForScreen(toScreen, userId, groupId);
  }

  /**
   * Calculate navigation probability with time decay
   */
  calculateNavigationProbability(pattern) {
    const recentCount = pattern.recentOccurrences.length;
    const timeFactor = Math.min(recentCount / 10, 1); // Max factor of 1 at 10+ occurrences
    
    // Base probability with decay over time
    const daysSinceLastUpdate = (Date.now() - pattern.lastUpdate) / (24 * 60 * 60 * 1000);
    const decayFactor = Math.exp(-daysSinceLastUpdate / 7); // 7-day half-life
    
    return Math.min(timeFactor * decayFactor, 0.95); // Cap at 95%
  }

  /**
   * Trigger prefetch based on current screen and patterns
   */
  async triggerPrefetchForScreen(currentScreen, userId, groupId) {
    if (!userId || !groupId) return;
    
    const prefetchTargets = this.getPrefetchTargets(currentScreen);
    
    for (const target of prefetchTargets) {
      if (target.probability >= this.PREFETCH_THRESHOLD) {
        const priority = target.probability >= this.HIGH_PRIORITY_THRESHOLD ? 'high' : 'normal';
        
        // Queue prefetch to avoid overwhelming the system
        this.queuePrefetch(target.screen, userId, groupId, priority);
      }
    }
  }

  /**
   * Get prefetch targets for a given screen
   */
  getPrefetchTargets(currentScreen) {
    const targets = [];
    
    this.navigationPatterns.forEach((pattern, key) => {
      const [fromScreen, toScreen] = key.split('_');
      
      if (fromScreen === currentScreen && pattern.probability >= this.PREFETCH_THRESHOLD) {
        targets.push({
          screen: toScreen,
          probability: pattern.probability,
          count: pattern.count
        });
      }
    });
    
    // Sort by probability (highest first)
    return targets.sort((a, b) => b.probability - a.probability);
  }

  /**
   * Queue prefetch operation
   */
  async queuePrefetch(screenName, userId, groupId, priority = 'normal') {
    const prefetchKey = `${screenName}_${userId}_${groupId}`;
    
    if (this.prefetchQueue.has(prefetchKey)) {
      return; // Already queued
    }
    
    this.prefetchQueue.add(prefetchKey);
    
    // Execute prefetch based on priority
    const delay = priority === 'high' ? 100 : 1000; // High priority gets faster execution
    
    setTimeout(async () => {
      try {
        await this.executePrefetch(screenName, userId, groupId);
        this.metrics.backgroundFetches++;
      } catch (error) {
        console.error(`Prefetch error for ${screenName}:`, error);
      } finally {
        this.prefetchQueue.delete(prefetchKey);
      }
    }, delay);
  }

  /**
   * Execute specific prefetch operations for different screens
   */
  async executePrefetch(screenName, userId, groupId) {
    const startTime = Date.now();
    
    try {
      switch (screenName) {
        case 'StoreScreen':
          await this.prefetchStoreData(userId, groupId);
          break;
          
        case 'ProfileScreen':
          await this.prefetchProfileData(userId, groupId);
          break;
          
        case 'TradesScreen':
          await this.prefetchTradesData(userId, groupId);
          break;
          
        case 'LeaderboardScreen':
          await this.prefetchLeaderboardData(groupId);
          break;
          
        case 'CollectionScreen':
          await this.prefetchCollectionData(userId, groupId);
          break;
          
        case 'SocialScreen':
          await this.prefetchSocialData(userId, groupId);
          break;
          
        default:
          console.log(`No prefetch strategy for ${screenName}`);
      }
      
      const loadTime = Date.now() - startTime;
      console.log(`Prefetched ${screenName} data in ${loadTime}ms`);
      
    } catch (error) {
      console.error(`Error prefetching ${screenName}:`, error);
    }
  }

  /**
   * Prefetch store screen data
   */
  async prefetchStoreData(userId, groupId) {
    const promises = [
      // User borders and purchase data
      CacheService.getDocument('users', userId, { ttl: 5 * 60 * 1000 }),
      
      // User cards for border application
      consolidatedQueryService.getCardsForUser(userId, groupId, {
        limit: 50,
        ttl: 3 * 60 * 1000
      })
    ];
    
    await Promise.allSettled(promises);
  }

  /**
   * Prefetch profile screen data
   */
  async prefetchProfileData(userId, groupId) {
    const promises = [
      // User profile data
      CacheService.getDocument('users', userId, { ttl: 8 * 60 * 1000 }),
      
      // User cards for showcase
      consolidatedQueryService.getCardsForUser(userId, groupId, {
        sortBy: 'name',
        ttl: 8 * 60 * 1000
      }),
      
      // User stats
      ReadOptimizationCoordinator.getUserStats(userId, groupId, {
        ttl: 5 * 60 * 1000
      })
    ];
    
    await Promise.allSettled(promises);
  }

  /**
   * Prefetch trades screen data
   */
  async prefetchTradesData(userId, groupId) {
    const promises = [
      // User trades with enriched data
      ReadOptimizationCoordinator.getTradesData(userId, groupId, {
        ttl: 90 * 1000
      }),
      
      // Recent trade activity for the group
      consolidatedQueryService.getRecentGroupActivity(groupId, {
        limit: 20,
        ttl: 2 * 60 * 1000
      })
    ];
    
    await Promise.allSettled(promises);
  }

  /**
   * Prefetch leaderboard screen data
   */
  async prefetchLeaderboardData(groupId) {
    const promises = [
      // Leaderboard data with user enrichment
      ReadOptimizationCoordinator.getLeaderboardData(groupId, {
        ttl: 3 * 60 * 1000
      }),
      
      // Group member data
      consolidatedQueryService.getGroupMembers(groupId, {
        ttl: 5 * 60 * 1000
      })
    ];
    
    await Promise.allSettled(promises);
  }

  /**
   * Prefetch collection screen data
   */
  async prefetchCollectionData(userId, groupId) {
    const promises = [
      // User cards with metadata
      consolidatedQueryService.getCardsForUser(userId, groupId, {
        includeMetadata: true,
        ttl: 5 * 60 * 1000
      }),
      
      // Group card statistics
      ReadOptimizationCoordinator.getGroupCardStats(groupId, {
        ttl: 10 * 60 * 1000
      })
    ];
    
    await Promise.allSettled(promises);
  }

  /**
   * Prefetch social screen data
   */
  async prefetchSocialData(userId, groupId) {
    const promises = [
      // User groups
      consolidatedQueryService.getUserGroups(userId, {
        ttl: 5 * 60 * 1000
      }),
      
      // Daily claim status
      CacheService.getDocument('users', userId, { 
        ttl: 60 * 1000 // Short TTL for balance-related data
      }),
      
      // Group activity feed
      consolidatedQueryService.getGroupActivity(groupId, {
        limit: 30,
        ttl: 2 * 60 * 1000
      })
    ];
    
    await Promise.allSettled(promises);
  }

  /**
   * Check if data was prefetched and record hit/miss
   */
  recordPrefetchResult(screenName, userId, groupId, wasHit) {
    if (wasHit) {
      this.metrics.prefetchHits++;
      this.metrics.savedLoadTime += 500; // Estimate 500ms saved per hit
    } else {
      this.metrics.prefetchMisses++;
    }
    
    // Log for debugging
    console.log(`Prefetch ${wasHit ? 'HIT' : 'MISS'} for ${screenName}`);
  }

  /**
   * Get prefetch effectiveness metrics
   */
  getMetrics() {
    const totalPrefetches = this.metrics.prefetchHits + this.metrics.prefetchMisses;
    const hitRate = totalPrefetches > 0 ? this.metrics.prefetchHits / totalPrefetches : 0;
    
    return {
      ...this.metrics,
      hitRate: hitRate,
      totalPrefetches,
      estimatedTimeSaved: this.metrics.savedLoadTime,
      activePatterns: this.navigationPatterns.size
    };
  }

  /**
   * Save navigation patterns to persistent storage
   */
  async saveNavigationPatterns() {
    try {
      const patterns = Object.fromEntries(this.navigationPatterns);
      await AsyncStorage.setItem('navigation_patterns', JSON.stringify(patterns));
    } catch (error) {
      console.error('Error saving navigation patterns:', error);
    }
  }

  /**
   * Load navigation patterns from persistent storage
   */
  async loadNavigationPatterns() {
    try {
      const stored = await AsyncStorage.getItem('navigation_patterns');
      if (stored) {
        const patterns = JSON.parse(stored);
        this.navigationPatterns = new Map(Object.entries(patterns));
        console.log(`Loaded ${this.navigationPatterns.size} navigation patterns`);
      }
    } catch (error) {
      console.error('Error loading navigation patterns:', error);
    }
  }

  /**
   * Clear old navigation patterns (maintenance)
   */
  clearOldPatterns() {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
    
    for (const [key, pattern] of this.navigationPatterns.entries()) {
      if (pattern.lastUpdate < cutoff) {
        this.navigationPatterns.delete(key);
      }
    }
    
    this.saveNavigationPatterns();
  }
}

// Create singleton instance
const intelligentPrefetchCoordinator = new IntelligentPrefetchCoordinator();

export default intelligentPrefetchCoordinator;
export { IntelligentPrefetchCoordinator };
