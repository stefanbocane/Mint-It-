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
  getDocs as firestoreGetDocs 
} from 'firebase/firestore';
import ReadMonitor from './ReadMonitor';

/**
 * Extract source information from stack trace
 */
function getCallerInfo() {
  try {
    const stack = new Error().stack;
    const lines = stack.split('\n');
    
    // Find the first line that's not in TrackedFirestore or node_modules
    for (let i = 2; i < Math.min(lines.length, 10); i++) {
      const line = lines[i];
      if (!line.includes('TrackedFirestore') && 
          !line.includes('node_modules') &&
          !line.includes('native code')) {
        
        // Extract filename and function
        const match = line.match(/at (\w+).*?([^\/]+\.(js|ts|tsx))/) ||
                     line.match(/([^\/]+\.(js|ts|tsx))/);
        
        if (match) {
          const fileName = match[match.length - 2] || 'unknown';
          const functionName = match[1] || 'anonymous';
          return `${fileName}:${functionName}`;
        }
      }
    }
    
    return 'unknown';
  } catch {
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
 * Export all other Firestore functions pass-through
 * This allows TrackedFirestore to be a drop-in replacement
 */
export * from 'firebase/firestore';

// Override the read functions
export { getDoc, getDocs };

export default {
  getDoc,
  getDocs
};

