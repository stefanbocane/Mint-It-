/**
 * AuthContext - Supabase Version
 *
 * Replaces Firebase Auth with Supabase Auth.
 * Maintains same API as original AuthContext for compatibility.
 *
 * Features:
 * - Email/password authentication
 * - Session persistence with AsyncStorage
 * - Auto-login support
 * - User profile creation via database trigger
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  getCurrentUser,
  onAuthStateChange,
  signInWithEmail,
  signOut as supabaseSignOut,
  signUpWithEmail,
  supabase,
} from '../config/supabase';
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
  const [session, setSession] = useState(null);

  // Stable initial user reference
  const stableInitialUser = useMemo(() => initialUser, [initialUser?.id]);

  // Set up auth state listener
  useEffect(() => {
    // If we already have an initialUser, don't set up the auth listener
    if (stableInitialUser) {
      setLoading(false);
      return () => {};
    }

    // Subscribe to auth state changes
    const unsubscribe = onAuthStateChange(async (event, session) => {
      console.log('🔐 Auth state changed:', event, session?.user?.email);

      setSession(session);
      setUser(session?.user || null);
      setLoading(false);

      // Handle user sign-in
      if (event === 'SIGNED_IN' && session?.user) {
        console.log('✅ User authenticated, auto-login successful');

        // Check if user profile exists, create if missing (backwards compatibility)
        try {
          const { data: existingProfile } = await supabase
            .from('users')
            .select('id')
            .eq('id', session.user.id)
            .single();

          if (!existingProfile) {
            console.log('⚠️ User profile missing, creating now...');
            const username = session.user.email?.split('@')[0] || 'user';

            // Create user profile
            await supabase.from('users').insert({
              id: session.user.id,
              email: session.user.email,
              username: username,
              display_name: username,
              gems: 5,
              xp: 0,
              level: 1,
              showcase: [],
              card_borders: ['default'],
              initial_reward_groups: [],
            });

            // Create user session
            await supabase.from('user_sessions').insert({
              user_id: session.user.id,
              group_balances: {},
              group_gems: {},
              total_cards: 0,
              sets_completed: 0,
              notifications_unread: 0,
            });

            console.log('✅ User profile created on sign-in');
          }
        } catch (error) {
          console.error('Error checking/creating user profile:', error);
        }

        // Register for push notifications (non-blocking)
        setTimeout(async () => {
          try {
            await registerForPushNotificationsAsync(session.user.id);
          } catch (error) {
            console.error('Error registering for push notifications:', error);
          }
        }, 1000);
      }

      // Handle user sign-out
      if (event === 'SIGNED_OUT') {
        console.log('🔓 User signed out');
        // Clear any cached data
        setUser(null);
        setSession(null);
      }
    });

    // Check for existing session on mount
    getCurrentUser().then((currentUser) => {
      console.log('🔍 Initial session check:', currentUser?.email || 'No user');
      if (!currentUser) {
        setLoading(false);
      }
      // If user exists, the auth state listener will handle setting user and loading
    });

    return unsubscribe;
  }, [stableInitialUser]);

  // Save credentials for auto-login
  const saveCredentials = async (email, password) => {
    try {
      const credentials = JSON.stringify({ email, password });
      await AsyncStorage.setItem(CREDENTIALS_KEY, credentials);
    } catch (error) {
      console.error('Error saving credentials:', error);
    }
  };

  // Get saved credentials
  const getSavedCredentials = async () => {
    try {
      const credentials = await AsyncStorage.getItem(CREDENTIALS_KEY);
      return credentials ? JSON.parse(credentials) : null;
    } catch (error) {
      console.error('Error getting saved credentials:', error);
      return null;
    }
  };

  // Remove saved credentials
  const removeSavedCredentials = async () => {
    try {
      await AsyncStorage.removeItem(CREDENTIALS_KEY);
    } catch (error) {
      console.error('Error removing saved credentials:', error);
    }
  };

  // Sign up with email and password
  const signUp = async (email, password, userData = {}) => {
    try {
      const { user, session, error } = await signUpWithEmail(email, password, {
        username: userData.username || email.split('@')[0],
        displayName: userData.displayName || email.split('@')[0],
      });

      if (error) {
        throw error;
      }

      // User profile is automatically created by database trigger (handle_new_user)
      console.log('✅ User signed up:', user?.email);

      return user;
    } catch (error) {
      console.error('Sign up error:', error);
      throw error;
    }
  };

  // Sign in with email and password
  const signIn = async (email, password, rememberMe = false, groupId = null) => {
    try {
      const { user, session, error } = await signInWithEmail(email, password);

      if (error) {
        throw error;
      }

      // Save credentials if remember me is checked
      if (rememberMe) {
        await saveCredentials(email, password);
      } else {
        await removeSavedCredentials();
      }

      console.log('✅ User signed in:', user?.email);

      return user;
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  };

  // Sign out
  const logout = async () => {
    try {
      await supabaseSignOut();
      await removeSavedCredentials();

      console.log('✅ User signed out');
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  };

  // Auto-login with saved credentials
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

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      signUp,
      signIn,
      logout,
      autoLogin,
      // Supabase-specific
      supabase,
    }),
    [user, session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
