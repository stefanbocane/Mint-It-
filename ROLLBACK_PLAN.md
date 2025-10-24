# Rollback Plan - Supabase Migration

## When to Rollback

Rollback immediately if ANY of these occur:

### Critical Issues (Immediate Rollback)
- [ ] Users unable to login (>10% failure rate)
- [ ] Data corruption detected
- [ ] Balance/transaction errors (coins lost/duplicated)
- [ ] Crash rate >5%
- [ ] Database unavailable >5 minutes
- [ ] Security breach detected

### Major Issues (Rollback within 24 hours)
- [ ] Performance degradation >50%
- [ ] User-reported bugs >20 in first 24 hours
- [ ] Key features broken (bidding, trading, etc.)
- [ ] Realtime updates not working
- [ ] Error rate >1%

### Minor Issues (Monitor, may not require rollback)
- [ ] UI glitches
- [ ] Non-critical features broken
- [ ] Performance slightly slower
- [ ] Individual user issues

---

## Rollback Procedure

### Phase 1: Emergency Response (15 min)

**1. Notify Team**
```
ALERT: Initiating rollback of Supabase migration
Reason: [describe issue]
ETA: 60 minutes
```

**2. Assess Scope**
- How many users affected?
- What functionality is broken?
- Is data at risk?
- Can we fix forward or must rollback?

**3. Decision**
- **Fix Forward**: If issue is minor and fixable quickly
- **Rollback**: If critical or fix time unknown

---

### Phase 2: Code Rollback (30 min)

**1. Revert Git Commits**

```bash
# Check git log to see migration commits
git log --oneline -20

# Revert to commit before migration
git revert HEAD~10  # Adjust number based on commits
# Or
git reset --hard COMMIT_HASH_BEFORE_MIGRATION
git push --force origin main
```

**2. Restore Firebase Imports**

Verify these files reverted to Firebase versions:
```bash
# Check imports
grep -r "AuthContextSupabase" src/
# Should return 0 results

grep -r "UnifiedUserDataContextSupabase" src/
# Should return 0 results

grep -r "from '../config/supabase'" src/
# Should return 0 results
```

**3. Update Environment Variables**

```bash
# Restore Firebase config in .env (if changed)
# EXPO_PUBLIC_FIREBASE_API_KEY=...
# EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
# etc.
```

---

### Phase 3: Firebase Re-enablement (15 min)

**1. Re-enable Firestore Writes**

Firebase Console → Firestore → Rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Restore original rules
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId;
    }

    match /auctions/{auctionId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }

    // ... restore all original rules
  }
}
```

Click **Publish**

**2. Re-enable Cloud Functions**

```bash
cd functions

# Redeploy if deleted
firebase deploy --only functions

# Or re-enable if disabled
# Firebase Console → Functions → Enable
```

**3. Verify Firebase Working**

```bash
# Test write
# Firebase Console → Firestore → Add document manually
# Should succeed

# Test function
# Firebase Console → Functions → Logs
# Should see recent invocations
```

---

### Phase 4: App Redeployment (45 min)

**1. Clear Build Cache**

```bash
rm -rf node_modules
rm -rf .expo
rm -rf ios
rm -rf android
npm install
npm run prebuild:clean
```

**2. Build Production App**

```bash
# iOS
eas build --platform ios --profile production

# Android
eas build --platform android --profile production
```

**3. Submit to Stores**

```bash
# iOS
eas submit --platform ios --latest

# Android
eas submit --platform android --latest
```

**4. Emergency Release**

If critical, use **Phased Release Override**:
- iOS: App Store Connect → Release → Pause Phased Release → Release to All Users
- Android: Play Console → Release → Full Rollout

---

### Phase 5: Data Reconciliation (variable)

**If data was written to Supabase during rollback period:**

**1. Export Supabase Data**

```bash
# Use migration script in reverse
node export-supabase-to-json.js
# Creates JSON files: users.json, auctions.json, etc.
```

**2. Merge with Firebase**

```javascript
// For each collection
const supabaseUsers = require('./users.json');
const batch = db.batch();

supabaseUsers.forEach(user => {
  const ref = db.collection('users').doc(user.id);

  // Check if exists in Firebase
  ref.get().then(doc => {
    if (!doc.exists()) {
      // New user created in Supabase, add to Firebase
      batch.set(ref, user);
    } else {
      // User exists, merge data (take most recent)
      const fbData = doc.data();
      const merged = mergeByTimestamp(fbData, user);
      batch.update(ref, merged);
    }
  });
});

batch.commit();
```

**3. Verify No Data Loss**

```sql
-- In Supabase (before disabling)
SELECT COUNT(*) FROM users WHERE created_at > '2025-10-22';
-- Note count

