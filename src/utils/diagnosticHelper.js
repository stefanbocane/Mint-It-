/**
 * Diagnostic Helper
 * 
 * Use this in the app console to diagnose card visibility issues
 */

import { collection, doc, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import CacheService from '../services/caching/CacheService';
import { getDoc, getDocs, runTransaction } from '../services/ReadTracking/TrackedFirestore';

export const DiagnosticHelper = {
  /**
   * Check what cards exist in Firestore for a user
   */
  async checkFirestoreCards(userId, groupId) {
    try {
      console.log('🔍 Checking Firestore for cards...');
      console.log(`   User: ${userId}`);
      console.log(`   Group: ${groupId}`);
      
      const cardsRef = collection(db, 'cards');
      const q = query(
        cardsRef,
        where('ownerId', '==', userId),
        where('groupId', '==', groupId)
      );
      
      const snapshot = await getDocs(q);
      const cards = [];
      
      snapshot.forEach(doc => {
        cards.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      console.log(`✅ Found ${cards.length} cards in Firestore:`);
      cards.forEach((card, index) => {
        console.log(`   ${index + 1}. ${card.name} (${card.rarity})`);
        console.log(`      Status: ${card.status || 'undefined'}`);
        console.log(`      inTrade: ${card.inTrade || false}`);
        console.log(`      inAuction: ${card.inAuction || false}`);
      });
      
      return cards;
    } catch (error) {
      console.error('❌ Error checking Firestore:', error);
      return [];
    }
  },
  
  /**
   * Check what's in the cache
   */
  async checkCache(userId, groupId) {
    try {
      console.log('🔍 Checking cache...');
      
      const cacheKeys = [
        `ultra_collection_all_cards_${userId}_${groupId}`,
        `user_cards_${userId}_${groupId}`,
        `shared_user_cards_${userId}_${groupId}`
      ];
      
      for (const key of cacheKeys) {
        const cached = await CacheService.getValue(key);
        if (cached) {
          console.log(`✅ Cache hit: ${key}`);
          console.log(`   Timestamp: ${new Date(cached.timestamp || 0).toLocaleString()}`);
          console.log(`   Age: ${Math.round((Date.now() - (cached.timestamp || 0)) / 1000 / 60)}min`);
          
          const cards = cached.cards || cached.data?.cards || [];
          console.log(`   Cards: ${cards.length}`);
          
          if (cards.length > 0) {
            cards.forEach((card, index) => {
              console.log(`      ${index + 1}. ${card.name || 'Unknown'}`);
            });
          }
        } else {
          console.log(`❌ Cache miss: ${key}`);
        }
      }
    } catch (error) {
      console.error('❌ Error checking cache:', error);
    }
  },
  
  /**
   * Check overview documents
   */
  async checkOverviews(userId, groupId) {
    try {
      console.log('🔍 Checking overview documents...');
      
      // Check cardOverviews
      const cardOverviewRef = doc(db, 'cardOverviews', `${groupId}_${userId}`);
      const cardOverviewSnap = await getDoc(cardOverviewRef);
      
      if (cardOverviewSnap.exists()) {
        const data = cardOverviewSnap.data();
        console.log(`✅ cardOverviews/${groupId}_${userId} exists`);
        console.log(`   Cards: ${data.cards?.length || 0}`);
        console.log(`   Updated: ${data.updatedAt?.toDate?.() || 'unknown'}`);
      } else {
        console.log(`❌ cardOverviews/${groupId}_${userId} does not exist`);
      }
      
      // Check boot payload
      const bootPayloadRef = doc(db, 'initialAppLoad', `${userId}_${groupId}`);
      const bootPayloadSnap = await getDoc(bootPayloadRef);
      
      if (bootPayloadSnap.exists()) {
        const data = bootPayloadSnap.data();
        console.log(`✅ initialAppLoad/${userId}_${groupId} exists`);
        console.log(`   Cards: ${data.cards?.length || 0}`);
        console.log(`   Version: ${data.version || 'unknown'}`);
        console.log(`   Updated: ${data.updatedAt?.toDate?.() || 'unknown'}`);
      } else {
        console.log(`❌ initialAppLoad/${userId}_${groupId} does not exist`);
      }
    } catch (error) {
      console.error('❌ Error checking overviews:', error);
    }
  },
  
  /**
   * Clear all caches
   */
  async clearAllCaches(userId, groupId) {
    try {
      console.log('🧹 Clearing all caches...');
      
      const cacheKeys = [
        `ultra_collection_all_cards_${userId}_${groupId}`,
        `user_cards_${userId}_${groupId}`,
        `shared_user_cards_${userId}_${groupId}`,
        `unified_user_${userId}`,
        `ultra_collection_group_info_${groupId}`,
        `ultra_collection_user_profile_${userId}`
      ];
      
      for (const key of cacheKeys) {
        await CacheService.invalidate(key);
        console.log(`   Cleared: ${key}`);
      }
      
      console.log('✅ All caches cleared. Refresh the app to fetch fresh data.');
    } catch (error) {
      console.error('❌ Error clearing caches:', error);
    }
  },
  
  /**
   * Diagnose coin balance drift
   */
  async diagnoseBalanceDrift(userId, groupId) {
    try {
      console.log(`🔍 Diagnosing balance drift for user ${userId} in group ${groupId}`);

      // Get current balance from user session
      const userRef = doc(db, 'users', userId, 'sessions', 'main');
      const userDoc = await getDoc(userRef);

      if (!userDoc.exists()) {
        console.warn('❌ User session not found');
        return {
          error: 'User session not found',
          currentBalance: 0,
          calculatedBalance: 0,
          drift: 0,
          hasDrift: false
        };
      }

      const userData = userDoc.data();
      const currentBalance = userData.groupBalances?.[groupId] || 0;

      // Fetch transaction history
      const txQuery = query(
        collection(db, 'transactions'),
        where('userId', '==', userId),
        where('groupId', '==', groupId),
        orderBy('timestamp', 'desc')
      );

      const txSnap = await getDocs(txQuery);

      // Calculate expected balance from transactions
      let calculatedBalance = 0;
      const transactions = [];

      txSnap.forEach(doc => {
        const tx = doc.data();
        const amount = tx.amount || 0;
        calculatedBalance += amount;
        transactions.push({
          id: doc.id,
          ...tx,
          timestamp: tx.timestamp?.toDate?.() || new Date()
        });
      });

      const drift = currentBalance - calculatedBalance;
      const hasDrift = Math.abs(drift) > 0.01;

      console.log(`📊 Balance Diagnosis:`);
      console.log(`   Current Balance: ${currentBalance}`);
      console.log(`   Calculated Balance: ${calculatedBalance}`);
      console.log(`   Drift: ${drift}`);
      console.log(`   Has Drift: ${hasDrift ? '❌ YES' : '✅ NO'}`);
      console.log(`   Transactions: ${transactions.length}`);

      return {
        currentBalance,
        calculatedBalance,
        drift,
        hasDrift,
        transactionCount: transactions.length,
        transactions: transactions.slice(0, 10) // Last 10 transactions
      };
    } catch (error) {
      console.error('❌ Error diagnosing balance drift:', error);
      return { error: error.message };
    }
  },

  /**
   * Reconcile user balance to match calculated value
   */
  async reconcileBalance(userId, groupId) {
    try {
      const diagnosis = await this.diagnoseBalanceDrift(userId, groupId);

      if (!diagnosis.hasDrift) {
        console.log('✅ No balance drift detected, no reconciliation needed');
        return {
          fixed: false,
          message: 'No drift detected',
          currentBalance: diagnosis.currentBalance
        };
      }

      console.warn(`⚠️ Balance drift detected: ${diagnosis.drift}`);
      console.log(`🔧 Reconciling balance...`);

      // Fix balance to match calculated value
      const userRef = doc(db, 'users', userId, 'sessions', 'main');
      await updateDoc(userRef, {
        [`groupBalances.${groupId}`]: diagnosis.calculatedBalance,
        lastReconciliation: serverTimestamp(),
        reconciliationReason: 'balance_drift_fix'
      });

      console.log(`✅ Balance reconciled: ${diagnosis.currentBalance} → ${diagnosis.calculatedBalance}`);

      return {
        fixed: true,
        correction: diagnosis.drift,
        oldBalance: diagnosis.currentBalance,
        newBalance: diagnosis.calculatedBalance
      };
    } catch (error) {
      console.error('❌ Error reconciling balance:', error);
      return { error: error.message };
    }
  },

  /**
   * Test transaction conflicts
   */
  async testTransactionConflicts(userId, groupId, iterations = 10) {
    console.log(`🔬 Testing transaction conflicts (${iterations} iterations)...`);

    let attempts = 0;
    let conflicts = 0;
    let successes = 0;

    for (let i = 0; i < iterations; i++) {
      attempts++;
      try {
        await runTransaction(db, async (transaction) => {
          const userRef = doc(db, 'users', userId, 'sessions', 'main');
          const userDoc = await transaction.get(userRef);

          // Simulate some work
          await new Promise(resolve => setTimeout(resolve, 50));

          transaction.update(userRef, {
            [`test_${Date.now()}`]: serverTimestamp()
          });
        });
        successes++;
      } catch (error) {
        if (error.code === 'failed-precondition' || error.message?.includes('transaction')) {
          conflicts++;
        }
      }
    }

    const conflictRate = conflicts / attempts;
    const recommendation = conflicts > 2
      ? 'High contention - implement operation queue'
      : 'Normal conflict rate';

    console.log(`📊 Transaction Conflict Analysis:`);
    console.log(`   Attempts: ${attempts}`);
    console.log(`   Successes: ${successes}`);
    console.log(`   Conflicts: ${conflicts}`);
    console.log(`   Conflict Rate: ${(conflictRate * 100).toFixed(1)}%`);
    console.log(`   Recommendation: ${recommendation}`);

    return {
      attempts,
      successes,
      conflicts,
      conflictRate,
      conflictPercentage: Math.round(conflictRate * 100),
      recommendation
    };
  },

  /**
   * Get performance snapshot
   */
  async getPerformanceSnapshot(userId, groupId) {
    console.log(`📸 Taking performance snapshot...`);

    try {
      const PerformanceMonitor = require('../services/monitoring/PerformanceMonitor').default;
      const balanceDiagnosis = await this.diagnoseBalanceDrift(userId, groupId);
      const perfReport = PerformanceMonitor.getReport();

      const snapshot = {
        timestamp: new Date().toISOString(),
        userId,
        groupId,
        balance: {
          current: balanceDiagnosis.currentBalance,
          calculated: balanceDiagnosis.calculatedBalance,
          hasDrift: balanceDiagnosis.hasDrift,
          drift: balanceDiagnosis.drift
        },
        performance: {
          totalReads: perfReport.totalReads,
          readsPerMinute: perfReport.readsPerMinute,
          sessionDuration: perfReport.sessionDuration
        },
        readsByOperation: perfReport.readsByOperation,
        timings: perfReport.timings,
        errors: perfReport.errors
      };

      console.log(`✅ Performance snapshot captured`);
      return snapshot;
    } catch (error) {
      console.error('❌ Error capturing performance snapshot:', error);
      return { error: error.message };
    }
  },

  /**
   * Full diagnostic report
   */
  async fullDiagnostic(userId, groupId) {
    console.log('='.repeat(60));
    console.log('🔬 FULL DIAGNOSTIC REPORT');
    console.log('='.repeat(60));

    await this.checkFirestoreCards(userId, groupId);
    console.log('\n');
    await this.checkCache(userId, groupId);
    console.log('\n');
    await this.checkOverviews(userId, groupId);
    console.log('\n');
    await this.diagnoseBalanceDrift(userId, groupId);
    console.log('\n');
    await this.getPerformanceSnapshot(userId, groupId);

    console.log('='.repeat(60));
    console.log('💡 Next Steps:');
    console.log('   1. If Firestore has cards but they\'re not showing, clear cache:');
    console.log('      DiagnosticHelper.clearAllCaches(userId, groupId)');
    console.log('   2. If balance has drift, reconcile it:');
    console.log('      DiagnosticHelper.reconcileBalance(userId, groupId)');
    console.log('   3. If overview documents are missing, trigger a card update');
    console.log('   4. Check filter settings in the UI (ALL, AVAILABLE, etc.)');
    console.log('='.repeat(60));
  }
};

// Make it available globally in dev mode
if (__DEV__) {
  global.DiagnosticHelper = DiagnosticHelper;
}

export default DiagnosticHelper;

