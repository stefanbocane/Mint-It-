# App Testing Guide - Supabase Backend

## ✅ Setup Complete!

Your app is now configured to use Supabase instead of Firebase:

- ✅ AuthContextSupabase imported
- ✅ UnifiedUserDataContextSupabase imported
- ✅ Environment variables configured
- ✅ Dependencies reinstalled
- ✅ Cache cleared

## 🚀 How to Test

### Step 1: Start the Development Server

```bash
npm start
```

Or for faster startup (bypass cache clearing):

```bash
npm run start:bypass
```

### Step 2: Run on Device/Simulator

Choose your platform:

```bash
# iOS
npm run ios

# Android
npm run android
```

### Step 3: Create a Test Account

Since we didn't migrate data, you need to **create a new account**:

1. Open the app
2. Tap **"Sign Up"**
3. Enter:
   - Email: `test@example.com` (or any email)
   - Password: at least 6 characters
   - Accept terms
4. Tap **"Sign Up"**

**What happens behind the scenes:**
- Supabase Auth creates the account
- Database trigger auto-creates user profile
- User starts with:
  - 5 gems
  - 0 coins
  - Level 1
  - 0 XP
  - 0 cards

### Step 4: Test Core Features

#### ✅ Test 1: Profile Screen
- Go to **Profile** tab
- Should see:
  - Username (auto-generated from email)
  - Level 1
  - 0 XP
  - 5 gems
  - Empty showcase

#### ✅ Test 2: Create a Group
- Go to **Social** tab
- Tap **"Create Group"**
- Enter group name
- Tap **"Create"**
- Should succeed and redirect to group

#### ✅ Test 3: Collection Screen
- Go to **Collection** tab
- Should see empty collection message
- (Can't test cards without minting, see below)

#### ✅ Test 4: Coin Store
- Go to **Coin** tab (Store)
- Should load without errors
- Shows packs available for purchase

#### ✅ Test 5: Leaderboard
- Go to **Leaderboard** tab
- Should show your user (only one so far)
- Level 1, 0 XP

### Step 5: Test Advanced Features (Optional)

These require implementing card minting via Supabase:

#### Card Minting (Needs Implementation)
Currently, the app may still call Firebase for card minting. To test this:

1. Open a pack in Store
2. If it fails, we need to migrate the minting service to Supabase

#### Auctions (Needs Cards)
Can't test until you have cards to auction

#### Trading (Needs Cards)
Can't test until you have cards to trade

---

## 🐛 Expected Issues

### Issue 1: Card Minting May Fail

**Symptom:** Opening packs doesn't work
**Cause:** Card minting service still uses Firebase
**Fix:** Need to migrate `src/services/SetsService.js` to use Supabase

### Issue 2: Some Features Use Old Firebase Services

**Symptom:** Features fail or crash
**Cause:** Some services haven't been migrated yet
**Fix:** Identify failing service and migrate to Supabase

### Issue 3: "No Groups" Error

**Symptom:** App shows "no groups" even after creating one
**Cause:** GroupContext may need refresh
**Fix:** Pull-to-refresh on Social screen

---

## 📊 Testing Checklist

Use this to track what works:

### Authentication
- [ ] Sign up works
- [ ] Sign in works
- [ ] Sign out works
- [ ] Profile auto-created on signup

### Navigation
- [ ] All tabs load without crashing
- [ ] Navigation between screens works

### Groups
- [ ] Create group works
- [ ] Join group works (need another user)
- [ ] Group list shows created groups

### Profile
- [ ] Profile data loads
- [ ] Shows correct gems (5)
- [ ] Shows correct level (1)

### Store
- [ ] Store screen loads
- [ ] Packs displayed
- [ ] Opening pack works (may fail - see Issue 1)

### Collection
- [ ] Screen loads
- [ ] Empty state shown (if no cards)
- [ ] Cards displayed (if cards exist)

### Auctions
- [ ] Screen loads
- [ ] Empty state shown (if no auctions)

### Trades
- [ ] Screen loads
- [ ] Empty state shown (if no trades)

### Leaderboard
- [ ] Screen loads
- [ ] User listed with correct stats

---

## 🔍 Debugging

### Check Logs

Look for these in console:

**Good signs:**
```
✅ OPTIMIZED: Optimization services initialized
🚀 Supabase client initialized
✅ Auth state listener set up
```

**Bad signs:**
```
❌ Firebase error: ...
❌ Could not find function ...
❌ RLS policy violation
```

### Check Supabase Dashboard

1. Go to: https://supabase.com/dashboard/project/ikizpnzgknmfhdituyyk
2. **Auth → Users** - Should see your test user
3. **Database → Tables → users** - Should see user profile
4. **Database → Tables → user_sessions** - Should see session
5. **Database → Tables → groups** - Should see created group

### Common Fixes

**Problem:** "Could not find function"
**Fix:** Make sure you ran SUPABASE_SETUP.sql completely

**Problem:** "RLS policy violation"
**Fix:** Make sure RLS policies were created (check SUPABASE_SETUP.sql)

**Problem:** App crashes on startup
**Fix:** Clear cache again: `rm -rf .expo && npm start`

**Problem:** "User not found"
**Fix:** Auth trigger may not have fired. Check Supabase Dashboard → Auth → Users

---

## 📝 Reporting Issues

If you find bugs, note:

1. **What you did** - Steps to reproduce
2. **What happened** - Error message or behavior
3. **What you expected** - Correct behavior
4. **Console logs** - Any errors in terminal
5. **Supabase logs** - Check Dashboard → Logs

---

## 🎯 Next Steps After Testing

Once basic testing works:

1. **Identify failing features** - Which services need migration?
2. **Migrate remaining services** - Update to use Supabase
3. **Test advanced features** - Auctions, trading, set completion
4. **Consider partial data migration** - Import some test data from Firebase
5. **Production deployment** - See DEPLOYMENT_GUIDE.md

---

## 🚨 Emergency Rollback

If app is completely broken:

1. Stop Metro bundler
2. Revert to Firebase imports:
   ```bash
   # In App.js, change back to:
   import { AuthContextProvider } from './src/contexts/AuthContext';
   import { UnifiedUserDataProvider } from './src/contexts/UnifiedUserDataContext';
   ```
3. Clear cache: `rm -rf .expo && npm start`
4. App should work with Firebase again

---

## ✅ Success Criteria

The app is working if:

- ✅ You can sign up
- ✅ You can sign in
- ✅ Profile loads with correct data
- ✅ You can create groups
- ✅ All tabs load without crashing
- ✅ No console errors related to Supabase

**Ready to test? Run `npm start` and let me know what happens!** 🚀
