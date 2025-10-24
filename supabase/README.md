# CardMates - Supabase Database Setup

Complete PostgreSQL schema for migrating CardMates from Firebase Firestore to Supabase.

## 📋 Overview

This directory contains all SQL scripts needed to set up the Supabase database for the CardMates app:

- **01-schema.sql** - Core tables and relationships
- **02-functions.sql** - Database functions (bidding, balances, bootstrap)
- **03-materialized-views.sql** - Overview aggregations (replaces Firebase overview docs)
- **04-policies.sql** - Row Level Security policies
- **05-indexes.sql** - Performance indexes
- **06-auth-trigger.sql** - Auto-create user profiles on signup
- **00-setup-all.sql** - Master script to run everything in order

## 🚀 Quick Start

### Option 1: Supabase Dashboard (Recommended)

1. **Open Supabase SQL Editor**
   - Go to your Supabase project dashboard
   - Navigate to **SQL Editor** in the left sidebar

2. **Run Master Setup Script**
   ```sql
   -- Copy and paste contents of 00-setup-all.sql
   -- Click "Run" to execute all scripts in order
   ```

3. **Verify Installation**
   ```sql
   -- Check tables
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' ORDER BY table_name;

   -- Check materialized views
   SELECT matviewname FROM pg_matviews;

   -- Check functions
   SELECT routine_name FROM information_schema.routines
   WHERE routine_schema = 'public' ORDER BY routine_name;
   ```

### Option 2: Supabase CLI

1. **Install Supabase CLI**
   ```bash
   npm install -g supabase
   ```

2. **Link to Your Project**
   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   ```

3. **Run Migrations**
   ```bash
   # Run all scripts in order
   supabase db push --file supabase/01-schema.sql
   supabase db push --file supabase/02-functions.sql
   supabase db push --file supabase/03-materialized-views.sql
   supabase db push --file supabase/04-policies.sql
   supabase db push --file supabase/05-indexes.sql
   supabase db push --file supabase/06-auth-trigger.sql
   ```

### Option 3: Direct Postgres Connection

1. **Get Database URL**
   - In Supabase dashboard → Settings → Database
   - Copy "Connection string" (with session pooler)

2. **Connect via psql**
   ```bash
   psql "your-connection-string-here"
   ```

3. **Run Scripts**
   ```sql
   \i supabase/01-schema.sql
   \i supabase/02-functions.sql
   \i supabase/03-materialized-views.sql
   \i supabase/04-policies.sql
   \i supabase/05-indexes.sql
   \i supabase/06-auth-trigger.sql
   ```

## 📊 Schema Overview

### Core Tables

- **users** - User profiles and global resources (gems, XP, level)
- **user_sessions** - Per-user session data with group-scoped balances
- **groups** - Game groups (social isolation boundary)
- **cards** - Collectible cards
- **auctions** - Card auctions with bidding state
- **bids** - Individual bid records
- **trades** - Card trade offers
- **posts** - Social feed posts
- **sets** - Card set definitions
- **set_progress** - User progress toward completing sets
- **set_completions** - Completed sets
- **notifications** - User notifications

### Materialized Views (Overview Documents)

Replace Firebase's "overview documents" pattern:

- **mv_auction_overview** - Active auctions per group
- **mv_card_overview** - User's cards per group
- **mv_trade_overview** - Active trades per group
- **mv_social_overview** - Recent posts per group
- **mv_leaderboard** - User rankings per group

These views **automatically refresh** via triggers when data changes.

### Key Functions

**Auction System:**
- `calculate_live_rarity(bid, bidder_count)` - Dynamic rarity calculation
- `process_bid(...)` - Atomic bidding transaction (deduct, update, refund)
- `complete_auctions()` - Process expired auctions (scheduled job)

**Balance Operations:**
- `update_balance(user_id, group_id, amount)` - Atomic balance update
- `update_gems(user_id, amount, group_id?)` - Atomic gems update
- `get_user_balance(user_id, group_id)` - Get balance
- `get_user_gems(user_id, group_id?)` - Get gems

**Bootstrap:**
- `get_bootstrap_payload(user_id, group_id)` - Single query for app startup data

**Auth:**
- `handle_new_user()` - Auto-create profile on signup (trigger)
- `handle_user_deletion()` - Cleanup on account deletion (trigger)

## 🔐 Security

### Row Level Security (RLS)

All tables have RLS enabled. Policies enforce:

- ✅ Users can only access their own data
- ✅ Group members can access group data
- ✅ Admins can manage their groups
- ✅ Bidders can bid via `process_bid()` function
- ✅ Participants can manage their trades

### Service Role vs Anon Key

- **Anon Key** (client-side): Limited by RLS policies
- **Service Role** (server-side): Bypasses RLS for admin operations

Use service role only for:
- Data migration scripts
- Admin tools
- Scheduled jobs (auction completion)

## 🏗 Migration from Firebase

### Data Migration Order

1. **Users** (auth.users → users table)
2. **Groups** (groups collection → groups table)
3. **Cards** (cards collection → cards table)
4. **Auctions** (auctions collection → auctions table)
5. **Bids** (auctions/{id}/bids → bids table)
6. **Trades** (trades collection → trades table)
7. **Posts** (posts collection → posts table)
8. **Sets** (sets collection → sets table)
9. **Set Progress** (setProgress collection → set_progress table)
10. **Notifications** (notifications collection → notifications table)

### ID Mapping

Firebase uses string IDs, Postgres uses UUIDs. Strategy:

1. Store original Firebase ID in `firebase_uid` column
2. Generate new UUIDs for Supabase
3. Maintain `migration-mapping.json` file during migration
4. Map relationships using the mapping file

## ⚡ Performance

### Indexes

Comprehensive indexes for:
- Foreign key relationships (owner_id, group_id, etc.)
- Common WHERE clauses (status, dates)
- Array/JSONB operations (members, balances)
- Full-text search (posts, usernames)
- Sorting operations (ORDER BY)

### Materialized Views

Auto-refreshing via triggers:
- `CONCURRENTLY` refresh (no read locks)
- Indexed for fast lookups
- Replace Firebase Cloud Functions

### Query Optimization

```sql
-- EXPLAIN ANALYZE to check query performance
EXPLAIN ANALYZE
SELECT * FROM auctions
WHERE group_id = 'some-uuid' AND status = 'active'
ORDER BY end_time ASC;

