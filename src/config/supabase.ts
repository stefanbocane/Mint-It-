/**
 * Supabase Configuration
 *
 * This file initializes the Supabase client for use throughout the app.
 * Replaces Firebase configuration (firebase.ts).
 *
 * Features:
 * - Supabase Auth (email/password)
 * - Postgres database with RLS
 * - Real-time subscriptions
 * - Automatic session persistence with AsyncStorage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

// Supabase project credentials
// Loaded from .env file (EXPO_PUBLIC_ prefix required for Expo)
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://REDACTED_SUPABASE_URL';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Initialize Supabase client
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      // Use AsyncStorage for session persistence (React Native)
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
    // Real-time configuration
    realtime: {
      params: {
        eventsPerSecond: 10, // Rate limit for real-time events
      },
    },
    // Database configuration
    db: {
      schema: 'public',
    },
  }
);

/**
 * Helper function to get current authenticated user
 * @returns Promise<User | null>
 */
export const getCurrentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    console.error('Error getting current user:', error);
    return null;
  }
  return user;
};

/**
 * Helper function to get current session
 * @returns Promise<Session | null>
 */
export const getCurrentSession = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    console.error('Error getting current session:', error);
    return null;
  }
  return session;
};

/**
 * Helper function to sign up with email and password
 * @param email - User email
 * @param password - User password
 * @param userData - Additional user metadata (username, displayName, etc.)
 * @returns Promise<{ user, session, error }>
 */
export const signUpWithEmail = async (
  email: string,
  password: string,
  userData?: {
    username?: string;
    displayName?: string;
  }
) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: userData, // Stored in auth.users.raw_user_meta_data
    },
  });

  if (error) {
    console.error('Sign up error:', error);
    return { user: null, session: null, error };
  }

  if (!data.user) {
    console.error('Sign up succeeded but no user returned');
    return { user: null, session: null, error: new Error('No user returned from signup') };
  }

  // Create user profile in the database
  try {
    const username = userData?.username || email.split('@')[0];
    const displayName = userData?.displayName || username;

    console.log('Creating user profile for:', email);

    // Create user profile
    const { error: profileError } = await supabase
      .from('users')
      .insert({
        id: data.user.id,
        email: email,
        username: username,
        display_name: displayName,
        gems: 5,
        xp: 0,
        level: 1,
        showcase: [],
        card_borders: ['default'],
        initial_reward_groups: [],
      });

    if (profileError) {
      // Check if it's a duplicate key error (profile already exists)
      if (profileError.code === '23505') {
        console.log('⚠️ User profile already exists, skipping creation');
      } else {
        console.error('Error creating user profile:', profileError);
        // Don't fail signup if profile creation fails
      }
    } else {
      console.log('✅ User profile created successfully');
    }

    // Create user session
    const { error: sessionError } = await supabase
      .from('user_sessions')
      .insert({
        user_id: data.user.id,
        group_balances: {},
        group_gems: {},
        total_cards: 0,
        sets_completed: 0,
        notifications_unread: 0,
      });

    if (sessionError) {
      if (sessionError.code === '23505') {
        console.log('⚠️ User session already exists, skipping creation');
      } else {
        console.error('Error creating user session:', sessionError);
      }
    } else {
      console.log('✅ User session created successfully');
    }

  } catch (profileError) {
    console.error('Exception creating user profile:', profileError);
    // Don't fail signup if profile creation fails
  }

  console.log('✅ User signed up:', data.user?.email);
  return { user: data.user, session: data.session, error: null };
};

/**
 * Helper function to sign in with email and password
 * @param email - User email
 * @param password - User password
 * @returns Promise<{ user, session, error }>
 */
export const signInWithEmail = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error('Sign in error:', error);
    return { user: null, session: null, error };
  }

  console.log('✅ User signed in:', data.user?.email);
  return { user: data.user, session: data.session, error: null };
};

/**
 * Helper function to sign out
 * @returns Promise<{ error }>
 */
export const signOut = async () => {
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error('Sign out error:', error);
    return { error };
  }

  console.log('✅ User signed out');
  return { error: null };
};

/**
 * Helper function to reset password
 * @param email - User email
 * @returns Promise<{ error }>
 */
export const resetPassword = async (email: string) => {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${SUPABASE_URL}/auth/v1/callback`,
  });

  if (error) {
    console.error('Password reset error:', error);
    return { error };
  }

  console.log('✅ Password reset email sent to:', email);
  return { error: null };
};

/**
 * Helper function to update user profile
 * @param updates - Profile updates (email, password, data)
 * @returns Promise<{ user, error }>
 */
export const updateUserProfile = async (updates: {
  email?: string;
  password?: string;
  data?: Record<string, any>;
}) => {
  const { data, error } = await supabase.auth.updateUser(updates);

  if (error) {
    console.error('Update profile error:', error);
    return { user: null, error };
  }

  console.log('✅ User profile updated');
  return { user: data.user, error: null };
};

/**
 * Subscribe to auth state changes
 * @param callback - Function to call on auth state change
 * @returns Unsubscribe function
 */
export const onAuthStateChange = (
  callback: (event: string, session: any) => void
) => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);

  return () => {
    subscription.unsubscribe();
  };
};

// Export the Supabase client as default
export default supabase;
