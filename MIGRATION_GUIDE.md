# Firebase → Supabase Migration Guide

## Prerequisites

1. **Firebase Service Account Key**
   - Download from Firebase Console → Project Settings → Service Accounts
   - Save as `service-account-key.json` in project root
   - **DO NOT COMMIT THIS FILE**

2. **Supabase Service Role Key**
   - Already in `.env.supabase` file
   - Required for migration script

3. **Database Setup**
   - Run all SQL scripts in `supabase/` directory (in order)
   - Verify tables, functions, and views created

## Migration Steps

### Step 1: Backup Firebase Data

```bash
# Export Firestore data (optional but recommended)
firebase firestore:export gs://your-bucket/firestore-backup
```

### Step 2: Run Database Setup

```bash
# In Supabase SQL Editor, run in order:
# 1. supabase/00-setup-all.sql (or run individually)
# 2. supabase/07-enable-realtime.sql
# 3. supabase/08-migration-helpers.sql
```

### Step 3: Install Migration Dependencies

```bash
npm install firebase-admin @supabase/supabase-js dotenv
```

### Step 4: Run Migration Script

```bash
# Dry run (recommended first)
# Comment out actual inserts in script, just log what would be migrated

# Full migration
node migrate-firestore-to-postgres.js
```

**Expected Output:**
```
🚀 Starting Firebase → Supabase migration...

📦 Migrating users...
✅ Migrated user: user@example.com
...

📦 Migrating groups...
✅ Migrated group: My Group
...

📦 Migrating cards...
✅ Migrated 100 cards...
✅ Migrated 200 cards...
...

🔄 Refreshing materialized views...

✅ Migration complete!

📊 Migration Statistics:
   Users: 150
   Sessions: 150
   Groups: 25
   Cards: 5000
   Auctions: 50
   Trades: 200
   Posts: 300
   Duration: 45.2s
   Errors: 0
```

### Step 5: Verify Migration

```sql
-- In Supabase SQL Editor
SELECT * FROM verify_migration();
```

**Check:**
- Row counts match Firebase
- No orphaned records
- All relationships intact

### Step 6: Refresh Materialized Views

```sql
SELECT refresh_all_views();
```

### Step 7: Test App with Supabase

```bash
# Start Expo app
npm start

# Test:
# - Login (existing user won't work - need password reset)
# - Signup (new user should work)
# - View auctions
# - Place bids
# - Check balance updates
```

### Step 8: Password Reset for Migrated Users

**Option A: Manual via Supabase Dashboard**
- Users → Select user → Send recovery email

**Option B: Bulk via API** (if many users)
```javascript
// Script to send reset emails to all migrated users
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sendResets() {
  const { data: users } = await supabase.from('users').select('email');

  for (const user of users) {
    await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: 'cardmates://reset-password'
    });
    console.log(`Sent reset to ${user.email}`);
  }
}

sendResets();
```

**Option C: Inform Users**
- Email all users: "We've upgraded to a new backend, please reset your password"
- Add banner in app: "Click here to reset your password"

## Post-Migration Checklist

- [ ] All users migrated
- [ ] All groups migrated
- [ ] All cards migrated with correct ownership
- [ ] All active auctions migrated
- [ ] All trades migrated
- [ ] All posts migrated
- [ ] Materialized views refreshed
- [ ] Row counts verified
- [ ] No orphaned records
- [ ] Password reset emails sent
- [ ] App tested end-to-end
- [ ] Firebase disabled (billing stopped)

## Rollback Plan

If migration fails or issues discovered:

1. **Keep Firebase Running** (don't disable until verified)
2. **Restore Previous Code** (git revert migration commits)
3. **Clear Supabase Data** (if needed)
   ```sql
   TRUNCATE users, user_sessions, groups, cards, auctions, trades, posts CASCADE;
   ```
4. **Re-run Migration** (after fixing issues)

## Common Issues

### Issue: "User session not found" errors

**Cause**: Missing `user_sessions` records

**Fix**:
```sql
-- Create missing sessions for users
INSERT INTO user_sessions (user_id, group_balances, group_gems)
SELECT id, '{}'::jsonb, '{}'::jsonb
FROM users
WHERE NOT EXISTS (
  SELECT 1 FROM user_sessions WHERE user_id = users.id
);
```

### Issue: Orphaned cards (no owner)

**Cause**: User deleted in Firebase but cards remain

**Fix**:
```sql
-- Delete orphaned cards
DELETE FROM cards WHERE owner_id NOT IN (SELECT id FROM users);

-- Or assign to a "deleted" user
UPDATE cards SET owner_id = 'DELETED_USER_ID'
WHERE owner_id NOT IN (SELECT id FROM users);
```

### Issue: Materialized views empty

**Cause**: Views not refreshed after migration

**Fix**:
```sql
SELECT refresh_all_views();
```

### Issue: Migration script hangs

**Cause**: Large dataset, slow network, or rate limits

**Fix**:
- Batch inserts (100 at a time)
- Add delay between batches
- Use Supabase direct Postgres connection instead of REST API

## Performance Tips

- Run migration during low-traffic period
- Use direct Postgres connection for large datasets
- Batch inserts (100-1000 records per transaction)
- Disable triggers temporarily if needed
- Refresh materialized views AFTER all data migrated

## Security Notes

- **Delete `service-account-key.json` after migration**
- **Revoke Firebase service account if no longer needed**
- **Keep Supabase service role key secure**
- **Review RLS policies before going live**

## Support

If issues arise:
1. Check `migration-errors.json` for details
2. Run `verify_migration()` to identify problems
3. Check Supabase logs in dashboard
4. Review this guide's Common Issues section
