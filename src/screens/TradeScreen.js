import React, { useState, useEffect } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Button, Text, Card, List, Searchbar } from 'react-native-paper';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs, addDoc, updateDoc, doc } from 'firebase/firestore';

const TradeScreen = () => {
  const [myCards, setMyCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [friends, setFriends] = useState([]);
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadMyCards();
    loadFriends();
  }, []);

  const loadMyCards = async () => {
    try {
      const cardsQuery = query(
        collection(db, 'cards'),
        where('ownerId', '==', auth.currentUser.uid)
      );
      const querySnapshot = await getDocs(cardsQuery);
      const cards = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setMyCards(cards);
    } catch (error) {
      console.error('Error loading cards:', error);
    }
  };

  const loadFriends = async () => {
    try {
      const usersQuery = query(collection(db, 'users'));
      const querySnapshot = await getDocs(usersQuery);
      const users = querySnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter(user => user.id !== auth.currentUser.uid);
      setFriends(users);
    } catch (error) {
      console.error('Error loading friends:', error);
    }
  };

  const handleTrade = async () => {
    if (!selectedCard || !selectedFriend) {
      alert('Please select both a card and a friend');
      return;
    }

    try {
      setLoading(true);
      
      // Create trade document
      await addDoc(collection(db, 'trades'), {
        fromUser: auth.currentUser.uid,
        toUser: selectedFriend.id,
        cardId: selectedCard.id,
        status: 'pending',
        createdAt: new Date()
      });

      alert('Trade request sent!');
      setSelectedCard(null);
      setSelectedFriend(null);
    } catch (error) {
      console.error('Trade error:', error);
      alert('Error initiating trade');
    } finally {
      setLoading(false);
    }
  };

  const renderCard = ({ item }) => (
    <Card
      style={[
        styles.card,
        selectedCard?.id === item.id && styles.selectedCard
      ]}
      onPress={() => setSelectedCard(item)}
    >
      <Card.Cover source={{ uri: item.imageUrl }} />
      <Card.Content>
        <Text variant="titleMedium">{item.title}</Text>
        <Text variant="bodyMedium">Rarity: {item.rarity}</Text>
      </Card.Content>
    </Card>
  );

  const renderFriend = ({ item }) => (
    <List.Item
      title={item.displayName || item.email}
      description={item.email}
      onPress={() => setSelectedFriend(item)}
      style={[
        styles.friendItem,
        selectedFriend?.id === item.id && styles.selectedFriend
      ]}
    />
  );

  return (
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>Trade Cards</Text>
      
      <Text variant="titleLarge" style={styles.sectionTitle}>My Cards</Text>
      <FlatList
        data={myCards}
        renderItem={renderCard}
        keyExtractor={item => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.cardsList}
      />

      <Text variant="titleLarge" style={styles.sectionTitle}>Friends</Text>
      <Searchbar
        placeholder="Search friends"
        onChangeText={setSearchQuery}
        value={searchQuery}
        style={styles.searchBar}
      />
      <FlatList
        data={friends.filter(friend => 
          friend.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          friend.email.toLowerCase().includes(searchQuery.toLowerCase())
        )}
        renderItem={renderFriend}
        keyExtractor={item => item.id}
        style={styles.friendsList}
      />

      <Button
        mode="contained"
        onPress={handleTrade}
        loading={loading}
        disabled={!selectedCard || !selectedFriend}
        style={styles.tradeButton}
      >
        Initiate Trade
      </Button>
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
  sectionTitle: {
    marginTop: 20,
    marginBottom: 10,
  },
  cardsList: {
    marginBottom: 20,
  },
  card: {
    width: 200,
    marginRight: 10,
  },
  selectedCard: {
    borderColor: '#6200ee',
    borderWidth: 2,
  },
  searchBar: {
    marginBottom: 10,
  },
  friendsList: {
    flex: 1,
  },
  friendItem: {
    padding: 10,
  },
  selectedFriend: {
    backgroundColor: '#f0f0f0',
  },
  tradeButton: {
    marginTop: 20,
  },
});

export default TradeScreen; 