# Deploy User Profile Initialization Function

## Problem
When users try to create or join groups, they get an error:
```
"new row violates row-level security policy for table 'users'"
```

This happens because:
1. Users exist in `auth.users` (Supabase Auth) but not in the custom `users` table
2. RLS policies block direct INSERT operations on the `users` table
3. The auth trigger may not be set up in the database

## Solution
Deploy a SQL function with `SECURITY DEFINER` that can bypass RLS to create user profiles.

## Deployment Steps

### Option 1: Supabase Dashboard (Recommended)

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project

2. **Navigate to SQL Editor**
   - Click "SQL Editor" in the left sidebar
   - Click "New query"

3. **Copy and Execute SQL**
   - Open: `supabase/09-user-profile-init.sql`
   - Copy the entire contents
   - Paste into the SQL Editor
   - Click "Run" or press `Cmd/Ctrl + Enter`

4. **Verify Success**
   - You should see: `✅ User profile initialization function created`
   - The function `ensure_user_profile` is now available

### Option 2: Supabase CLI

```bash
# Make sure you're logged in
supabase login

# Link to your project (if not already linked)
supabase link --project-ref YOUR_PROJECT_REF

# Apply the migration
supabase db push supabase/09-user-profile-init.sql
```

### Option 3: Direct psql Connection

```bash
# Get connection string from Supabase Dashboard → Settings → Database
psql "YOUR_CONNECTION_STRING" < supabase/09-user-profile-init.sql
```

## Testing

After deployment, test by:

1. **Login to the app**
2. **Try creating a group**
3. **Check the console logs**:
   - Should see: `🔍 Ensuring user profile exists via RPC...`
   - Should see: `✅ User profile created: [username]` (first time)
   - Should see: `✅ User profile already exists` (subsequent times)
   - Should see: `✅ Group created: [group-id]`

## What This Function Does

The `ensure_user_profile()` function:
- ✅ Checks if user exists in `users` table
- ✅ Creates user profile if missing (with SECURITY DEFINER to bypass RLS)
- ✅ Creates user session record
- ✅ Generates unique username from email
- ✅ Returns success/failure status
- ✅ Is safe to call multiple times (idempotent)

## Troubleshooting

### Function not found error
```
RPC error: function ensure_user_profile does not exist
```
**Solution**: The SQL function hasn't been deployed yet. Follow deployment steps above.

### Still getting RLS error
```
"new row violates row-level security policy"
```
**Possible causes**:
1. Function not deployed (see above)
2. Function name mismatch - verify it's called `ensure_user_profile`
3. GRANT not executed - make sure the entire SQL file ran, including the GRANT statement

**Check function exists**:
```sql
SELECT proname, prokind FROM pg_proc WHERE proname = 'ensure_user_profile';
```

### Permission denied
```
permission denied for function ensure_user_profile
```
**Solution**: The GRANT statement didn't run. Execute manually:
```sql
GRANT EXECUTE ON FUNCTION ensure_user_profile TO authenticated;
```

## Integration

The function is automatically called by `useGroupOperations` hook:
- Before creating a group
- Before joining a group

No additional code changes needed in the app once the SQL function is deployed.
