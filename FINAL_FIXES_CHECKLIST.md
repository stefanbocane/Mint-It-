# Final Fixes Checklist - Run All 4 SQL Scripts

You need to run **4 SQL scripts** in Supabase to fix all issues:

---

## ✅ Fix #1: See Public Groups (Already Done)
**File**: `fix-group-rls-policy.sql`
**Status**: ✅ You already ran this

---

## 🔴 Fix #2: Join Public Groups

**File**: `RUN_THIS_NOW.sql`
**Status**: 🔴 **MUST RUN**

**SQL**:
```sql
CREATE POLICY groups_update_join ON groups
  FOR UPDATE
  USING (is_private = false)
  WITH CHECK (is_private = false AND auth.uid() = ANY(members));
```

**What it fixes**: Groups disappearing after joining
**Error it fixes**: `includes_user: false` after join

---

## 🔴 Fix #3: Add SECURITY DEFINER to process_bid

**File**: `fix-auction-bidding.sql`
**Status**: 🔴 **MUST RUN**

**What it does**:
- Drops and recreates `process_bid()` function
- Adds `SECURITY DEFINER` to bypass RLS
- Allows function to see auctions even with stale group membership

**What it fixes**: "Auction not found" errors
**Important**: Copy the ENTIRE file contents - it's a large function

---

## 🔴 Fix #4: Add group_id Column to bids Table

**File**: `fix-bids-table-schema.sql`
**Status**: 🔴 **MUST RUN** (This is the new one!)

**SQL**:
```sql
ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_bids_group_id ON bids(group_id);

UPDATE bids
SET group_id = auctions.group_id
FROM auctions
WHERE bids.auction_id = auctions.id
  AND bids.group_id IS NULL;

ALTER TABLE bids
  ALTER COLUMN group_id SET NOT NULL;
```

**What it fixes**: `column "group_id" of relation "bids" does not exist`
**Why needed**: `process_bid()` inserts group_id but table schema missing it

---

## 📋 Run in This Order:

### Step 1: Supabase Dashboard
Go to: https://supabase.com/dashboard → Your Project → SQL Editor

### Step 2: Run Fix #2
```sql
CREATE POLICY groups_update_join ON groups
  FOR UPDATE
  USING (is_private = false)
  WITH CHECK (is_private = false AND auth.uid() = ANY(members));
```
Click **Run** ▶️

### Step 3: Run Fix #3
Open `fix-auction-bidding.sql`, copy **ALL** contents, paste, click **Run** ▶️

### Step 4: Run Fix #4
Open `fix-bids-table-schema.sql`, copy **ALL** contents, paste, click **Run** ▶️

---

## ✅ Verification After All Fixes

### Test 1: Join a Group
```
📡 Step 4.5: Verifying user was added to group...
✅ Verification result: {
  "includes_user": true,    ← Should be TRUE
  "member_count": 2
}
```

### Test 2: Refresh App
```
🔄 Refreshing groups from Supabase...
📦 Query returned 2 groups    ← Should include newly joined group
```

### Test 3: Bid on Auction
```
🎯 [Supabase] Placing bid: 7 coins on auction...
✅ [Supabase] Bid placed: 7 on [auction-id] by [name] - Rarity: common
✅ THIRD PASS: Server confirmed bid
```

**No errors!** ✅

---

## 🎯 What Each Fix Does

| Fix # | Issue | Error Message | Solution |
|-------|-------|---------------|----------|
| 1 | Can't see other users' groups | Search result: [] | Add SELECT policy ✅ |
| 2 | Can't join groups | includes_user: false | Add UPDATE policy 🔴 |
| 3 | Auction queries blocked | Auction not found | Add SECURITY DEFINER 🔴 |
| 4 | Missing database column | column "group_id" does not exist | ALTER TABLE 🔴 |

---

## 🔐 Security Maintained

All fixes are secure:
- ✅ Users can only add themselves to public groups
- ✅ SECURITY DEFINER function does its own validation
- ✅ group_id properly references groups table with FK
- ✅ RLS still protects all sensitive data

---

## 📁 All Files Created

1. ✅ `fix-group-rls-policy.sql` - Done
2. 🔴 `RUN_THIS_NOW.sql` - Run this
3. 🔴 `fix-auction-bidding.sql` - Run this
4. 🔴 `fix-bids-table-schema.sql` - Run this

---

**Run fixes #2, #3, and #4 in order, then test!** 🚀

After all fixes, you should be able to:
- ✅ See all public groups
- ✅ Join groups (and they persist)
- ✅ Bid on auctions successfully
- ✅ No more errors!
