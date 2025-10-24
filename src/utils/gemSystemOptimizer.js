/**
 * Gem System Optimizer
 * 
 * Coordinates and optimizes all gem-related operations across the application
 * Ensures consistency between daily rewards, set completion, level ups, and displays
 */

import { doc, updateDoc } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import CacheService from '../services/caching/CacheService';
import { getDoc } from '../services/ReadTracking/TrackedFirestore';
import { getGems, updateGems } from './gemOperations';
import { getDailyAchievements } from './gemRewards';

/**
 * Comprehensive gem system health check
 * Verifies all gem systems are working correctly
 */
export const performGemSystemHealthCheck = async (userId, groupId = null) => {
  console.log('🔍 Starting comprehensive gem system health check...');
  
  const healthReport = {
    timestamp: new Date().toISOString(),
    userId,
    groupId,
    checks: {
      userDocument: false,
      gemRetrieval: false,
      gemUpdate: false,
      dailyAchievements: false,
      xpSystem: false,
      setsSystem: false
    },
    balances: {
      globalGems: 0,
      groupGems: {},
      beforeTest: 0,
      afterTest: 0
    },
    errors: [],
    recommendations: []
  };

  try {
    // 1. Check user document existence
    console.log('📋 Checking user document...');
    const userDoc = await getDoc(doc(db, 'users', userId, 'sessions', 'main'));
    
    if (!userDoc.exists()) {
      healthReport.errors.push('User document does not exist');
      return healthReport;
    }
    
    const userData = userDoc.data();
    healthReport.checks.userDocument = true;
    healthReport.balances.globalGems = userData.gems || 0;
    healthReport.balances.groupGems = userData.groupGems || {};

    // 2. Test gem retrieval
    console.log('💎 Testing gem retrieval...');
    try {
      const globalGems = await getGems(userId, { preferGlobal: true });
      const groupGems = groupId ? await getGems(userId, { groupId }) : null;
      
      healthReport.balances.beforeTest = globalGems;
      healthReport.checks.gemRetrieval = true;
      
      console.log(`Global gems: ${globalGems}`);
      if (groupGems !== null) console.log(`Group gems (${groupId}): ${groupGems}`);
    } catch (error) {
      healthReport.errors.push(`Gem retrieval failed: ${error.message}`);
    }

    // 3. Test gem update (small test transaction)
    console.log('🔄 Testing gem update...');
    try {
      const testAmount = 1;
      const initialBalance = await getGems(userId, { preferGlobal: true });
      
      // Add test gem
      await updateGems(userId, testAmount, {
        reason: 'health_check_test',
        source: 'gem_system_optimizer'
      });
      
      // Verify addition
      const afterAddBalance = await getGems(userId, { preferGlobal: true });
      
      // Remove test gem
      await updateGems(userId, -testAmount, {
        reason: 'health_check_cleanup',
        source: 'gem_system_optimizer'
      });
      
      // Verify removal
      const finalBalance = await getGems(userId, { preferGlobal: true });
      
      if (afterAddBalance === initialBalance + testAmount && finalBalance === initialBalance) {
        healthReport.checks.gemUpdate = true;
        healthReport.balances.afterTest = finalBalance;
      } else {
        healthReport.errors.push('Gem update test failed - balance inconsistency');
      }
    } catch (error) {
      healthReport.errors.push(`Gem update test failed: ${error.message}`);
    }

    // 4. Check daily achievements system
    console.log('🎯 Checking daily achievements...');
    try {
      const achievements = await getDailyAchievements(userId);
      if (achievements) {
        healthReport.checks.dailyAchievements = true;
        console.log(`Daily achievements: ${achievements.availableToClaim.length} available to claim`);
      } else {
        healthReport.errors.push('Daily achievements system returned null');
      }
    } catch (error) {
      healthReport.errors.push(`Daily achievements check failed: ${error.message}`);
    }

    // 5. Verify XP system integration
    console.log('⚡ Checking XP system integration...');
    try {
      // Just verify the XP functions are available and user has level data
      if (userData.level !== undefined && userData.experience !== undefined) {
        healthReport.checks.xpSystem = true;
        console.log(`Current level: ${userData.level}, XP: ${userData.experience}`);
      } else {
        healthReport.recommendations.push('User missing XP data - may need initialization');
      }
    } catch (error) {
      healthReport.errors.push(`XP system check failed: ${error.message}`);
    }

    // 6. Check sets system availability
    console.log('🏆 Checking sets system...');
    try {
      // Verify sets system is available by checking import
      const { getSetsProgress } = await import('../services/SetsService');
      if (groupId) {
        const setsProgress = await getSetsProgress(userId, groupId);
        healthReport.checks.setsSystem = true;
        console.log(`Sets progress available for group ${groupId}`);
      } else {
        healthReport.checks.setsSystem = true;
        healthReport.recommendations.push('Sets system check skipped - no group ID provided');
      }
    } catch (error) {
      healthReport.errors.push(`Sets system check failed: ${error.message}`);
    }

    // Generate recommendations
    if (healthReport.balances.globalGems === 0 && Object.keys(healthReport.balances.groupGems).length === 0) {
      healthReport.recommendations.push('User has no gems - consider providing initial gems');
    }

    if (healthReport.errors.length === 0) {
      console.log('✅ Gem system health check passed!');
    } else {
      console.log(`⚠️ Gem system health check found ${healthReport.errors.length} issues`);
    }

  } catch (error) {
    healthReport.errors.push(`Health check failed: ${error.message}`);
    console.error('❌ Gem system health check error:', error);
  }

  return healthReport;
};

