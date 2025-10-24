/**
 * Tracked Supabase Wrapper
 *
 * PURPOSE: Intercept and track ALL Supabase query operations
 * GOAL: Ensure 100% query visibility for accurate optimization
 *
 * This wrapper automatically tracks every Supabase query
 * without requiring manual ReadMonitor.trackRead() calls everywhere.
 *
 * USAGE:
 * Replace:
 *   import { supabase } from '../config/supabase';
 * With:
 *   import { supabase } from '../services/ReadTracking/SupabaseTracked';
 *
 * @version 1.0.0
 */

import { supabase as originalSupabase } from '../../config/supabase';
import ReadMonitor from './ReadMonitor';

/**
 * Extract source information from stack trace
 */
function getCallerInfo() {
  try {
    const stack = new Error().stack;
    if (!stack) return 'unknown';

    const lines = stack.split('\n');

    // Skip SupabaseTracked, node_modules, and internal frames
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes('SupabaseTracked') ||
          line.includes('node_modules') ||
          line.includes('InternalBytecode') ||
          line.includes('native code') ||
          line.includes('tryCallTwo') ||
          line.includes('tryCallOne') ||
          line.includes('address at')) {
        continue;
      }

      let match = line.match(/at\s+(?:async\s+)?([^\s(]+)\s+\(([^)]+):(\d+):(\d+)\)/);
      if (match) {
        const funcName = match[1];
        const fullPath = match[2];
        const fileName = fullPath.split('/').pop() || fullPath;
        return `${fileName}:${funcName}`;
      }

      match = line.match(/at\s+([^:\s]+):(\d+):(\d+)/);
      if (match) {
        const fullPath = match[1];
        const fileName = fullPath.split('/').pop() || fullPath;
        return fileName;
      }

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
 * Proxy handler for Supabase query builder
 * Tracks all query executions
 */
const createQueryProxy = (target, source, tableName, queryType = 'select') => {
  return new Proxy(target, {
    get(obj, prop) {
      const value = obj[prop];

      // If it's a function, wrap it
      if (typeof value === 'function') {
        return function(...args) {
          const result = value.apply(obj, args);

          // If result is a query builder, wrap it recursively
          if (result && typeof result === 'object' && result.then) {
            // This is a Promise (final query execution)
            if (__DEV__) {
              console.log(`📖 [SupabaseTracked] ${queryType}: ${tableName} from ${source}`);
            }

            ReadMonitor.trackRead(source, queryType, {
              table: tableName,
              type: 'supabase_query'
            });

            return result;
          }

          // Return wrapped query builder for chaining
          return createQueryProxy(result, source, tableName, queryType);
        };
      }

      return value;
    }
  });
};

/**
 * Create wrapped Supabase client with tracking
 */
const createTrackedSupabase = () => {
  return new Proxy(originalSupabase, {
    get(target, prop) {
      const value = target[prop];

      // Wrap 'from' method to track table queries
      if (prop === 'from') {
        return function(tableName) {
          const source = getCallerInfo();
          const queryBuilder = value.call(target, tableName);
          return createQueryProxy(queryBuilder, source, tableName, 'select');
        };
      }

      // Wrap 'rpc' method to track function calls
      if (prop === 'rpc') {
        return async function(functionName, params) {
          const source = getCallerInfo();

          if (__DEV__) {
            console.log(`🔧 [SupabaseTracked] rpc: ${functionName} from ${source}`);
          }

          ReadMonitor.trackRead(source, 'rpc', {
            function: functionName,
            type: 'postgres_function'
          });

          return value.call(target, functionName, params);
        };
      }

      // Pass through everything else
      return value;
    }
  });
};

/**
 * Tracked Supabase client
 */
export const supabase = createTrackedSupabase();

/**
 * Export auth helpers (pass-through)
 */
export {
  getCurrentUser,
  getCurrentSession,
  signUpWithEmail,
  signInWithEmail,
  signOut,
  resetPassword,
  updateUserProfile,
  onAuthStateChange
} from '../../config/supabase';

export default supabase;
