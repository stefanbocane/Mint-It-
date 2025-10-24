# Supabase Migration Testing Plan

## Pre-Migration Testing

### 1. Database Setup Verification

```sql
-- Run in Supabase SQL Editor

-- Check all tables created
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
-- Expected: auctions, bids, cards, groups, notifications, posts, set_completions, set_progress, sets, trades, user_sessions, users

-- Check all functions created
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;
-- Expected: 27+ functions

-- Check materialized views
SELECT matviewname FROM pg_matviews;
-- Expected: mv_auction_overview, mv_card_overview, mv_leaderboard, mv_social_overview, mv_trade_overview

-- Check RLS policies
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
-- Expected: 30+ policies

-- Check Realtime enabled
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime';
-- Expected: auctions, cards, notifications, posts, trades, user_sessions
```

**✅ Pass Criteria:**
- All 12 tables exist
- 27+ functions exist
- 5 materialized views exist
- 30+ RLS policies exist
- 6 tables have Realtime enabled

---

## Unit Testing

### 2. Database Function Tests

```sql
-- Test: update_balance()
DO $$
DECLARE
  v_test_user_id UUID := gen_random_uuid();
  v_test_group_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- Create test user and session
  INSERT INTO users (id, email, username)
  VALUES (v_test_user_id, 'test@test.com', 'testuser');

  INSERT INTO user_sessions (user_id, group_balances)
  VALUES (v_test_user_id, jsonb_build_object(v_test_group_id::text, 1000));

  -- Test adding coins
  v_result := update_balance(v_test_user_id, v_test_group_id, 100);
  RAISE NOTICE 'Add coins result: %', v_result;

  -- Test subtracting coins
  v_result := update_balance(v_test_user_id, v_test_group_id, -50);
  RAISE NOTICE 'Subtract coins result: %', v_result;

  -- Verify balance
  ASSERT (SELECT (group_balances->>v_test_group_id::text)::int
          FROM user_sessions
          WHERE user_id = v_test_user_id) = 1050, 'Balance should be 1050';

  -- Cleanup
  DELETE FROM user_sessions WHERE user_id = v_test_user_id;
  DELETE FROM users WHERE id = v_test_user_id;

  RAISE NOTICE '✅ update_balance() test passed';
END $$;

-- Test: process_bid()
DO $$
DECLARE
  v_seller_id UUID := gen_random_uuid();
  v_bidder_id UUID := gen_random_uuid();
  v_group_id UUID := gen_random_uuid();
  v_card_id UUID := gen_random_uuid();
  v_auction_id UUID;
  v_result JSONB;
BEGIN
  -- Setup test data
  INSERT INTO users (id, email, username) VALUES
    (v_seller_id, 'seller@test.com', 'seller'),
    (v_bidder_id, 'bidder@test.com', 'bidder');

  INSERT INTO user_sessions (user_id, group_balances) VALUES
    (v_seller_id, jsonb_build_object(v_group_id::text, 500)),
    (v_bidder_id, jsonb_build_object(v_group_id::text, 1000));

  INSERT INTO groups (id, name, created_by, members) VALUES
    (v_group_id, 'Test Group', v_seller_id, ARRAY[v_seller_id, v_bidder_id]);

  INSERT INTO cards (id, name, image_url, rarity, owner_id, group_id) VALUES
    (v_card_id, 'Test Card', 'https://test.com/card.jpg', 'common', v_seller_id, v_group_id);

  INSERT INTO auctions (id, card_id, seller_id, group_id, starting_bid, current_bid, end_time, status)
  VALUES (gen_random_uuid(), v_card_id, v_seller_id, v_group_id, 10, 10, NOW() + INTERVAL '1 hour', 'active')
  RETURNING id INTO v_auction_id;

  -- Test bidding
  v_result := process_bid(v_auction_id, v_bidder_id, 50, v_group_id);
  RAISE NOTICE 'Bid result: %', v_result;

  -- Verify auction updated
  ASSERT (SELECT current_bid FROM auctions WHERE id = v_auction_id) = 50, 'Current bid should be 50';

  -- Verify bidder balance decreased (50 + 1 tax)
  ASSERT (SELECT (group_balances->>v_group_id::text)::int FROM user_sessions WHERE user_id = v_bidder_id) = 949,
    'Bidder balance should be 949';

  -- Cleanup
  DELETE FROM auctions WHERE id = v_auction_id;
  DELETE FROM cards WHERE id = v_card_id;
  DELETE FROM groups WHERE id = v_group_id;
  DELETE FROM user_sessions WHERE user_id IN (v_seller_id, v_bidder_id);
  DELETE FROM users WHERE id IN (v_seller_id, v_bidder_id);

  RAISE NOTICE '✅ process_bid() test passed';
END $$;

-- Test: award_xp()
DO $$
DECLARE
  v_user_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  INSERT INTO users (id, email, username, xp, level)
  VALUES (v_user_id, 'xptest@test.com', 'xptest', 0, 1);

  -- Award 500 XP (should level up to level 2)
  v_result := award_xp(v_user_id, 500, 'test');
  RAISE NOTICE 'XP result: %', v_result;

  ASSERT (SELECT level FROM users WHERE id = v_user_id) > 1, 'Should have leveled up';

  DELETE FROM users WHERE id = v_user_id;

  RAISE NOTICE '✅ award_xp() test passed';
END $$;
```