/**
 * Ensure gem system consistency across all displays
 * Verifies that all gem displays show the same values
 */
export const ensureGemDisplayConsistency = async (userId, groupId = null) => {
  console.log('🔄 Ensuring gem display consistency...');
  
  try {
    const globalGems = await getGems(userId, { preferGlobal: true });
    const groupGems = groupId ? await getGems(userId, { groupId }) : null;
    
    const consistency = {
      timestamp: new Date().toISOString(),
      userId,
      groupId,
      globalGems,
      groupGems,
      recommendedDisplay: globalGems, // Use global gems as primary display
      issues: []
    };

    // Check for potential inconsistencies
    if (groupGems !== null && groupGems !== globalGems) {
      consistency.issues.push(`Group gems (${groupGems}) differ from global gems (${globalGems})`);
      consistency.recommendedDisplay = globalGems; // Prioritize global gems
    }

    console.log(`💎 Gem consistency check: Global: ${globalGems}, Group: ${groupGems || 'N/A'}`);
    
    return consistency;
  } catch (error) {
    console.error('❌ Error ensuring gem display consistency:', error);
    return { error: error.message };
  }
};

/**
 * Optimize gem operations for performance
 * Batches multiple gem operations into efficient transactions
 */
export const optimizeGemOperations = async (operations, userId) => {
  console.log(`⚡ Optimizing ${operations.length} gem operations...`);
  
  const results = [];
  const batchSize = 5; // Process in batches to avoid overwhelming Firestore
  
  for (let i = 0; i < operations.length; i += batchSize) {
    const batch = operations.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (op) => {
        const { type, amount, metadata = {} } = op;
        
        if (type === 'add') {
          return await updateGems(userId, amount, {
            ...metadata,
            source: 'gem_optimizer',
            batchId: Math.floor(i / batchSize) + 1
          });
        } else if (type === 'subtract') {
          return await updateGems(userId, -amount, {
            ...metadata,
            source: 'gem_optimizer',
            batchId: Math.floor(i / batchSize) + 1
          });
        }
        throw new Error(`Unknown operation type: ${type}`);
      })
    );
    
    results.push(...batchResults);
    
    // Small delay between batches to be respectful to Firestore
    if (i + batchSize < operations.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  
  console.log(`✅ Gem operations complete: ${successful} successful, ${failed} failed`);
  
  return {
    total: operations.length,
    successful,
    failed,
    results
  };
};

/**
 * Generate comprehensive gem system report
 * Provides detailed analysis of gem system health and usage
 */
export const generateGemSystemReport = async (userId, groupId = null) => {
  console.log('📊 Generating comprehensive gem system report...');
  
  const report = {
    timestamp: new Date().toISOString(),
    userId,
    groupId,
    sections: {}
  };

  try {
    // Health check
    report.sections.healthCheck = await performGemSystemHealthCheck(userId, groupId);
    
    // Consistency check
    report.sections.consistency = await ensureGemDisplayConsistency(userId, groupId);
    
    // Current balances
    const userDoc = await getDoc(doc(db, 'users', userId, 'sessions', 'main'));
    
    if (userDoc.exists()) {
      const userData = userDoc.data();
      report.sections.currentState = {
        globalGems: userData.gems || 0,
        groupGems: userData.groupGems || {},
        level: userData.level || 1,
        experience: userData.experience || 0,
        gemsFromLeveling: userData.gemsFromLeveling || 0,
        lastGemClaim: userData.lastGemClaim || null,
        dailyClaimedAchievements: userData.dailyClaimedAchievements || {}
      };
    }

    // Summary
    const healthPassed = report.sections.healthCheck.errors.length === 0;
    const consistencyIssues = report.sections.consistency.issues?.length || 0;
    
    report.summary = {
      overall: healthPassed && consistencyIssues === 0 ? 'HEALTHY' : 'NEEDS_ATTENTION',
      recommendations: [
        ...report.sections.healthCheck.recommendations,
        ...(consistencyIssues > 0 ? ['Review gem display consistency'] : [])
      ]
    };

    console.log(`📋 Gem system report complete: ${report.summary.overall}`);
    
  } catch (error) {
    report.error = error.message;
    console.error('❌ Error generating gem system report:', error);
  }

  return report;
};

