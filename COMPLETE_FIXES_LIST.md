# Complete SQL Fixes List - All 5 Fixes

Run these **5 SQL scripts** in Supabase SQL Editor to fix all issues:

---

## ✅ Fix #1: See Public Groups
**Status**: ✅ Already Done

---

## 🔴 Fix #2: Join Public Groups
**File**: `RUN_THIS_NOW.sql`

```sql
CREATE POLICY groups_update_join ON groups
  FOR UPDATE
  USING (is_private = false)
  WITH CHECK (is_private = false AND auth.uid() = ANY(members));
```

**Fixes**: Groups disappearing after joining

---

## 🔴 Fix #3: Allow Bidding (with Self-Bidding)
**File**: `fix-auction-bidding.sql`

**Changes**:
- Adds `SECURITY DEFINER` to `process_bid()`
- Removes "Cannot bid on your own auction" check

**Fixes**: "Auction not found" error

**Run**: Copy **ENTIRE** file contents

---

## 🔴 Fix #4: Add group_id to bids Table
**File**: `fix-bids-table-schema.sql`

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

**Fixes**: `column "group_id" of relation "bids" does not exist`

---

## 🔴 Fix #5: Fix Auction Completion (NEW!)
**File**: `fix-auction-completion.sql`

**What it does**:
- Adds `SECURITY DEFINER` to `complete_auctions()`
- Allows card ownership transfer during auction completion
- Winners receive their cards properly

**Fixes**: `new row violates row-level security policy for table "cards"`

**Run**: Copy **ENTIRE** file contents

---

## 📋 Quick Run Checklist

**Supabase Dashboard → SQL Editor**

### ✅ Step 1: Already Done
You ran `fix-group-rls-policy.sql`

### 🔴 Step 2: Enable Group Joining
```sql
CREATE POLICY groups_update_join ON groups
  FOR UPDATE
  USING (is_private = false)
  WITH CHECK (is_private = false AND auth.uid() = ANY(members));
```

### 🔴 Step 3: Fix Bidding
Paste entire `fix-auction-bidding.sql` → Run

### 🔴 Step 4: Fix bids Table Schema
Paste entire `fix-bids-table-schema.sql` → Run

### 🔴 Step 5: Fix Auction Completion
Paste entire `fix-auction-completion.sql` → Run

---

## ✅ After All 5 Fixes

### Groups:
```
✅ Can see all public groups
✅ Can join groups
✅ Groups persist after refresh
```

### Auctions:
```
✅ Can bid on any auction (including own)
✅ No "Auction not found" errors
✅ No column errors
✅ Auctions complete automatically
✅ Winners receive cards
✅ Sellers receive coins
```

---

## 🔐 Security Summary

All functions with `SECURITY DEFINER` are safe:

| Function | Why It Needs SECURITY DEFINER | Security Maintained |
|----------|-------------------------------|---------------------|
| `process_bid()` | Queries auctions with stale group membership | ✅ Validates balance, bid amount, auction status |
| `complete_auctions()` | Transfers card ownership (neither party can do this) | ✅ Only processes expired auctions, validates winners |

---

## 🎯 What Each Fix Does

| # | Issue | Error | Solution |
|---|-------|-------|----------|
| 1 | Can't see other groups | Search: [] | Add SELECT policy ✅ |
| 2 | Can't join | includes_user: false | Add UPDATE policy 🔴 |
| 3 | Can't bid | Auction not found | SECURITY DEFINER 🔴 |
| 4 | Column missing | group_id not exist | ALTER TABLE 🔴 |
| 5 | Completion fails | RLS violation | SECURITY DEFINER 🔴 |

---

## 📁 All SQL Files

1. ✅ `fix-group-rls-policy.sql` - Done
2. 🔴 `RUN_THIS_NOW.sql` or manual SQL
3. 🔴 `fix-auction-bidding.sql` - Full file
4. 🔴 `fix-bids-table-schema.sql` - Full file
5. 🔴 `fix-auction-completion.sql` - Full file (NEW)

---

**Run fixes #2-5 to complete the setup!** 🚀

Then test:
- Join a group → Persists ✅
- Bid on auction → Works ✅
- Wait for auction to end → Card transfers ✅
