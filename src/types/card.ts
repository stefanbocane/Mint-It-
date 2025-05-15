export type Card = {
  id: string;
  imageUrl: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  name?: string;
  mintedAt?: string;
  userId?: string;
  groupId?: string;
  inTrade?: boolean;
  inAuction?: boolean;
  tradeId?: string;
  auctionId?: string;
}; 