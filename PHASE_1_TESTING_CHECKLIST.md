# Phase 1 Testing Checklist

## ✅ Pre-Test Verification

Before testing in the app, verify these are complete:

### SQL Migrations Deployed
- [ ] `supabase/09-user-profile-init.sql` deployed
- [ ] `supabase/10-add-daily-claim-column.sql` deployed
- [ ] Run verification query:
  ```sql
  SELECT proname FROM pg_proc WHERE proname = 'ensure_user_profile';
  ```
  Should return 1 row

### Storage Setup Complete
- [ ] `cards` bucket created
- [ ] Bucket is marked as **Public**
- [ ] 4 RLS policies added (INSERT, SELECT, UPDATE, DELETE)
- [ ] Test file uploaded and accessible via public URL
- [ ] Test file deleted

### Code Changes
- [ ] `expo-file-system` installed
- [ ] `TabNavigator.js` imports `CoinScreenSupabase`
- [ ] No syntax errors in `CoinScreenSupabase.js`

---

## 🧪 Test 1: User Profile Auto-Creation

**Goal**: Verify users are auto-created when they try to create a group

### Steps:
1. Login with existing user
2. Go to Social tab
3. Click "Create Group"
4. Enter group name (e.g., "Test Group 1")
5. Click Create

### Expected Result:
✅ Group created successfully
✅ No "foreign key constraint" error
✅ No "RLS policy violation" error

### What It Proves:
- `ensure_user_profile()` RPC function works
- User profile auto-created in `users` table
- User session created in `user_sessions` table

### If It Fails:
- Check: Did you deploy `09-user-profile-init.sql`?
- Check: Does function exist in Supabase?
- Check: Are there errors in Supabase logs?

---

## 🧪 Test 2: Daily Coin Claim

**Goal**: Verify daily claims use Supabase

### Steps:
1. Make sure you have a group selected
2. Go to Social tab
3. Click "Claim Daily Coins" (if available)

### Expected Result:
✅ Coins awarded (50 coins)
✅ Balance updates
✅ No "indexOf" error
✅ Can't claim again for 24 hours

### What It Proves:
- `useDailyClaims` hook migrated to Supabase
- `last_daily_claim` column exists
- No Firebase dependencies in daily claims

### If It Fails:
- Check: Did you deploy `10-add-daily-claim-column.sql`?
- Check: Does column exist in `user_sessions` table?
- Look for errors in app console

---

## 🧪 Test 3: Card Minting (CRITICAL)

**Goal**: Mint a card using Supabase Storage

### Steps:
1. Login
2. Select/create a group
3. Go to "Coin" tab
4. Click camera button or take photo
5. Enter card name (e.g., "Pikachu")
6. Click "Coin Card"

### Expected Result:
✅ Success alert appears
✅ "Card minted and listed in auction!"
✅ Balance decreases by 6 coins
✅ No "unauthorized" error
✅ No "Firebase Storage" error

### Verify in Supabase Dashboard:

#### Check Storage:
1. Go to Storage → `cards` bucket
2. Should see new file: `{user_id}/timestamp_randomid.jpg`
3. Click file → Copy public URL
4. Open URL in browser → Should display the card image

#### Check Database - Cards:
1. Go to Table Editor → `cards` table
2. Should see new row with:
   - `name`: "Pikachu" (or whatever you entered)
   - `image_url`: Supabase Storage URL
   - `owner_id`: Your user ID
   - `group_id`: Current group ID
   - `status`: "in_auction"
   - `in_auction`: true

#### Check Database - Auctions:
1. Go to Table Editor → `auctions` table
2. Should see new row with:
   - `card_name`: "Pikachu"
   - `card_image_url`: Same Supabase Storage URL
   - `seller_id`: Your user ID
   - `status`: "active"
   - `end_time`: ~30 seconds from now

### What It Proves:
- Supabase Storage upload works
- RLS policies allow authenticated uploads
- Card creation in Supabase database works
- Auction creation works
- Full card minting flow end-to-end

### If It Fails:

