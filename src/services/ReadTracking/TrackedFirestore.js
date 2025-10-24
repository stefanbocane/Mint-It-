/**
 * Tracked Firestore Wrapper
 * 
 * PURPOSE: Intercept and track ALL Firestore read operations
 * GOAL: Ensure 100% read visibility for accurate optimization
 * 
 * This wrapper automatically tracks every getDoc() and getDocs() call
 * without requiring manual ReadMonitor.trackRead() calls everywhere.
 * 
 * USAGE:
 * Replace:
 *   import { getDoc, getDocs } from 'firebase/firestore';
 * With:
 *   import { getDoc, getDocs } from '../services/ReadTracking/TrackedFirestore';
 * 
 * @version 1.0.0
 */

import {
  getDoc as firestoreGetDoc,
  getDocs as firestoreGetDocs,
  runTransaction as firestoreRunTransaction
} from 'firebase/firestore';
import ReadMonitor from './ReadMonitor';

/**
 * Extract source information from stack trace
 * Enhanced version that handles React Native stack traces better
 */
function getCallerInfo() {
  try {
    const stack = new Error().stack;
    if (!stack) return 'unknown';
    
    const lines = stack.split('\n');
    
    // Skip TrackedFirestore, node_modules, and internal frames
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Skip if it's our wrapper or internals
      if (line.includes('TrackedFirestore') ||
          line.includes('node_modules') ||
          line.includes('InternalBytecode') ||
          line.includes('native code') ||
          line.includes('tryCallTwo') ||
          line.includes('tryCallOne') ||
          line.includes('address at')) {
        continue;
      }
      
      // Try to extract meaningful file info
      // Pattern 1: "at functionName (path/to/file.js:123:45)"
      let match = line.match(/at\s+(?:async\s+)?([^\s(]+)\s+\(([^)]+):(\d+):(\d+)\)/);
      if (match) {
        const funcName = match[1];
        const fullPath = match[2];
        const fileName = fullPath.split('/').pop() || fullPath;
        return `${fileName}:${funcName}`;
      }
      
      // Pattern 2: "at path/to/file.js:123:45"
      match = line.match(/at\s+([^:\s]+):(\d+):(\d+)/);
      if (match) {
        const fullPath = match[1];
        const fileName = fullPath.split('/').pop() || fullPath;
        return fileName;
      }
      
      // Pattern 3: Just filename with extension
      match = line.match(/([a-zA-Z0-9_-]+\.(?:js|ts|tsx|jsx))/);
      if (match) {
        return match[1];
      }
    }
    
    return 'unknown';
  } catch (err) {
    if (__DEV__) {
      console.warn('Failed to get caller info:', err);
    }
    return 'unknown';
  }
}

/**
 * Tracked version of getDoc()
 * Automatically tracks single document reads
 */
export async function getDoc(reference) {
  const source = getCallerInfo();
  const collectionPath = reference.path || 'unknown';
  
  if (__DEV__) {
    console.log(`📖 [TrackedFirestore] getDoc: ${collectionPath} from ${source}`);
  }
  
  // Track the read BEFORE executing (for accurate counting)
  ReadMonitor.trackRead(source, 'getDoc', {
    path: collectionPath,
    type: 'single_document'
  });
  
  // Execute the actual read
  const result = await firestoreGetDoc(reference);
  
  if (__DEV__ && !result.exists()) {
    console.log(`   ⚠️ Document does not exist: ${collectionPath}`);
  }
  
  return result;
}

/**
 * Tracked version of getDocs()
 * Automatically tracks collection/query reads
 */
export async function getDocs(query) {
  const source = getCallerInfo();
  
  // Try to extract query info
  let queryInfo = 'collection_query';
  try {
    if (query._query) {
      const path = query._query.path?.segments?.join('/') || 'unknown';
      queryInfo = path;
    }
  } catch {
    queryInfo = 'unknown_query';
  }
  
  if (__DEV__) {
    console.log(`📖 [TrackedFirestore] getDocs: ${queryInfo} from ${source}`);
  }
  
  // Track the read BEFORE executing
  ReadMonitor.trackRead(source, 'getDocs', {
    query: queryInfo,
    type: 'collection_query'
  });
  
  // Execute the actual read
  const result = await firestoreGetDocs(query);
  
  if (__DEV__) {
    console.log(`   📊 Retrieved ${result.size} documents`);
  }
  
  return result;
}

/**
 * Tracked version of onSnapshot()
 * 
 * 🚫 DISABLED: Real-time listeners cause 80+ reads per session
 * All listeners are now blocked to achieve <20 reads per session
 * 
 * Apps should use pull-based updates with manual refresh instead
 */
