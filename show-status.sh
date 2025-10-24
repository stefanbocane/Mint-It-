#!/bin/bash

# Quick status check for Supabase migration

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "📊 Supabase Migration Status"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if SQL files exist
echo "📄 SQL Files:"
if [ -f "temp-migrations.sql" ]; then
  echo "   ✅ temp-migrations.sql (ready to deploy)"
else
  echo "   ❌ temp-migrations.sql (missing)"
fi

if [ -f "temp-storage-policies.sql" ]; then
  echo "   ✅ temp-storage-policies.sql (ready to deploy)"
else
  echo "   ❌ temp-storage-policies.sql (missing)"
fi

echo ""

# Check services
echo "🔧 Services Created:"
[ -f "src/services/AuctionServiceSupabase.js" ] && echo "   ✅ AuctionServiceSupabase" || echo "   ❌ AuctionServiceSupabase"
[ -f "src/services/CardServiceSupabase.js" ] && echo "   ✅ CardServiceSupabase" || echo "   ❌ CardServiceSupabase"
[ -f "src/services/TradeServiceSupabase.js" ] && echo "   ✅ TradeServiceSupabase" || echo "   ❌ TradeServiceSupabase"
[ -f "src/services/StatsServiceSupabase.js" ] && echo "   ✅ StatsServiceSupabase" || echo "   ⬜ StatsServiceSupabase (pending)"
[ -f "src/services/XPServiceSupabase.js" ] && echo "   ✅ XPServiceSupabase" || echo "   ⬜ XPServiceSupabase (pending)"
[ -f "src/services/SetsServiceSupabase.js" ] && echo "   ✅ SetsServiceSupabase" || echo "   ⬜ SetsServiceSupabase (pending)"

echo ""

# Check documentation
echo "📚 Documentation:"
[ -f "WHAT_TO_DO_NOW.md" ] && echo "   ✅ WHAT_TO_DO_NOW.md"
[ -f "MIGRATION_FINAL_SUMMARY.md" ] && echo "   ✅ MIGRATION_FINAL_SUMMARY.md"
[ -f "SUPABASE_MIGRATION_COMPLETE.md" ] && echo "   ✅ SUPABASE_MIGRATION_COMPLETE.md"
[ -f "QUICK_DEPLOY.md" ] && echo "   ✅ QUICK_DEPLOY.md"

echo ""

# Count Firebase imports remaining
FIREBASE_IMPORTS=$(grep -r "from 'firebase" src/ --include="*.js" 2>/dev/null | wc -l | xargs)
echo "🔍 Firebase Imports Remaining: $FIREBASE_IMPORTS"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "📋 Next Steps"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "1. Deploy SQL files:"
echo "   ./DEPLOY_NOW.sh"
echo ""
echo "2. Test the app:"
echo "   npm start"
echo ""
echo "3. Read documentation:"
echo "   cat WHAT_TO_DO_NOW.md"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
