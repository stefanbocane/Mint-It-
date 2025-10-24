#!/bin/bash

# Migrate to TrackedFirestore
# This script updates imports to use TrackedFirestore for automatic read tracking

echo "🚀 Migrating to TrackedFirestore for 100% read visibility..."
echo ""

# Backup directory
BACKUP_DIR="./src_backup_$(date +%Y%m%d_%H%M%S)"
echo "📦 Creating backup in $BACKUP_DIR..."
cp -r ./src "$BACKUP_DIR"

# Counter
MIGRATED=0

# High priority files (most reads)
PRIORITY_FILES=(
  "src/services/AuctionService.js"
  "src/services/DataManager.js"
  "src/services/OptimizedPaginationService.js"
  "src/services/UnifiedBootstrapService.js"
  "src/services/UltraEfficientAuctionService.js"
  "src/screens/SocialScreen.js"
  "src/screens/AuctionScreen.js"
  "src/screens/TradesScreen.js"
  "src/screens/LeaderboardScreen.js"
  "src/screens/CreateTradeScreen.js"
)

echo ""
echo "🎯 Migrating high-priority files..."

for file in "${PRIORITY_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "   Migrating: $file"
    
    # Calculate relative path depth
    DEPTH=$(echo "$file" | tr -cd '/' | wc -c)
    if [ $DEPTH -eq 2 ]; then
      # services/ or screens/ -> ../services/ReadTracking/TrackedFirestore
      RELATIVE_PATH="../services/ReadTracking/TrackedFirestore"
    elif [ $DEPTH -eq 3 ]; then
      # deeper nesting -> ../../services/ReadTracking/TrackedFirestore
      RELATIVE_PATH="../../services/ReadTracking/TrackedFirestore"
    else
      RELATIVE_PATH="../services/ReadTracking/TrackedFirestore"
    fi
    
    # Check if file imports from firebase/firestore
    if grep -q "from 'firebase/firestore'" "$file"; then
      # Create temp file with modified imports
      awk -v path="$RELATIVE_PATH" '
      /^import.*\{.*getDoc.*getDocs.*\}.*from.*firebase\/firestore/ {
        # Extract other imports
        match($0, /\{([^}]+)\}/, arr)
        imports = arr[1]
        gsub(/getDoc,?/, "", imports)
        gsub(/getDocs,?/, "", imports)
        gsub(/^[[:space:]]*,?[[:space:]]*/, "", imports)
        gsub(/[[:space:]]*,?[[:space:]]*$/, "", imports)
        gsub(/,[[:space:]]*,/, ",", imports)
        
        if (imports) {
          print "import { " imports " } from '\''firebase/firestore'\'';"
        }
        print "// 🚀 TRACKED: Automatic read monitoring"
        print "import { getDoc, getDocs } from '\''" path "'\'';"
        next
      }
      /^import.*from.*firebase\/firestore/ {
        if (/getDoc/ || /getDocs/) {
          print "// 🚀 TRACKED: Automatic read monitoring"
          print "import { getDoc, getDocs } from '\''" path "'\'';"
          print $0
        } else {
          print
        }
        next
      }
      { print }
      ' "$file" > "$file.tmp"
      
      mv "$file.tmp" "$file"
      ((MIGRATED++))
    else
      echo "      ⏭️  Skipped (no firebase/firestore import)"
    fi
  else
    echo "      ⚠️  File not found: $file"
  fi
done

echo ""
echo "✅ Migration complete!"
echo "   Files migrated: $MIGRATED"
echo "   Backup created: $BACKUP_DIR"
echo ""
echo "📋 Next steps:"
echo "   1. Test the app to ensure it still works"
echo "   2. Check ReadMonitor now shows accurate read counts"
echo "   3. If issues occur, restore from backup: cp -r $BACKUP_DIR/* ./src/"
echo ""