-- In Firebase
// Count documents created after rollback
db.collection('users')
  .where('createdAt', '>', new Date('2025-10-22'))
  .get()
  .then(snap => console.log(snap.size));
// Should match Supabase count
```

---

### Phase 6: User Communication

**Immediate Notification**

```
Subject: CardMates Service Update

We've temporarily reverted to our previous system to resolve a technical issue.

✅ Your data is safe
✅ No action required
✅ Normal service restored

We apologize for any inconvenience. Updates will be shared on [social media].

- CardMates Team
```

**Send via:**
- Push notification (if available)
- Email (all users)
- Social media (Twitter, Discord, etc.)
- In-app banner

---

### Phase 7: Post-Rollback Analysis

**1. Root Cause Analysis**

Document:
- What went wrong?
- Why did it happen?
- How did we detect it?
- How quickly did we respond?
- What could prevent this in future?

**2. Data Integrity Check**

Run these checks:

```javascript
// Firebase
// 1. Check for duplicates
db.collection('users').get().then(snap => {
  const emails = snap.docs.map(d => d.data().email);
  const duplicates = emails.filter((e, i) => emails.indexOf(e) !== i);
  console.log('Duplicate emails:', duplicates);
});

// 2. Check for orphaned data
db.collection('cards').get().then(snap => {
  snap.docs.forEach(doc => {
    const card = doc.data();
    db.collection('users').doc(card.ownerId).get().then(owner => {
      if (!owner.exists) {
        console.log('Orphaned card:', doc.id);
      }
    });
  });
});

// 3. Check balances
db.collection('users').get().then(snap => {
  snap.docs.forEach(doc => {
    const balance = doc.data().balance;
    if (balance < 0) {
      console.error('Negative balance:', doc.id, balance);
    }
  });
});
```

**3. Update Migration Plan**

Add learnings to migration plan:
- What tests were missing?
- What monitoring was missing?
- What documentation was unclear?
- What risks were underestimated?

**4. Schedule Retry**

If rollback due to technical issue:
- Fix issue in staging
- Add additional tests
- Schedule new migration date
- Brief team on changes

---

## Rollback Checklist

### Immediate Actions (0-30 min)
- [ ] Notify team of rollback
- [ ] Assess issue severity
- [ ] Decide: rollback or fix forward
- [ ] Revert git commits
- [ ] Re-enable Firebase writes
- [ ] Re-enable Cloud Functions

### Short-term Actions (30-120 min)
- [ ] Rebuild app with Firebase code
- [ ] Submit to app stores
- [ ] Emergency release (if needed)
- [ ] Notify users
- [ ] Verify Firebase working
- [ ] Monitor error rates

### Follow-up Actions (1-7 days)
- [ ] Data reconciliation (if needed)
- [ ] Root cause analysis
- [ ] Update documentation
- [ ] Team retrospective
- [ ] Plan migration retry (if applicable)

---

## Prevention Strategies

**To avoid needing rollback in future:**

1. **Better Testing**
   - More comprehensive integration tests
   - Load testing before migration
   - Chaos engineering (test failures)

2. **Gradual Rollout**
   - Start with 1% of users
   - Monitor for 24 hours before increasing
   - Use feature flags to toggle Supabase/Firebase

3. **Canary Deployment**
   - Deploy to staging first (1 week)
   - Deploy to beta users (1 week)
   - Deploy to production (gradual)

4. **Feature Flags**
   ```javascript
   const USE_SUPABASE = FeatureFlags.isEnabled('use_supabase');

   const AuthContext = USE_SUPABASE
     ? require('./AuthContextSupabase')
     : require('./AuthContext');
   ```

5. **Monitoring**
   - Set up alerts before migration
   - Monitor error rates continuously
   - Dashboard for key metrics

6. **Rollback Automation**
   - Automated rollback script
   - One-command rollback
   - Automated health checks

---

## Success Criteria for Retry

**Don't retry migration until:**

- [ ] Root cause identified and fixed
- [ ] Additional tests written and passing
- [ ] Staging environment stable for 1 week
- [ ] Team fully briefed on changes
- [ ] Monitoring/alerts improved
- [ ] Rollback procedure tested
- [ ] Low-traffic window scheduled
- [ ] All stakeholders aligned

---

## Support Contacts

**During Rollback:**
- Tech Lead: [contact]
- Database Admin: [contact]
- DevOps: [contact]
- CEO/Decision Maker: [contact]

**External Support:**
- Supabase Support: support@supabase.io
- Firebase Support: firebase.google.com/support
- Expo Support: expo.dev/support

---

## Final Notes

**Remember:**
- Speed is important, but accuracy is critical
- Don't skip data integrity checks
- Communicate clearly with users
- Document everything for next time
- Team health matters - don't burn out

**Rollback is not failure. It's responsible engineering.**
