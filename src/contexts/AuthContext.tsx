import * as AppleAuth from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import {
    Auth,
    createUserWithEmailAndPassword,
    signOut as firebaseSignOut,
    GoogleAuthProvider,
    OAuthProvider,
    onAuthStateChanged,
    signInWithCredential,
    signInWithEmailAndPassword,
    User,
    UserCredential
} from 'firebase/auth';
import { doc, Firestore, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { auth as firebaseAuth, db as firebaseDb } from '../config/firebase';

const auth = firebaseAuth as Auth;
const db = firebaseDb as Firestore;

// Extended user type to include Firestore data
type ExtendedUser = User & {
  coinBalance?: number;
  lastBoostDate?: Date;
};

type AuthContextType = {
  user: ExtendedUser | null;
  loading: boolean;
  error: string | null;
  signUp: (email: string, password: string) => Promise<UserCredential>;
  signIn: (email: string, password: string) => Promise<UserCredential>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<any>;
  signInWithApple: () => Promise<UserCredential>;
  updateCoinBalance: (amount: number) => Promise<void>;
};

type AuthContextProviderProps = {
  children: ReactNode;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthContextProvider');
  return ctx;
}

export default function AuthContextProvider({ children }: AuthContextProviderProps) {
  const [user, setUser] = useState<ExtendedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [request, response, promptGoogleSignIn] = Google.useAuthRequest({
    clientId: '<YOUR_GOOGLE_IOS_CLIENT_ID>',
    iosClientId: '<YOUR_GOOGLE_IOS_CLIENT_ID>',
    androidClientId: '<YOUR_GOOGLE_ANDROID_CLIENT_ID>',
    responseType: 'id_token',
    scopes: ['profile', 'email'],
  });

  // Function to fetch and merge Firestore user data
  const updateUserWithFirestoreData = async (authUser: User) => {
    try {
      const userRef = doc(db, 'users', authUser.uid);
      const snap = await getDoc(userRef);
      
      if (!snap.exists()) {
        // Create new user document
        const userData = {
          uid: authUser.uid,
          email: authUser.email,
          displayName: authUser.displayName || '',
          coinBalance: 100,
          createdAt: serverTimestamp()
        };
        await setDoc(userRef, userData);
        setUser({ ...authUser, ...userData });
      } else {
        // Merge existing Firestore data with auth user
        setUser({ ...authUser, ...snap.data() });
      }
    } catch (err) {
      console.error('Error updating user data:', err);
      setError(err instanceof Error ? err.message : 'Failed to update user data');
    }
  };

  // Initialize auth state listener
  useEffect(() => {
    let unsubscribe: () => void;

    const initializeAuth = async () => {
      try {
        if (!auth) {
          throw new Error('Firebase Auth is not initialized');
        }

        unsubscribe = onAuthStateChanged(auth, async (u) => {
          console.log('🛠️ onAuthStateChanged fired, user =', u);
          if (u) {
            await updateUserWithFirestoreData(u);
          } else {
            setUser(null);
          }
          setLoading(false);
        });
      } catch (err) {
        console.error('Auth initialization error:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize auth');
        setLoading(false);
      }
    };

    initializeAuth();
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  // Handle Google Sign In response
  useEffect(() => {
    if (response?.type === 'success' && auth) {
      const { id_token } = response.params;
      const credential = GoogleAuthProvider.credential(id_token);
      signInWithCredential(auth, credential).catch(err => {
        console.error('Google sign in error:', err);
        setError(err instanceof Error ? err.message : 'Failed to sign in with Google');
      });
    }
  }, [response]);

  // Function to update coin balance
  const updateCoinBalance = async (amount: number) => {
    if (!user) return;
    
    try {
      const userRef = doc(db, 'users', user.uid);
      const newBalance = (user.coinBalance || 0) + amount;
      
      await updateDoc(userRef, {
        coinBalance: newBalance
      });
      
      setUser((prev: ExtendedUser | null) => prev ? { ...prev, coinBalance: newBalance } : null);
    } catch (err) {
      console.error('Error updating coin balance:', err);
      setError(err instanceof Error ? err.message : 'Failed to update coin balance');
    }
  };

  // Auth methods with error handling
  const signUp = async (email: string, password: string) => {
    if (!auth) throw new Error('Firebase Auth is not initialized');
    return createUserWithEmailAndPassword(auth, email, password);
  };

  const signIn = async (email: string, password: string) => {
    if (!auth) throw new Error('Firebase Auth is not initialized');
    return signInWithEmailAndPassword(auth, email, password);
  };

  const signInWithGoogle = () => {
    if (!auth) throw new Error('Firebase Auth is not initialized');
    return promptGoogleSignIn();
  };

  const signInWithApple = async () => {
    if (!auth) throw new Error('Firebase Auth is not initialized');
    
    const res = await AppleAuth.signInAsync({
      requestedScopes: [AppleAuth.AppleAuthenticationScope.FULL_NAME, AppleAuth.AppleAuthenticationScope.EMAIL],
    });
    
    const { identityToken } = res;
    if (!identityToken) {
      throw new Error('No identity token received from Apple Sign In');
    }
    
    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({ idToken: identityToken });
    return signInWithCredential(auth, credential);
  };

  const signOut = async () => {
    if (!auth) throw new Error('Firebase Auth is not initialized');
    return firebaseSignOut(auth);
  };

  const value: AuthContextType = {
    user,
    loading,
    error,
    signUp,
    signIn,
    signOut,
    signInWithGoogle,
    signInWithApple,
    updateCoinBalance
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
} 