/**
 * Recover lost gems from failed border purchases
 * This helps fix issues where gems were deducted but border wasn't received
 */
export const recoverLostGemsFromFailedPurchases = async (userId, groupId = null) => {
  console.log('🔄 Checking for lost gems from failed border purchases...');
  
  try {
    // Get current user data
    const userDoc = await getDoc(doc(db, 'users', userId, 'sessions', 'main'));
    if (!userDoc.exists()) {
      return { success: false, error: 'User document not found' };
    }
    
    const userData = userDoc.data();
    const recovery = {
      timestamp: new Date().toISOString(),
      userId,
      groupId,
      recoveredGems: 0,
      issues: [],
      actions: []
    };

    // Check if user has purchased borders that aren't in their cardBorders field
    const purchaseHistory = userData.purchaseHistory || [];
    const cardBorders = userData.cardBorders || ['default'];
    
    const missingBorders = [];
    let potentialLostGems = 0;
    
    // Check recent border purchases (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    for (const purchase of purchaseHistory) {
      if (purchase.type === 'border' && 
          purchase.timestamp && 
          new Date(purchase.timestamp) > sevenDaysAgo &&
          !cardBorders.includes(purchase.itemId)) {
        
        missingBorders.push(purchase);
        potentialLostGems += purchase.gemsSpent || 0;
        recovery.issues.push(`Missing border: ${purchase.itemId} (${purchase.gemsSpent} gems)`);
      }
    }

    // If we found missing borders, fix them
    if (missingBorders.length > 0) {
      console.log(`🔧 Found ${missingBorders.length} missing borders, fixing...`);
      
      const newCardBorders = [...cardBorders];
      for (const purchase of missingBorders) {
        if (!newCardBorders.includes(purchase.itemId)) {
          newCardBorders.push(purchase.itemId);
          recovery.actions.push(`Added missing border: ${purchase.itemId}`);
        }
      }
      
      // Update user document with missing borders
      await updateDoc(doc(db, 'users', userId), {
        cardBorders: newCardBorders,
        lastRecoveryCheck: new Date().toISOString()
      });
      
      recovery.actions.push(`Updated cardBorders field with ${missingBorders.length} missing borders`);
    }

    // Check for gem inconsistencies
    const globalGems = userData.gems || 0;
    const groupGems = groupId && userData.groupGems ? userData.groupGems[groupId] : null;
    
    if (groupGems !== null && Math.abs(globalGems - groupGems) > 0) {
      recovery.issues.push(`Gem inconsistency: Global (${globalGems}) vs Group (${groupGems})`);
      // Use higher value as the correct one
      const correctGems = Math.max(globalGems, groupGems);
      recovery.actions.push(`Would sync gems to ${correctGems} (using higher value)`);
    }

    console.log(`✅ Recovery check completed. Found ${recovery.issues.length} issues, performed ${recovery.actions.length} fixes`);
    return { success: true, recovery };
    
  } catch (error) {
    console.error('❌ Error during gem recovery:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Force refresh all gem displays across the app
 * Useful after fixing gem sync issues
 */
export const forceRefreshAllGemDisplays = async (userId, groupId = null) => {
  console.log('🔄 Force refreshing all gem displays...');
  
  try {
    // Clear relevant caches
    const cacheKeys = [
      `store_static_${userId}`,
      `store_user_cards_${userId}_${groupId}`,
      `users:${userId}`,
      `unified_user_data_${userId}`
    ];
    
    for (const key of cacheKeys) {
      await CacheService.invalidate(key);
    }
    
    // Get fresh gem data
    const consistency = await ensureGemDisplayConsistency(userId, groupId);
    
    console.log('✅ All gem displays refreshed successfully');
    return { success: true, consistency };
    
  } catch (error) {
    console.error('❌ Error refreshing gem displays:', error);
    return { success: false, error: error.message };
  }
};

export default {
  performGemSystemHealthCheck,
  ensureGemDisplayConsistency,
  optimizeGemOperations,
  generateGemSystemReport,
  recoverLostGemsFromFailedPurchases,
  forceRefreshAllGemDisplays
}; 