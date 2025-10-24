# Supabase Database Setup Instructions

## ✅ Fixed Issues

All SQL errors have been resolved:
1. ✅ Invalid index syntax - FIXED
2. ✅ RLS on materialized views - FIXED (removed)
3. ✅ NOW() in index predicate - FIXED (removed)
4. ✅ GRANT permission errors - FIXED (removed)
5. ✅ Auth trigger permission errors - FIXED (commented out with instructions)

## 📋 Step-by-Step Setup

### Step 1: Run Main SQL File

1. Open Supabase SQL Editor:
   https://supabase.com/dashboard/project/ikizpnzgknmfhdituyyk/sql

2. Copy the entire contents of **`SUPABASE_SETUP.sql`** (3,232 lines)

3. Paste into SQL Editor and click **Run**

4. Wait for completion (should take 10-30 seconds)

5. Check for errors in output. Should see success messages:
   ```
   ✅ Database schema created successfully
   ✅ Core functions created successfully
   ✅ Materialized views created successfully
   ✅ Row Level Security policies applied successfully
   ✅ Performance indexes created successfully
   ✅ Auth triggers configured successfully
   ```

### Step 2: Create Auth Triggers (Manual)

The auth triggers cannot be created via SQL Editor. You have 2 options:

#### Option A: Use Supabase Dashboard (Recommended)

1. Go to: **Database → Triggers**

2. Click **"Create a new trigger"**

3. **First Trigger** (for signup):
   - Name: `on_auth_user_created`
   - Schema: `auth`
   - Table: `users`
   - Events: ✅ **Insert**
   - Type: After
   - Function: `handle_new_user`
   - Click **Confirm**

4. Click **"Create a new trigger"** again

5. **Second Trigger** (for deletion):
   - Name: `on_auth_user_deleted`
   - Schema: `auth`
   - Table: `users`
   - Events: ✅ **Delete**
   - Type: After
   - Function: `handle_user_deletion`
   - Click **Confirm**

#### Option B: Check if Auto-Created

Sometimes Supabase auto-creates these triggers when the functions exist. Check:
- Go to: **Database → Triggers**
- Look for `on_auth_user_created` and `on_auth_user_deleted`
- If they exist, you're done!

### Step 3: Verify Setup

Run the verification script:

```bash
node verify-database-setup.js
```

Expected output:
```
🔍 Verifying Supabase Database Setup...

Checking Tables created... ✅
Checking Functions created... ✅
Checking Materialized views created... ✅
Checking RLS policies enabled... ✅
Checking Indexes created... ✅

📊 Verification Results:
   Passed: 5
   Failed: 0
   Total:  5

✅ Database setup looks good!
```

### Step 4: Run Function Tests

Run the automated test suite:

```bash
node test-supabase-functions.js
```

Expected output:
```
🧪 Running Supabase Function Tests

Testing update_balance()... ✅ PASS
Testing update_gems()... ✅ PASS
Testing process_bid()... ✅ PASS
Testing award_xp()... ✅ PASS
Testing get_bootstrap_payload()... ✅ PASS

📊 Test Results:
   Passed: 5
   Failed: 0
   Total:  5

✅ All tests passed!
```

### Step 5: Enable Realtime (Optional for now)

If you want realtime updates:

1. In Supabase SQL Editor, run: **`supabase/07-enable-realtime.sql`**

2. Verify in Dashboard: **Database → Replication**
   - Should see: auctions, bids, trades, posts, notifications, user_sessions

### Step 6: Run Migration Helpers

When ready to migrate data:

1. In Supabase SQL Editor, run: **`supabase/08-migration-helpers.sql`**

2. This creates helper functions for the migration script

## 🚨 Troubleshooting

### Error: "function does not exist"
- Make sure SUPABASE_SETUP.sql ran completely
- Check SQL Editor output for errors
- Re-run the file

### Error: "permission denied"
- Make sure you're using the **Service Role Key** in `.env.supabase`
- Not the Anon Key

### Error: "could not find the function"
- The function name might be wrong
- Check: Database → Functions in Dashboard
- Verify function exists

### Tests Failing
- Make sure database setup completed successfully
- Make sure `.env.supabase` has correct keys
- Check Supabase project is not paused/inactive

## ✅ Success Checklist

- [ ] SUPABASE_SETUP.sql ran without errors
- [ ] Auth triggers created (via Dashboard or auto-created)
- [ ] `node verify-database-setup.js` passes
- [ ] `node test-supabase-functions.js` passes
- [ ] Ready for data migration!

## 📁 File Reference

- **SUPABASE_SETUP.sql** (3,232 lines) - Main setup file
- **verify-database-setup.js** - Quick verification script
- **test-supabase-functions.js** - Comprehensive function tests
- **supabase/07-enable-realtime.sql** - Enable realtime (optional)
- **supabase/08-migration-helpers.sql** - Migration helpers
- **migrate-firestore-to-postgres.js** - Data migration script (run later)

## 🎯 Next Steps After Setup

Once all tests pass:

1. Review **FINAL_MIGRATION_CHECKLIST.md**
2. Review **DEPLOYMENT_GUIDE.md**
3. Review **ROLLBACK_PLAN.md**
4. Schedule migration date
5. Run data migration
6. Deploy app
7. Celebrate! 🎉
