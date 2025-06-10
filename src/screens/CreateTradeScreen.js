import { addDoc, collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, Dimensions, FlatList, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Appbar, Button, Card, Divider, Surface, Text, useTheme } from 'react-native-paper';
import CardItem from '../components/CardItem';
import ScreenBackground from '../components/ScreenBackground';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import CacheService from '../services/caching/CacheService';
import GroupMembersLookupService from '../services/GroupMembersLookupService';
import { sendTradeOfferNotification } from '../services/notifications';
import consolidatedQueryService from '../utils/consolidatedQueryService';
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
      // OPTIMIZATION: Use GroupMembersLookupService instead of direct reads
      const groupMembers = await GroupMembersLookupService.getGroupMembers(currentGroup.id, {
        ttl: 5 * 60 * 1000 // 5 minute cache
      });
      
      // Filter out current user
      const otherMembers = groupMembers.filter(member => member.id !== user.uid);
      setMembers(otherMembers);
    } catch (error) {
      console.error('Error loading members:', error);
      // Fallback to original implementation if needed
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
      } catch (fallbackError) {
        console.error('Error in fallback loadMembers:', fallbackError);
      }
    }
  };

  // OPTIMIZED: Use consolidated query service to replace dual query pattern
  const loadUserCards = async () => {
    if (!user || !currentGroup) return;
    setLoadingCards(true);
    
    try {
      console.log('🚀 Loading user cards for trading with optimized service...');
      
      // Use the optimized consolidated query service instead of dual queries
      const cards = await consolidatedQueryService.getCardsForTradeCreation(user.uid, currentGroup.id, {
        ttl: 2 * 60 * 1000 // 2 minute cache
      });
      
      console.log(`✅ Optimized service returned ${cards.length} cards`);
      
      // Process all cards with batch status verification
      const statusFixedCards = [];
      await verifyCardStatusesBatch(cards, statusFixedCards);
      
      // Filter valid cards
      const validCards = cards.filter(card => 
        card.name && card.imageUrl && card.rarity && !card.inTrade && !card.inAuction
      );
      
      console.log(`📊 Total valid cards for trading: ${validCards.length}`);
      if (statusFixedCards.length > 0) {
        console.log(`🔧 Fixed status for ${statusFixedCards.length} cards`);
      }
      
      setUserCards(validCards);
      setSelectedCards([]);
    } catch (error) {
      console.error('❌ Error in optimized loadUserCards:', error);
      
      // Fallback to original dual query implementation
      console.log('⚠️  Falling back to original dual query implementation');
      await loadUserCardsOriginal();
    } finally {
      setLoadingCards(false);
    }
  };

  // Original implementation as fallback
  const loadUserCardsOriginal = async () => {
    try {
      console.log('Loading user cards for trading (fallback mode)...');
      const cardsRef = collection(db, 'cards');
      
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
      
      console.log(`Found ${ownerQuerySnapshot.docs.length} cards with ownerId and ${userIdQuerySnapshot.docs.length} cards with userId (fallback)`);
      
      const cardMap = new Map();
      
      ownerQuerySnapshot.docs.forEach(doc => {
        cardMap.set(doc.id, { id: doc.id, ...doc.data() });
      });
      
      userIdQuerySnapshot.docs.forEach(doc => {
        if (!cardMap.has(doc.id)) {
          cardMap.set(doc.id, { id: doc.id, ...doc.data() });
        }
      });
      
      const statusFixedCards = [];
      await verifyCardStatusesBatch(cardMap.values(), statusFixedCards);
      
      const validCards = Array.from(cardMap.values()).filter(card => 
        card.name && card.imageUrl && card.rarity && !card.inTrade && !card.inAuction
      );
      
      console.log(`Total valid cards for trading: ${validCards.length} (fallback)`);
      setUserCards(validCards);
      setSelectedCards([]);
    } catch (error) {
      console.error('Error in fallback loadUserCards:', error);
      Alert.alert('Error', 'Failed to load your cards. Please try again.');
    }
  };

  // Helper function to batch verify card statuses using optimized readOptimizer
  const verifyCardStatusesBatch = async (cards, statusFixedCards) => {
    try {
      const { batchVerifyCardStatuses } = await import('../utils/readOptimizer');
      await batchVerifyCardStatuses(cards, statusFixedCards);
    } catch (error) {
      console.error('Error in optimized batch card status verification:', error);
    }
  };

  // OPTIMIZED: Use consolidated query service for selected user cards
  const loadSelectedUserCards = async () => {
    if (!currentGroup || !selectedUser) return;
    setLoadingCards(true);
    try {
      console.log(`🚀 Loading cards for user ${selectedUser.id} in group ${currentGroup.id} with optimized service...`);
      
      // Use the optimized consolidated query service
      const cards = await consolidatedQueryService.getCardsForTradeCreation(selectedUser.id, currentGroup.id, {
        ttl: 2 * 60 * 1000 // 2 minute cache
      });
      
      console.log(`✅ Optimized service returned ${cards.length} cards for selected user`);
      
      // Filter valid cards (include all cards, not just those not in trade/auction)
      const validCards = cards.filter(card => 
        card.name && card.imageUrl && card.rarity
      );
      
      console.log(`📊 Total valid cards for selected user: ${validCards.length}`);
      setSelectedUserCards(validCards);
      setRequestedCards([]);
    } catch (error) {
      console.error('❌ Error in optimized loadSelectedUserCards:', error);
      
      // Fallback to original implementation
      console.log('⚠️  Falling back to original dual query for selected user');
      await loadSelectedUserCardsOriginal();
    } finally {
      setLoadingCards(false);
    }
  };

  // Original implementation as fallback
  const loadSelectedUserCardsOriginal = async () => {
    try {
      console.log(`Loading cards for user ${selectedUser.id} in group ${currentGroup.id} (fallback)...`);
      const cardsRef = collection(db, 'cards');
      
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
      
      console.log(`Found ${ownerQuerySnapshot.docs.length} cards with ownerId and ${userIdQuerySnapshot.docs.length} cards with userId (fallback)`);
      
      const cardMap = new Map();
      
      ownerQuerySnapshot.docs.forEach(doc => {
        cardMap.set(doc.id, { id: doc.id, ...doc.data() });
      });
      
      userIdQuerySnapshot.docs.forEach(doc => {
        if (!cardMap.has(doc.id)) {
          cardMap.set(doc.id, { id: doc.id, ...doc.data() });
        }
      });
      
      // Process all cards with batch status verification
      const statusFixedCards = [];
      await verifyCardStatusesBatch(cardMap.values(), statusFixedCards);
      
      // Filter valid cards (include all cards, not just those not in trade/auction)
      const validCards = Array.from(cardMap.values()).filter(card => 
        card.name && card.imageUrl && card.rarity
      );
      
      console.log(`Found ${validCards.length} valid cards to request from selected user (fallback)`);
      if (statusFixedCards.length > 0) {
        console.log(`Fixed status for ${statusFixedCards.length} cards (fallback)`);
      }
      
      setSelectedUserCards(validCards);
      setRequestedCards([]);
    } catch (error) {
      console.error('Error loading selected user cards (fallback):', error);
      Alert.alert('Error', 'Failed to load cards from selected user.');
    }
  };

  const loadUserBalance = async () => {
    if (!user || !currentGroup) return;
    try {
      // OPTIMIZATION: Use CacheService instead of direct getDoc
      const userData = await CacheService.getDocument('users', user.uid, {
        ttl: 2 * 60 * 1000 // 2 minute cache for user data
      });
      
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
        <Appbar.Content title="Create Trade" />
      </Appbar.Header>
      
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 100 }}>
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