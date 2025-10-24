// Ensure URL polyfill is loaded before any Firebase imports
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import 'react-native-url-polyfill/auto';
// @ts-ignore: RN persistence methods not in default Firebase Auth type declarations
import { Auth, getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth';
import {
    CACHE_SIZE_UNLIMITED,
    doc,
    enableIndexedDbPersistence,
    Firestore, getDoc, getFirestore,
    initializeFirestore,
    serverTimestamp, setDoc, updateDoc
} from 'firebase/firestore';
import { FirebaseStorage, getStorage } from 'firebase/storage';
import { Platform } from 'react-native';
import { retryFirestoreOperation } from '../utils/firebaseErrorHandler';
import firebaseConfig from './firebaseConfig';

// Initialize Firebase
let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

// Initialize Firebase only if it hasn't been initialized
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage)
  });
  
  // Use specialized Firestore initialization for Hermes
  if (Platform.OS !== 'web') {
    db = initializeFirestore(app, {
      cacheSizeBytes: CACHE_SIZE_UNLIMITED,
      experimentalForceLongPolling: true // Remove the conflicting auto-detect option
    });
    // Enable offline persistence with IndexedDB (single line read optimisation)
    enableIndexedDbPersistence(db).catch(err => {
      if (__DEV__) {
        console.log('Firestore persistence error:', err.code);
      }
    });
  } else {
    db = getFirestore(app);
  }
} else {
  app = getApps()[0];
  auth = getAuth(app);
  db = getFirestore(app);
}

const storage: FirebaseStorage = getStorage(app);

/**
 * Guaranteed function to add coins to a user's balance for a specific group
 * This function will ensure the user has the specified amount of coins for the group
 * 
 * @param userId - The ID of the user to add coins to
 * @param groupId - The ID of the group to add coins for
 * @param amount - The amount of coins to ensure (default 100)
 * @returns A promise that resolves to a boolean indicating success
 */
export const guaranteedAddCoins = async (
  userId: string, 
  groupId: string, 
  amount: number = 100
): Promise<boolean> => {
  if (!userId || !groupId) {
    console.error('Invalid userId or groupId provided to guaranteedAddCoins');
    return false;
  }

  console.log(`[COIN DEBUG] guaranteedAddCoins CALLED for user ${userId} in group ${groupId} with amount ${amount}`);
  
  try {
    // Get the user document reference
    const userRef = doc(db, 'users', userId);
    
    // Use retry utility for getting the user document
    const userDoc = await retryFirestoreOperation(() => getDoc(userRef));
    
    // If the user document doesn't exist, create it with initial data
    if (!userDoc.exists()) {
      console.log(`[COIN DEBUG] User document doesn't exist, creating new user with ${amount} coins`);
      
      // Use retry utility for setting the document
      await retryFirestoreOperation(() => 
        setDoc(userRef, {
          uid: userId,
          groupBalances: { [groupId]: amount },
          lastUpdated: serverTimestamp(),
          hasReceivedInitialCoins: true, // Mark as received initial coins
          coinAddedGroups: [groupId]
        })
      );
      
      console.log(`[COIN DEBUG] New user document created with ${amount} coins for group ${groupId}`);
      return true;
    }
    
    // User document exists, get its data
    const userData = userDoc.data();
    console.log(`[COIN DEBUG] User document exists. Current data:`, JSON.stringify({
      coinAddedGroups: userData.coinAddedGroups || [],
      groupBalances: userData.groupBalances || {}
    }));
    
    // Track which groups have had coins added to prevent adding multiple times
    const coinAddedGroups = userData.coinAddedGroups || [];
    const groupBalances = userData.groupBalances || {};
    const currentBalance = groupBalances[groupId] || 0;
    
    console.log(`[COIN DEBUG] Current balance for group ${groupId}: ${currentBalance}`);
    
    // FIXED: Don't check coinAddedGroups for new group creation/join
    // This was preventing coins from being awarded for new groups
    // We only care if the user has coins in this group already
    
    // Don't override balance if the user already has coins for this group (except if it's 0)
    if (currentBalance > 0) {
      console.log(`[COIN DEBUG] User already has ${currentBalance} coins for group ${groupId}, not updating`);
      // Still mark as added to avoid duplicate additions
      await updateDoc(userRef, {
        coinAddedGroups: [...coinAddedGroups, groupId],
        lastUpdated: serverTimestamp()
      });
      return true;
    }
    
    // Initialize or update the group balances
    groupBalances[groupId] = amount;
    
    console.log(`[COIN DEBUG] Setting balance to ${amount} for group ${groupId}`);
    
    // Update the user document with the new balance and tracking data
    await updateDoc(userRef, {
      groupBalances: groupBalances,
      coinAddedGroups: [...coinAddedGroups, groupId],
      lastUpdated: serverTimestamp(),
      coinLastAdded: {
        groupId,
        amount,
        timestamp: serverTimestamp()
      }
    });
    
    console.log(`[COIN DEBUG] SUCCESS: Added ${amount} coins for user ${userId} in group ${groupId}`);
    return true;
  } catch (error) {
    console.error('[COIN DEBUG] Error adding coins:', error);
    
    // Attempt one more time with simplified approach
    try {
      console.log('[COIN DEBUG] Attempting fallback approach with direct field update');
      const userRef = doc(db, 'users', userId);
      
      // Direct update to just set the field without any conditionals
      await updateDoc(userRef, {
        [`groupBalances.${groupId}`]: amount,
        lastEmergencyUpdate: serverTimestamp()
      });
      
      console.log('[COIN DEBUG] Fallback successful, directly set balance');
      return true;
    } catch (fallbackError) {
      console.error('[COIN DEBUG] Fallback failed:', fallbackError);
      return false;
    }
  }
};

export { app, auth, db, storage };
