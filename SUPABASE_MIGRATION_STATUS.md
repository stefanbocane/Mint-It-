# Supabase Migration Status

## ✅ Completed Migrations

### Authentication
- ✅ `AuthContextSupabase.js` - Full auth with Supabase
- ✅ `LoginScreen.tsx` - Using Supabase auth
- ✅ `RegisterScreen.tsx` - Using Supabase auth

### Groups System
- ✅ `GroupContextSupabase.js` - Group management
- ✅ `useGroupOperations.js` - Create/join/leave groups (Supabase)
- ✅ `ensure_user_profile` RPC function - Auto-create missing profiles

### Daily Claims
- ✅ `useDailyClaims.js` - Migrated to Supabase (just now)
  - Reads from `user_sessions.last_daily_claim`
  - **Requires migration**: `supabase/10-add-daily-claim-column.sql`

### App Structure
- ✅ `App.js` - Uses Supabase contexts

## ⚠️ Partially Migrated (Mixed Firebase/Supabase)

These files import from Firebase but may or may not use it actively:

### Screens
- ⚠️ `LeaderboardScreen.js` - Has Firebase imports, shows "Group not found"
- ⚠️ `AuctionScreen.js` - Firebase imports
- ⚠️ `CollectionScreen.js` - Firebase imports
- ⚠️ `TradeDetailsScreen.js` - Firebase imports
- ⚠️ `CreateTradeScreen.js` - Firebase imports
- ⚠️ `CoinScreen.js` - Firebase imports

### Hooks
- ⚠️ `useConsolidatedUserData.js` - Firebase imports
- ⚠️ `useOptimizedTradeData.js` - Firebase imports
- ⚠️ `useOptimizedSocialData.js` - Firebase imports
- ⚠️ `useCollectionData.js` - Firebase imports
- ⚠️ `useSmartStatusVerification.js` - Firebase imports
- ⚠️ `useSimpleCollectionData.js` - Firebase imports

### Services
- ⚠️ All auction services still use Firebase
- ⚠️ Most utility services still use Firebase
- ⚠️ `TrackedFirestore.js` - Wrapper around Firebase

### Contexts
- ⚠️ `UnifiedUserDataContext.js` - Firebase imports (there's also Firebase backup)

## 🔴 Not Yet Migrated

The bulk of the app still uses Firebase:
- Auction system (bidding, completion, status management)
- Trading system
- Card collections
- Leaderboards
- Social feed
- Stats/XP system
- All services in `src/services/`
- All utilities in `src/utils/`

## Current Issues

### 1. Firebase Warning on Launch
```
Firestore (10.14.1): Error using user provided cache. Falling back to memory cache
```
**Cause**: Firebase is being imported somewhere even though we're using Supabase

**Impact**: Performance degradation, confused data flow

### 2. "Group not found" Errors (x4)
**Cause**: `LeaderboardScreen.js` and potentially other screens trying to fetch groups from Firebase instead of Supabase

**Impact**: Features don't work properly

### 3. `indexOf` Error in Daily Claims
**Status**: ✅ FIXED - Migrated to Supabase

## Required Migrations (Priority Order)

### High Priority (Needed for Groups to Work)
1. ✅ Deploy `supabase/09-user-profile-init.sql` - User profile creation
2. 🔄 Deploy `supabase/10-add-daily-claim-column.sql` - Daily claims
3. 🔴 Migrate `LeaderboardScreen.js` to Supabase
4. 🔴 Migrate `UnifiedUserDataContext.js` to Supabase (or use Supabase version)

### Medium Priority (Core Features)
5. 🔴 Migrate auction system to Supabase
6. 🔴 Migrate collection/cards system to Supabase
7. 🔴 Migrate trading system to Supabase
8. 🔴 Migrate social feed to Supabase

### Low Priority (Can work with Firebase temporarily)
9. 🔴 Migrate stats/XP to Supabase
10. 🔴 Migrate utility services to Supabase
11. 🔴 Remove Firebase entirely

## Deployment Checklist

Before the groups system will work, you need to deploy these SQL migrations:

### Required Migrations
```bash
# 1. User profile initialization (bypasses RLS)
# Copy and run: supabase/09-user-profile-init.sql

# 2. Daily claim tracking
# Copy and run: supabase/10-add-daily-claim-column.sql
```

### Verification
After deploying, verify in Supabase Dashboard:
```sql
-- Check function exists
SELECT proname FROM pg_proc WHERE proname = 'ensure_user_profile';

-- Check column exists
SELECT column_name FROM information_schema.columns
WHERE table_name = 'user_sessions' AND column_name = 'last_daily_claim';
```

## Testing Flow

Once migrations are deployed:

1. ✅ Login with Supabase auth
2. ✅ Create a group → User profile auto-created, group created
3. ✅ Group appears in list and is auto-selected
4. ✅ Join another group → Group added and selected
5. ✅ Claim daily coins → Works with Supabase
6. ⚠️ Leaderboard → Currently broken (needs migration)
7. ⚠️ Other features → Most still use Firebase

## Recommendation

**Option A: Full Migration** (Best long-term)
- Migrate all features to Supabase systematically
- Remove Firebase entirely
- Clean, single source of truth

**Option B: Hybrid Approach** (Faster short-term)
- Keep Firebase for complex features (auctions, collections, trades)
- Use Supabase only for auth and groups
- Migrate incrementally

**Option C: Rollback**
- Revert groups to Firebase
- Use Firebase everywhere
- Migrate later when ready

Given the current state, **Option A** is recommended since you've already started the migration and groups are working.
