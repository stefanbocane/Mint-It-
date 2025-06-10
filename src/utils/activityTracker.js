/**
 * User Activity Tracker
 * 
 * Tracks user interactions across the app to optimize database reads
 * and listener frequencies based on actual user engagement.
 */

let lastInteraction = Date.now();
let activityLevel = 'medium'; // 'low', 'medium', 'high'
let interactionCount = 0;
let sessionStart = Date.now();

// Activity thresholds
const ACTIVITY_THRESHOLDS = {
  HIGH_INTERACTION_WINDOW: 30 * 1000,    // 30 seconds
  MEDIUM_INTERACTION_WINDOW: 2 * 60 * 1000, // 2 minutes
  HIGH_INTERACTION_COUNT: 10,             // 10 interactions in window
  MEDIUM_INTERACTION_COUNT: 3             // 3 interactions in window
};

/**
 * Track a user interaction
 */
export const trackInteraction = (type = 'general') => {
  const now = Date.now();
  lastInteraction = now;
  interactionCount++;
  
  // Update activity level based on recent interactions
  updateActivityLevel();
  
  console.log(`👆 User interaction: ${type} (activity: ${activityLevel})`);
  
  return activityLevel;
};

/**
 * Update activity level based on recent interactions
 */
const updateActivityLevel = () => {
  const now = Date.now();
  const timeSinceLastInteraction = now - lastInteraction;
  const sessionDuration = now - sessionStart;
  
  // Recent interaction patterns
  if (timeSinceLastInteraction < ACTIVITY_THRESHOLDS.HIGH_INTERACTION_WINDOW) {
    if (interactionCount >= ACTIVITY_THRESHOLDS.HIGH_INTERACTION_COUNT) {
      activityLevel = 'high';
    } else if (interactionCount >= ACTIVITY_THRESHOLDS.MEDIUM_INTERACTION_COUNT) {
      activityLevel = 'medium';
    } else {
      activityLevel = 'low';
    }
  } else if (timeSinceLastInteraction < ACTIVITY_THRESHOLDS.MEDIUM_INTERACTION_WINDOW) {
    activityLevel = 'medium';
  } else {
    activityLevel = 'low';
  }
  
  // Reset interaction count periodically
  if (sessionDuration > 60 * 1000) { // Reset every minute
    interactionCount = Math.max(0, interactionCount - 1);
    sessionStart = now;
  }
};

/**
 * Get current activity level
 */
export const getActivityLevel = () => {
  updateActivityLevel();
  return activityLevel;
};

/**
 * Get activity metrics
 */
export const getActivityMetrics = () => {
  return {
    activityLevel,
    lastInteraction,
    interactionCount,
    timeSinceLastInteraction: Date.now() - lastInteraction,
    sessionDuration: Date.now() - sessionStart
  };
};

/**
 * Reset activity tracking (useful for app state changes)
 */
export const resetActivity = () => {
  lastInteraction = Date.now();
  interactionCount = 0;
  sessionStart = Date.now();
  activityLevel = 'medium';
};

/**
 * Create touch handlers for components that want to track activity
 */
export const createActivityHandlers = (customType = 'touch') => ({
  onTouchStart: () => trackInteraction(`${customType}_start`),
  onTouchMove: () => trackInteraction(`${customType}_move`),
  onTouchEnd: () => trackInteraction(`${customType}_end`),
  onScroll: () => trackInteraction(`${customType}_scroll`),
  onPress: () => trackInteraction(`${customType}_press`)
});

export default {
  trackInteraction,
  getActivityLevel,
  getActivityMetrics,
  resetActivity,
  createActivityHandlers
}; 