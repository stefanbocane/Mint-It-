import React, { useState, useEffect } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Button, Text, Card, TextInput } from 'react-native-paper';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs, addDoc, updateDoc, doc, orderBy, limit } from 'firebase/firestore';

const AuctionScreen = () => {
  const [auctions, setAuctions] = useState([]);
  const [selectedAuction, setSelectedAuction] = useState(null);
  const [bidAmount, setBidAmount] = useState('');
  const [loading, setLoading] = useState(false);

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
    if (!selectedAuction || !bidAmount) {
      alert('Please select an auction and enter a bid amount');
      return;
    }

    const bid = parseFloat(bidAmount);
    if (isNaN(bid) || bid <= selectedAuction.currentBid) {
      alert('Bid must be higher than current bid');
      return;
    }

    try {
      setLoading(true);

      // Check if user has enough coins
      const userDoc = await getDocs(doc(db, 'users', auth.currentUser.uid));
      const userData = userDoc.data();
      if (userData.coinBalance < bid) {
        alert('Not enough coins');
        return;
      }

      // Update auction with new bid
      await updateDoc(doc(db, 'auctions', selectedAuction.id), {
        currentBid: bid,
        currentBidder: auth.currentUser.uid,
        lastBidTime: new Date()
      });

      // Record bid history
      await addDoc(collection(db, 'bids'), {
        auctionId: selectedAuction.id,
        userId: auth.currentUser.uid,
        amount: bid,
        timestamp: new Date()
      });

      // Update user's coin balance
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        coinBalance: userData.coinBalance - bid
      });

      alert('Bid placed successfully!');
      setBidAmount('');
      loadActiveAuctions();
    } catch (error) {
      console.error('Bid error:', error);
      alert('Error placing bid');
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