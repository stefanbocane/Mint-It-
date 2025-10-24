# Final Migration Checklist - Supabase

## Pre-Migration (1 week before)

### Documentation Review
- [ ] Read `MIGRATION_PROGRESS.md` - understand what was built
- [ ] Read `DEPLOYMENT_GUIDE.md` - understand deployment steps
- [ ] Read `ROLLBACK_PLAN.md` - understand rollback procedure
- [ ] Read `TESTING_PLAN.md` - understand testing requirements
- [ ] Read `MIGRATION_GUIDE.md` - understand data migration

### Team Preparation
- [ ] Schedule migration date/time (low-traffic period)
- [ ] Assign roles (database lead, app lead, support lead)
- [ ] Brief entire team on migration plan
- [ ] Set up war room (Slack channel, video call)
- [ ] Notify stakeholders of migration window
- [ ] Prepare user communication (emails, notifications)

### Technical Preparation
- [ ] Backup Firebase data (`firebase firestore:export`)
- [ ] Download Firebase service account key
- [ ] Verify Supabase project created
- [ ] Verify `.env.supabase` has correct keys
- [ ] Test migration script on sample data
- [ ] Test rollback procedure in staging

---

## Migration Day - T-1 Hour

### Final Checks
- [ ] Team assembled and ready
- [ ] Firebase backup completed (verify in GCS)
- [ ] Supabase database empty (or ready for migration)
- [ ] Migration script tested and ready
- [ ] Rollback plan printed and accessible
- [ ] Monitoring dashboards open
- [ ] Communication templates ready

### Risk Assessment
- [ ] Weather check (no storms affecting cloud providers)
- [ ] Service status check (Supabase, Firebase, Expo all green)
- [ ] Team bandwidth check (no one sick/unavailable)
- [ ] Customer impact assessment (any major users active?)

### Go/No-Go Decision
- [ ] All checklist items above complete
- [ ] Team consensus to proceed
- [ ] Stakeholder approval obtained
- [ ] Backup plan understood by all

**Decision: GO / NO-GO**

---

## Migration Day - T-0 (Start)

### Phase 1: Database Setup (30 min)

#### Step 1.1: Run SQL Scripts
```bash
# In Supabase SQL Editor
\i supabase/00-setup-all.sql
```
- [ ] Script completes without errors
- [ ] 12 tables created
- [ ] 27+ functions created
- [ ] 5 materialized views created
- [ ] 30+ RLS policies created
- [ ] 80+ indexes created

#### Step 1.2: Enable Realtime
```sql
\i supabase/07-enable-realtime.sql
```
- [ ] 6 tables enabled for Realtime
- [ ] Verification query returns expected tables

#### Step 1.3: Test Database Functions
```bash
node test-supabase-functions.js
```
- [ ] All 5 tests pass
- [ ] No errors in output
- [ ] Screenshot of results saved

**Checkpoint 1: Database ready** ✅

---

### Phase 2: Data Migration (1-2 hours)

#### Step 2.1: Pre-Migration Snapshot
```bash
# Note Firebase row counts
echo "Users: $(firebase firestore:count users)"
echo "Groups: $(firebase firestore:count groups)"
echo "Cards: $(firebase firestore:count cards)"
echo "Auctions: $(firebase firestore:count auctions)"
# Save to file: firebase-counts.txt
```
- [ ] Row counts documented
- [ ] Screenshots saved

#### Step 2.2: Run Migration
```bash
node migrate-firestore-to-postgres.js 2>&1 | tee migration.log
```
- [ ] Migration started
- [ ] Progress logs visible
- [ ] No critical errors (some warnings OK)

**Monitor in parallel:**
- [ ] Supabase Dashboard → Database → Tables (watch row counts)
- [ ] Console output for errors
- [ ] System resources (CPU, memory)

#### Step 2.3: Verify Migration
```sql
SELECT * FROM verify_migration();
```
- [ ] Row counts match Firebase
- [ ] No orphaned records
- [ ] Zero data integrity issues