**✅ Pass Criteria:**
- All test blocks complete without errors
- Assertions pass
- Data cleanup successful

---

## Integration Testing

### 3. Authentication Flow

**Test Signup:**
```bash
# Use Supabase client or app
1. Open app
2. Navigate to signup screen
3. Enter email: test1@test.com, password: TestPass123!
4. Submit

Expected:
- ✅ User created in auth.users
- ✅ Profile created in public.users (via trigger)
- ✅ Session created in user_sessions
- ✅ Can login with credentials
```

**Test Login:**
```bash
1. Open app
2. Navigate to login screen
3. Enter credentials
4. Submit

Expected:
- ✅ Session created
- ✅ User data loaded
- ✅ Navigate to main screen
```

**Test Logout:**
```bash
1. Click logout button

Expected:
- ✅ Session cleared
- ✅ Redirect to login screen
- ✅ Can't access protected routes
```

### 4. Balance Operations

**Test Add Coins:**
```javascript
// In app or test script
const { data, error } = await supabase.rpc('update_balance', {
  p_user_id: 'USER_ID',
  p_group_id: 'GROUP_ID',
  p_amount: 100
});

// Verify balance increased
const { data: session } = await supabase
  .from('user_sessions')
  .select('group_balances')
  .eq('user_id', 'USER_ID')
  .single();

console.log(session.group_balances['GROUP_ID']); // Should increase by 100
```

**✅ Pass Criteria:**
- Balance increases correctly
- No negative balances allowed
- Transaction atomic (no partial updates)

### 5. Bidding Flow

**Test Place Bid:**
```bash
1. Login as user with sufficient balance
2. Navigate to auction screen
3. Select auction
4. Place bid (higher than current)

Expected:
- ✅ Bid accepted
- ✅ Balance decreased by (bid + 1 tax)
- ✅ Previous bidder refunded
- ✅ Auction current_bid updated
- ✅ Rarity recalculated
- ✅ UI updates immediately (optimistic)
```

**Test Insufficient Balance:**
```bash
1. Try to bid more than balance

Expected:
- ❌ Bid rejected
- ✅ Error message shown
- ✅ Balance unchanged
```

**Test Bid Too Low:**
```bash
1. Try to bid same or lower than current bid

Expected:
- ❌ Bid rejected
- ✅ Error message shown
- ✅ Balance unchanged
```

### 6. Realtime Updates

**Test Auction Updates:**
```bash
Setup:
- Open app on Device A (User 1)
- Open app on Device B (User 2)
- Navigate both to same auction

Test:
1. User 2 places bid
2. Observe User 1's screen

Expected:
- ✅ User 1 sees new bid in <1 second
- ✅ Current bid updates
- ✅ Rarity updates
- ✅ No page refresh needed
```

**Test Balance Updates:**
```bash
Setup:
- Open profile on Device A
- Open admin panel on Device B

Test:
1. Admin awards coins to user
2. Observe Device A

Expected:
- ✅ Balance updates in real-time
- ✅ No page refresh needed
```

### 7. Bootstrap/Initial Load

**Test App Startup:**
```bash
1. Clear app cache
2. Login
3. Measure time to interactive

Expected:
- ✅ Bootstrap completes in <100ms
- ✅ All initial data loaded (user, group, balance)
- ✅ Single RPC call to get_bootstrap_payload()
- ✅ No waterfall queries
```

---

## Performance Testing

### 8. Query Performance

```sql
-- Test auction query performance
EXPLAIN ANALYZE
SELECT * FROM auctions
WHERE group_id = 'TEST_GROUP_ID'
  AND status = 'active'
  AND end_time > NOW()
ORDER BY end_time ASC;
-- Expected: <10ms, uses index

-- Test materialized view query
EXPLAIN ANALYZE
SELECT * FROM mv_auction_overview
WHERE group_id = 'TEST_GROUP_ID';
-- Expected: <5ms, sequential scan acceptable

-- Test bidding transaction
EXPLAIN ANALYZE
SELECT process_bid(
  'AUCTION_ID'::UUID,
  'BIDDER_ID'::UUID,
  100,
  'GROUP_ID'::UUID
);
-- Expected: <20ms
```

