#!/bin/bash

# Supabase SQL Deployment Helper
# Makes manual deployment as easy as possible

echo "═══════════════════════════════════════════════════════════"
echo "🚀 Supabase SQL Deployment"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Open Supabase SQL Editor
echo "📂 Opening Supabase SQL Editor in browser..."
open "https://supabase.com/dashboard/project/ikizpnzgknmfhdituyyk/sql/new"

echo ""
echo "📋 Step 1: Deploy Migrations"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Copy this SQL (Cmd+C):"
echo ""
echo "────────────────────────────────────────────────────────────"
cat temp-migrations.sql
echo "────────────────────────────────────────────────────────────"
echo ""
echo "✅ Paste in SQL Editor → Click RUN → Wait for success"
echo ""
read -p "Press ENTER when migrations are deployed..."

echo ""
echo "📋 Step 2: Deploy Storage Policies"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Copy this SQL (Cmd+C):"
echo ""
echo "────────────────────────────────────────────────────────────"
cat temp-storage-policies.sql
echo "────────────────────────────────────────────────────────────"
echo ""
echo "✅ Paste in SQL Editor → Click RUN → Wait for success"
echo ""
read -p "Press ENTER when storage policies are deployed..."

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ Deployment Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "🧪 Test your app now:"
echo "   1. Login"
echo "   2. Create a group"
echo "   3. Mint a card (Coin tab)"
echo "   4. Place a bid on an auction"
echo ""
echo "📚 Documentation: SUPABASE_MIGRATION_COMPLETE.md"
echo ""
