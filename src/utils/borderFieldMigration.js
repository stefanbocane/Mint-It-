/**
 * Border Field Migration Utility
 * 
 * This utility helps fix the field naming inconsistency between 'borders' and 'cardBorders'
 * that was causing users to purchase multiple borders instead of just one.
 * 
 * The issue: Purchase function was updating 'borders' field, but validation was checking 'cardBorders'
 * The fix: Ensure both fields are kept in sync and properly migrated
 */

import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Migrate user border data to fix field naming inconsistency
 * @param {string} userId - The user's ID
 * @returns {Object} - Migration result with details
 */
export const migrateBorderFields = async (userId) => {
  console.log(`🔧 Starting border field migration for user: ${userId}`);
  
  try {
    // Get current user document
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      return {
        success: false,
        error: 'User document not found',
        changes: []
      };
    }
    
    const userData = userDoc.data();
    const migration = {
      success: true,
      changes: [],
      fixedInconsistencies: false,
      addedMissingBorders: false
    };
    
    // Get both border fields
    const legacyBorders = userData.borders || [];
    const currentBorders = userData.cardBorders || [];
    
    // Merge and deduplicate borders from both fields
    const allUniqueBorders = [...new Set([
      ...legacyBorders,
      ...currentBorders,
      'default' // Ensure default is always included
    ])];
    
    // Check if there are inconsistencies
    const hasInconsistency = (
      JSON.stringify([...legacyBorders].sort()) !== JSON.stringify([...currentBorders].sort()) ||
      allUniqueBorders.length !== currentBorders.length
    );
    
    if (hasInconsistency) {
      console.log(`🔍 Found border field inconsistency:`, {
        legacyBorders,
        currentBorders,
        mergedBorders: allUniqueBorders
      });
      
      // Update both fields with the merged data
      const updateData = {
        borders: allUniqueBorders,
        cardBorders: allUniqueBorders,
        borderFieldsMigrated: true,
        lastBorderMigration: new Date().toISOString()
      };
      
      await updateDoc(userRef, updateData);
      
      migration.fixedInconsistencies = true;
      migration.changes.push(`Merged ${legacyBorders.length} legacy borders with ${currentBorders.length} current borders`);
      migration.changes.push(`Final border count: ${allUniqueBorders.length}`);
      migration.changes.push(`Added borders: ${allUniqueBorders.filter(b => !currentBorders.includes(b)).join(', ') || 'none'}`);
      
      console.log(`✅ Successfully migrated border fields for user ${userId}`);
    } else {
      migration.changes.push('No field inconsistencies found');
      console.log(`✅ No border field migration needed for user ${userId}`);
    }
    
    return migration;
    
  } catch (error) {
    console.error(`❌ Error during border field migration for user ${userId}:`, error);
    return {
      success: false,
      error: error.message,
      changes: []
    };
  }
};

/**
 * Check if user needs border field migration
 * @param {Object} userData - User data object
 * @returns {boolean} - Whether migration is needed
 */
export const needsBorderFieldMigration = (userData) => {
  if (!userData) return false;
  
  // Skip if already migrated
  if (userData.borderFieldsMigrated) return false;
  
  const legacyBorders = userData.borders || [];
  const currentBorders = userData.cardBorders || [];
  
  // Check if fields are inconsistent
  return JSON.stringify([...legacyBorders].sort()) !== JSON.stringify([...currentBorders].sort());
};

/**
 * Batch migrate multiple users (for admin use)
 * @param {Array} userIds - Array of user IDs to migrate
 * @returns {Object} - Batch migration results
 */
export const batchMigrateBorderFields = async (userIds) => {
  console.log(`🔧 Starting batch border field migration for ${userIds.length} users`);
  
  const results = {
    total: userIds.length,
    successful: 0,
    failed: 0,
    errors: [],
    details: []
  };
  
  for (const userId of userIds) {
    try {
      const migrationResult = await migrateBorderFields(userId);
      
      if (migrationResult.success) {
        results.successful++;
        if (migrationResult.fixedInconsistencies) {
          results.details.push({
            userId,
            status: 'migrated',
            changes: migrationResult.changes
          });
        } else {
          results.details.push({
            userId,
            status: 'no_changes_needed'
          });
        }
      } else {
        results.failed++;
        results.errors.push({
          userId,
          error: migrationResult.error
        });
      }
      
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      results.failed++;
      results.errors.push({
        userId,
        error: error.message
      });
    }
  }
  
  console.log(`✅ Batch migration completed: ${results.successful} successful, ${results.failed} failed`);
  return results;
};

/**
 * Validate border data consistency for a user
 * @param {string} userId - The user's ID
 * @returns {Object} - Validation result
 */
export const validateBorderDataConsistency = async (userId) => {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      return {
        valid: false,
        issues: ['User document not found']
      };
    }
    
    const userData = userDoc.data();
    const validation = {
      valid: true,
      issues: [],
      info: {}
    };
    
    const legacyBorders = userData.borders || [];
    const currentBorders = userData.cardBorders || [];
    
    validation.info = {
      legacyBorders,
      currentBorders,
      migrated: userData.borderFieldsMigrated || false,
      lastMigration: userData.lastBorderMigration || 'never'
    };
    
    // Check field consistency
    if (JSON.stringify([...legacyBorders].sort()) !== JSON.stringify([...currentBorders].sort())) {
      validation.valid = false;
      validation.issues.push('Border fields are inconsistent between borders and cardBorders');
    }
    
    // Check for default border
    if (!currentBorders.includes('default')) {
      validation.valid = false;
      validation.issues.push('Missing default border in cardBorders field');
    }
    
    // Check for empty arrays
    if (currentBorders.length === 0) {
      validation.valid = false;
      validation.issues.push('cardBorders field is empty');
    }
    
    return validation;
    
  } catch (error) {
    return {
      valid: false,
      issues: [`Validation error: ${error.message}`]
    };
  }
}; 