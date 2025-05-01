import { useNavigation } from '@react-navigation/native';
import { addDoc, collection, getDocs, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, SafeAreaView, StyleSheet } from 'react-native';
import { Appbar, Button, Card, Chip, Menu, Modal, Portal, Text } from 'react-native-paper';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

const TradeScreen = () => {
  const [cards, setCards] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [menuVisible, setMenuVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const { user } = useAuth();
  const navigation = useNavigation();

  useEffect(() => {
    fetchUserCards();
    fetchUsers();
  }, []);

  const fetchUserCards = async () => {
    try {
      const cardsQuery = query(
        collection(db, 'cards'),
        where('ownerId', '==', user.uid)
      );
      const snapshot = await getDocs(cardsQuery);
      const userCards = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCards(userCards);
    } catch (error) {
      console.error('Error fetching cards:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const usersQuery = query(
        collection(db, 'users'),
        where('uid', '!=', user.uid)
      );
      const snapshot = await getDocs(usersQuery);
      const userList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUsers(userList);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const getRarityColor = (rarity) => {
    const colors = {
      common: '#757575',
      uncommon: '#2196F3',
      rare: '#FFD700',
    };
    return colors[rarity] || '#757575';
  };

  const handleTrade = async () => {
    if (!selectedUser) {
      Alert.alert('No User Selected', 'Please select a user to trade with');
      return;
    }

    try {
      setLoading(true);
      
      await addDoc(collection(db, 'trades'), {
        fromUser: user.uid,
        toUser: selectedUser.id,
        cardId: selectedCard.id,
        status: 'pending',
        createdAt: new Date(),
      });

      Alert.alert('Success', 'Trade offer sent successfully!');
      setShowModal(false);
      setSelectedCard(null);
      setSelectedUser(null);
    } catch (error) {
      console.error('Error creating trade:', error);
      Alert.alert('Error', 'Failed to create trade offer. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderCard = ({ item }) => (
    <Card style={styles.card}>
      <Card.Cover source={{ uri: item.imageUrl }} />
      <Card.Content>
        <Chip
          mode="outlined"
          style={[styles.rarityChip, { borderColor: getRarityColor(item.rarity) }]}
          textStyle={{ color: getRarityColor(item.rarity) }}
        >
          {item.rarity.toUpperCase()}
        </Chip>
      </Card.Content>
      <Card.Actions>
        <Button
          mode="contained"
          onPress={() => {
            setSelectedCard(item);
            setShowModal(true);
          }}
        >
          Trade
        </Button>
      </Card.Actions>
    </Card>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => navigation.navigate('Home')} />
        <Appbar.Content title="Trade Cards" />
      </Appbar.Header>
      <FlatList
        data={cards}
        renderItem={renderCard}
        keyExtractor={item => item.id}
        numColumns={2}
        contentContainerStyle={styles.list}
      />

      <Portal>
        <Modal
          visible={showModal}
          onDismiss={() => setShowModal(false)}
          contentContainerStyle={styles.modal}
        >
          <Text style={styles.modalTitle}>Select a User to Trade With</Text>
          
          <Menu
            visible={menuVisible}
            onDismiss={() => setMenuVisible(false)}
            anchor={
              <Button
                mode="outlined"
                onPress={() => setMenuVisible(true)}
                style={styles.menuButton}
              >
                {selectedUser ? selectedUser.displayName : 'Select User'}
              </Button>
            }
          >
            {users.map(user => (
              <Menu.Item
                key={user.id}
                onPress={() => {
                  setSelectedUser(user);
                  setMenuVisible(false);
                }}
                title={user.displayName}
              />
            ))}
          </Menu>

          <Button
            mode="contained"
            onPress={handleTrade}
            loading={loading}
            disabled={!selectedUser}
            style={styles.tradeButton}
          >
            Send Trade
          </Button>

          <Button
            mode="text"
            onPress={() => {
              setShowModal(false);
              setSelectedUser(null);
            }}
            style={styles.cancelButton}
          >
            Cancel
          </Button>
        </Modal>
      </Portal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  list: {
    padding: 8,
  },
  card: {
    flex: 1,
    margin: 4,
    maxWidth: '48%',
  },
  rarityChip: {
    marginTop: 8,
  },
  modal: {
    backgroundColor: 'white',
    padding: 20,
    margin: 20,
    borderRadius: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  menuButton: {
    marginBottom: 16,
  },
  tradeButton: {
    marginBottom: 8,
  },
  cancelButton: {
    marginTop: 8,
  },
});

export default TradeScreen; 