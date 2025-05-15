import AsyncStorage from '@react-native-async-storage/async-storage';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../config/firebase';
import { registerForPushNotificationsAsync } from '../services/notifications';
import { performCacheMaintenance, preloadUserData } from '../utils/appInitializer';

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

  // Perform cache maintenance on context initialization
  useEffect(() => {
    performCacheMaintenance()
      .then(result => console.log('Initial cache maintenance completed:', result))
      .catch(err => console.error('Error in initial cache maintenance:', err));
  }, []);

  // Only set up the auth state listener if we don't have an initialUser
  useEffect(() => {
    // If we already have an initialUser, don't set up the auth listener
    if (initialUser) {
      setLoading(false);
      return () => {};
    }

    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        // Get user data from Firestore
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (!userDoc.exists()) {
          // Create new user document if it doesn't exist
          await setDoc(doc(db, 'users', user.uid), {
            email: user.email,
            username: user.email.split('@')[0],
            coinBalance: 1000, // Initial balance
            groupBalances: {}, // Initialize empty group balances object
            createdAt: new Date(),
            lastOperation: 'create',
            lastOperationTimestamp: new Date(),
          });
        }
        
        // Register for push notifications
        try {
          await registerForPushNotificationsAsync(user.uid);
        } catch (error) {
          console.error('Error registering for push notifications:', error);
        }
        
        setUser(user);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [initialUser]);

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
      
      // Preload essential user data to improve initial experience
      preloadUserData(userCredential.user.uid, groupId)
        .catch(err => console.error('Error preloading user data:', err));
      
      return userCredential.user;
    } catch (error) {
      throw error;
    }
  };

  const logout = async () => {
    try {
      // Perform maintenance before logout to clean up stale data
      await performCacheMaintenance();
      await signOut(auth);
      await removeSavedCredentials();
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

  const value = {
    user,
    loading,
    signUp,
    signIn,
    logout,
    autoLogin,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}; 