**✅ Pass Criteria:**
- Queries complete in <50ms (95th percentile)
- Indexes used where expected
- No full table scans on large tables

### 9. Load Testing

**Concurrent Bidding:**
```bash
# Use tool like k6 or artillery
# Simulate 10 users bidding on same auction simultaneously

Expected:
- ✅ All bids processed correctly
- ✅ No race conditions
- ✅ Final state consistent
- ✅ Only one winner
```

---

## Data Integrity Testing

### 10. Post-Migration Verification

```sql
-- Run after migration completes
SELECT * FROM verify_migration();

-- Check for data anomalies
-- Orphaned cards
SELECT COUNT(*) FROM cards c
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.owner_id);
-- Expected: 0

-- Orphaned auctions
SELECT COUNT(*) FROM auctions a
WHERE NOT EXISTS (SELECT 1 FROM cards c WHERE c.id = a.card_id);
-- Expected: 0

-- Negative balances
SELECT user_id, group_balances
FROM user_sessions
WHERE EXISTS (
  SELECT 1 FROM jsonb_each_text(group_balances)
  WHERE value::int < 0
);
-- Expected: 0 rows

-- Users without sessions
SELECT COUNT(*) FROM users u
WHERE NOT EXISTS (SELECT 1 FROM user_sessions s WHERE s.user_id = u.id);
-- Expected: 0
```

**✅ Pass Criteria:**
- All row counts match Firebase export
- Zero orphaned records
- Zero negative balances
- All users have sessions

---

## End-to-End Testing

### 11. Full User Journey

**Test Complete Auction Cycle:**
```bash
1. User A creates auction for card
   - ✅ Card marked as in_auction
   - ✅ Auction appears in list

2. User B places bid
   - ✅ Balance decreases
   - ✅ Auction updates

3. User C places higher bid
   - ✅ User B refunded
   - ✅ User C balance decreases
   - ✅ Rarity upgrades

4. Auction expires (wait or manually trigger)
   - ✅ Winner receives card
   - ✅ Seller receives coins
   - ✅ Auction marked completed

5. Verify final state
   - ✅ Card owner is User C
   - ✅ User A has bid amount in balance
   - ✅ User B fully refunded
   - ✅ All balances correct
```

### 12. Trade Flow

```bash
1. User A creates trade offer (offers card X for card Y)
   - ✅ Cards marked in_trade
   - ✅ Trade appears in User B's inbox

2. User B accepts trade
   - ✅ Cards swap owners
   - ✅ Trade marked completed
   - ✅ Both users awarded XP

3. Verify final state
   - ✅ User A owns card Y
   - ✅ User B owns card X
   - ✅ Cards no longer in_trade
```

---

## Regression Testing

### 13. Compare Firebase vs Supabase

**Run in parallel (if possible):**
```bash
# Keep Firebase version running
# Deploy Supabase version to separate environment
# Run same operations on both
# Compare results

Operations to test:
- Place 100 bids
- Create 50 trades
- Post 30 social updates
- Award coins/gems
- Complete set rewards

Compare:
- ✅ Final balances match
- ✅ Card ownership matches
- ✅ Auction states match
- ✅ Performance (Supabase should be faster)
```

---

## Security Testing

### 14. RLS Policy Tests

```sql
-- Test: Users can only read their own data
SET request.jwt.claims.sub = 'USER_A_ID';

SELECT * FROM user_sessions WHERE user_id = 'USER_B_ID';
-- Expected: 0 rows (blocked by RLS)

-- Test: Users can only bid on auctions in their groups
SELECT process_bid(
  'AUCTION_IN_OTHER_GROUP'::UUID,
  'USER_A_ID'::UUID,
  100,
  'OTHER_GROUP_ID'::UUID
);
-- Expected: Error (not a member)

-- Test: Users can only update their own trades
UPDATE trades SET status = 'cancelled' WHERE id = 'TRADE_ID';
-- Expected: Success if participant, failure otherwise
```

**✅ Pass Criteria:**
- All unauthorized actions blocked
- No data leakage between users/groups
- RLS policies enforced correctly

---

## Checklist

### Pre-Launch Testing Checklist

- [ ] All database functions tested
- [ ] Authentication flows work
- [ ] Balance operations atomic
- [ ] Bidding transactions correct
- [ ] Realtime updates working
- [ ] Bootstrap load <100ms
- [ ] Query performance <50ms
- [ ] Data integrity verified
- [ ] No orphaned records
- [ ] RLS policies enforced
- [ ] Migration verified
- [ ] E2E flows complete
- [ ] Load testing passed
- [ ] Security testing passed

### Ready for Production When:

- [ ] All tests passing
- [ ] Performance metrics met
- [ ] No critical bugs
- [ ] Data migration successful
- [ ] Rollback plan tested
- [ ] Monitoring setup
- [ ] Alerts configured
