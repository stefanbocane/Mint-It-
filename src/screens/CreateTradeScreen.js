import { addDoc, collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, Dimensions, FlatList, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Appbar, Button, Card, Divider, Surface, Text, useTheme } from 'react-native-paper';
import CardItem from '../components/CardItem';
import ScreenBackground from '../components/ScreenBackground';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import { sendTradeOfferNotification } from '../services/notifications';
import { RARITY_COLORS } from '../utils/rarity';

const { width } = Dimensions.get('window');

const CreateTradeScreen = ({ navigation, route }) => {
  const theme = useTheme();
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const [members, setMembers] = useState([]);
  const [userCards, setUserCards] = useState([]);
  const [selectedUserCards, setSelectedUserCards] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedCards, setSelectedCards] = useState([]);
  const [requestedCards, setRequestedCards] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [userBalance, setUserBalance] = useState(0);
  const [loadingCards, setLoadingCards] = useState(false);

  // Get initialCardId from route params if available
  const initialCardId = route.params?.initialCardId;

  useEffect(() => {
    loadMembers();
    loadUserCards();
    loadUserBalance();
  }, [currentGroup]);

  // Handle initial card selection if provided via navigation
  useEffect(() => {
    if (initialCardId && userCards.length > 0) {
      const cardExists = userCards.find(card => card.id === initialCardId);
      if (cardExists && !cardExists.inTrade && !cardExists.inAuction) {
        setSelectedCards(prev => {
          // Only add if not already selected
          if (!prev.includes(initialCardId)) {
            return [...prev, initialCardId];
          }
          return prev;
        });
      }
    }
  }, [initialCardId, userCards]);

  useEffect(() => {
    if (selectedUser) {
      loadSelectedUserCards();
    } else {
      setSelectedUserCards([]);
      setRequestedCards([]);
    }
  }, [selectedUser]);

  const loadMembers = async () => {
    if (!currentGroup) return;
    try {
      const groupRef = doc(db, 'groups', currentGroup.id);
      const groupDoc = await getDoc(groupRef);
      const groupData = groupDoc.data();
      
      if (!groupData?.members) {
        setMembers([]);
        return;
      }

      const memberPromises = groupData.members
        .filter(memberId => memberId !== user.uid)
        .map(async (memberId) => {
          const userRef = doc(db, 'users', memberId);
          const userDoc = await getDoc(userRef);
          return {
            id: memberId,
            ...userDoc.data()
          };
        });

      const membersData = await Promise.all(memberPromises);
      setMembers(membersData);
    } catch (error) {
      console.error('Error loading members:', error);
    }
  };

  const loadUserCards = async () => {
    if (!user || !currentGroup) return;
    setLoadingCards(true);
    
    try {
      console.log('Loading user cards for trading...');
      const cardsRef = collection(db, 'cards');
      
      // Query for cards using both ownerId and userId for backward compatibility
      // First, get all cards for this user in this group
      const ownerQuery = query(
        cardsRef,
        where('ownerId', '==', user.uid),
        where('groupId', '==', currentGroup.id)
      );
      
      const userIdQuery = query(
        cardsRef,
        where('userId', '==', user.uid),
        where('groupId', '==', currentGroup.id)
      );
      
      const [ownerQuerySnapshot, userIdQuerySnapshot] = await Promise.all([
        getDocs(ownerQuery),
        getDocs(userIdQuery)
      ]);
      
      console.log(`Found ${ownerQuerySnapshot.docs.length} cards with ownerId and ${userIdQuerySnapshot.docs.length} cards with userId`);
      
      // Combine results, removing duplicates
      const cardMap = new Map();
      
      ownerQuerySnapshot.docs.forEach(doc => {
        cardMap.set(doc.id, { id: doc.id, ...doc.data() });
      });
      
      userIdQuerySnapshot.docs.forEach(doc => {
        if (!cardMap.has(doc.id)) {
          cardMap.set(doc.id, { id: doc.id, ...doc.data() });
        }
      });
      
      // Filter cards that are actually available (not in trade or auction)
      const validCards = [];
      const invalidCards = [];
      const statusFixedCards = [];
      
      // Process all cards
      for (const card of cardMap.values()) {
        // Skip cards with missing required fields
        if (!card.name || !card.imageUrl || !card.rarity) {
          console.log(`Skipping invalid card: ${card.id} (missing required fields)`);
          invalidCards.push(card);
          continue;
        }
        
        // Check and fix card status if needed
        let needsStatusFix = false;
        
        // Check trade status
        if (card.inTrade === true) {
          if (card.tradeId) {
            // Verify the trade actually exists and is pending
            try {
              const tradeRef = doc(db, 'trades', card.tradeId);
              const tradeDoc = await getDoc(tradeRef);
              
              if (!tradeDoc.exists() || tradeDoc.data().status !== 'pending') {
                // Trade doesn't exist or isn't pending
                card.inTrade = false;
                card.tradeId = null;
                needsStatusFix = true;
              }
            } catch (error) {
              console.error(`Error checking trade status for card ${card.id}:`, error);
              // On error, assume we can fix it
              card.inTrade = false;
              card.tradeId = null;
              needsStatusFix = true;
            }
          } else {
            // Card marked as in trade but has no tradeId
            card.inTrade = false;
            needsStatusFix = true;
          }
        }
        
        // Check auction status
        if (card.inAuction === true) {
          if (card.auctionId) {
            // Verify the auction actually exists and is active
            try {
              const auctionRef = doc(db, 'auctions', card.auctionId);
              const auctionDoc = await getDoc(auctionRef);
              
              if (!auctionDoc.exists() || auctionDoc.data().status !== 'active') {
                // Auction doesn't exist or isn't active
                card.inAuction = false;
                card.auctionId = null;
                needsStatusFix = true;
              }
            } catch (error) {
              console.error(`Error checking auction status for card ${card.id}:`, error);
              // On error, assume we can fix it
              card.inAuction = false;
              card.auctionId = null;
              needsStatusFix = true;
            }
          } else {
            // Card marked as in auction but has no auctionId
            card.inAuction = false;
            needsStatusFix = true;
          }
        }
        
        // If card needs status fix, update it in the database
        if (needsStatusFix) {
          try {
            const cardRef = doc(db, 'cards', card.id);
            const updateData = {};
            
            // Only include fields that are defined
            if (card.inTrade !== undefined) updateData.inTrade = card.inTrade;
            if (card.inAuction !== undefined) updateData.inAuction = card.inAuction;
            if (card.tradeId !== undefined) updateData.tradeId = card.tradeId;
            if (card.auctionId !== undefined) updateData.auctionId = card.auctionId;
            
            await updateDoc(cardRef, updateData);
            statusFixedCards.push(card.id);
            console.log(`Fixed status for card ${card.id} (${card.name})`);
          } catch (error) {
            console.error(`Error fixing card status for ${card.id}:`, error);
          }
        }
        
        // Only add cards that are not in trade or auction to valid cards
        if (!card.inTrade && !card.inAuction) {
          validCards.push(card);
        }
      }
      
      console.log(`Total valid cards for trading: ${validCards.length}`);
      if (statusFixedCards.length > 0) {
        console.log(`Fixed status for ${statusFixedCards.length} cards`);
      }
      
      setUserCards(validCards);
      setSelectedCards([]);
    } catch (error) {
      console.error('Error fetching user cards for trading:', error);
      Alert.alert('Error', 'Failed to load your cards. Please try again.');
    } finally {
      setLoadingCards(false);
    }
  };

  const loadSelectedUserCards = async () => {
    if (!currentGroup || !selectedUser) return;
    setLoadingCards(true);
    try {
      console.log(`Loading cards for user ${selectedUser.id} in group ${currentGroup.id}...`);
      const cardsRef = collection(db, 'cards');
      
      // First, get all cards for the selected user in this group without filtering by trade/auction status
      const ownerQuery = query(
        cardsRef,
        where('ownerId', '==', selectedUser.id),
        where('groupId', '==', currentGroup.id)
      );
      
      const userIdQuery = query(
        cardsRef,
        where('userId', '==', selectedUser.id),
        where('groupId', '==', currentGroup.id)
      );
      
      const [ownerQuerySnapshot, userIdQuerySnapshot] = await Promise.all([
        getDocs(ownerQuery),
        getDocs(userIdQuery)
      ]);
      
      console.log(`Found ${ownerQuerySnapshot.docs.length} cards with ownerId and ${userIdQuerySnapshot.docs.length} cards with userId`);
      
      // Combine results, removing duplicates
      const cardMap = new Map();
      
      ownerQuerySnapshot.docs.forEach(doc => {
        cardMap.set(doc.id, { id: doc.id, ...doc.data() });
      });
      
      userIdQuerySnapshot.docs.forEach(doc => {
        if (!cardMap.has(doc.id)) {
          cardMap.set(doc.id, { id: doc.id, ...doc.data() });
        }
      });
      
      // Filter cards that are actually available (not in trade or auction)
      const validCards = [];
      const invalidCards = [];
      const statusFixedCards = [];
      
      // Process all cards
      for (const card of cardMap.values()) {
        // Skip cards with missing required fields
        if (!card.name || !card.imageUrl || !card.rarity) {
          console.log(`Skipping invalid card: ${card.id} (missing required fields)`);
          invalidCards.push(card);
          continue;
        }
        
        // Check and fix card status if needed
        let needsStatusFix = false;
        
        // Check trade status
        if (card.inTrade === true) {
          if (card.tradeId) {
            // Verify the trade actually exists and is pending
            try {
              const tradeRef = doc(db, 'trades', card.tradeId);
              const tradeDoc = await getDoc(tradeRef);
              
              if (!tradeDoc.exists() || tradeDoc.data().status !== 'pending') {
                // Trade doesn't exist or isn't pending
                card.inTrade = false;
                card.tradeId = null;
                needsStatusFix = true;
              }
            } catch (error) {
              console.error(`Error checking trade status for card ${card.id}:`, error);
              // On error, assume we can fix it
              card.inTrade = false;
              card.tradeId = null;
              needsStatusFix = true;
            }
          } else {
            // Card marked as in trade but has no tradeId
            card.inTrade = false;
            needsStatusFix = true;
          }
        }
        
        // Check auction status
        if (card.inAuction === true) {
          if (card.auctionId) {
            // Verify the auction actually exists and is active
            try {
              const auctionRef = doc(db, 'auctions', card.auctionId);
              const auctionDoc = await getDoc(auctionRef);
              
              if (!auctionDoc.exists() || auctionDoc.data().status !== 'active') {
                // Auction doesn't exist or isn't active
                card.inAuction = false;
                card.auctionId = null;
                needsStatusFix = true;
              }
            } catch (error) {
              console.error(`Error checking auction status for card ${card.id}:`, error);
              // On error, assume we can fix it
              card.inAuction = false;
              card.auctionId = null;
              needsStatusFix = true;
            }
          } else {
            // Card marked as in auction but has no auctionId
            card.inAuction = false;
            needsStatusFix = true;
          }
        }
        
        // If card needs status fix, update it in the database
        if (needsStatusFix) {
          try {
            const cardRef = doc(db, 'cards', card.id);
            const updateData = {};
            
            // Only include fields that are defined
            if (card.inTrade !== undefined) updateData.inTrade = card.inTrade;
            if (card.inAuction !== undefined) updateData.inAuction = card.inAuction;
            if (card.tradeId !== undefined) updateData.tradeId = card.tradeId;
            if (card.auctionId !== undefined) updateData.auctionId = card.auctionId;
            
            await updateDoc(cardRef, updateData);
            statusFixedCards.push(card.id);
            console.log(`Fixed status for card ${card.id} (${card.name})`);
          } catch (error) {
            console.error(`Error fixing card status for ${card.id}:`, error);
          }
        }
        
        // Only add cards that are not in trade or auction to valid cards
        if (!card.inTrade && !card.inAuction) {
          validCards.push(card);
        }
      }
      
      console.log(`Found ${validCards.length} valid cards to request from selected user`);
      if (statusFixedCards.length > 0) {
        console.log(`Fixed status for ${statusFixedCards.length} cards`);
      }
      
      setSelectedUserCards(validCards);
      setRequestedCards([]);
    } catch (error) {
      console.error('Error loading selected user cards:', error);
      Alert.alert('Error', 'Failed to load cards from selected user.');
    } finally {
      setLoadingCards(false);
    }
  };

  const loadUserBalance = async () => {
    if (!user || !currentGroup) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      const userData = userDoc.data();
      setUserBalance(userData?.groupBalances?.[currentGroup.id] || 0);
    } catch (error) {
      console.error('Error loading user balance:', error);
    }
  };

  const toggleCardSelection = (cardId) => {
    setSelectedCards(prev => 
      prev.includes(cardId)
        ? prev.filter(id => id !== cardId)
        : [...prev, cardId]
    );
  };

  const toggleRequestedCardSelection = (cardId) => {
    setRequestedCards(prev => 
      prev.includes(cardId)
        ? prev.filter(id => id !== cardId)
        : [...prev, cardId]
    );
  };

  const canSend = selectedUser && 
                 selectedCards.length > 0 && 
                 requestedCards.length > 0 && 
                 !isLoading;

  const sendTrade = async () => {
    if (!canSend) return;
    
    setIsLoading(true);
    try {
      // Prepare card image maps for UI display
      const offeredCardImages = {};
      let offeredCardNames = [];
      for (const cardId of selectedCards) {
        const card = userCards.find(c => c.id === cardId);
        if (card) {
          offeredCardImages[cardId] = card.imageUrl;
          offeredCardNames.push(card.name);
        }
      }

      const requestedCardImages = {};
      let requestedCardNames = [];
      for (const cardId of requestedCards) {
        const card = selectedUserCards.find(c => c.id === cardId);
        if (card) {
          requestedCardImages[cardId] = card.imageUrl;
          requestedCardNames.push(card.name);
        }
      }

      const tradeRef = await addDoc(collection(db, 'trades'), {
        senderId: user.uid,
        receiverId: selectedUser.id,
        offeredCards: selectedCards,
        requestedCards: requestedCards,
        offeredCoins: 0, // Always set to 0
        groupId: currentGroup.id,
        status: 'active',
        timestamp: new Date().toISOString(),
        offeredCardImages,
        requestedCardImages,
        // Add participants array for compatibility with existing queries
        participants: [user.uid, selectedUser.id]
      });

      // Update offered cards to mark them as in trade
      for (const cardId of selectedCards) {
        const cardRef = doc(db, 'cards', cardId);
        // Only include fields that are defined
        const updateData = {
          inTrade: true,
          tradeId: tradeRef.id
        };
        await updateDoc(cardRef, updateData);
      }
      
      // Also mark requested cards as in trade so they can't be offered elsewhere
      for (const cardId of requestedCards) {
        const cardRef = doc(db, 'cards', cardId);
        // Only include fields that are defined
        const updateData = {
          inTrade: true,
          tradeId: tradeRef.id
        };
        await updateDoc(cardRef, updateData);
      }
      
      // Send notification to the recipient of the trade
      const offeredCardsText = offeredCardNames.length > 1 
        ? `${offeredCardNames.length} cards (${offeredCardNames.slice(0, 2).join(', ')}${offeredCardNames.length > 2 ? '...' : ''})`
        : offeredCardNames[0] || 'a card';
      
      const requestedCardsText = requestedCardNames.length > 1
        ? `${requestedCardNames.length} cards (${requestedCardNames.slice(0, 2).join(', ')}${requestedCardNames.length > 2 ? '...' : ''})`
        : requestedCardNames[0] || 'a card';
      
      await sendTradeOfferNotification(
        selectedUser.id,
        user.displayName || 'Someone',
        offeredCardsText,
        requestedCardsText,
        tradeRef.id
      );

      navigation.navigate('TradesOverview');
    } catch (error) {
      console.error('Error creating trade:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const renderCardItem = ({ item }) => (
    <CardItem
      item={item}
      isSelected={selectedCards.includes(item.id)}
      onPress={() => toggleCardSelection(item.id)}
      displayMode="standard"
      rarityColors={RARITY_COLORS}
      containerStyle={styles.cardButton}
      selectionText="Selected"
    />
  );

  const renderTheirCardItem = ({ item }) => (
    <CardItem
      item={item}
      isSelected={requestedCards.includes(item.id)}
      onPress={() => toggleRequestedCardSelection(item.id)}
      displayMode="standard"
      rarityColors={RARITY_COLORS}
      containerStyle={styles.theirCardButton}
      selectionText="Requested"
    />
  );

  const renderMemberItem = ({ item }) => (
    <TouchableOpacity
      style={styles.memberItem}
      onPress={() => setSelectedUser(item)}
    >
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{item.username || 'Anonymous'}</Text>
        <Text style={styles.memberEmail}>{item.email}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <ScreenBackground>
      <View style={{ flex: 1,  }}>
      <Appbar.Header style={{ backgroundColor: 'rgba(255,255,255,0.2)', elevation: 0, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' }}>
        <Appbar.BackAction onPress={() => navigation.navigate('TradesOverview')} />
        <Appbar.Content title="Create Trade" />
      </Appbar.Header>
      
      <ScrollView contentContainerStyle={styles.container}>
        <Surface style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Select User</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.membersScroll}>
            {members.length === 0 ? (
              <Text style={styles.emptyText}>No group members found</Text>
            ) : (
              members.map(member => (
                <Card
                  key={member.id}
                  style={[
                    styles.memberCard,
                    selectedUser?.id === member.id && styles.selectedMemberCard
                  ]}
                  onPress={() => setSelectedUser(member)}
                >
                  <Card.Content style={styles.memberCardContent}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {member.username}
                    </Text>
                  </Card.Content>
                </Card>
              ))
            )}
          </ScrollView>
        </Surface>

        {selectedUser && (
          <>
            <Surface style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Your Cards to Offer</Text>
              <Text style={styles.sectionSubtitle}>Select cards you want to offer</Text>
              {loadingCards ? (
                <ActivityIndicator style={styles.loader} />
              ) : userCards.length === 0 ? (
                <Text style={styles.emptyText}>You don't have any cards to trade</Text>
              ) : (
                <FlatList
                  data={userCards}
                  renderItem={renderCardItem}
                  keyExtractor={item => item.id}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.cardsContainer}
                  initialNumToRender={5}
                />
              )}
            </Surface>

            <Surface style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                {selectedUser.username}'s Cards to Request
              </Text>
              <Text style={styles.sectionSubtitle}>Select cards you want in return</Text>
              {loadingCards ? (
                <ActivityIndicator style={styles.loader} />
              ) : selectedUserCards.length === 0 ? (
                <Text style={styles.emptyText}>This user doesn't have any cards</Text>
              ) : (
                <FlatList
                  data={selectedUserCards}
                  renderItem={renderTheirCardItem}
                  keyExtractor={item => item.id}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.cardsContainer}
                  initialNumToRender={5}
                />
              )}
            </Surface>

            <View style={styles.tradeDetails}>
              <Text style={styles.detailsTitle}>Trade Summary</Text>
              <Divider style={styles.divider} />
              <Text style={styles.detailsText}>
                <Text style={styles.bold}>Offering:</Text> {selectedCards.length} cards
              </Text>
              <Text style={styles.detailsText}>
                <Text style={styles.bold}>Requesting:</Text> {requestedCards.length} cards
              </Text>
              <Text style={styles.detailsText}>
                <Text style={styles.bold}>To:</Text> {selectedUser.username}
              </Text>
            </View>

            <Button
              mode="contained"
              onPress={sendTrade}
              disabled={!canSend}
              loading={isLoading}
              style={styles.sendButton}
            >
              Send Trade Offer
            </Button>
            
            {!canSend && requestedCards.length === 0 && (
              <Text style={styles.hintText}>
                You must select at least one card to request from {selectedUser.username}
              </Text>
            )}
            
            {!canSend && selectedCards.length === 0 && (
              <Text style={styles.hintText}>
                You must select at least one card to offer
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  section: {
    padding: 16,
    marginBottom: 16,
    borderRadius: 8,
    elevation: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
    fontStyle: 'italic',
  },
  membersScroll: {
    flexGrow: 0,
  },
  memberCard: {
    width: 100,
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  selectedMemberCard: {
    borderColor: '#4CAF50',
    borderWidth: 2,
  },
  memberCardContent: {
    alignItems: 'center',
    padding: 8,
  },
  memberName: {
    textAlign: 'center',
  },
  cardsContainer: {
    paddingVertical: 8,
  },
  cardButton: {
    width: 150,
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  theirCardButton: {
    width: 150,
    marginRight: 12,
    borderWidth: 1, 
    borderColor: '#e0e0e0',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  cardImage: {
    height: 200,
  },
  cardName: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 4,
  },
  cardRarity: {
    fontSize: 12,
    fontWeight: '500',
  },
  balanceText: {
    fontSize: 14,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  input: {
    marginBottom: 8,
  },
  errorText: {
    color: '#D32F2F',
    fontSize: 12,
    marginBottom: 8,
  },
  sendButton: {
    marginTop: 16,
    padding: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    padding: 16,
  },
  tradeDetails: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  detailsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  divider: {
    marginBottom: 8,
  },
  detailsText: {
    fontSize: 14,
    marginBottom: 4,
  },
  loader: {
    padding: 16,
  },
  selectedOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#4CAF50',
    borderRadius: 4,
    padding: 4,
  },
  selectedText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  bold: {
    fontWeight: 'bold',
  },
  hintText: {
    textAlign: 'center',
    color: '#D32F2F',
    fontSize: 14,
    marginTop: 8,
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  memberInfo: {
    flex: 1,
    marginLeft: 8,
  },
  memberEmail: {
    fontSize: 12,
    color: '#666',
  },
});

export default CreateTradeScreen; 