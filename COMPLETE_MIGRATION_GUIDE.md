## 🚀 Complete Supabase Migration Guide

This guide will help you complete the migration from Firebase to Supabase.

---

## Current Status

### ✅ Completed
- Authentication (login/register)
- Groups system (create/join/leave)
- User profiles (with RLS bypass)
- Daily claims
- CoinScreen (Supabase version created)

### 🔄 In Progress
- Card storage (needs Supabase Storage setup)
- Card minting/coining

### ❌ Not Started
- Auction system
- Trading system
- Collections/card display
- Leaderboards
- Social feed
- Stats/XP

---

## Phase 1: Card System Migration (CRITICAL - Unblocks Everything)

### Step 1.1: Deploy SQL Migrations

Run these in Supabase Dashboard → SQL Editor:

```bash
1. supabase/09-user-profile-init.sql  # User profile creation
2. supabase/10-add-daily-claim-column.sql  # Daily claims
```

### Step 1.2: Set Up Supabase Storage

Follow **`SUPABASE_STORAGE_SETUP.md`**:

1. Create `cards` bucket (public)
2. Add 4 RLS policies
3. Install dependencies:
   ```bash
   npm install expo-file-system
   ```

### Step 1.3: Switch to Supabase CoinScreen

**File**: `src/navigation/TabNavigator.js` (or wherever CoinScreen is imported)

```javascript
// Find this line:
import CoinScreen from '../screens/CoinScreen';

// Replace with:
import CoinScreen from '../screens/CoinScreenSupabase';
```

### Step 1.4: Test Card Minting

1. Login to app
2. Navigate to Coin tab
3. Take photo of a card
4. Enter name, click "Coin Card"
5. Verify:
   - No "unauthorized" error
   - Card created in Supabase `cards` table
   - Image in Supabase Storage `cards` bucket
   - Auction created in `auctions` table

---

## Phase 2: Auction System Migration

### Core Files to Migrate

1. **`src/screens/AuctionScreen.js`**
   - Replace Firebase queries with Supabase
   - Use `supabase.from('auctions')` instead of Firestore

2. **`src/hooks/useAuctionData.js`** (or similar)
   - Query auctions from Supabase
   - Use Supabase Realtime for live updates (optional)

3. **`src/services/AuctionService.js`**
   - Migrate `placeBid()` to use Supabase RPC `process_bid()`
   - Already exists in `supabase/02-functions.sql`!

### Key Changes

```javascript
// Before (Firebase):
const auctionsRef = collection(db, 'auctions');
const q = query(auctionsRef, where('groupId', '==', groupId));
const snapshot = await getDocs(q);

// After (Supabase):
const { data: auctions, error } = await supabase
  .from('auctions')
  .select('*')
  .eq('group_id', groupId)
  .eq('status', 'active');
```

### Bidding Function Already Exists!

The Supabase database already has a `process_bid()` function:

```javascript
// Call it like this:
const { data, error } = await supabase.rpc('process_bid', {
  p_auction_id: auctionId,
  p_bidder_id: user.id,
  p_bidder_name: user.email?.split('@')[0],
  p_bid_amount: bidAmount,
  p_group_id: groupId
});
```

---

## Phase 3: Collection Screen Migration

### Files to Update

1. **`src/screens/CollectionScreen.js`**
   - Query cards from Supabase
   - Display image URLs from Supabase Storage

2. **`src/hooks/useCollectionData.js`** (or similar)
   - Replace Firebase queries

### Example Query

```javascript
// Get user's cards
const { data: cards, error } = await supabase
  .from('cards')
  .select('*')
  .eq('owner_id', user.id)
  .eq('group_id', groupId)
  .order('created_at', { ascending: false });
```

---

## Phase 4: Trading System Migration

### Files to Update

1. **`src/screens/TradesScreen.js`**
2. **`src/screens/TradeDetailsScreen.js`**
3. **`src/screens/CreateTradeScreen.js`**
4. **`src/hooks/useOptimizedTradeData.js`**

### Trade Tables Already Exist

The schema has:
- `trades` table
- Foreign keys to `users` and `cards`
- RLS policies

---

## Phase 5: Social & Leaderboard Migration

### Leaderboard

**File**: `src/screens/LeaderboardScreen.js`

