import { Image, StyleSheet, Text, View } from 'react-native';
import { Button, Card } from 'react-native-paper';
import { RARITY_COLORS } from '../../utils/rarity';
import AuctionTimer from './AuctionTimer';

const AuctionListItem = ({ 
  auction = {}, 
  onPress,
  userCache,
  user,
  cardRarityStyle,
  freshCheck = false,
  onAuctionEnded
}) => {
  // Ensure auction has required properties to prevent errors
  if (!auction || !auction.id) {
    return null; // Don't render if auction data is invalid
  }
  
  // Get color for rarity with fallbacks for missing data
  const getRarityColor = () => {
    // Get the current rarity with appropriate fallbacks
    const rarity = auction?.currentRarity || auction?.cardRarity || 'common';
    
    // If rarity is mystery or unknown, use common
    if (rarity === 'mystery' || rarity === 'unknown' || rarity === '') {
      return RARITY_COLORS.common;
    }
    
    return RARITY_COLORS[rarity] || RARITY_COLORS.common;
  };
  
  const rarityColor = getRarityColor();
  
  // Determine what rarity to display
  const displayRarity = () => {
    // Always prioritize the current rarity for active auctions
    // For completed/expired auctions, use cardRarity (final rarity)
    
    // If auction status is completed, expired, or canceled, use the final cardRarity if valid
    if ((auction.status === 'completed' || auction.status === 'expired' || auction.status === 'canceled') && 
        auction.cardRarity && 
        auction.cardRarity !== 'mystery' && 
        auction.cardRarity !== 'unknown' && 
        auction.cardRarity !== '') {
      return auction.cardRarity.toUpperCase();
    }
    
    // For active auctions, prioritize currentRarity which reflects the live status
    // If currentRarity is missing or mystery, fall back to cardRarity
    let rarity = auction.status === 'active' ? 
               (auction.currentRarity || auction.cardRarity || 'COMMON') : 
               (auction.cardRarity || auction.currentRarity || 'COMMON');
    
    // Always convert mystery/unknown to COMMON
    if (rarity.toLowerCase() === 'mystery' || 
        rarity.toLowerCase() === 'unknown' || 
        rarity === '') {
      rarity = 'COMMON';
    }
    
    return rarity.toUpperCase();
  };
  
  return (
    // Outer wrapper for shadow
    <View style={[styles.shadowWrapper, cardRarityStyle]}>
      {/* Inner wrapper for content with overflow:hidden */}
      <View style={styles.overflowWrapper}>
        <Card 
          style={[
            styles.auctionCard, 
            { 
              backgroundColor: `${rarityColor}10`, // Very light background based on rarity
            }
          ]} 
          mode="elevated"
        >
          <View style={styles.cardInnerContainer}>
            <View style={styles.innerWrapper}>
              <Card.Content style={styles.cardContent}>
                <View style={styles.cardImageContainer}>
                  <View style={styles.imageWrapper}>
                    <Image
                      source={{ uri: auction?.cardImage || 'https://via.placeholder.com/100' }}
                      style={styles.cardImage}
                      resizeMode="cover"
                    />
                    <View style={[styles.rarityBadge, { backgroundColor: `${rarityColor}CC` }]}>
                      <Text style={styles.rarityText}>
                        {displayRarity()}
                      </Text>
                    </View>
                  </View>
                </View>
                
                <View style={styles.cardDetails}>
                  <Text style={styles.cardName} numberOfLines={1}>
                    {auction?.cardName || 'Unknown Card'}
                  </Text>
                  
                  <View style={styles.bidInfo}>
                    <Text style={styles.bidLabel}>Current Bid:</Text>
                    <Text style={[styles.bidAmount, { color: '#000000', fontWeight: 'bold' }]}>
                      {auction?.currentBid || 0} coins
                    </Text>
                  </View>
                  
                  <View style={styles.timeInfo}>
                    <Text style={styles.timeLabel}>Time left:</Text>
                    <AuctionTimer 
                      auction={auction}
                      onEnd={() => {
                        if (onAuctionEnded) onAuctionEnded(auction);
                      }}
                      style={styles.timeValue}
                    />
                  </View>
                  
                  <View style={styles.bidderInfo}>
                    <Text style={styles.bidderLabel}>Top bidder:</Text>
                    <Text style={styles.bidderValue}>
                      {auction?.currentBidder ? 
                        (auction.currentBidder === user?.uid ? 
                          <Text style={[styles.yourBidText, { color: '#4CAF50', fontWeight: 'bold' }]}>You</Text> : 
                          <Text style={{fontWeight: 'bold'}}>{auction?.currentBidderName || 'Unknown'}</Text>) : 
                        <Text style={styles.noBidderText}>No bids yet</Text>}
                    </Text>
                  </View>
                  
                  <View style={styles.rarityInfo}>
                    <Text style={styles.rarityLabel}>Live Rarity:</Text>
                    <Text style={[styles.rarityValue, { color: rarityColor, fontWeight: 'bold' }]}>
                      {displayRarity()}
                    </Text>
                  </View>
                  
                  <View style={styles.actionsContainer}>
                    <Button
                      mode="contained"
                      onPress={() => onPress && onPress(auction)}
                      style={[styles.bidButton, { backgroundColor: rarityColor }]}
                      icon="gavel"
                      contentStyle={styles.bidButtonContent}
                      labelStyle={styles.bidButtonLabel}
                    >
                      Bid
                    </Button>
                  </View>
                </View>
              </Card.Content>
            </View>
          </View>
        </Card>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // New shadow wrapper that contains the shadow properties
  shadowWrapper: {
    margin: 8,
    borderRadius: 8,
    // Shadow properties
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.23,
    shadowRadius: 2.62,
  },
  // New overflow wrapper that contains the overflow:hidden property
  overflowWrapper: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  // Remove shadow and elevation from auctionCard
  auctionCard: {
    borderRadius: 8,
    // Remove elevation from here (moved to shadowWrapper)
  },
  cardWrapper: {
    borderRadius: 8,
  },
  cardInnerContainer: {
    borderRadius: 8,
  },
  innerWrapper: {
    borderRadius: 8,
  },
  cardContent: {
    padding: 8,
    flexDirection: 'row',
  },
  cardImageContainer: {
    width: 90,
    height: 120,
    position: 'relative',
    marginRight: 12,
    borderRadius: 8,
  },
  imageWrapper: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  rarityBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderBottomRightRadius: 4,
  },
  rarityText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0.5, height: 0.5 },
    textShadowRadius: 1,
  },
  cardDetails: {
    flex: 1,
    justifyContent: 'center',
  },
  cardName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  bidInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  bidLabel: {
    fontSize: 14,
    marginRight: 4,
    color: '#555',
  },
  bidAmount: {
    fontSize: 14,
  },
  timeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  timeLabel: {
    fontSize: 14,
    marginRight: 4,
    color: '#555',
  },
  timeValue: {
    fontSize: 14,
  },
  bidderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  bidderLabel: {
    fontSize: 14,
    marginRight: 4,
    color: '#555',
  },
  bidderValue: {
    fontSize: 14,
  },
  noBidderText: {
    fontStyle: 'italic',
    color: '#888',
  },
  yourBidText: {
    fontWeight: 'bold',
  },
  rarityInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  rarityLabel: {
    fontSize: 14,
    marginRight: 4,
    color: '#555',
  },
  rarityValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  bidButton: {
    borderRadius: 4,
    width: 'auto',
  },
  bidButtonContent: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    height: 28,
  },
  bidButtonLabel: {
    fontSize: 12,
    marginLeft: 2,
    fontWeight: 'bold',
  },
});

export default AuctionListItem; 