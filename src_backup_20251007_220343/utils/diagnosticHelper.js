/**
 * Diagnostic Helper
 * 
 * Use this in the app console to diagnose card visibility issues
 */

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import CacheService from '../services/caching/CacheService';

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
    
    console.log('='.repeat(60));
    console.log('💡 Next Steps:');
    console.log('   1. If Firestore has cards but they\'re not showing, clear cache:');
    console.log('      DiagnosticHelper.clearAllCaches(userId, groupId)');
    console.log('   2. If overview documents are missing, trigger a card update');
    console.log('   3. Check filter settings in the UI (ALL, AVAILABLE, etc.)');
    console.log('='.repeat(60));
  }
};

// Make it available globally in dev mode
if (__DEV__) {
  global.DiagnosticHelper = DiagnosticHelper;
}

export default DiagnosticHelper;

