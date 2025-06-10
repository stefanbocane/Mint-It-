import { useNavigation, useRoute } from '@react-navigation/native';
import { deleteDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Divider, Text, useTheme } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import { useStats } from '../contexts/StatsContext';
import { awardTradeXP, getTradesCompletedToday } from '../services/XPService';
import { batchedUpdateDoc } from '../utils/enhancedBatchOperations';
import { ACHIEVEMENT_TYPES, recordAchievement } from '../utils/gemRewards';

const TradeDetailsScreen = () => {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const { tradeId } = route.params || {};
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const { recordTradeComplete } = useStats();
  const [trade, setTrade] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchTradeDetails();
  }, [tradeId]);

  const fetchTradeDetails = async () => {
    if (!tradeId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const tradeRef = doc(db, 'trades', tradeId);
      const tradeDoc = await getDoc(tradeRef);

      if (!tradeDoc.exists()) {
        Alert.alert('Error', 'Trade not found');
        navigation.goBack();
        return;
      }

      const tradeData = tradeDoc.data();
      
      // Collect all document IDs we need to fetch
      const userIds = [tradeData.senderId, tradeData.receiverId].filter(Boolean);
      const cardIds = [...(tradeData.offeredCards || []), ...(tradeData.requestedCards || [])];
      
      // Batch fetch users and cards
      const [usersMap, cardsMap] = await Promise.all([
        // Use CacheService for batch user fetching
        import('../services/caching/CacheService').then(({ default: CacheService }) => 
          CacheService.getDocuments('users', userIds).then(users => 
            new Map(users.map(user => [user.id, user]))
          )
        ),
        // Use CacheService for batch card fetching
        import('../services/caching/CacheService').then(({ default: CacheService }) => 
          CacheService.getDocuments('cards', cardIds).then(cards => 
            new Map(cards.map(card => [card.id, card]))
          )
        )
      ]);

      // Build offered and requested cards arrays
      const offeredCards = (tradeData.offeredCards || [])
        .map(cardId => cardsMap.get(cardId))
        .filter(Boolean);
        
      const requestedCards = (tradeData.requestedCards || [])
        .map(cardId => cardsMap.get(cardId))
        .filter(Boolean);

      setTrade({
        id: tradeDoc.id,
        ...tradeData,
        senderName: usersMap.get(tradeData.senderId)?.username || 'Unknown User',
        receiverName: usersMap.get(tradeData.receiverId)?.username || 'Unknown User',
        offeredCardsDetails: offeredCards,
        requestedCardsDetails: requestedCards,
        isSender: tradeData.senderId === user.uid,
        isReceiver: tradeData.receiverId === user.uid,
      });
    } catch (error) {
      console.error('Error fetching trade details:', error);
      Alert.alert('Error', 'Failed to load trade details');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptTrade = async () => {
    if (!trade || processing) return;
    
    setProcessing(true);
    const raritiesTraded = {};
    try {
      // Update trade status
      await updateDoc(doc(db, 'trades', trade.id), {
        status: 'completed',
      });
      
      // Record achievement for first trade of the day for both parties
      try {
        console.log('Attempting to record first trade achievements...');
        const [senderResult, receiverResult] = await Promise.all([
          recordAchievement(trade.senderId, ACHIEVEMENT_TYPES.FIRST_TRADE)
            .then(result => {
              console.log(`Trade achievement for sender ${trade.senderId}: ${result ? 'recorded' : 'already completed'}`);
              return result;
            })
            .catch(error => {
              console.error(`Error recording trade achievement for sender ${trade.senderId}:`, error);
              return null;
            }),
          recordAchievement(trade.receiverId, ACHIEVEMENT_TYPES.FIRST_TRADE)
            .then(result => {
              console.log(`Trade achievement for receiver ${trade.receiverId}: ${result ? 'recorded' : 'already completed'}`);
              return result;
            })
            .catch(error => {
              console.error(`Error recording trade achievement for receiver ${trade.receiverId}:`, error);
              return null;
            })
        ]);
        
        if (senderResult || receiverResult) {
          console.log('Successfully recorded trade achievements for one or both parties');
        } else {
          console.log('Trade achievements already completed by both parties today');
        }
      } catch (error) {
        console.error('Unexpected error recording trade achievements:', error);
        // Don't fail the trade if achievement recording fails
      }

      // Prepare batch updates for all cards involved in the trade
      const cardUpdates = [];
      
      // Process offered cards (going to receiver)
      for (const card of trade.offeredCardsDetails) {
        cardUpdates.push({
          collection: 'cards',
          id: card.id,
          data: {
            ownerId: trade.receiverId,
            userId: trade.receiverId,
            inTrade: false,
            tradeId: null
          }
        });
        
        // Track rarity for stats
        if (card.rarity) {
          raritiesTraded[card.rarity] = (raritiesTraded[card.rarity] || 0) + 1;
        }
      }
      
      // Process requested cards (going to sender)
      for (const card of trade.requestedCardsDetails) {
        const updateData = {
          inTrade: false,
          tradeId: null
        };
        
        // Only add properties if they're not undefined
        if (trade.senderId) {
          updateData.ownerId = trade.senderId;
          updateData.userId = trade.senderId;
        }
        
        cardUpdates.push({
          collection: 'cards',
          id: card.id,
          data: updateData
        });
        
        // Track rarity for stats
        if (card.rarity) {
          raritiesTraded[card.rarity] = (raritiesTraded[card.rarity] || 0) + 1;
        }
      }
      
      // Execute all card updates in a single batch operation
      await batchedUpdateDoc(cardUpdates);
      
      // Record trade completion in stats for both users
      if (trade.senderId) {
        await recordTradeComplete(trade.senderId, {
          cardId: trade.offeredCardsDetails[0]?.id,
          rarity: trade.offeredCardsDetails[0]?.rarity,
          receivedCardId: trade.requestedCardsDetails[0]?.id,
          receivedRarity: trade.requestedCardsDetails[0]?.rarity,
          partnerId: trade.receiverId
        });
        
        // Award XP to sender
        try {
          const senderXPResult = await awardTradeXP(trade.senderId, await getTradesCompletedToday(trade.senderId), currentGroup?.id);
          console.log(`🌟 Awarded ${senderXPResult.xpAwarded} XP to trade sender`);
          if (senderXPResult.levelsGained > 0) {
            console.log(`🎉 Trade sender leveled up ${senderXPResult.levelsGained} time(s)!`);
          }
        } catch (xpError) {
          console.error('Error awarding XP to trade sender:', xpError);
        }
      }
      
      if (trade.receiverId) {
        await recordTradeComplete(trade.receiverId, {
          cardId: trade.requestedCardsDetails[0]?.id,
          rarity: trade.requestedCardsDetails[0]?.rarity,
          receivedCardId: trade.offeredCardsDetails[0]?.id,
          receivedRarity: trade.offeredCardsDetails[0]?.rarity,
          partnerId: trade.senderId
        });
        
        // Award XP to receiver (current user)
        try {
          const receiverTradesCompletedToday = await getTradesCompletedToday(trade.receiverId);
          const receiverXPResult = await awardTradeXP(trade.receiverId, receiverTradesCompletedToday, currentGroup?.id);
          console.log(`🌟 Awarded ${receiverXPResult.xpAwarded} XP to trade receiver`);
          if (receiverXPResult.levelsGained > 0) {
            console.log(`🎉 Trade receiver leveled up ${receiverXPResult.levelsGained} time(s)!`);
          }
        } catch (xpError) {
          console.error('Error awarding XP to trade receiver:', xpError);
        }
      }
      
      Alert.alert('Success', 'Trade completed successfully');
      navigation.goBack();
    } catch (error) {
      console.error('Error accepting trade:', error);
      Alert.alert('Error', 'Failed to complete trade');
    } finally {
      setProcessing(false);
    }
  };

  const handleDeclineTrade = async () => {
    if (!trade || processing) return;
    
    setProcessing(true);
    try {
      // Update trade status
      await updateDoc(doc(db, 'trades', trade.id), {
        status: 'declined',
      });
      
      // Release cards from trade
      for (const card of [...trade.offeredCardsDetails, ...trade.requestedCardsDetails]) {
        const updateData = {
          inTrade: false,
          tradeId: null
        };
        await updateDoc(doc(db, 'cards', card.id), updateData);
      }
      
      Alert.alert('Success', 'Trade declined');
      navigation.goBack();
    } catch (error) {
      console.error('Error declining trade:', error);
      Alert.alert('Error', 'Failed to decline trade');
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelTrade = async () => {
    if (!trade || processing) return;
    
    setProcessing(true);
    try {
      // Delete the trade
      await deleteDoc(doc(db, 'trades', trade.id));
      
      // Release cards from trade
      for (const card of [...trade.offeredCardsDetails, ...trade.requestedCardsDetails]) {
        const updateData = {
          inTrade: false,
          tradeId: null
        };
        await updateDoc(doc(db, 'cards', card.id), updateData);
      }
      
      Alert.alert('Success', 'Trade cancelled');
      navigation.goBack();
    } catch (error) {
      console.error('Error cancelling trade:', error);
      Alert.alert('Error', 'Failed to cancel trade');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <ScreenBackground>
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </ScreenBackground>
    );
  }

  if (!trade) {
    return (
      <ScreenBackground>
        <View style={[styles.container, styles.centered]}>
          <Text>Trade not found</Text>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScrollView style={styles.container}>
        <Card style={styles.tradeCard}>
          <Card.Content>
            <View style={styles.statusContainer}>
              <Text 
                style={[
                  styles.statusText, 
                  { 
                    color: 
                      trade.status === 'pending' ? '#FFA000' : 
                      trade.status === 'offered' ? '#1976D2' :
                      trade.status === 'active' ? '#388E3C' : 
                      trade.status === 'completed' ? '#388E3C' : 
                      trade.status === 'rejected' ? '#D32F2F' : 
                      trade.status === 'canceled' ? '#757575' : '#FFA000'
                  }
                ]}
              >
                {trade.status.charAt(0).toUpperCase() + trade.status.slice(1)}
              </Text>
            </View>
            
            <Divider style={styles.divider} />
            
            <Text style={styles.sectionTitle}>Participants</Text>
            <View style={styles.participants}>
              <Text>From: {trade.senderName}</Text>
              <Text>To: {trade.receiverName}</Text>
            </View>
            
            <Divider style={styles.divider} />
            
            <Text style={styles.sectionTitle}>Offered Items</Text>
            <View style={styles.cardsSection}>
              {trade.offeredCardsDetails.length > 0 ? (
                trade.offeredCardsDetails.map(card => (
                  <Card key={card.id} style={styles.cardItem}>
                    <Card.Cover source={{ uri: card.imageUrl }} style={styles.cardImage} />
                    <Card.Content>
                      <Text style={styles.cardName} numberOfLines={1}>{card.name}</Text>
                    </Card.Content>
                  </Card>
                ))
              ) : (
                <Text style={styles.noCardsText}>No cards offered</Text>
              )}
            </View>
            
            <Divider style={styles.divider} />
            
            <Text style={styles.sectionTitle}>Requested Items</Text>
            <View style={styles.cardsSection}>
              {trade.requestedCardsDetails.length > 0 ? (
                trade.requestedCardsDetails.map(card => (
                  <Card key={card.id} style={styles.cardItem}>
                    <Card.Cover source={{ uri: card.imageUrl }} style={styles.cardImage} />
                    <Card.Content>
                      <Text style={styles.cardName} numberOfLines={1}>{card.name}</Text>
                    </Card.Content>
                  </Card>
                ))
              ) : (
                <Text style={styles.noCardsText}>No cards requested</Text>
              )}
            </View>
            
            <Divider style={styles.divider} />
            
            {trade.status === 'active' && (
              <View style={styles.actionButtons}>
                {trade.isReceiver && (
                  <>
                    <Button
                      mode="contained"
                      onPress={handleAcceptTrade}
                      style={styles.actionButton}
                      loading={processing}
                      disabled={processing}
                      buttonColor={theme.colors.primary}
                      icon="check"
                    >
                      Accept Trade
                    </Button>
                    <Button
                      mode="outlined"
                      onPress={handleDeclineTrade}
                      style={styles.actionButton}
                      loading={processing}
                      disabled={processing}
                      textColor={theme.colors.error}
                      icon="close"
                    >
                      Decline Trade
                    </Button>
                  </>
                )}
                
                {trade.isSender && (
                  <Button
                    mode="outlined"
                    onPress={handleCancelTrade}
                    style={styles.actionButton}
                    loading={processing}
                    disabled={processing}
                    textColor={theme.colors.error}
                    icon="delete"
                  >
                    Cancel Trade
                  </Button>
                )}
              </View>
            )}
          </Card.Content>
        </Card>
      </ScrollView>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  tradeCard: {
    marginBottom: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  titleText: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  statusContainer: {
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  statusText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  divider: {
    marginVertical: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  participants: {
    marginBottom: 8,
  },
  cardsSection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    marginBottom: 8,
    gap: 8,
  },
  cardItem: {
    width: 120,
    margin: 4,
  },
  cardImage: {
    height: 120,
    resizeMode: 'cover',
  },
  cardName: {
    fontSize: 12,
    textAlign: 'center',
  },
  noCardsText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  actionButtons: {
    marginTop: 16,
    gap: 8,
  },
  actionButton: {
    marginVertical: 4,
  },
});

export default TradeDetailsScreen; 