#### "Bucket not found"
- Storage bucket `cards` not created
- Or bucket name is wrong (case-sensitive)

#### "new row violates row-level security policy"
- RLS policies not added to `cards` bucket
- Or policies have wrong syntax

#### "Permission denied" / "Unauthorized"
- User not authenticated
- Or RLS policy blocking upload
- Check policies in Storage → Policies tab

#### "Failed to upload"
- Image too large (> 5 MB)
- MIME type not allowed
- Check bucket settings

#### Image uploads but card creation fails
- Schema mismatch (check column names)
- Foreign key constraint (user profile missing)
- Check Supabase logs for details

---

## 🧪 Test 4: View Card in Collection

**Goal**: Verify minted card appears with Supabase image

### Steps:
1. After minting card, go to Collection tab
2. Look for your new card

### Expected Result (if CollectionScreen migrated):
✅ Card appears in grid
✅ Image loads from Supabase Storage URL
✅ Card name displays correctly

### Expected Result (if CollectionScreen NOT migrated):
⚠️ Card might not appear (Firebase query won't find Supabase cards)
⚠️ This is expected - CollectionScreen needs migration (Phase 3)

---

## 🧪 Test 5: View Auction

**Goal**: Verify created auction appears

### Steps:
1. After minting card, go to Auction tab
2. Look for your card's auction

### Expected Result (if AuctionScreen migrated):
✅ Auction appears in list
✅ Card image displays
✅ Timer counts down
✅ Can bid on auction

### Expected Result (if AuctionScreen NOT migrated):
⚠️ Auction might not appear (Firebase query won't find Supabase auctions)
⚠️ This is expected - AuctionScreen needs migration (Phase 2)

---

## 📊 Success Criteria

### Minimum Success (Phase 1 Complete):
- ✅ Test 1: User profile auto-creation works
- ✅ Test 2: Daily claims work
- ✅ Test 3: Card minting completes without errors
- ✅ Card appears in Supabase `cards` table
- ✅ Image appears in Supabase Storage `cards` bucket
- ✅ Auction appears in Supabase `auctions` table

### Bonus Success (Indicates Phase 2/3 Ready):
- ✅ Test 4: Card appears in Collection tab
- ✅ Test 5: Auction appears in Auction tab

---

## 🐛 Common Issues & Solutions

### Issue: "Function ensure_user_profile does not exist"
**Solution**: Deploy `supabase/09-user-profile-init.sql`

### Issue: "Column last_daily_claim does not exist"
**Solution**: Deploy `supabase/10-add-daily-claim-column.sql`

### Issue: "Bucket 'cards' not found"
**Solution**: Create bucket in Supabase Storage

### Issue: "new row violates row-level security policy for table 'objects'"
**Solution**: Add RLS policies to `cards` bucket

### Issue: App crashes on Coin tab
**Solution**: Check React Native logs - might be missing `expo-file-system`

### Issue: "Cannot read property 'id' of undefined"
**Solution**: Make sure you're logged in and have a group selected

---

## 📝 Test Results Log

Use this to track your testing:

```
[ ] Test 1: User Profile Auto-Creation
    Result: _______________
    Notes: ________________

[ ] Test 2: Daily Coin Claim
    Result: _______________
    Notes: ________________

[ ] Test 3: Card Minting
    Result: _______________
    Card ID: ______________
    Image URL: ____________
    Auction ID: ___________

[ ] Test 4: View in Collection
    Result: _______________
    Notes: ________________

[ ] Test 5: View in Auction
    Result: _______________
    Notes: ________________
```

---

## ✅ Phase 1 Complete When:

- [x] All SQL migrations deployed
- [x] Supabase Storage configured
- [x] Dependencies installed
- [x] Code updated to use Supabase
- [ ] **Test 3 passes** (card minting works end-to-end)
- [ ] Card visible in Supabase dashboard
- [ ] Image accessible via public URL

**Next**: Proceed to Phase 2 (Auction System Migration) or Phase 3 (Collection Screen Migration)