Current issue: Tries to fetch from Firebase groups

```javascript
// Replace Firebase:
const groupRef = doc(db, 'groups', groupId);
const groupSnap = await getDoc(groupRef);

// With Supabase:
const { data: group, error } = await supabase
  .from('groups')
  .select('*')
  .eq('id', groupId)
  .single();
```

### Social Feed

**File**: `src/screens/SocialScreen.js`

Already uses Supabase for groups! Just needs cleanup of Firebase imports.

---

## Phase 6: Remove Firebase Completely

### 6.1: Remove Firebase Dependencies

```bash
npm uninstall firebase
```

### 6.2: Delete Firebase Files

```bash
rm src/config/firebase.ts
rm -rf src/services/ReadTracking/  # TrackedFirestore wrapper
```

### 6.3: Update All Imports

Search and replace across project:

```javascript
// Find:
import { ... } from 'firebase/firestore'
import { db } from '../config/firebase'

// Replace with Supabase equivalents
```

### 6.4: Remove Compatibility Wrappers

Once fully migrated, remove:
- `useCompatUser()` from screens
- Any uid → id mappings

---

## Quick Win: Priority Migration Order

To get the app working ASAP:

### 1. **Complete Card System** (Phase 1)
   - Deploy SQL migrations
   - Set up Storage
   - Switch to CoinScreenSupabase
   - **Estimated time**: 30 mins

### 2. **Fix Leaderboard** (5 mins)
   - Just replace Firebase group query with Supabase
   - Removes "Group not found" errors

### 3. **Migrate AuctionScreen** (1-2 hours)
   - Most important user-facing feature
   - Can use existing `process_bid()` RPC function

### 4. **Migrate CollectionScreen** (30 mins)
   - Simple SELECT query
   - Display images from Supabase Storage

### 5. **Everything Else** (2-3 hours)
   - Trades, social feed, etc.

---

## Testing Checklist

After each phase, test:

- [ ] User can login
- [ ] User can create/join groups
- [ ] User can mint cards
- [ ] Cards appear with images
- [ ] User can view collection
- [ ] User can bid on auctions
- [ ] Auctions complete properly
- [ ] User can create/accept trades
- [ ] Leaderboard shows correct data
- [ ] Balance updates correctly
- [ ] No Firebase errors in console

---

## Rollback Plan

If migration breaks something critical:

### Option 1: Revert Individual Screens

```javascript
// In TabNavigator.js or wherever:
import CoinScreen from '../screens/CoinScreen';  // Firebase version
// import CoinScreen from '../screens/CoinScreenSupabase';  // Supabase version
```

### Option 2: Keep Both Systems Running

- Use Supabase for auth & groups
- Keep Firebase for cards, auctions, trades
- Migrate incrementally over time

---

## Getting Help

If you encounter issues:

1. Check **`SUPABASE_MIGRATION_STATUS.md`** for current state
2. See **`DEPLOY_USER_PROFILE_FUNCTION.md`** for SQL deployment
3. See **`SUPABASE_STORAGE_SETUP.md`** for storage setup
4. Check Supabase Dashboard → Logs for errors
5. Look for RLS policy violations (most common issue)

---

## Summary: What You Need To Do Now

### Immediate Actions (Required for Groups to Work)

1. **Deploy 2 SQL migrations** (5 mins)
   - `supabase/09-user-profile-init.sql`
   - `supabase/10-add-daily-claim-column.sql`

2. **Set up Supabase Storage** (15 mins)
   - Create `cards` bucket
   - Add RLS policies
   - See `SUPABASE_STORAGE_SETUP.md`

3. **Install dependency** (1 min)
   ```bash
   npm install expo-file-system
   ```

4. **Switch to Supabase CoinScreen** (1 min)
   - Update import in `TabNavigator.js`

5. **Test card minting** (5 mins)
   - Take photo → Enter name → Coin card
   - Should work without "unauthorized" error

### Next Steps (To complete migration)

6. Migrate AuctionScreen (see Phase 2)
7. Migrate CollectionScreen (see Phase 3)
8. Migrate remaining screens (see Phases 4-5)
9. Remove Firebase completely (see Phase 6)

**Total immediate work**: ~25 minutes to unblock groups system
**Total remaining work**: ~4-6 hours to complete full migration