#### Step 2.4: Refresh Views
```sql
SELECT refresh_all_views();
```
- [ ] All 5 views refreshed
- [ ] Views populated with data

**Checkpoint 2: Data migrated** ✅

---

### Phase 3: App Deployment (30 min)

#### Step 3.1: Verify Environment
```bash
cat .env | grep SUPABASE
```
- [ ] EXPO_PUBLIC_SUPABASE_URL correct
- [ ] EXPO_PUBLIC_SUPABASE_ANON_KEY correct

#### Step 3.2: Build App
```bash
# Clear cache
npm run prebuild:clean

# Build iOS
eas build --platform ios --profile production

# Build Android
eas build --platform android --profile production
```
- [ ] iOS build succeeds
- [ ] Android build succeeds
- [ ] Build artifacts available

#### Step 3.3: Deploy (Gradual Rollout)
```bash
# Submit to TestFlight (iOS)
eas submit --platform ios --latest

# Submit to Internal Testing (Android)
eas submit --platform android --latest
```
- [ ] iOS submitted
- [ ] Android submitted
- [ ] Set to 10% rollout initially

**Checkpoint 3: App deployed** ✅

---

### Phase 4: Testing (30 min)

#### Step 4.1: Device Testing
**Test on real device (not simulator):**

- [ ] Install app from TestFlight/Internal Testing
- [ ] **Signup** - new user account
  - [ ] User created in Supabase
  - [ ] Profile auto-created
  - [ ] Can login after signup
- [ ] **Login** - existing user (will fail - expected)
- [ ] **Password Reset** - send reset email, verify works
- [ ] **Login After Reset** - existing user can now login
- [ ] **View Auctions** - list loads correctly
- [ ] **Place Bid** - bidding works
- [ ] **Balance Updates** - balance decreases correctly
- [ ] **Realtime Updates** - other users' bids appear instantly
- [ ] **View Collection** - cards load
- [ ] **Create Trade** - trade creation works
- [ ] **Social Feed** - posts load

#### Step 4.2: Performance Testing
```bash
# In Supabase Dashboard → API → Logs
# Check response times
```
- [ ] Bootstrap load <100ms
- [ ] Bid transaction <200ms
- [ ] Balance query <50ms
- [ ] No slow queries (>500ms)

#### Step 4.3: Database Health
```sql
-- Check connections
SELECT COUNT(*) FROM pg_stat_activity;
-- Should be low (<50)

-- Check slow queries
SELECT query, mean_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 10;
-- Should be empty or minimal
```
- [ ] Connection count healthy
- [ ] No slow queries
- [ ] No errors in logs

**Checkpoint 4: Testing complete** ✅

---

### Phase 5: User Communication (15 min)

#### Step 5.1: Send Password Reset Notification
```javascript
// Via email service or Supabase
const { data: users } = await supabase.from('users').select('email');

users.forEach(user => {
  // Send email or trigger password reset
});
```
- [ ] Email template reviewed
- [ ] Emails sent (or scheduled)
- [ ] Support team briefed on expected questions

#### Step 5.2: Post Migration Announcement
```
Subject: CardMates Upgrade Complete! 🎉

Great news! We've successfully upgraded CardMates to a faster, more reliable backend.

What you need to do:
1. Update your app from the App Store
2. Reset your password (link below)
3. Enjoy faster performance!

[Reset Password Button]

Questions? Contact support@cardmates.com

Thanks!
- CardMates Team
```
- [ ] Announcement sent via email
- [ ] Posted on social media
- [ ] In-app banner active (if implemented)

**Checkpoint 5: Users notified** ✅

---

## Migration Day - T+1 Hour (Monitoring)

### Immediate Monitoring (Every 15 min for first hour)

**Supabase Dashboard:**
- [ ] No error spikes in Logs
- [ ] Database CPU <50%
- [ ] API requests succeeding
- [ ] Realtime connections stable

**App Monitoring (Sentry/Crashlytics):**
- [ ] Crash rate <1%
- [ ] Error rate <1%
- [ ] No critical errors

**User Feedback:**
- [ ] Check support channels
- [ ] Check app store reviews
- [ ] Check social media mentions

