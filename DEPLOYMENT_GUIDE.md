# Supabase Migration Deployment Guide

## Pre-Deployment Checklist

- [ ] All SQL scripts tested in Supabase SQL Editor
- [ ] All database functions working (`test-supabase-functions.js` passes)
- [ ] Migration script tested with sample data
- [ ] App tested locally with Supabase
- [ ] Firebase backup created
- [ ] Rollback plan documented and understood
- [ ] Monitoring/alerts configured
- [ ] Team notified of migration window

---

## Deployment Timeline

**Recommended: Low-traffic period (2-4 AM local time)**

**Estimated Duration: 2-4 hours**

- Database setup: 30 min
- Data migration: 1-2 hours (depends on data size)
- Testing: 30 min
- App deployment: 30 min
- Verification: 30 min

---

## Phase 1: Database Setup (30 min)

### 1.1 Run SQL Scripts in Order

In Supabase SQL Editor, run each script in sequence:

```sql
-- 1. Core schema
\i supabase/01-schema.sql

-- 2. Database functions
\i supabase/02-functions.sql

-- 3. Materialized views
\i supabase/03-materialized-views.sql

-- 4. RLS policies
\i supabase/04-policies.sql

-- 5. Performance indexes
\i supabase/05-indexes.sql

-- 6. Auth trigger
\i supabase/06-auth-trigger.sql

-- 7. Enable Realtime
\i supabase/07-enable-realtime.sql

-- 8. Migration helpers
\i supabase/08-migration-helpers.sql
```

**Or use the master script:**
```sql
\i supabase/00-setup-all.sql
```

### 1.2 Verify Database Setup

```sql
-- Check tables
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema = 'public';
-- Expected: 12

-- Check functions
SELECT COUNT(*) FROM information_schema.routines
WHERE routine_schema = 'public';
-- Expected: 27+

-- Check materialized views
SELECT COUNT(*) FROM pg_matviews;
-- Expected: 5

-- Check RLS enabled
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = true;
-- Expected: All 12 tables

-- Check Realtime enabled
SELECT COUNT(*) FROM pg_publication_tables
WHERE pubname = 'supabase_realtime';
-- Expected: 6
```

### 1.3 Run Automated Tests

```bash
node test-supabase-functions.js
```

**Expected output:**
```
🧪 Running Supabase Function Tests

Testing update_balance()... ✅ PASS
Testing update_gems()... ✅ PASS
Testing process_bid()... ✅ PASS
Testing award_xp()... ✅ PASS
Testing get_bootstrap_payload()... ✅ PASS

📊 Test Results:
   Passed: 5
   Failed: 0
   Total:  5

✅ All tests passed!
```

---

## Phase 2: Data Migration (1-2 hours)

### 2.1 Backup Firebase Data

```bash
# Export Firestore (recommended)
firebase firestore:export gs://your-bucket/firestore-backup-$(date +%Y%m%d)

# Or use Firebase console: Settings → Backup → Export
```

### 2.2 Prepare Migration Script

```bash
# Install dependencies
npm install firebase-admin @supabase/supabase-js dotenv

# Verify service account key exists
ls service-account-key.json
# If missing, download from Firebase Console

# Verify .env.supabase has service role key
cat .env.supabase | grep SUPABASE_SERVICE_ROLE_KEY
```

### 2.3 Run Migration (Dry Run First)

**Option A: Dry Run (Recommended First)**

Edit `migrate-firestore-to-postgres.js`:
- Comment out all `.insert()` calls
- Just log what would be migrated

```bash
node migrate-firestore-to-postgres.js
```

Review output, verify counts look correct.

**Option B: Full Migration**

Uncomment `.insert()` calls, run:

```bash
node migrate-firestore-to-postgres.js 2>&1 | tee migration.log
```

**Monitor progress:**
- Watch console output
- Check `migration.log` for errors
- Monitor Supabase Dashboard → Database → Tables (row counts)

### 2.4 Verify Migration

