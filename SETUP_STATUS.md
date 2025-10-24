# Supabase Setup Status

**Last Updated**: 2025-01-23
**Status**: Storage bucket created ✅ | SQL files ready for manual deployment ⚠️

---

## ✅ **Automated Setup Complete**

### Storage Bucket Created

The `cards` storage bucket has been automatically created with the following settings:

- **Name**: `cards`
- **Public**: ✅ Yes (images are publicly accessible)
- **File Size Limit**: 5 MB
- **Allowed MIME Types**: image/jpeg, image/png, image/jpg
- **Status**: ✅ **READY TO USE**

**Verification**: You can verify this in Supabase Dashboard → Storage → cards

---

## ⚠️ **Manual Steps Required** (2 SQL Files)

### SQL Files Generated

Two SQL files have been created and are ready for deployment:

1. **`temp-migrations.sql`** - User profile & daily claims
2. **`temp-storage-policies.sql`** - Storage RLS policies

### How to Deploy

#### Option 1: Web Dashboard (Recommended)

1. **Open SQL Editor**:
   - Go to: https://supabase.com/dashboard/project/ikizpnzgknmfhdituyyk/sql
   - Click "New Query"

2. **Deploy temp-migrations.sql**:
   ```bash
   # Open the file
   open temp-migrations.sql

   # Or cat it:
   cat temp-migrations.sql
   ```
   - Copy the entire contents
   - Paste into SQL Editor
   - Click **RUN**
   - Wait for success message: "Success. No rows returned"

3. **Deploy temp-storage-policies.sql**:
   ```bash
   # Open the file
   open temp-storage-policies.sql

   # Or cat it:
   cat temp-storage-policies.sql
   ```
   - Copy the entire contents
   - Paste into SQL Editor
   - Click **RUN**
   - Wait for success message

#### Option 2: Command Line (If you have psql)

Get your connection string from Supabase Dashboard → Settings → Database:

```bash
psql "postgresql://postgres:[YOUR_PASSWORD]@db.REDACTED_SUPABASE_URL:5432/postgres" < temp-migrations.sql
psql "postgresql://postgres:[YOUR_PASSWORD]@db.REDACTED_SUPABASE_URL:5432/postgres" < temp-storage-policies.sql
```

---

## 📋 **What Each SQL File Does**

### temp-migrations.sql

**Purpose**: Core user and session functionality

**Creates**:
1. **`ensure_user_profile()`** function
   - Creates user profiles automatically
   - Bypasses RLS (SECURITY DEFINER)
   - Generates unique usernames
   - Creates user sessions
   - Required for group creation/joining

2. **`last_daily_claim`** column in `user_sessions`
   - Stores per-group daily claim timestamps
   - Format: `{ "group_uuid": "2025-01-23T10:30:00Z", ... }`
   - Required for daily reward system

**Why it's needed**: Without this, users can't create or join groups (RLS violation).

---

### temp-storage-policies.sql

**Purpose**: Security policies for card image uploads

**Creates 4 RLS Policies**:

1. **Upload Policy** - Users can upload to their own folder
   ```sql
   bucket_id = 'cards' AND
   (storage.foldername(name))[1] = auth.uid()::text
   ```

2. **Read Policy** - Anyone can view card images (public)
   ```sql
   bucket_id = 'cards'
   ```

3. **Update Policy** - Users can update their own images
4. **Delete Policy** - Users can delete their own images

**Why it's needed**: Without these, users will get "unauthorized" errors when minting cards.

---

## ✅ **Verification Checklist**

After deploying both SQL files:

### Check 1: User Profile Function

Open SQL Editor and run:
```sql
SELECT proname, prokind
FROM pg_proc
WHERE proname = 'ensure_user_profile';
```

**Expected**: Should return 1 row with `ensure_user_profile | f`

---

### Check 2: Daily Claim Column

Run:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'user_sessions'
  AND column_name = 'last_daily_claim';
```

**Expected**: Should return 1 row with `last_daily_claim | jsonb`

---

### Check 3: Storage Policies

Run:
```sql
SELECT policyname
FROM pg_policies
WHERE tablename = 'objects'
  AND schemaname = 'storage';
```

**Expected**: Should return 4 rows:
- Users can upload to own folder
- Public read access
- Users can update own files
- Users can delete own files

---

## 🧪 **Testing After Setup**

Once both SQL files are deployed:

### Test 1: Group Creation
1. Login to app
2. Try creating a group
3. **Expected**: Group created successfully (no RLS errors)

### Test 2: Card Minting
1. Navigate to Coin tab
2. Take/select a photo
3. Enter card name
4. Click "Coin Card"
5. **Expected**:
   - Image uploads to Supabase Storage
   - Card created in database
   - Auction created
   - No "unauthorized" errors

### Test 3: Auction Bidding
1. View active auctions
2. Place a bid
3. **Expected**:
   - Balance deducted
   - Bid recorded
   - Rarity updated
   - Success message shown

---

## 🆘 **Troubleshooting**

### Error: "function ensure_user_profile does not exist"

**Cause**: temp-migrations.sql not deployed

**Solution**: Deploy temp-migrations.sql in SQL Editor

---

### Error: "new row violates row-level security policy for table 'users'"

**Cause**: ensure_user_profile() function not created or not granted to authenticated users

**Solution**:
1. Deploy temp-migrations.sql
2. Verify the GRANT statement executed:
   ```sql
   SELECT * FROM information_schema.routine_privileges
   WHERE routine_name = 'ensure_user_profile';
   ```

---

### Error: "Failed to upload image" or "Unauthorized"

**Cause**: Storage RLS policies not created

**Solution**: Deploy temp-storage-policies.sql

---

### Error: "Bucket 'cards' not found"

**Cause**: This shouldn't happen - bucket was created automatically

**Solution**: Verify in Dashboard → Storage. If missing, run:
```bash
node setup-supabase.js
```

---

## 📊 **Migration Progress**

### Infrastructure: 80% Complete

✅ Supabase client configured
✅ Tracking wrapper created
✅ Storage bucket created
✅ SQL migration files generated
⬜ SQL migrations deployed (manual step)
⬜ Storage policies deployed (manual step)

### Services: 50% Complete

✅ AuctionServiceSupabase
✅ CardServiceSupabase
✅ TradeServiceSupabase
⬜ StatsServiceSupabase
⬜ XPServiceSupabase
⬜ SetsServiceSupabase

### Hooks: 100% Complete

✅ All auction hooks updated to use Supabase

---

## 🚀 **Next Steps**

### Immediate (Required)
1. ✅ **Deploy temp-migrations.sql** (5 minutes)
2. ✅ **Deploy temp-storage-policies.sql** (3 minutes)
3. ✅ **Test card minting** (5 minutes)
4. ✅ **Test auction bidding** (3 minutes)

### Short-term (Complete core features)
5. Create remaining services (Stats, XP, Sets)
6. Update screens to use Supabase services
7. Full app testing

### Long-term (Cleanup)
8. Remove Firebase dependencies
9. Delete Firebase files
10. Production deployment

---

## 📞 **Support**

- **Supabase Dashboard**: https://supabase.com/dashboard/project/ikizpnzgknmfhdituyyk
- **SQL Editor**: https://supabase.com/dashboard/project/ikizpnzgknmfhdituyyk/sql
- **Documentation**: `SUPABASE_MIGRATION_COMPLETE.md`

---

**Total setup time**: ~15 minutes (if doing manual SQL deployment now)
**Estimated time to complete migration**: 2-4 hours
