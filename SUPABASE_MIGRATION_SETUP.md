# Supabase Migration Setup - Complete ✅

## Setup Status

✅ Supabase project created
✅ MCP server configured
✅ Supabase JS client installed
✅ Connection tested successfully
✅ Credentials secured

## Project Details

**Supabase Project**: `ikizpnzgknmfhdituyyk`
**Region**: Set in Supabase dashboard
**Database**: PostgreSQL 15

## Configuration Files

1. **MCP Server Config**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Enables Claude Code to query Supabase database directly
   - Must restart Claude Code to activate

2. **Environment Variables**: `.env.supabase`
   - Contains all Supabase credentials
   - Added to `.gitignore` (never commit!)

3. **Test Script**: `test-supabase-connection.js`
   - Verifies connection works
   - Run with: `node test-supabase-connection.js`

## Next Steps

### 1. Restart Claude Code
**IMPORTANT**: You must restart Claude Code to activate the MCP server.

After restart, Claude will have direct database access to:
- Create tables and indexes
- Write migrations
- Query data structure
- Test queries in real-time

### 2. Begin Migration Planning

Once restarted, we'll proceed with:

#### Phase 1: Schema Design (This Week)
- [ ] Map Firebase collections to PostgreSQL tables
- [ ] Design normalized schema (users, groups, cards, auctions, trades)
- [ ] Create indexes for performance
- [ ] Set up Row Level Security (RLS) policies
- [ ] Create database functions for complex operations

#### Phase 2: Core Services Migration (Week 2-3)
- [ ] Authentication (Firebase Auth → Supabase Auth)
- [ ] User data and balance operations
- [ ] Auction system with Postgres transactions
- [ ] Card collection management
- [ ] Trade system

#### Phase 3: UI Layer Migration (Week 3-4)
- [ ] Update all hooks to use Supabase client
- [ ] Replace Firestore listeners with Supabase real-time
- [ ] Update screens and components
- [ ] Remove Firebase dependencies

#### Phase 4: Testing & Cutover (Week 4+)
- [ ] Parallel testing (Firebase + Supabase)
- [ ] Data migration scripts
- [ ] Production cutover plan
- [ ] Rollback strategy

## Cost Comparison

### Current Firebase (100 users, 300 reads/session, 10 sessions/day):
- **9M reads/month** = ~$162/month (reads only)
- Hidden transaction reads multiply costs
- Unpredictable scaling

### Supabase:
- **$25/month** (Pro tier) = unlimited reads within compute
- Predictable costs
- Better performance at scale

**Estimated savings: $137/month → $1,644/year**

## Why This Migration Makes Sense

1. **Untrackable Transaction Reads**: Your Firebase transactions (bids, balance ops) create invisible reads
2. **Cost Predictability**: Supabase charges for compute, not reads
3. **Better Tooling**: Direct SQL access, better debugging, query optimization
4. **MCP Advantage**: Claude can directly interact with your database for faster development
5. **Scale-Ready**: Postgres handles high transaction volume better than Firestore

## Technical Advantages of Postgres for Your App

### Auctions
- **ACID transactions** with true serializable isolation
- **Trigger-based updates** instead of Cloud Functions
- **Materialized views** for instant auction lists (replaces overview docs)
- **Row-level locking** for concurrent bids

### Real-time
- **Postgres LISTEN/NOTIFY** - native pub/sub
- **Supabase Realtime** - WebSocket subscriptions to table changes
- **Less chatty** than Firestore listeners

### Data Model
- **Normalized relations** - no data duplication
- **Foreign keys** - referential integrity
- **Joins** - complex queries in one roundtrip
- **Aggregations** - COUNT, SUM, AVG built-in

## What Happens When You Restart

After restarting Claude Code, you'll see a new MCP tool available called `postgres-supabase`.

I'll be able to:
- Execute SQL queries directly
- Create tables and schemas
- Test migrations before applying to production
- Analyze query performance with EXPLAIN
- Verify data integrity

## Questions or Issues?

If you encounter any issues:
1. Check Supabase dashboard is showing project as active
2. Verify `.env.supabase` has correct credentials
3. Run `node test-supabase-connection.js` to test connection
4. Check MCP config: `cat ~/Library/Application\ Support/Claude/claude_desktop_config.json`

---

**Ready to proceed? Restart Claude Code and let's start planning the schema!**