```sql
-- Run verification function
SELECT * FROM verify_migration();

-- Check row counts
SELECT
  'users' AS table_name, COUNT(*) FROM users
UNION ALL
SELECT 'groups', COUNT(*) FROM groups
UNION ALL
SELECT 'cards', COUNT(*) FROM cards
UNION ALL
SELECT 'auctions', COUNT(*) FROM auctions
UNION ALL
SELECT 'trades', COUNT(*) FROM trades
UNION ALL
SELECT 'posts', COUNT(*) FROM posts;

-- Compare with Firebase counts (from console or export)
```

### 2.5 Refresh Materialized Views

```sql
SELECT refresh_all_views();

-- Verify views populated
SELECT COUNT(*) FROM mv_auction_overview;
SELECT COUNT(*) FROM mv_card_overview;
SELECT COUNT(*) FROM mv_trade_overview;
SELECT COUNT(*) FROM mv_social_overview;
SELECT COUNT(*) FROM mv_leaderboard;
```

---

## Phase 3: App Deployment (30 min)

### 3.1 Environment Variables

Verify `.env` file has correct values:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://REDACTED_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 3.2 Build Production App

```bash
# Clear cache
npm run prebuild:clean

# Build for iOS
npm run build:ios

# Build for Android
npm run build:android
```

### 3.3 Deploy to App Stores

**iOS (TestFlight first):**
```bash
# Upload to TestFlight
eas build --platform ios --profile preview
eas submit --platform ios
```

**Android (Internal Testing first):**
```bash
# Upload to Play Console
eas build --platform android --profile preview
eas submit --platform android
```

### 3.4 Enable Gradual Rollout

**Recommended rollout schedule:**
- Day 1: 10% of users (TestFlight/Internal Testing)
- Day 2: 25% of users
- Day 3: 50% of users
- Day 4: 100% of users

**Monitor during rollout:**
- Crash rates (Sentry/Crashlytics)
- Error logs (Supabase Dashboard → Logs)
- User feedback
- Performance metrics

---

## Phase 4: Post-Deployment Testing (30 min)

### 4.1 Smoke Tests

**Test on real device:**

1. **Authentication**
   - [ ] New user signup works
   - [ ] Existing user login works (after password reset)
   - [ ] Logout works

2. **Core Features**
   - [ ] View auctions
   - [ ] Place bid
   - [ ] Balance updates correctly
   - [ ] Realtime updates work
   - [ ] Create trade
   - [ ] View collection
   - [ ] Post to social feed

3. **Performance**
   - [ ] App loads in <3 seconds
   - [ ] Bootstrap completes in <500ms
   - [ ] Bid transaction in <1 second
   - [ ] No lag on UI

### 4.2 Verify Database Performance

```sql
-- Check slow queries (last hour)
SELECT
  query,
  calls,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Check connection count
SELECT COUNT(*) FROM pg_stat_activity;
-- Should be low (<50)

-- Check table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Phase 5: User Communication

### 5.1 Password Reset Notification

**Option A: Email all users** (recommended)

```javascript
// Send bulk emails via your email service
const users = await supabase.from('users').select('email');

users.data.forEach(async (user) => {
  await sendEmail({
    to: user.email,
    subject: 'CardMates App Update - Password Reset Required',
    body: `
      Hi there!

      We've upgraded CardMates to a faster, more reliable backend.
      Please reset your password to continue using the app:

      [Reset Password Link]

      Thanks for your patience!
    `
  });
});
```

**Option B: In-app banner**

Add to App.js:
```javascript
{migratedUser && !passwordReset && (
  <Banner
    visible={true}
    actions={[
      {
        label: 'Reset Password',
        onPress: () => navigation.navigate('ResetPassword'),
      },
    ]}
  >
    Please reset your password to continue using CardMates.
  </Banner>
)}
```

**Option C: Password reset via Supabase Dashboard**

For small user base, manually send resets via Dashboard → Authentication → Users

---

## Phase 6: Monitoring & Alerts (Ongoing)

### 6.1 Set Up Monitoring

**Supabase Dashboard:**
- Database → Logs (monitor errors)
- API → Logs (monitor requests)
- Database → Performance (slow queries)

**External Monitoring:**
- Set up Sentry for client errors
- Set up Datadog/New Relic for backend (optional)
- Set up UptimeRobot for API availability

### 6.2 Configure Alerts

**Critical Alerts:**
- Database CPU > 80%
- Database connections > 80% of max
- Error rate > 5%
- API latency p95 > 500ms

**Create alerts in Supabase:**
- Settings → Integrations → Webhooks
- Send to Slack/Discord/Email

---

## Phase 7: Firebase Cleanup (After 7 days)

### 7.1 Verify Supabase Stable

Wait 7 days with Supabase in production. Monitor:
- No critical bugs
- Performance stable
- User feedback positive
- Error rates normal

### 7.2 Disable Firebase Services

```bash
# Stop Firebase Functions
firebase functions:delete --all

