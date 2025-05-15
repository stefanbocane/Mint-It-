import { useNavigation, useRoute } from '@react-navigation/native';
import { deleteDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Divider, Text, useTheme } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';

const TradeDetailsScreen = () => {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const { tradeId } = route.params || {};
  const { user } = useAuth();
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
      
      // Get user info
      const senderDoc = await getDoc(doc(db, 'users', tradeData.senderId));
      const receiverDoc = await getDoc(doc(db, 'users', tradeData.receiverId));
      
      // Get offered cards
      const offeredCards = [];
      for (const cardId of tradeData.offeredCards || []) {
        try {
          const cardDoc = await getDoc(doc(db, 'cards', cardId));
          if (cardDoc.exists()) {
            offeredCards.push({ id: cardId, ...cardDoc.data() });
          }
        } catch (error) {
          console.error('Error fetching offered card:', error);
        }
      }
      
      // Get requested cards
      const requestedCards = [];
      for (const cardId of tradeData.requestedCards || []) {
        try {
          const cardDoc = await getDoc(doc(db, 'cards', cardId));
          if (cardDoc.exists()) {
            requestedCards.push({ id: cardId, ...cardDoc.data() });
          }
        } catch (error) {
          console.error('Error fetching requested card:', error);
        }
      }

      setTrade({
        id: tradeDoc.id,
        ...tradeData,
        senderName: senderDoc.data()?.username || 'Unknown User',
        receiverName: receiverDoc.data()?.username || 'Unknown User',
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
    try {
      // Update trade status
      await updateDoc(doc(db, 'trades', trade.id), {
        status: 'completed',
      });
      
      // Transfer cards ownership
      for (const card of trade.offeredCardsDetails) {
        const updateData = {
          inTrade: false,
          tradeId: null
        };
        
        // Only add properties if they're not undefined
        if (trade.receiverId) {
          updateData.ownerId = trade.receiverId;
          updateData.userId = trade.receiverId;
        }
        
        await updateDoc(doc(db, 'cards', card.id), updateData);
      }
      
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
        
        await updateDoc(doc(db, 'cards', card.id), updateData);
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