-- Should use index: idx_auctions_group_status_end
```

## 🔄 Scheduled Jobs

### Auction Completion (Every Minute)

**Option 1: Supabase Edge Function (Recommended)**

Create edge function:
```typescript
// supabase/functions/complete-auctions/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data, error } = await supabaseAdmin.rpc('complete_auctions')

  return new Response(
    JSON.stringify({ data, error }),
    { headers: { "Content-Type": "application/json" } }
  )
})
```

Deploy:
```bash
supabase functions deploy complete-auctions
```

Schedule via **cron job** or external service (e.g., GitHub Actions, Vercel Cron).

**Option 2: pg_cron Extension**

If using self-hosted Supabase or Supabase Pro:

```sql
-- Enable pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule auction completion every minute
SELECT cron.schedule(
  'complete-auctions',
  '* * * * *', -- Every minute
  $$SELECT complete_auctions()$$
);
```

## 🧪 Testing

### Verify Setup

```sql
-- 1. Check all tables exist
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';
-- Expected: 12 tables

-- 2. Check materialized views
SELECT COUNT(*) FROM pg_matviews;
-- Expected: 5 views

-- 3. Check functions
SELECT COUNT(*) FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION';
-- Expected: 15+ functions

-- 4. Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = true;
-- Expected: All 12 tables

-- 5. Check indexes
SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';
-- Expected: 80+ indexes
```

### Test Bootstrap Function

```sql
-- Create test user
INSERT INTO users (id, email, username)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'test@test.com', 'testuser');

INSERT INTO user_sessions (user_id)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid);

-- Create test group
INSERT INTO groups (id, name, created_by, members, admin_ids)
VALUES (
  '00000000-0000-0000-0000-000000000002'::uuid,
  'Test Group',
  '00000000-0000-0000-0000-000000000001'::uuid,
  ARRAY['00000000-0000-0000-0000-000000000001'::uuid],
  ARRAY['00000000-0000-0000-0000-000000000001'::uuid]
);

-- Test bootstrap
SELECT get_bootstrap_payload(
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid
);
-- Should return complete payload with user, group, cards, auctions, etc.
```

### Test Bidding Function

```sql
-- Create test card
INSERT INTO cards (id, name, image_url, rarity, owner_id, group_id)
VALUES (
  '00000000-0000-0000-0000-000000000003'::uuid,
  'Test Card',
  'https://example.com/card.jpg',
  'common',
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid
);

-- Create test auction
INSERT INTO auctions (
  id, card_id, group_id, seller_id, seller_username,
  card_name, end_time, status
)
VALUES (
  '00000000-0000-0000-0000-000000000004'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  'testuser',
  'Test Card',
  NOW() + INTERVAL '1 hour',
  'active'
);

-- Give user some coins
UPDATE user_sessions
SET group_balances = jsonb_set(
  group_balances,
  ARRAY['00000000-0000-0000-0000-000000000002'],
  '1000'
)
WHERE user_id = '00000000-0000-0000-0000-000000000001'::uuid;

-- Test bid
SELECT process_bid(
  '00000000-0000-0000-0000-000000000004'::uuid, -- auction_id
  '00000000-0000-0000-0000-000000000001'::uuid, -- bidder_id
  'testuser',                                     -- bidder_name
  100,                                            -- bid_amount
  '00000000-0000-0000-0000-000000000002'::uuid  -- group_id
);
-- Should succeed and return rarity, cost, etc.
```

## 📚 Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Materialized Views](https://www.postgresql.org/docs/current/rules-materializedviews.html)

## 🐛 Troubleshooting

### "Permission denied" errors

Check that:
1. RLS is properly configured
2. User is authenticated (`auth.uid()` is not null)
3. Policies match your use case

Debug:
```sql
-- Check current user
SELECT auth.uid();

-- Check policy for table
SELECT * FROM pg_policies WHERE tablename = 'your_table';

-- Test query as specific user (requires superuser)
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'user-uuid-here';
SELECT * FROM your_table;
```

### Materialized views not refreshing

Check triggers:
```sql
-- List triggers
SELECT * FROM pg_trigger WHERE tgname LIKE 'trg_refresh_%';

-- Manually refresh
SELECT refresh_all_materialized_views();
```

### Slow queries

Use `EXPLAIN ANALYZE`:
```sql
EXPLAIN ANALYZE
SELECT * FROM your_query_here;

-- Look for "Seq Scan" (bad) vs "Index Scan" (good)
-- Check if expected indexes are being used
```

## 📞 Support

Issues? Check:
1. SQL execution logs in Supabase dashboard
2. Postgres logs for detailed errors
3. Run validation queries above
4. Check migration documentation in parent directory

---

**Next Steps:**
1. Run setup scripts (this guide)
2. Test authentication flow
3. Run data migration from Firebase
4. Update client code to use Supabase
5. Deploy and test in staging
6. Cutover to production

