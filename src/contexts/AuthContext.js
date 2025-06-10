import AsyncStorage from '@react-native-async-storage/async-storage';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../config/firebase';
import CacheService from '../services/caching/CacheService';
import { registerForPushNotificationsAsync } from '../services/notifications';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

const CREDENTIALS_KEY = '@auth_credentials';

export const AuthContextProvider = ({ children, initialUser = null }) => {
  const [user, setUser] = useState(initialUser);
  const [loading, setLoading] = useState(initialUser ? false : true);

  // FIXED: Prevent infinite loops by stabilizing the initialUser reference
  const stableInitialUser = React.useMemo(() => initialUser, [initialUser?.uid]);

  // OPTIMIZATION: Cache maintenance moved to UnifiedBootstrapService
  // No longer needed here as it's handled in the unified bootstrap process

  // Only set up the auth state listener if we don't have an initialUser
  useEffect(() => {
    // If we already have an initialUser, don't set up the auth listener
    if (stableInitialUser) {
      setLoading(false);
      return () => {};
    }

    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        // STEP 3.F.1: Use enhanced cache-aside pattern for current user profile
        const userData = await CacheService.getUserProfileCacheAside(
          user.uid, 
          () => getDoc(doc(db, 'users', user.uid))
        );
        
        if (!userData) {
          // Create new user document if it doesn't exist
          await setDoc(doc(db, 'users', user.uid), {
            email: user.email,
            username: user.email.split('@')[0],
            coinBalance: 1000, // Initial balance
            gems: 5, // Initial gems
            groupBalances: {}, // Initialize empty group balances object
            createdAt: new Date(),
            lastOperation: 'create',
            lastOperationTimestamp: new Date(),
          });
        }
        
        // Register for push notifications (moved to background)
        setTimeout(async () => {
          try {
            await registerForPushNotificationsAsync(user.uid);
          } catch (error) {
            console.error('Error registering for push notifications:', error);
          }
        }, 1000); // 1 second delay to not block auth
        
        setUser(user);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [stableInitialUser]); // FIXED: Use stable reference to prevent loops

  const saveCredentials = async (email, password) => {
    try {
      const credentials = JSON.stringify({ email, password });
      await AsyncStorage.setItem(CREDENTIALS_KEY, credentials);
    } catch (error) {
      console.error('Error saving credentials:', error);
    }
  };

  const getSavedCredentials = async () => {
    try {
      const credentials = await AsyncStorage.getItem(CREDENTIALS_KEY);
      return credentials ? JSON.parse(credentials) : null;
    } catch (error) {
      console.error('Error getting saved credentials:', error);
      return null;
    }
  };

  const removeSavedCredentials = async () => {
    try {
      await AsyncStorage.removeItem(CREDENTIALS_KEY);
    } catch (error) {
      console.error('Error removing saved credentials:', error);
    }
  };

  const signUp = async (email, password) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      return userCredential.user;
    } catch (error) {
      throw error;
    }
  };

  const signIn = async (email, password, rememberMe = false, groupId = null) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      if (rememberMe) {
        await saveCredentials(email, password);
      } else {
        await removeSavedCredentials();
      }
      
      // OPTIMIZATION: Preloading moved to UnifiedBootstrapService in App.js
      // No longer needed here as it's handled in the unified bootstrap process
      
      return userCredential.user;
    } catch (error) {
      throw error;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      await removeSavedCredentials();
      // OPTIMIZATION: Cache maintenance moved to background
      setTimeout(() => {
        UnifiedBootstrapService.performCacheMaintenance().catch(console.error);
      }, 100);
    } catch (error) {
      throw error;
    }
  };

  const autoLogin = async (groupId = null) => {
    try {
      const credentials = await getSavedCredentials();
      if (credentials) {
        await signIn(credentials.email, credentials.password, true, groupId);
      }
    } catch (error) {
      console.error('Auto login error:', error);
    }
  };

  // FIXED: Memoize context value to prevent infinite re-renders
  const value = React.useMemo(() => ({
    user,
    loading,
    signUp,
    signIn,
    logout,
    autoLogin,
  }), [user, loading]); // Only depend on user and loading state

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}; 