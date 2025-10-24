import { addDoc, collection, doc, query, updateDoc, where } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { useEffect, useState } from 'react';
import {
    Alert,
    FlatList,
    Image,
    Modal,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { db } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContextSupabase';
import { useGroup } from '../../contexts/GroupContextSupabase';
import { getDocs } from '../../services/ReadTracking/TrackedFirestore';
import { RARITY_COLORS } from '../../utils/rarity';

const CreateAuctionModal = ({ visible, onDismiss, onSuccess, initialCard }) => {
  const { user } = useAuth();
  const { currentGroup } = useGroup();

  // Early return if no group context is available
  if (visible && !currentGroup) {
    console.warn('CreateAuctionModal: No current group available');
    return null;
  }
  
  const [cards, setCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [startingBid, setStartingBid] = useState('10');
  const [duration, setDuration] = useState('24');
  const [loading, setLoading] = useState(false);

  // Duration options in hours
  const durationOptions = [
    { label: '6 hours', value: '6' },
    { label: '12 hours', value: '12' },
    { label: '24 hours', value: '24' }
  ];

  useEffect(() => {
    if (visible) {
      loadCards();
      // If initialCard is provided, pre-select it
      if (initialCard && initialCard.id) {
        setSelectedCard(initialCard);
      } else {
        setSelectedCard(null);
      }
      setStartingBid('10');
      setDuration('24');
    }
  }, [visible, initialCard]);

  const loadCards = async () => {
    if (!user?.uid || !currentGroup?.id) {
      return;
    }

    try {
      const cardsQuery = query(
        collection(db, 'cards'),
        where('ownerId', '==', user.uid),
        where('groupId', '==', currentGroup.id)
      );

      const snapshot = await getDocs(cardsQuery);
      const userCards = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Filter available cards
      const available = userCards.filter(card => 
        !card.inTrade && 
        !card.inAuction && 
        !['auction', 'traded', 'pending'].includes(card.status)
      );

      setCards(available);
      
      // If initialCard is provided and it's in the available cards, pre-select it
      if (initialCard && initialCard.id) {
        const foundCard = available.find(card => card.id === initialCard.id);
        if (foundCard) {
          setSelectedCard(foundCard);
        }
      }
    } catch (error) {
      console.error('Error loading cards:', error);
      Alert.alert('Error', 'Failed to load cards');
    }
  };

  const createAuction = async () => {
    if (!selectedCard) {
      Alert.alert('Error', 'Please select a card');
      return;
    }

    const bid = parseInt(startingBid);
    if (isNaN(bid) || bid < 1) {
      Alert.alert('Error', 'Please enter a valid starting bid');
      return;
    }

    setLoading(true);

    try {
      const durationHours = parseInt(duration);
      const endTime = new Date(Date.now() + durationHours * 60 * 60 * 1000);

      // Create auction
      const auctionData = {
        cardId: selectedCard.id,
        cardName: selectedCard.name,
        cardImage: selectedCard.imageUrl,
        cardRarity: selectedCard.rarity || 'common',
        currentRarity: selectedCard.rarity || 'common',
        sellerId: user.uid,
        sellerName: user.displayName || user.email || 'Unknown',
        groupId: currentGroup.id,
        startingBid: bid,
        currentBid: bid,
        currentBidder: null,
        currentBidderName: null,
        status: 'active',
        createdAt: new Date(),
        endTime: endTime,
        uniqueBidderCount: 0,
        bidCount: 0,
        lastBidTime: null,
        lastRarityUpdate: new Date(),
      };

      const auctionRef = await addDoc(collection(db, 'auctions'), auctionData);

      // Update card
      await updateDoc(doc(db, 'cards', selectedCard.id), {
        inAuction: true,
        auctionId: auctionRef.id,
        status: 'auction',
        statusUpdateTime: new Date(),
      });

      // CRITICAL FIX: Invalidate auction list cache so new auction appears on refresh
      try {
        // Import AuctionService to access cache manager
        const { default: AuctionService } = await import('../../services/AuctionService');
        const auctionService = new AuctionService();
        
        // Clear auction list caches for this group so fresh data is fetched
        const groupId = currentGroup.id;
        const auctionListCacheKeys = [
          `paginated_auctions_optimized_${groupId}_active_start_10`,
          `paginated_auctions_optimized_${groupId}_active_start_20`,
          `paginated_auctions_optimized_${groupId}_active_start_${15}`, // Default page size
        ];
        
        auctionListCacheKeys.forEach(key => {
          auctionService.cache.invalidate(key);
        });
        
        console.log(`🧹 Invalidated auction list caches for new auction in group ${groupId}`);
      } catch (cacheError) {
        console.warn('⚠️ Could not invalidate auction cache (non-critical):', cacheError);
      }

      Alert.alert('Success!', 'Auction created successfully', [
        { text: 'OK', onPress: () => {
          onDismiss();
          onSuccess?.(auctionRef.id);
        }}
      ]);

    } catch (error) {
      console.error('Error creating auction:', error);
      Alert.alert('Error', 'Failed to create auction');
    } finally {
      setLoading(false);
    }
  };

  const renderCard = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.cardItem,
        selectedCard?.id === item.id && styles.selectedCard
      ]}
      onPress={() => setSelectedCard(item)}
    >
      <Image source={{ uri: item.imageUrl }} style={styles.cardImage} />
      <View style={styles.cardInfo}>
        <Text style={styles.cardName}>{item.name}</Text>
        <Text style={[styles.cardRarity, { color: RARITY_COLORS[item.rarity] || '#666' }]}>
          {(item.rarity || 'common').toUpperCase()}
        </Text>
      </View>
      {selectedCard?.id === item.id && (
        <Text style={styles.selectedText}>✓</Text>
      )}
    </TouchableOpacity>
  );

  const renderDuration = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.durationItem,
        duration === item.value && styles.selectedDuration
      ]}
      onPress={() => setDuration(item.value)}
    >
      <Text style={[
        styles.durationText,
        duration === item.value && styles.selectedDurationText
      ]}>
        {item.label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Create Auction</Text>
          <TouchableOpacity onPress={onDismiss} style={styles.closeButton}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.content}>
          {/* Card Selection */}
          <Text style={styles.sectionTitle}>Select Card ({cards.length} available)</Text>
          <FlatList
            data={cards}
            renderItem={renderCard}
            keyExtractor={(item) => item.id}
            style={styles.cardList}
            showsVerticalScrollIndicator={false}
          />

          {/* Starting Bid */}
          <Text style={styles.sectionTitle}>Starting Bid</Text>
          <TextInput
            style={styles.input}
            value={startingBid}
            onChangeText={setStartingBid}
            placeholder="Enter starting bid"
            keyboardType="numeric"
            placeholderTextColor="#999"
          />

          {/* Duration */}
          <Text style={styles.sectionTitle}>Auction Duration</Text>
          <FlatList
            data={durationOptions}
            renderItem={renderDuration}
            keyExtractor={(item) => item.value}
            horizontal
            style={styles.durationList}
            showsHorizontalScrollIndicator={false}
          />
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.createButton, (!selectedCard || loading) && styles.disabledButton]}
            onPress={createAuction}
            disabled={!selectedCard || loading}
          >
            <Text style={styles.createButtonText}>
              {loading ? 'Creating...' : 'Create Auction'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#4FC3A1',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  closeButton: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    fontSize: 20,
    color: 'white',
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    marginTop: 20,
    color: '#2d3748',
  },
  cardList: {
    maxHeight: 300,
    marginBottom: 10,
  },
  cardItem: {
    flexDirection: 'row',
    backgroundColor: 'white',
    padding: 15,
    marginBottom: 10,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  selectedCard: {
    borderColor: '#4FC3A1',
    backgroundColor: '#e6fffa',
  },
  cardImage: {
    width: 50,
    height: 70,
    borderRadius: 8,
    marginRight: 15,
    backgroundColor: '#f7fafc',
  },
  cardInfo: {
    flex: 1,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 5,
    color: '#2d3748',
  },
  cardRarity: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  selectedText: {
    fontSize: 20,
    color: '#4FC3A1',
    fontWeight: 'bold',
  },
  input: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    color: '#2d3748',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  durationList: {
    marginBottom: 20,
  },
  durationItem: {
    backgroundColor: 'white',
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginRight: 10,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  selectedDuration: {
    backgroundColor: '#4FC3A1',
    borderColor: '#4FC3A1',
  },
  durationText: {
    fontSize: 14,
    color: '#718096',
  },
  selectedDurationText: {
    color: 'white',
    fontWeight: '600',
  },
  footer: {
    padding: 20,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  createButton: {
    backgroundColor: '#4FC3A1',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  disabledButton: {
    backgroundColor: '#a0aec0',
  },
  createButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default CreateAuctionModal; 