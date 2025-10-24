#!/bin/bash

# Supabase Migration Runner
# Runs SQL migrations using psql or Supabase CLI

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🚀 Supabase Migration Runner"
echo ""

# Check if .env file exists
if [ -f .env ]; then
    echo "📄 Loading .env file..."
    export $(cat .env | grep -v '^#' | xargs)
fi

# Get Supabase credentials
SUPABASE_URL=${SUPABASE_URL:-${EXPO_PUBLIC_SUPABASE_URL}}
SUPABASE_KEY=${SUPABASE_SERVICE_ROLE_KEY}

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_KEY" ]; then
    echo -e "${RED}❌ Error: Missing Supabase credentials${NC}"
    echo ""
    echo "Please set these environment variables:"
    echo "  SUPABASE_URL=https://xxx.supabase.co"
    echo "  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key"
    echo ""
    echo "Or add them to .env file"
    exit 1
fi

# Extract project ref from URL
PROJECT_REF=$(echo $SUPABASE_URL | sed 's/https:\/\/\(.*\)\.supabase\.co/\1/')

echo "📍 Project: $PROJECT_REF"
echo ""

# Function to run SQL file
run_sql() {
    local file=$1
    local name=$2

    echo -e "${YELLOW}🔄 Running: $name${NC}"

    if [ ! -f "$file" ]; then
        echo -e "${RED}❌ File not found: $file${NC}"
        return 1
    fi

    # Use Supabase REST API to run SQL
    response=$(curl -s -X POST \
        "$SUPABASE_URL/rest/v1/rpc/exec_sql" \
        -H "apikey: $SUPABASE_KEY" \
        -H "Authorization: Bearer $SUPABASE_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"sql_string\": $(cat $file | jq -Rs .)}" \
    )

    if echo "$response" | grep -q "error"; then
        echo -e "${RED}❌ Failed: $response${NC}"
        return 1
    else
        echo -e "${GREEN}✅ $name completed${NC}"
        return 0
    fi
}

# Run migrations
echo "🗂️  Running migrations..."
echo ""

run_sql "supabase/09-user-profile-init.sql" "User Profile Init"
run_sql "supabase/10-add-daily-claim-column.sql" "Daily Claim Column"

echo ""
echo -e "${GREEN}✅ All migrations completed!${NC}"
echo ""
echo "📝 Next steps:"
echo "  1. Set up Storage bucket (see SUPABASE_STORAGE_SETUP.md)"
echo "  2. Test card minting (see PHASE_1_TESTING_CHECKLIST.md)"
