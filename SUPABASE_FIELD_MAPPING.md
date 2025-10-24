# Supabase Field Name Reference

Quick reference for correct Supabase column names to prevent common errors.

## Users Table

| Firebase/App Field | Supabase Column | Type | Notes |
|-------------------|-----------------|------|-------|
| `profilePicture` | `avatar_url` | TEXT | User's profile image URL |
| `displayName` | `display_name` | TEXT | User's display name |
| `username` | `username` | TEXT | Unique username |
| `expoPushToken` | `expo_push_token` | TEXT | Push notification token |
| `lastActiveGroup` | `last_active_group` | UUID | Last selected group |
| `cardBorders` | `card_borders` | TEXT[] | Array of unlocked border types |
| `initialRewardGroups` | `initial_reward_groups` | UUID[] | Groups user received initial rewards from |

## Cards Table

| Firebase/App Field | Supabase Column | Type | Notes |
|-------------------|-----------------|------|-------|
| `imageUrl` | `image_url` | TEXT | Card image URL |
| `ownerId` | `owner_id` | UUID | Card owner user ID |
| `groupId` | `group_id` | UUID | Group the card belongs to |
| `inTrade` | `in_trade` | BOOLEAN | Is card currently in a trade |
| `inAuction` | `in_auction` | BOOLEAN | Is card currently in auction |
| `tradeId` | `trade_id` | UUID | Associated trade ID |
| `auctionId` | `auction_id` | UUID | Associated auction ID |
| `mintedAt` | `minted_at` | TIMESTAMPTZ | When card was created |
| `borderType` | `border_type` | TEXT | Applied border style |
| `statusUpdateTime` | `status_update_time` | TIMESTAMPTZ | Last status change |

## Trades Table

| Firebase/App Field | Supabase Column | Type | Notes |
|-------------------|-----------------|------|-------|
| `senderId` | `sender_id` | UUID | User who sent the trade |
| `receiverId` | `receiver_id` | UUID | User who received the trade |
| `offeredCards` | `offered_cards` | UUID[] | Cards being offered |
| `requestedCards` | `requested_cards` | UUID[] | Cards being requested |
| `offeredCoins` | `offered_coins` | INT | Coins offered |
| `requestedCoins` | `requested_coins` | INT | Coins requested |
| `groupId` | `group_id` | UUID | Trade group |
| `offeredCardImages` | `offered_card_images` | JSONB | Card images for UI |
| `requestedCardImages` | `requested_card_images` | JSONB | Card images for UI |
| `senderName` | `sender_name` | TEXT | Cached sender name |
| `senderAvatar` | `sender_avatar` | TEXT | Cached sender avatar |
| `receiverName` | `receiver_name` | TEXT | Cached receiver name |
| `receiverAvatar` | `receiver_avatar` | TEXT | Cached receiver avatar |
| `participantIds` | `participant_ids` | UUID[] | Both sender and receiver IDs |

## Auctions Table

| Firebase/App Field | Supabase Column | Type | Notes |
|-------------------|-----------------|------|-------|
| `cardId` | `card_id` | UUID | Card being auctioned |
| `sellerId` | `seller_id` | UUID | User selling the card |
| `sellerUsername` | `seller_username` | TEXT | Cached seller username |
| `sellerAvatarUrl` | `seller_avatar_url` | TEXT | Cached seller avatar |
| `cardName` | `card_name` | TEXT | Cached card name |
| `cardImageUrl` | `card_image_url` | TEXT | Cached card image |
| `startTime` | `start_time` | TIMESTAMPTZ | Auction start |
| `endTime` | `end_time` | TIMESTAMPTZ | Auction end |
| `currentBid` | `current_bid` | INT | Current bid amount |
| `currentBidder` | `current_bidder` | UUID | Current bidder ID |
| `currentBidderName` | `current_bidder_name` | TEXT | Cached bidder name |
| `currentRarity` | `current_rarity` | TEXT | Live rarity level |
| `uniqueBidderCount` | `unique_bidder_count` | INT | Number of unique bidders |
| `lastBidTime` | `last_bid_time` | TIMESTAMPTZ | Time of last bid |
| `lastRarityUpdate` | `last_rarity_update` | TIMESTAMPTZ | Last rarity calculation |
| `completedAt` | `completed_at` | TIMESTAMPTZ | When auction completed |
| `startingBid` | `starting_bid` | INT | Minimum starting bid |

## Groups Table

| Firebase/App Field | Supabase Column | Type | Notes |
|-------------------|-----------------|------|-------|
| `createdBy` | `created_by` | UUID | Group creator |
| `adminIds` | `admin_ids` | UUID[] | Array of admin user IDs |
| `memberCount` | `member_count` | INT | Number of members |
| `isPrivate` | `is_private` | BOOLEAN | Private group flag |
| `mintCost` | `mint_cost` | INT | Cost to mint cards |

## User Sessions Table

| Firebase/App Field | Supabase Column | Type | Notes |
|-------------------|-----------------|------|-------|
| `userId` | `user_id` | UUID | User reference |
| `groupBalances` | `group_balances` | JSONB | Per-group coin balances |
| `groupGems` | `group_gems` | JSONB | Per-group gem counts |
| `totalCards` | `total_cards` | INT | Total cards owned |
| `setsCompleted` | `sets_completed` | INT | Number of completed sets |
| `notificationsUnread` | `notifications_unread` | INT | Unread notification count |

## Common Patterns

### SELECT Queries
```javascript
// ✅ Correct
const { data } = await supabase
  .from('users')
  .select('id, username, display_name, avatar_url')
  .eq('id', userId);

// ❌ Wrong
const { data } = await supabase
  .from('users')
  .select('id, username, displayName, profilePicture') // Wrong column names!
  .eq('id', userId);
```

### UPDATE Queries
```javascript
// ✅ Correct
const { error } = await supabase
  .from('cards')
  .update({ border_type: 'gold' })
  .eq('id', cardId);

// ❌ Wrong
const { error } = await supabase
  .from('cards')
  .update({ borderType: 'gold' }) // Wrong column name!
  .eq('id', cardId);
```

### INSERT Queries
```javascript
// ✅ Correct
const { data, error } = await supabase
  .from('trades')
  .insert({
    sender_id: userId,
    receiver_id: otherId,
    offered_cards: [cardId1, cardId2],
    group_id: groupId
  });

// ❌ Wrong
const { data, error } = await supabase
  .from('trades')
  .insert({
    senderId: userId,        // Wrong!
    receiverId: otherId,     // Wrong!
    offeredCards: [...],     // Wrong!
    groupId: groupId         // Wrong!
  });
```

## Remember

1. **Supabase uses `snake_case`** for column names
2. **JavaScript/App uses `camelCase`** for object properties
3. **Always map between the two** when reading/writing data
4. **Check schema file** (`supabase/01-schema.sql`) when unsure

## Common Mistakes to Avoid

- ❌ `profilePicture` → ✅ `avatar_url`
- ❌ `displayName` → ✅ `display_name`
- ❌ `imageUrl` → ✅ `image_url`
- ❌ `ownerId` → ✅ `owner_id`
- ❌ `groupId` → ✅ `group_id`
- ❌ `borderType` → ✅ `border_type`
- ❌ `inTrade` → ✅ `in_trade`
- ❌ `inAuction` → ✅ `in_auction`
