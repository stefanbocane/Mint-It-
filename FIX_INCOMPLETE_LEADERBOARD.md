# Fix: Incomplete Users on Leaderboard

## Problem
Users are showing as "Incomplete" on the leaderboard because their user profiles don't exist in the database.

## Root Cause
The Supabase database trigger `handle_new_user` couldn't be created on the `auth.users` table (Supabase doesn't allow this via SQL). As a result, when users signed up, they got an auth account but no profile in the `users` table.

## Solution Implemented

### 1. App-Side Profile Creation (src/config/supabase.ts)
- Modified `signUpWithEmail()` to create user profile and session immediately after signup
- Profile creation happens in the app code, not via database trigger
- Includes error handling for duplicate profiles (code 23505)

### 2. Backwards Compatibility (src/contexts/AuthContextSupabase.js)
- Modified auth state listener to check for missing profiles on sign-in
- Automatically creates profiles for users who signed up before this fix
- Runs on every sign-in, so existing users will be fixed when they next log in

### 3. One-Time Migration (supabase/13-fix-missing-user-profiles.sql)
- SQL script to immediately fix all existing users with missing profiles
- Creates user profiles and sessions for all auth users without profiles
- Safe to run multiple times (skips existing profiles)

## How to Apply the Fix

### Step 1: Run the Migration (Fix Existing Users)

1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy and paste the contents of `supabase/13-fix-missing-user-profiles.sql`
5. Click **Run**

You should see output like:
```
========================================
Starting migration: Fix Missing User Profiles
========================================
Step 1: Checking for auth users without profiles...
  ✓ Created profile for: user1@example.com (username: user1)
  ✓ Created session for: user1@example.com
  ✓ Created profile for: user2@example.com (username: user2)
  ✓ Created session for: user2@example.com
========================================
✅ Migration complete!
  - User profiles created: 2
  - User sessions created: 2
  - Errors encountered: 0
========================================
```

### Step 2: Deploy the App Changes

The code changes are already made in:
- `src/config/supabase.ts` - Creates profiles on signup
- `src/contexts/AuthContextSupabase.js` - Creates profiles on sign-in if missing

These changes will:
- Ensure all **new signups** get profiles automatically
- Fix **existing users** when they sign in (no action needed from them)

### Step 3: Verify the Fix

1. Check the leaderboard - "Incomplete" badges should be gone
2. Test new user signup:
   ```bash
   # In Supabase SQL Editor:
   SELECT u.id, u.email, u.username, u.display_name
   FROM auth.users au
   LEFT JOIN users u ON u.id = au.id
   WHERE au.email = 'newuser@test.com';
   ```
   Both columns should have data (not NULL)

3. Check console logs when users sign up/in:
   - Should see: `✅ User profile created successfully`
   - Or: `⚠️ User profile already exists, skipping creation`

## What Changed in the Code

### Before
```typescript
// signUpWithEmail just called supabase.auth.signUp()
// Relied on a database trigger that couldn't be created
```

### After
```typescript
// signUpWithEmail now:
1. Creates auth user (supabase.auth.signUp)
2. Creates user profile (INSERT into users table)
3. Creates user session (INSERT into user_sessions table)
```

## Files Modified
- ✅ `src/config/supabase.ts` (lines 81-171)
- ✅ `src/contexts/AuthContextSupabase.js` (lines 47-137)
- ✅ `supabase/13-fix-missing-user-profiles.sql` (new file)

## Testing Checklist

- [ ] Run migration SQL in Supabase Dashboard
- [ ] Refresh leaderboard - verify "Incomplete" is gone
- [ ] Create a new test user account
- [ ] Verify new user appears correctly on leaderboard (with username, not "Incomplete")
- [ ] Have an existing "incomplete" user sign in again
- [ ] Verify their profile is created automatically and leaderboard updates

## Notes

- The `handle_new_user` trigger in `supabase/06-auth-trigger.sql` is **not used** because Supabase doesn't allow triggers on `auth.users` via SQL
- The app-side approach is actually more reliable and gives better error handling
- The migration script is idempotent (safe to run multiple times)
- No data loss - all existing users and their cards are preserved