**If any critical issues:** → Execute `ROLLBACK_PLAN.md`

---

## Migration Day - T+6 Hours (Extended Monitoring)

### Health Check (Every hour)

- [ ] Database performance stable
- [ ] Error rate still <1%
- [ ] User complaints minimal (<5)
- [ ] Key metrics within targets:
  - [ ] Bootstrap: <100ms
  - [ ] Bid transaction: <200ms
  - [ ] Balance query: <50ms

### Rollout Expansion
If all green for 6 hours:
- [ ] Increase rollout to 25%
- [ ] Monitor for another 6 hours

---

## Migration Day - T+24 Hours

### Daily Health Check

- [ ] Review last 24 hours of logs
- [ ] Check database performance trends
- [ ] Review user feedback
- [ ] Document any issues and resolutions
- [ ] Update stakeholders

### Success Metrics
- [ ] Zero critical errors
- [ ] Performance targets met
- [ ] User feedback positive (or neutral)
- [ ] No data loss reported

**Decision: Continue rollout to 50% or rollback?**

---

## T+48 Hours

### Rollout Complete
- [ ] Increase to 100% rollout
- [ ] Monitor closely for 24 hours
- [ ] Prepare Firebase shutdown

---

## T+7 Days (One Week Post-Migration)

### Final Verification

#### Database
- [ ] All queries performing well
- [ ] No data integrity issues
- [ ] Materialized views updating correctly
- [ ] RLS policies working as expected

#### App
- [ ] Crash rate back to baseline (or better)
- [ ] User retention stable
- [ ] Key metrics improved:
  - [ ] Read operations: 300+ → <10 per session ✅
  - [ ] Latency: 200-500ms → <100ms ✅
  - [ ] Cost: $162/mo → $25/mo ✅

#### Users
- [ ] Most users have reset passwords
- [ ] Support tickets back to normal
- [ ] Positive feedback received

### Firebase Shutdown
- [ ] Disable Cloud Functions
- [ ] Set Firestore to read-only
- [ ] Export final backup
- [ ] Downgrade to free tier
- [ ] Archive migration files

**Checkpoint 6: Migration complete** ✅ 🎉

---

## Post-Migration (Ongoing)

### Week 2-4
- [ ] Monitor performance trends
- [ ] Optimize slow queries (if any)
- [ ] Gather user feedback
- [ ] Document lessons learned

### Month 2
- [ ] Delete Firebase data (after 30-day safety period)
- [ ] Remove Firebase dependencies from codebase
- [ ] Update documentation
- [ ] Team retrospective

### Month 3+
- [ ] Measure cost savings (target: $137/month)
- [ ] Measure performance improvements
- [ ] Plan next optimizations
- [ ] Share success story

---

## Emergency Contacts

**During Migration:**
- Database Lead: __________
- App Lead: __________
- Support Lead: __________
- Decision Maker: __________

**External:**
- Supabase Support: support@supabase.io
- Firebase Support: firebase.google.com/support
- Expo Support: expo.dev/support

---

## Sign-Off

**Pre-Migration:**
- [ ] Tech Lead: __________ Date: ______
- [ ] Database Admin: __________ Date: ______
- [ ] Product Owner: __________ Date: ______

**Post-Migration:**
- [ ] Migration Successful: __________ Date: ______
- [ ] Firebase Disabled: __________ Date: ______
- [ ] Project Closed: __________ Date: ______

---

## Celebration! 🎉

**When migration is fully complete:**
- [ ] Team celebration scheduled
- [ ] Success shared with stakeholders
- [ ] Lessons documented for future projects
- [ ] Migration artifacts archived

**Congratulations on completing the Firebase → Supabase migration!**

**Achievements:**
- ✅ 87% cost reduction ($162 → $25/month)
- ✅ 10-20x faster queries
- ✅ 97% read reduction (300+ → <10 per session)
- ✅ Better data integrity (ACID transactions)
- ✅ More scalable architecture
- ✅ Easier to maintain and extend

**Well done! 🚀**
