import {
    collection,
    doc,
    serverTimestamp
} from 'firebase/firestore';
import { db } from '../config/firebase';
// 🚀 TRACKED: Automatic read monitoring
import { getDoc, runTransaction } from '../services/ReadTracking/TrackedFirestore';

// Rate limiting configuration
const RATE_LIMIT = {
  WINDOW_MS: 60000, // 1 minute
  MAX_REQUESTS: 30, // Max requests per window
};

const requestQueue = [];
let lastRequestTime = 0;

// Process queued balance updates with rate limiting
const processQueue = async () => {
  if (requestQueue.length === 0) return;
  
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  const timeToWait = Math.max(0, (RATE_LIMIT.WINDOW_MS / RATE_LIMIT.MAX_REQUESTS) - timeSinceLastRequest);

  if (timeToWait > 0) {
    await new Promise(resolve => setTimeout(resolve, timeToWait));
  }

  const { userId, groupId, amount, metadata, resolve, reject } = requestQueue.shift();
  lastRequestTime = Date.now();

  try {
    const result = await updateBalanceInTransaction(userId, groupId, amount, metadata);
    resolve(result);
  } catch (error) {
    reject(error);
  }

  // Process next item in queue
  if (requestQueue.length > 0) {
    processQueue();
  }
};

// Update user balance with transaction and rate limiting
export const updateBalance = (userId, groupId, amount, metadata = {}) => {
  return new Promise((resolve, reject) => {
    requestQueue.push({ userId, groupId, amount, metadata, resolve, reject });
    
    // Start processing if this is the only item in queue
    if (requestQueue.length === 1) {
      processQueue();
    }
  });
};

// Core transaction to update user balance with validation
const updateBalanceInTransaction = async (userId, groupId, amount, metadata = {}) => {
  if (!userId || !groupId || amount === undefined || amount === null) {
    throw new Error('Invalid parameters for balance update');
  }

  try {
    const result = await runTransaction(db, async (transaction) => {
      // CRITICAL FIX: Use sessions/main path consistently
      const userRef = doc(db, 'users', userId, 'sessions', 'main');
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists()) {
        throw new Error('User session not found');
      }

      const userData = userDoc.data();
      const groupBalances = userData.groupBalances || {};
      const currentBalance = groupBalances[groupId] || 0;
      const newBalance = currentBalance + amount;

      // Validate balance won't go negative
      if (newBalance < 0) {
        throw new Error('Insufficient balance');
      }

      // Prepare transaction data
      const updateData = {
        [`groupBalances.${groupId}`]: newBalance,
        lastUpdated: serverTimestamp(),
        lastOperation: amount >= 0 ? 'add_coins' : 'remove_coins',
        lastOperationAmount: Math.abs(amount),
        lastOperationTimestamp: serverTimestamp(),
      };

      // Update user balance
      transaction.update(userRef, updateData);

      // Record transaction if metadata is provided
      if (Object.keys(metadata).length > 0) {
        const transactionData = {
          userId,
          groupId,
          amount,
          previousBalance: currentBalance,
          newBalance,
          timestamp: serverTimestamp(),
          ...metadata,
        };
        
        const transactionsRef = collection(db, 'transactions');
        transaction.set(doc(transactionsRef), transactionData);
      }

      return { success: true, newBalance };
    });

    return result;
  } catch (error) {
    console.error('Balance update failed:', error);
    throw error;
  }
};

// Get user balance with caching
export const getBalance = async (userId, groupId) => {
  if (!userId || !groupId) return 0;

  try {
    // CRITICAL FIX: Use sessions/main path consistently
    const userRef = doc(db, 'users', userId, 'sessions', 'main');
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) return 0;

    const userData = userDoc.data();
    return userData.groupBalances?.[groupId] || 0;
  } catch (error) {
    console.error('Error getting balance:', error);
    return 0;
  }
};

// Get transaction history
export const getTransactionHistory = async (userId, groupId, limitCount = 20) => {
  if (!userId || !groupId) return [];

  try {
    // Create a reference to the user's document
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      console.log('User document not found');
      return [];
    }
    
    // Get the user's transaction IDs from their document
    const userData = userDoc.data();
    const transactionIds = userData.transactionIds || [];
    
    // If no transactions, return empty array
    if (transactionIds.length === 0) return [];
    
    // Fetch all transactions in batches
    const batchSize = 10;
    const transactions = [];
    
    for (let i = 0; i < transactionIds.length; i += batchSize) {
      const batch = transactionIds.slice(i, i + batchSize);
      const transactionPromises = batch.map(txId => {
        const txRef = doc(db, 'transactions', txId);
        return getDoc(txRef);
      });
      
      const batchResults = await Promise.all(transactionPromises);
      
      // Process batch results
      batchResults.forEach(doc => {
        if (doc.exists()) {
          const data = doc.data();
          // Only include transactions for the current group
          if (data.groupId === groupId) {
            transactions.push({
              id: doc.id,
              ...data
            });
          }
        }
      });
      
      // Stop if we've reached the limit
      if (transactions.length >= limitCount) {
        break;
      }
    }
    
    // Sort by timestamp (newest first) and apply limit
    return transactions
      .sort((a, b) => (b.timestamp?.toDate?.() || 0) - (a.timestamp?.toDate?.() || 0))
      .slice(0, limitCount);
      
  } catch (error) {
    console.error('Error getting transaction history:', error);
    return [];
  }
};
