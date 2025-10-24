# Fix Border Application Issue - IMMEDIATE ACTION REQUIRED

## Problem
The app is trying to apply borders to cards, but the `cards` table is missing the `border_type` column.

**Error Message:**
```
ERROR  Error applying border: {"code": "PGRST204", "details": null, "hint": null, "message": "Could not find the 'border_type' column of 'cards' in the schema cache"}
```

## Solution

### Step 1: Add the `border_type` Column

Run this SQL in your **Supabase SQL Editor** (https://supabase.com/dashboard/project/YOUR_PROJECT/sql):

```sql
-- Add border_type column to cards table
ALTER TABLE cards
ADD COLUMN IF NOT EXISTS border_type TEXT DEFAULT 'default';

-- Add a comment to explain the column
COMMENT ON COLUMN cards.border_type IS 'Type of border applied to the card (e.g., default, gold, rainbow, etc.)';

-- Verify the column was added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'cards'
AND column_name = 'border_type';
```

### Step 2: Verify the Fix

After running the SQL, you should see output like:
```
column_name  | data_type | column_default
-------------|-----------|---------------
border_type  | text      | 'default'::text
```

### Step 3: Test in the App

1. Open the app and navigate to the Store
2. Purchase a border (or select one you already own)
3. Select a card to apply the border to
4. The border should now apply successfully!

## What This Does

- **Adds `border_type` column** to the `cards` table with a default value of `'default'`
- Allows users to apply custom borders purchased from the store
- All existing cards will automatically have `border_type = 'default'`

## Files Created

- `supabase/18-add-border-type-column.sql` - Migration file (for reference)
- `run-border-migration.js` - Helper script (attempted to run automatically, requires .env setup)

## Migration File Location

The complete migration is saved in:
```
supabase/18-add-border-type-column.sql
```

## Next Steps

Once the column is added:
1. ✅ Users can purchase borders from the store
2. ✅ Users can apply borders to their cards
3. ✅ Borders will be saved and persist across sessions
4. ✅ Cards will display with their custom borders

## Rollback (if needed)

If you need to remove the column:
```sql
ALTER TABLE cards DROP COLUMN IF EXISTS border_type;
```

**Note:** This should only be done if there's a critical issue.
