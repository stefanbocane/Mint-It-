import { doc, getDoc, runTransaction, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';
import { updateCache } from './cacheUtils';
import { getCachedDoc } from './firestoreUtils';

/**
 * Optimized function to update user balance with transaction
 */
export const updateUserBalance = async (userId, groupId, amount) => {
  if (!userId || !groupId || !amount) return false;
  
  try {
    await runTransaction(db, async (transaction) => {
      const userRef = doc(db, 'users', userId);
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists()) {
        throw new Error('User not found');
      }
      
      const userData = userDoc.data();
      const groupBalances = userData.groupBalances || {};
      const currentBalance = groupBalances[groupId] || 0;
      
      transaction.update(userRef, {
        groupBalances: {
          ...groupBalances,
          [groupId]: currentBalance + amount
        },
        lastOperation: amount > 0 ? 'add_coins' : 'remove_coins',
        lastOperationTimestamp: new Date().toISOString()
      });
    });
    
    return true;
  } catch (error) {
    console.error('Error updating user balance:', error);
    return false;
  }
};

/**
 * Batch update multiple documents with caching
 */
export const batchUpdateWithCache = async (updates) => {
  if (!updates || updates.length === 0) return;
  
  try {
    const batch = writeBatch(db);
    const cacheUpdates = [];
    
    updates.forEach(({ collection, id, data }) => {
      const docRef = doc(db, collection, id);
      batch.update(docRef, data);
      
      // Prepare cache updates
      cacheUpdates.push({
        key: `${collection}/${id}`,
        data: { id, ...data }
      });
    });
    
    await batch.commit();
    
    // Update cache after successful batch write
    await Promise.all(
      cacheUpdates.map(({ key, data }) => updateCache(key, data))
    );
    
    return true;
  } catch (error) {
    console.error('Error in batch update:', error);
    return false;
  }
};

/**
 * Get document with fallback to cache
 */
export const getDocWithFallback = async (collection, id, options = {}) => {
  try {
    // Try to get from cache first
    const cachedDoc = await getCachedDoc(collection, id, options);
    if (cachedDoc) return cachedDoc;
    
    // Fallback to direct Firestore read
    const docRef = doc(db, collection, id);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = { id: docSnap.id, ...docSnap.data() };
      // Update cache for future reads
      await updateCache(`${collection}/${id}`, data);
      return data;
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting document ${collection}/${id}:`, error);
    return null;
  }
}; 