export function onSnapshot(reference, ...args) {
  const source = getCallerInfo();
  let path = 'unknown';
  
  // Extract path from reference
  try {
    if (reference.path) {
      path = reference.path;
    } else if (reference._query?.path?.segments) {
      path = reference._query.path.segments.join('/');
    }
  } catch (err) {
    // Ignore path extraction errors
  }
  
  // 🚫 BLOCK ALL LISTENERS - Return no-op unsubscribe function
  if (__DEV__) {
    console.warn(`🚫 [TrackedFirestore] onSnapshot BLOCKED: ${path} from ${source}`);
    console.warn(`   Real-time listeners are disabled to reduce reads. Use manual refresh instead.`);
  }
  
  // Return a no-op unsubscribe function
  return () => {
    if (__DEV__) {
      console.log(`🚫 [TrackedFirestore] No-op unsubscribe called for: ${path}`);
    }
  };
  
  /* ORIGINAL CODE - DISABLED TO ELIMINATE 80+ LISTENER READS
  
  // Track initial listener setup read
  ReadMonitor.trackRead(source, 'onSnapshot_setup', {
    path,
    type: 'realtime_listener_initial'
  });
  
  // Wrap callback to track snapshot updates
  const [observerOrOnNext, onError, onCompletion] = args;
  
  let wrappedCallback;
  if (typeof observerOrOnNext === 'function') {
    // Simple callback function
    wrappedCallback = (snapshot) => {
      const docCount = snapshot.size !== undefined ? snapshot.size : 1;
      
      if (__DEV__) {
        console.log(`🔴 [TrackedFirestore] onSnapshot UPDATE: ${path} (${docCount} docs) from ${source}`);
      }
      
      // Track each snapshot update
      ReadMonitor.trackRead(source, 'onSnapshot_update', {
        path,
        type: 'realtime_listener_update',
        docCount
      });
      
      observerOrOnNext(snapshot);
    };
  } else if (observerOrOnNext && typeof observerOrOnNext.next === 'function') {
    // Observer object with next/error/complete
    wrappedCallback = {
      next: (snapshot) => {
        const docCount = snapshot.size !== undefined ? snapshot.size : 1;
        
        if (__DEV__) {
          console.log(`🔴 [TrackedFirestore] onSnapshot UPDATE: ${path} (${docCount} docs) from ${source}`);
        }
        
        ReadMonitor.trackRead(source, 'onSnapshot_update', {
          path,
          type: 'realtime_listener_update',
          docCount
        });
        
        observerOrOnNext.next(snapshot);
      },
      error: observerOrOnNext.error,
      complete: observerOrOnNext.complete
    };
  } else {
    // Fallback - just pass through
    wrappedCallback = observerOrOnNext;
  }
  
  // Execute the actual listener setup with wrapped callback
  return firestoreOnSnapshot(reference, wrappedCallback, onError, onCompletion);
  */
}

/**
 * Tracked version of runTransaction()
 * Transactions perform reads (transaction.get) which count against quota
 * 
 * UPDATED: Now tracks estimated internal reads to match Firebase Console counts
 */
export async function runTransaction(db, updateFunction, options) {
  const source = getCallerInfo();
  
  if (__DEV__) {
    console.log(`🔄 [TrackedFirestore] runTransaction from ${source}`);
  }
  
  // Track the transaction initiation
  ReadMonitor.trackRead(source, 'runTransaction_start', {
    type: 'transaction',
    note: 'Transaction initiated (will perform 2-3 internal reads)'
  });
  
  try {
    // Execute the actual transaction
    const result = await firestoreRunTransaction(db, updateFunction, options);
    
    // Track estimated internal reads (Firebase performs these automatically)
    // Transactions typically perform 2 reads: 1 for initial state + 1 for verification
    ReadMonitor.trackRead(source, 'runTransaction_internal_reads', {
      type: 'transaction_internals',
      estimatedReads: 2,
      note: 'Firebase transaction internal verification reads'
    });
    
    return result;
  } catch (error) {
    // Track retry reads if transaction fails and retries
    ReadMonitor.trackRead(source, 'runTransaction_retry', {
      type: 'transaction_retry',
      estimatedReads: 3,
      note: 'Transaction retry reads (transaction failed and retried)'
    });
    throw error;
  }
}

/**
 * Export all other Firestore functions pass-through (excluding tracked ones)
 * This allows TrackedFirestore to be a drop-in replacement
 */
export {
  addDoc, arrayRemove, arrayUnion,
  // Core Firestore
  collection, deleteDoc, deleteField, doc, documentId, endAt,
  endBefore, FieldValue,
  GeoPoint, increment, limit,
  // Query operations (onSnapshot and runTransaction are now wrapped above)
  orderBy, query,
  // Utilities
  serverTimestamp,
  // Write operations
  setDoc, startAfter,
  startAt,
  // Types
  Timestamp, updateDoc, where, writeBatch
} from 'firebase/firestore';

// Export our tracked versions (already exported above via function declarations)
// getDoc, getDocs, onSnapshot, and runTransaction are exported via function declarations above

export default {
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction
};
