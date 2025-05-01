import * as AppleAuth from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import { initializeApp } from 'firebase/app';
import {
    createUserWithEmailAndPassword,
    signOut as firebaseSignOut,
    getAuth,
    GoogleAuthProvider,
    OAuthProvider,
    onAuthStateChanged,
    signInWithCredential,
    signInWithEmailAndPassword,
    User,
    UserCredential
} from 'firebase/auth';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import firebaseConfig from '../config/firebaseConfig';

// Initialize Firebase app & auth once
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

type AuthContextType = {
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<UserCredential>;
  signIn: (email: string, password: string) => Promise<UserCredential>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<any>;
  signInWithApple: () => Promise<UserCredential>;
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
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [request, response, promptGoogleSignIn] = Google.useAuthRequest({
    clientId: '<YOUR_GOOGLE_IOS_CLIENT_ID>',
    iosClientId: '<YOUR_GOOGLE_IOS_CLIENT_ID>',
    expoClientId: '<YOUR_GOOGLE_EXPO_CLIENT_ID>',
    responseType: 'id_token',
    scopes: ['profile', 'email'],
  });

  // Track auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, user => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Handle Google Sign In response
  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      const credential = GoogleAuthProvider.credential(id_token);
      signInWithCredential(auth, credential);
    }
  }, [response]);

  // Email/password
  const signUp = (email: string, password: string) =>
    createUserWithEmailAndPassword(auth, email, password);

  const signIn = (email: string, password: string) =>
    signInWithEmailAndPassword(auth, email, password);

  // Google
  const signInWithGoogle = () => promptGoogleSignIn();

  // Apple
  const signInWithApple = async () => {
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

  // Sign out
  const signOut = () => firebaseSignOut(auth);

  const value: AuthContextType = {
    user,
    loading,
    signUp,
    signIn,
    signOut,
    signInWithGoogle,
    signInWithApple
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
} 