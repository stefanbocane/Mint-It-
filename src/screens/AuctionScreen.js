import { useNavigation } from '@react-navigation/native';
import { collection, doc, getDocs, increment, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { Appbar, Button, Card, Text, TextInput } from 'react-native-paper';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';

const AuctionScreen = () => {
  const [auctions, setAuctions] = useState([]);
  const [selectedAuction, setSelectedAuction] = useState(null);
  const [bidAmount, setBidAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const navigation = useNavigation();
  const { user, updateCoinBalance } = useAuth();

  useEffect(() => {
    loadActiveAuctions();
  }, []);

  const loadActiveAuctions = async () => {
    try {
      const now = new Date();
      const auctionsQuery = query(
        collection(db, 'auctions'),
        where('endTime', '>', now),
        orderBy('endTime', 'asc')
      );
      const querySnapshot = await getDocs(auctionsQuery);
      const activeAuctions = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAuctions(activeAuctions);
    } catch (error) {
      console.error('Error loading auctions:', error);
    }
  };

  const handleBid = async () => {
    if (!selectedAuction || !bidAmount || !user) return;
    
    const bid = parseInt(bidAmount);
    if (isNaN(bid) || bid <= selectedAuction.currentBid) {
      Alert.alert('Invalid Bid', 'Your bid must be higher than the current bid');
      return;
    }

    if (user.coinBalance < bid) {
      Alert.alert('Insufficient Funds', 'You don\'t have enough coins for this bid');
      return;
    }

    setLoading(true);
    try {
      // Deduct bid amount
      await updateCoinBalance(-bid);

      // Update auction in Firestore
      const auctionRef = doc(db, 'auctions', selectedAuction.id);
      await updateDoc(auctionRef, {
        currentBid: bid,
        currentBidder: user.uid,
        bidCount: increment(1),
        lastBidTime: serverTimestamp()
      });

      // Update local state
      setAuctions(prev => prev.map(a => 
        a.id === selectedAuction.id 
          ? { ...a, currentBid: bid, currentBidder: user.uid, bidCount: (a.bidCount || 0) + 1 }
          : a
      ));

      Alert.alert('Success', 'Bid placed successfully!');
      setBidAmount('');
      setSelectedAuction(null);
    } catch (error) {
      // If bid fails, refund the coins
      await updateCoinBalance(bid);
      console.error('Bidding error:', error);
      Alert.alert('Error', 'Failed to place bid. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderAuction = ({ item }) => (
    <Card
      style={[
        styles.auctionCard,
        selectedAuction?.id === item.id && styles.selectedAuction
      ]}
      onPress={() => setSelectedAuction(item)}
    >
      <Card.Cover source={{ uri: item.cardImageUrl }} />
      <Card.Content>
        <Text variant="titleMedium">{item.cardTitle}</Text>
        <Text variant="bodyMedium">Current Bid: {item.currentBid} coins</Text>
        <Text variant="bodyMedium">
          Ends: {new Date(item.endTime).toLocaleString()}
        </Text>
        <Text variant="bodyMedium">
          Bids: {item.bidCount || 0}
        </Text>
      </Card.Content>
    </Card>
  );

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => navigation.navigate('Home')} />
        <Appbar.Content title="Auction House" />
      </Appbar.Header>
      <Text variant="headlineMedium" style={styles.title}>Active Auctions</Text>
      
      <FlatList
        data={auctions}
        renderItem={renderAuction}
        keyExtractor={item => item.id}
        style={styles.auctionsList}
      />

      {selectedAuction && (
        <View style={styles.bidSection}>
          <Text variant="titleMedium">Place a Bid</Text>
          <TextInput
            label="Bid Amount"
            value={bidAmount}
            onChangeText={setBidAmount}
            keyboardType="numeric"
            style={styles.bidInput}
          />
          <Button
            mode="contained"
            onPress={handleBid}
            loading={loading}
            style={styles.bidButton}
          >
            Place Bid
          </Button>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  title: {
    textAlign: 'center',
    marginBottom: 20,
  },
  auctionsList: {
    flex: 1,
  },
  auctionCard: {
    marginBottom: 10,
  },
  selectedAuction: {
    borderColor: '#6200ee',
    borderWidth: 2,
  },
  bidSection: {
    padding: 20,
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
  },
  bidInput: {
    marginVertical: 10,
  },
  bidButton: {
    marginTop: 10,
  },
});

export default AuctionScreen; 