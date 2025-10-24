import { useNavigation, useRoute } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Divider, Text } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import { useStats } from '../contexts/StatsContext';
import { useTheme } from '../contexts/ThemeContext';
import { awardTradeXP, getTradesCompletedToday } from '../services/XPService';
import { ACHIEVEMENT_TYPES, recordAchievement } from '../utils/gemRewards';
import { setPayload as cachePayload, getPayload as getCachedPayload } from '../utils/GlobalPayloadCache';

const TradeDetailsScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { tradeId } = route.params || {};
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const { recordTradeComplete } = useStats();
  const { theme } = useTheme();
  const cached = getCachedPayload(tradeId);
  const [trade, setTrade] = useState(cached);
  const [loading, setLoading] = useState(true); // Always load initially to get card details
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    // Always fetch trade details to ensure we have complete card information
    fetchTradeDetails();
  }, [tradeId]);

  const fetchTradeDetails = async () => {
    if (!tradeId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { supabase } = await import('../config/supabase');
      const currentUserId = user?.id || user?.uid;

      // Fetch trade from Supabase
      const { data: tradeData, error: tradeError } = await supabase
        .from('trades')
        .select('*')
        .eq('id', tradeId)
        .single();

      if (tradeError || !tradeData) {
        console.error('Trade not found:', tradeError);
        Alert.alert('Error', 'Trade not found');
        navigation.goBack();
        return;
      }

      // Fetch cards for this trade
      const cardIds = [...(tradeData.offered_cards || []), ...(tradeData.requested_cards || [])];
      console.log('Fetching cards for trade:', { cardIds, offeredCards: tradeData.offered_cards, requestedCards: tradeData.requested_cards });

      let cardsMap = new Map();
      if (cardIds.length > 0) {
        const { data: cards, error: cardsError } = await supabase
          .from('cards')
          .select('id, name, image_url, rarity, owner_id')
          .in('id', cardIds);

        console.log('Fetched cards from Supabase:', { cards, error: cardsError });

        if (!cardsError && cards) {
          cardsMap = new Map(cards.map(card => [
            card.id,
            {
              id: card.id,
              name: card.name,
              imageUrl: card.image_url,
              rarity: card.rarity,
              ownerId: card.owner_id
            }
          ]));
        }
      }

      // Build offered and requested cards arrays
      const offeredCards = (tradeData.offered_cards || [])
        .map(cardId => cardsMap.get(cardId))
        .filter(Boolean);

      const requestedCards = (tradeData.requested_cards || [])
        .map(cardId => cardsMap.get(cardId))
        .filter(Boolean);

      console.log('Built card arrays:', { offeredCards, requestedCards });

      const built = {
        id: tradeData.id,
        senderId: tradeData.sender_id,
        receiverId: tradeData.receiver_id,
        senderName: tradeData.sender_name || 'Unknown User',
        receiverName: tradeData.receiver_name || 'Unknown User',
        senderAvatar: tradeData.sender_avatar,
        receiverAvatar: tradeData.receiver_avatar,
        offeredCards: tradeData.offered_cards || [],
        requestedCards: tradeData.requested_cards || [],
        offeredCardsDetails: offeredCards,
        requestedCardsDetails: requestedCards,
        groupId: tradeData.group_id,
        status: tradeData.status,
        timestamp: tradeData.created_at,
        isSender: tradeData.sender_id === currentUserId,
        isReceiver: tradeData.receiver_id === currentUserId,
      };

      console.log('Trade details built:', {
        status: built.status,
        isSender: built.isSender,
        isReceiver: built.isReceiver,
        senderId: built.senderId,
        receiverId: built.receiverId,
        currentUserId
      });

      setTrade(built);
      cachePayload(tradeId, built);
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
      const { supabase } = await import('../config/supabase');

      // Use Supabase function to accept trade (bypasses RLS)
      console.log('🔄 Calling accept_trade function for trade:', trade.id);
      const { data: result, error: functionError } = await supabase
        .rpc('accept_trade', { trade_id_param: trade.id });

      console.log('Accept trade result:', result);

      if (functionError) {
        console.error('Function error:', functionError);
        throw functionError;
      }

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to accept trade');
      }

      console.log(`✅ Trade accepted! Transferred ${result.cards_transferred} cards`);

      // Track rarities for stats
      (trade.offeredCardsDetails || []).forEach(card => {
        if (card.rarity) {
          raritiesTraded[card.rarity] = (raritiesTraded[card.rarity] || 0) + 1;
        }
      });
      (trade.requestedCardsDetails || []).forEach(card => {
        if (card.rarity) {
          raritiesTraded[card.rarity] = (raritiesTraded[card.rarity] || 0) + 1;
        }
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

      // Card transfers already handled by accept_trade function
      
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
      const { supabase } = await import('../config/supabase');

      // Use Supabase function to decline trade (bypasses RLS)
      console.log('🔄 Calling decline_trade function for trade:', trade.id);
      const { data: result, error: functionError } = await supabase
        .rpc('decline_trade', { trade_id_param: trade.id });

      console.log('Decline trade result:', result);

      if (functionError) {
        console.error('Function error:', functionError);
        throw functionError;
      }

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to decline trade');
      }

      console.log('✅ Trade declined successfully');
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
      const { supabase } = await import('../config/supabase');

      // Use Supabase function to cancel trade (bypasses RLS)
      console.log('🔄 Calling cancel_trade function for trade:', trade.id);
      const { data: result, error: functionError } = await supabase
        .rpc('cancel_trade', { trade_id_param: trade.id });

      console.log('Cancel trade result:', result);

      if (functionError) {
        console.error('Function error:', functionError);
        throw functionError;
      }

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to cancel trade');
      }

      console.log('✅ Trade canceled successfully');
      Alert.alert('Success', 'Trade canceled');
      navigation.goBack();
    } catch (error) {
      console.error('Error canceling trade:', error);
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
              {trade.offeredCardsDetails?.length > 0 ? (
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
              {trade.requestedCardsDetails?.length > 0 ? (
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

            {(trade.status === 'active' || trade.status === 'pending') && (
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
