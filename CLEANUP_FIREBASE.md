# Firebase Cleanup Guide

## ✅ Already Removed/Migrated

1. **ReadDashboard** - Removed from App.js (was only shown in `__DEV__` mode)
2. **firebaseErrorHandler import** - Removed from App.js
3. **ReadMonitor critical event logging** - Removed Firebase-specific AsyncStorage logging
4. **StoreContent** - ✅ **MIGRATED TO SUPABASE** (StoreContentSupabase.js)
   - Now uses `supabase` instead of Firebase
   - Uses `update_gems()` RPC for atomic gem transactions
   - Direct queries to `users` table for `card_borders` array
   - Direct queries to `cards` table with `border_type` field

## 🔴 Files Still Using Firebase (Low Priority)

### Legacy Components:
1. **src/components/auction/CreateAuctionModal.js**
   - Uses: Firebase imports
   - Status: May not be used anymore (minting happens in CoinScreenSupabase)

### Legacy Files (Not Actively Used):
These are old Firebase implementations that have Supabase versions:
- `src/contexts/AuthContext.js` → Using `AuthContextSupabase.js` ✅
- `src/contexts/GroupContext.js` → Using `GroupContextSupabase.js` ✅
- `src/contexts/UnifiedUserDataContext.js` → Using `UnifiedUserDataContextSupabase.js` ✅
- All `*.firebase.bak` files
- All `*.bak` files

## 📋 Cleanup Steps (Optional - Do Later)

### Step 1: Migrate StoreContent.js to Supabase
The store functionality needs to be updated to use Supabase instead of Firebase.

### Step 2: Remove Firebase Dependencies
After all active files are migrated:
```bash
npm uninstall firebase
```

### Step 3: Delete Firebase Config
```bash
rm src/config/firebase.ts
```

### Step 4: Delete Legacy Files
```bash
# Backup files
rm src/**/*.firebase.bak
rm src/**/*.bak

# Old Firebase versions
rm src/contexts/AuthContext.js
rm src/contexts/GroupContext.js
rm src/contexts/UnifiedUserDataContext.js
```

### Step 5: Clean Up Unused Services
Many utility files in `src/services/` and `src/utils/` were built for Firebase optimization and may not be needed with Supabase's different architecture.

## 🎯 Priority: Just Get the App Working First!

**For now, ignore Firebase cleanup.** The important thing is:

1. ✅ ReadDashboard removed
2. ✅ App is using Supabase for authentication, auctions, cards, etc.
3. ⏳ Run the 2 SQL fixes to complete auction functionality

The Firebase files won't hurt anything - they're just sitting there unused. You can clean them up later when you have time.

## What's Actually Running Now

### Active (Supabase):
- ✅ Authentication: `AuthContextSupabase.js`
- ✅ Groups: `GroupContextSupabase.js`
- ✅ User Data: `UnifiedUserDataContextSupabase.js`
- ✅ Cards: `CardServiceSupabase.js`
- ✅ Auctions: `AuctionServiceSupabase.js`
- ✅ Collection: `useSimpleCollectionData.js`
- ✅ Leaderboard: `LeaderboardScreen.js`
- ✅ Settings: `SettingsContent.js`
- ✅ Daily Claims: `useDailyClaims.js`
- ✅ Coin/Mint: `CoinScreenSupabase.js`

### Not Yet Migrated:
- ⏳ Store: `StoreContent.js` (still uses Firebase)
- ⏳ Trades: May need TradeServiceSupabase
- ⏳ XP/Stats: May need migration

The core functionality (minting, auctions, bidding, collection) is all on Supabase! 🎉
