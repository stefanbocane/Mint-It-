import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Animated, Dimensions, FlatList, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Appbar, Chip, FAB, Portal, Searchbar, Surface, Text } from 'react-native-paper';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

const CARD_WIDTH = Dimensions.get('window').width / 2 - 24;
const CARD_ASPECT_RATIO = 1.4;

const CardLibraryScreen = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRarity, setSelectedRarity] = useState(null);
  const [sortBy, setSortBy] = useState('newest');
  const [fabOpen, setFabOpen] = useState(false);

  // Animation values
  const [cardScales] = useState(() => 
    cards.map(() => new Animated.Value(0))
  );

  useEffect(() => {
    loadCards();
  }, []);

  const loadCards = async () => {
    try {
      setLoading(true);
      const cardsRef = collection(db, 'cards');
      const q = query(cardsRef, where('ownerId', '==', user.uid));
      const querySnapshot = await getDocs(q);
      
      const fetchedCards = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      setCards(fetchedCards);
      
      // Animate cards appearing
      fetchedCards.forEach((_, index) => {
        Animated.spring(cardScales[index], {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }).start();
      });
    } catch (error) {
      console.error('Error loading cards:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredCards = cards
    .filter(card => {
      if (searchQuery) {
        return card.rarity.toLowerCase().includes(searchQuery.toLowerCase());
      }
      if (selectedRarity) {
        return card.rarity === selectedRarity;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'newest') {
        return b.createdAt?.toMillis() - a.createdAt?.toMillis();
      }
      if (sortBy === 'rarity') {
        const rarityOrder = { legendary: 4, epic: 3, rare: 2, common: 1 };
        return rarityOrder[b.rarity] - rarityOrder[a.rarity];
      }
      if (sortBy === 'value') {
        return b.coinValue - a.coinValue;
      }
      return 0;
    });

  const handleCardPress = (card) => {
    // Animate card press
    const cardScale = cardScales[cards.indexOf(card)];
    Animated.sequence([
      Animated.timing(cardScale, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(cardScale, {
        toValue: 1,
        tension: 40,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start(() => {
      navigation.navigate('CardDetails', { card });
    });
  };

  const renderCard = ({ item, index }) => {
    const scale = cardScales[index] || new Animated.Value(1);
    const rarityColor = {
      common: '#757575',
      rare: '#2196F3',
      epic: '#9C27B0',
      legendary: '#FFD700',
    }[item.rarity];

    return (
      <TouchableOpacity
        onPress={() => handleCardPress(item)}
        activeOpacity={0.8}
      >
        <Animated.View
          style={[
            styles.cardContainer,
            {
              transform: [{ scale }],
            },
          ]}
        >
          <Surface style={[styles.card, { borderColor: rarityColor }]}>
            <Animated.Image
              source={{ uri: item.imageUrl }}
              style={styles.cardImage}
              resizeMode="cover"
            />
            <View style={styles.cardInfo}>
              <Text style={[styles.rarityText, { color: rarityColor }]}>
                {item.rarity.toUpperCase()}
              </Text>
              <Text style={styles.valueText}>{item.coinValue} coins</Text>
            </View>
          </Surface>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title="Card Library" />
      </Appbar.Header>

      <View style={styles.container}>
        <Searchbar
          placeholder="Search cards..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchBar}
        />

        <View style={styles.filterContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {['common', 'rare', 'epic', 'legendary'].map(rarity => (
              <Chip
                key={rarity}
                selected={selectedRarity === rarity}
                onPress={() => setSelectedRarity(selectedRarity === rarity ? null : rarity)}
                style={styles.filterChip}
              >
                {rarity.toUpperCase()}
              </Chip>
            ))}
          </ScrollView>
        </View>

        <FlatList
          data={filteredCards}
          renderItem={renderCard}
          keyExtractor={item => item.id}
          numColumns={2}
          contentContainerStyle={styles.cardGrid}
          showsVerticalScrollIndicator={false}
        />

        <Portal>
          <FAB.Group
            open={fabOpen}
            icon={fabOpen ? 'close' : 'sort'}
            actions={[
              {
                icon: 'clock',
                label: 'Newest First',
                onPress: () => setSortBy('newest'),
              },
              {
                icon: 'star',
                label: 'By Rarity',
                onPress: () => setSortBy('rarity'),
              },
              {
                icon: 'currency-usd',
                label: 'By Value',
                onPress: () => setSortBy('value'),
              },
            ]}
            onStateChange={({ open }) => setFabOpen(open)}
          />
        </Portal>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  searchBar: {
    margin: 16,
    elevation: 2,
  },
  filterContainer: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  filterChip: {
    marginRight: 8,
  },
  cardGrid: {
    padding: 8,
  },
  cardContainer: {
    width: CARD_WIDTH,
    margin: 8,
  },
  card: {
    elevation: 4,
    borderRadius: 12,
    borderWidth: 2,
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: CARD_WIDTH * CARD_ASPECT_RATIO,
  },
  cardInfo: {
    padding: 8,
  },
  rarityText: {
    fontWeight: 'bold',
    fontSize: 12,
  },
  valueText: {
    fontSize: 12,
    color: theme.colors.text,
    opacity: 0.7,
  },
});

export default CardLibraryScreen; 