# Disable Firestore writes (read-only mode)
# Update firestore.rules:
# match /{document=**} {
#   allow read: if true;
#   allow write: if false;
# }

# Export final backup
firebase firestore:export gs://your-bucket/firestore-final-backup
```

### 7.3 Downgrade Firebase Plan

- Firebase Console → Settings → Usage & Billing
- Downgrade to Spark (free) plan
- Keep data for 30 days (in case rollback needed)

### 7.4 Archive Migration Artifacts

```bash
# Create archive
tar -czf migration-archive.tar.gz \
  migration.log \
  migration-errors.json \
  service-account-key.json \
  migrate-firestore-to-postgres.js

# Move to secure storage (S3, Google Drive, etc.)
# DELETE from local machine

# Remove service account key
rm service-account-key.json
```

---

## Rollback Procedure

**If critical issues discovered within first 7 days:**

### Step 1: Revert App Code

```bash
# Revert git commits
git revert HEAD~5  # Adjust based on commits

# Rebuild app with Firebase
npm run build:ios
npm run build:android

# Deploy emergency update
eas submit --platform all
```

### Step 2: Re-enable Firebase

```bash
# Update firestore.rules (allow writes)
firebase deploy --only firestore:rules

# Redeploy Functions if needed
cd functions && firebase deploy --only functions
```

### Step 3: Notify Users

Send notification:
```
We've temporarily reverted to our previous backend while we resolve an issue.
No action required. Thank you for your patience.
```

### Step 4: Investigate Issues

- Review error logs (Sentry, Supabase)
- Identify root cause
- Fix in staging environment
- Re-test before re-deploying

---

## Success Metrics

**Deployment is successful when:**

- [ ] All users can login
- [ ] Zero critical errors in first 24 hours
- [ ] Average response time < 200ms
- [ ] No data loss or corruption
- [ ] User-reported bugs < baseline
- [ ] Firebase costs stopped
- [ ] Supabase costs within budget ($25/month)

**Performance Targets:**
- Bootstrap load: <100ms (vs 200-500ms Firebase)
- Bid transaction: <200ms (vs 150-300ms Firebase)
- Balance query: <50ms (vs 50-100ms Firebase)
- Total reads per session: <10 (vs 300+ Firebase)

**Cost Targets:**
- Firebase: $162/month → $0/month (free tier)
- Supabase: $25/month (Pro tier)
- **Savings: $137/month = $1,644/year**

---

## Post-Deployment Checklist

### Day 1
- [ ] Monitor error logs every hour
- [ ] Check database performance
- [ ] Verify Realtime subscriptions working
- [ ] Respond to user feedback
- [ ] Document any issues

### Day 2-7
- [ ] Monitor error logs twice daily
- [ ] Check slow queries
- [ ] Verify data integrity
- [ ] Collect user feedback
- [ ] Measure performance metrics

### Day 7+
- [ ] Disable Firebase (if stable)
- [ ] Archive migration files
- [ ] Update documentation
- [ ] Team retrospective
- [ ] Celebrate success! 🎉

---

## Emergency Contacts

**Database Issues:**
- Supabase Support: support@supabase.io
- Dashboard: https://supabase.com/dashboard

**App Issues:**
- Expo Status: https://status.expo.dev
- Expo Support: expo.dev/support

**Team Escalation:**
- Add your team contacts here

---

## Final Notes

- **Don't rush**: Better to delay than deploy broken code
- **Monitor closely**: First 48 hours are critical
- **Keep Firebase running**: Don't disable until 100% confident
- **Communicate**: Keep users informed of any issues
- **Document**: Record everything learned for future migrations

**Good luck! 🚀**
