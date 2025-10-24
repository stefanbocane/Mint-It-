# 🚀 Quick Deployment Guide

**Status**: Ready to deploy SQL files

---

## ✅ What's Done

- ✅ Storage bucket `cards` created
- ✅ SQL migration files generated
- ✅ Supabase services created (Auction, Card, Trade)
- ✅ Hooks updated to use Supabase

---

## ⚡ Deploy Now (5 Minutes)

### Step 1: Open SQL Editor

Click: https://supabase.com/dashboard/project/ikizpnzgknmfhdituyyk/sql

### Step 2: Deploy Migrations

**File 1: temp-migrations.sql**

```bash
cat temp-migrations.sql
```

- Copy all output
- Paste in SQL Editor → Click **RUN**
- Wait for "Success"

**File 2: temp-storage-policies.sql**

```bash
cat temp-storage-policies.sql
```

- Copy all output
- Paste in SQL Editor → Click **RUN**
- Wait for "Success"

---

## ✅ Verify

### Check Function Exists

```sql
SELECT proname FROM pg_proc WHERE proname = 'ensure_user_profile';
```
Should return 1 row.

### Check Storage Policies

```sql
SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';
```
Should return 4 rows.

---

## 🧪 Test the App

1. **Login** to app
2. **Create group** → Should work (no RLS errors)
3. **Mint card** (Coin tab) → Should upload image
4. **View auctions** → Should display with images
5. **Place bid** → Should update balance & rarity

---

## 🆘 If Something Fails

**Error: "function does not exist"**
→ Redeploy temp-migrations.sql

**Error: "unauthorized" (image upload)**
→ Redeploy temp-storage-policies.sql

**Error: "RLS policy violation"**
→ Both SQL files need to be deployed

---

## 📚 Full Documentation

- **Complete Guide**: `SUPABASE_MIGRATION_COMPLETE.md`
- **Setup Status**: `SETUP_STATUS.md`

---

**After deployment**: App should work with Supabase! 🎉
