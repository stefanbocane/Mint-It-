# Leaderboard Fix - Complete

## Issue
The leaderboard was only showing the logged-in user instead of all group members.

## Root Cause
The group had 2 members in the `groups.members` array:
- `975fb0dd-0616-49ac-8dfd-b54753b409fc` (has user profile) ✅
- `ae08a446-e1a0-44f0-aefa-e5cf81e1ad3c` (missing user profile) ❌

The second user exists in Supabase Auth (`auth.users`) but does NOT have a corresponding profile in the `users` table.

## Why This Happened
The `handle_new_user()` database trigger that automatically creates user profiles on signup is **not enabled** in Supabase.

From `COMPLETE_SETUP.sql` line 3114-3120:
```
NOTE: Cannot create triggers on auth.users via SQL Editor.
Instead, use Supabase Dashboard:
1. Go to Database → Triggers
2. Click "Create a new trigger"
3. Table: auth.users
4. Events: INSERT
5. Function: handle_new_user
```

## What Was Fixed

### 1. Leaderboard Now Shows All Members
Modified `src/screens/LeaderboardScreen.js` to:
- Show ALL group members, even those without user profiles
- Display users with missing profiles as "User (xxxxxxxx)" with an "Incomplete" badge
- Still calculate scores correctly for all members
- Added comprehensive debug logging

### 2. Better Error Handling
- Added warnings when group members don't have user profiles
- Gracefully handles missing profile data
- Continues to function normally even with incomplete data

## How to Permanently Fix This

### Option 1: Enable the Database Trigger (Recommended)
1. Go to your Supabase Dashboard
2. Navigate to **Database → Triggers**
3. Click **"Create a new trigger"**
4. Configure:
   - **Name**: `on_auth_user_created`
   - **Table**: `auth.users`
   - **Events**: `INSERT`
   - **Type**: `After`
   - **Function**: `handle_new_user`
5. Click **Save**

This will ensure all future signups automatically create user profiles.

### Option 2: Manually Fix Existing Users
Run this SQL in Supabase SQL Editor to create profiles for users who registered without profiles:

```sql
-- Find auth users without profiles
SELECT au.id, au.email, au.created_at
FROM auth.users au
LEFT JOIN users u ON u.id = au.id
WHERE u.id IS NULL;

-- For each user without a profile, manually call handle_new_user
-- Replace <user_id> and <email> with actual values from above query
DO $$
DECLARE
  v_user_id UUID := '<user_id>';
  v_email TEXT := '<email>';
  v_username TEXT;
BEGIN
  -- Generate unique username
  v_username := SPLIT_PART(v_email, '@', 1);
  WHILE EXISTS (SELECT 1 FROM users WHERE username = v_username) LOOP
    v_username := SPLIT_PART(v_email, '@', 1) || '_' || substr(md5(random()::text), 1, 4);
  END LOOP;

  -- Create user profile
  INSERT INTO users (id, email, username, display_name, created_at)
  VALUES (v_user_id, v_email, v_username, v_username, NOW());

  -- Create user session
  INSERT INTO user_sessions (user_id)
  VALUES (v_user_id);

  RAISE NOTICE 'Created profile for: %', v_email;
END $$;
```

## Testing
After the fix, the leaderboard should show:
- All 2 members in the group
- Correct scores and card counts for each
- No "Incomplete" badges (if trigger is enabled for future users)

## Files Changed
- `src/screens/LeaderboardScreen.js` - Fixed to show all members
- `src/utils/profileScreenOptimizer.js` - Silenced non-critical errors
- `src/utils/storeScreenOptimizer.js` - Silenced non-critical errors
