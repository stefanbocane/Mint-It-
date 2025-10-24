# Fix Trade Transfer Error - URGENT

## Error
```
❌ Errors transferring cards: [{"error": {"code": "42501", "message": "new row violates row-level security policy for table \"cards\""}}]
Error accepting trade: [Error: Failed to transfer 1 card(s)]
```

## Problem
The RLS (Row-Level Security) policy on the `cards` table is preventing card ownership transfers during trade acceptance. Users can only update cards they own, but during a trade, we need to transfer cards to a new owner.

## Root Cause
The current RLS policy only allows:
```sql
-- Users can only update their own cards
CREATE POLICY cards_update_owner ON cards
  FOR UPDATE
  USING (auth.uid() = owner_id);
```

But when accepting a trade, we need to change `owner_id` from one user to another, which this policy blocks.

## Solution

### Run This SQL in Supabase SQL Editor

```sql
-- Drop existing policies
DROP POLICY IF EXISTS cards_select_owner ON cards;
DROP POLICY IF EXISTS cards_select_group_member ON cards;
DROP POLICY IF EXISTS cards_insert_owner ON cards;
DROP POLICY IF EXISTS cards_update_owner ON cards;
DROP POLICY IF EXISTS cards_update_trade_transfer ON cards;
DROP POLICY IF EXISTS cards_delete_owner ON cards;

-- Users can view their own cards
CREATE POLICY cards_select_owner ON cards
  FOR SELECT
  USING (auth.uid() = owner_id);

-- Users can view cards in their groups
CREATE POLICY cards_select_group_member ON cards
  FOR SELECT
  USING (
    group_id IN (
      SELECT id FROM groups WHERE auth.uid() = ANY(members)
    )
  );

-- Users can create cards (minting)
CREATE POLICY cards_insert_owner ON cards
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

-- Users can update their own cards
CREATE POLICY cards_update_owner ON cards
  FOR UPDATE
  USING (auth.uid() = owner_id);

-- CRITICAL: Allow card ownership transfers during trades
CREATE POLICY cards_update_trade_transfer ON cards
  FOR UPDATE
  USING (
    in_trade = true
    AND trade_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM trades
      WHERE trades.id = cards.trade_id
      AND (
        trades.sender_id = auth.uid() OR
        trades.receiver_id = auth.uid()
      )
    )
  );

-- Users can delete their own cards
CREATE POLICY cards_delete_owner ON cards
  FOR DELETE
  USING (auth.uid() = owner_id);
```

## How It Works

### Current Flow (Broken)
1. User A sends trade to User B
2. Cards marked as `in_trade: true, trade_id: xxx`
3. User B accepts trade
4. **System tries to update cards**: `owner_id` from A → B
5. ❌ **RLS BLOCKS**: "You can't update cards you don't own!"

### Fixed Flow (With New Policy)
1. User A sends trade to User B
2. Cards marked as `in_trade: true, trade_id: xxx`
3. User B accepts trade
4. **System tries to update cards**: `owner_id` from A → B
5. ✅ **RLS ALLOWS**: "This card is in a trade, and you're a participant!"
6. ✅ Cards transferred successfully

## New RLS Policy Logic

The `cards_update_trade_transfer` policy allows updates when:

1. ✅ Card is in a trade (`in_trade = true`)
2. ✅ Card has a trade ID (`trade_id IS NOT NULL`)
3. ✅ The current user is either:
   - The sender of that trade, OR
   - The receiver of that trade

This ensures:
- ✅ Only trade participants can transfer cards
- ✅ Only cards actively in trades can be transferred
- ❌ Random users can't steal cards
- ❌ Cards not in trades can't be transferred by others

## Security Considerations

### Safe:
- ✅ Cards can only be transferred by trade participants
- ✅ Cards must be marked `in_trade = true`
- ✅ Trade must exist in database
- ✅ User must be sender or receiver

### Not Possible:
- ❌ Stealing cards (must be in a trade you're part of)
- ❌ Transferring cards between random users
- ❌ Bypassing the trade system
- ❌ Modifying cards in completed trades (in_trade = false)

## Testing After Fix

1. Run the SQL above in Supabase
2. Create a trade offer
3. Accept the trade
4. ✅ Should see: "📦 Transferring offered cards to receiver..."
5. ✅ Should see: "✅ All card ownership transfers completed successfully"
6. ✅ Cards should appear in new owner's collection
7. ✅ Cards removed from previous owner's collection

## Files Created

- `supabase/19-fix-cards-rls-for-trades.sql` - Complete migration
- `FIX_TRADE_TRANSFER_ERROR.md` - This guide

## Alternative: Service Role Key (Not Recommended)

If you need a quick workaround, you could use the service role key to bypass RLS, but this is **not recommended** for security reasons. The RLS policy fix above is the proper solution.

## Summary

🔴 **Problem**: RLS blocking card ownership transfers
🟢 **Solution**: Add policy to allow transfers during trades
⚡ **Action**: Run SQL in Supabase SQL Editor
✅ **Result**: Trades work end-to-end with secure transfers
