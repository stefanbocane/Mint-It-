# Balance Fix - Quick Testing Guide

## What Was Fixed

**CRITICAL FIX**: Bidding now uses a single atomic transaction to prevent:
- Lost coins if app crashes during bid
- Race conditions between multiple bidders
- Missing refunds when outbid
- Duplicate coin deductions

## Quick Test Scenarios

### ✅ Test 1: Coin a Card (2 minutes)
1. Note your current balance
2. Coin a card (costs 6 coins)
3. **Check**: Balance decreased by exactly 6 coins
4. **Check**: Card and auction created

**Expected Logs**:
```
💰 Creating card, auction, and deducting coins in single transaction...
✅ Card, auction created and 6 coins deducted atomically
💰 Balance: 50 → 44
```

### ✅ Test 2: Place First Bid (2 minutes)
1. Note your current balance
2. Bid 10 coins on an auction
3. **Check**: Balance decreased by 11 coins (10 + 1 tax)
4. **Check**: You are the current bidder

**Expected Logs**:
```
💰 THIRD PASS: Placing bid 10 on auction abc123
🎯 [BidTransaction] Auction abc123: uncommon (1 bidders, 10 coins)
💰 [BidTransaction] Deducting 11 coins from user123 (bid: 10 + tax: 1)
✅ [BidTransaction] Complete: 10 on auction abc123
```

### ✅ Test 3: Get Outbid (3 minutes, needs 2 users)
**Setup**: 
- User A balance: 50 coins
- User A bids 10 coins → Balance: 39 coins

**Test**:
1. User B bids 15 coins
2. **Check User A**: Balance = 49 coins (refunded 10, lost 1 tax)
3. **Check User B**: Balance decreased by 16 coins
4. **Check**: User B is current bidder

**Expected Logs (User B's device)**:
```
💰 [BidTransaction] Deducting 16 coins from userB (bid: 15 + tax: 1)
💸 [BidTransaction] Refunding 10 coins to previous bidder userA
✅ [BidTransaction] Refunded 10 coins to userA
```

### ✅ Test 4: Insufficient Balance (1 minute)
1. Have 5 coins
2. Try to bid 10 coins
3. **Check**: Error message shown
4. **Check**: Balance unchanged (still 5 coins)

**Expected Logs**:
```
❌ [BidTransaction] Failed: Error: Insufficient balance: 5 < 11 (bid: 10 + tax: 1)
```

### ✅ Test 5: Race Condition (3 minutes, needs 2 users)
**Setup**: Auction at 10 coins

**Test**:
1. User A and User B both bid 15 coins AT THE SAME TIME
2. **Check**: Only ONE bid succeeds
3. **Check**: Other user gets error "Bid must be higher than current bid"
4. **Check**: Failed user's balance unchanged

**Expected**: Transaction prevents duplicate bids!

## What to Watch For

### ❌ Bad Signs (Report if you see these):
- Balance decreases but bid fails
- Balance doesn't decrease but bid succeeds  
- Get outbid but no refund
- Refund is wrong amount
- Can place bid with insufficient balance

### ✅ Good Signs (Everything working):
- `✅ [BidTransaction] Complete` in logs
- Balance changes match expected amounts
- Refunds happen automatically
- Clear error messages
- No coins lost on failures

## Key Differences from Before

| Scenario | Before | After |
|----------|--------|-------|
| Bid fails | Coins deducted, must refund manually | Coins never deducted |
| Get outbid | No automatic refund | Automatic refund in transaction |
| Race condition | Both users could bid same amount | Transaction prevents it |
| App crash during bid | Lost coins | Transaction rolls back, no loss |

## Console Log Patterns

### Success Pattern ✅
```
💰 THIRD PASS: Placing bid...
🎯 [BidTransaction] Auction...
💰 [BidTransaction] Deducting...
💸 [BidTransaction] Refunding... (if outbidding someone)
✅ [BidTransaction] Complete...
```

### Failure Pattern ❌
```
💰 THIRD PASS: Placing bid...
❌ [BidTransaction] Failed: Error: ...
🚨 THIRD PASS: Bid failed, executing intelligent rollback...
```

## Reporting Issues

If something doesn't work as expected, please provide:
1. **Scenario**: Which test case?
2. **Balances**: Before and after amounts
3. **Console logs**: Copy the `[BidTransaction]` logs
4. **Expected vs Actual**: What should have happened vs what did happen

## Files Changed

1. `src/services/AuctionService.js` - Now handles ALL bid operations atomically
2. `src/hooks/useOptimizedBidding.js` - Simplified, no more manual coin handling
3. `src/screens/CoinScreen.js` - No changes (already atomic)

## Next Steps

1. **Test coin card creation** - Should cost exactly 6 coins
2. **Test bidding flow** - Should deduct bid + 1 tax
3. **Test getting outbid** - Should get refund automatically
4. **Test edge cases** - Insufficient balance, race conditions
5. **Report any issues** - If balances are wrong, share logs

Everything should "just work" now - no more manual balance management needed! 🎉

