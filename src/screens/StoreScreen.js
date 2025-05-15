import { useFocusEffect } from '@react-navigation/native';
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Animated, Easing, FlatList, Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Button, Card, Modal, Portal, Surface, Text, useTheme } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useBalance } from '../contexts/BalanceContext';
import { useGroup } from '../contexts/GroupContext';
import { BORDER_OPTIONS } from '../utils/borderOptions';
import { batchUpdateWithCache } from '../utils/dbOptimizationUtils';

const StoreScreen = () => {
  const theme = useTheme();
  const { user } = useAuth();
  const { balance, subtractCoins, refreshBalance } = useBalance();
  const { currentGroup } = useGroup();
  const [userBorders, setUserBorders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBorder, setSelectedBorder] = useState(null);
  const [cardSelectionVisible, setCardSelectionVisible] = useState(false);
  const [userCards, setUserCards] = useState([]);
  const [animations] = useState(() => 
    BORDER_OPTIONS.map(() => new Animated.Value(0))
  );
  const [isLoadingCards, setIsLoadingCards] = useState(false);
  const [cardFetchError, setCardFetchError] = useState(null);
  const [selectingExistingBorder, setSelectingExistingBorder] = useState(false);
  const [borderSelectionVisible, setBorderSelectionVisible] = useState(false);

  useEffect(() => {
    loadUserBorders();
    
    // Start animations
    BORDER_OPTIONS.forEach((_, index) => {
      animateBorder(index);
    });
  }, [user, currentGroup]);

  // Add useFocusEffect to refresh border data when screen is focused
  useFocusEffect(
    useCallback(() => {
      if (user && currentGroup) {
        loadUserBorders();
      }
    }, [user, currentGroup])
  );

  // Continuous animation function
  const animateBorder = (index) => {
    const animation = animations[index];
    const animationType = BORDER_OPTIONS[index].animationType;
    const duration = animationType === 'flicker' ? 1500 : 
                     animationType === 'pulse' ? 2000 : 
                     animationType === 'rotate' ? 6000 : 3000;
                     
    Animated.timing(animation, {
      toValue: 1,
      duration: duration,
      easing: animationType === 'flicker' ? Easing.out(Easing.bounce) : 
              animationType === 'pulse' ? Easing.inOut(Easing.sin) : 
              Easing.linear,
      useNativeDriver: false,
    }).start(() => {
      animation.setValue(0);
      animateBorder(index);
    });
  };

  const loadUserBorders = async () => {
    if (!user || !currentGroup) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        // Get user's purchased borders, defaulting to empty array if none
        // Always include the default border which everyone owns
        const borders = userData.cardBorders || [];
        if (!borders.includes('default')) {
          borders.push('default');
        }
        setUserBorders(borders);
      } else {
        // If user doc doesn't exist, still ensure they have the default border
        setUserBorders(['default']);
      }
    } catch (error) {
      console.error('Error loading user borders:', error);
      Alert.alert('Error', 'Failed to load your purchased borders');
      // Even on error, ensure user has default border
      setUserBorders(['default']);
    } finally {
      setLoading(false);
    }
  };

  const loadUserCards = async () => {
    if (!user || !currentGroup) {
      return;
    }

    try {
      setIsLoadingCards(true);
      setCardFetchError(null);
      
      // Use collection query to get all user cards for the current group
      const cardsRef = collection(db, 'cards');
      const q = query(
        cardsRef,
        where('ownerId', '==', user.uid),
        where('groupId', '==', currentGroup.id)
      );
      
      const querySnapshot = await getDocs(q);
      const cards = [];
      
      querySnapshot.forEach((doc) => {
        cards.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      setUserCards(cards);
      
      if (cards.length === 0) {
        console.log('No cards found for user in current group');
      }
    } catch (error) {
      console.error('Error loading user cards:', error);
      setCardFetchError('Failed to load your cards. Please try again.');
    } finally {
      setIsLoadingCards(false);
    }
  };

  const purchaseBorder = async (border) => {
    if (!user || !currentGroup) {
      Alert.alert('Error', 'You must be logged in and have a group selected');
      return;
    }

    if (userBorders.includes(border.id)) {
      Alert.alert('Already Purchased', 'You already own this border');
      return;
    }

    try {
      // Check if user has enough coins
      if (balance < border.price) {
        Alert.alert('Insufficient Funds', `You need ${border.price} coins to purchase this border. You have ${balance} coins.`);
        return;
      }

      // Confirm purchase
      Alert.alert(
        'Confirm Purchase',
        `Are you sure you want to purchase ${border.name} for ${border.price} coins?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Purchase',
            onPress: async () => {
              // Subtract coins first
              const success = await subtractCoins(border.price);
              
              if (success) {
                // Add border to user's collection
                const userRef = doc(db, 'users', user.uid);
                const updatedBorders = [...userBorders, border.id];
                
                await updateDoc(userRef, {
                  cardBorders: updatedBorders
                });
                
                setUserBorders(updatedBorders);
                refreshBalance();
                
                // Immediately fetch cards in the background
                loadUserCards();
                // Show card selection modal
                setSelectedBorder(border);
                setCardSelectionVisible(true);
              } else {
                Alert.alert('Purchase Failed', 'Failed to complete purchase. Please try again.');
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error purchasing border:', error);
      Alert.alert('Error', 'Failed to complete purchase');
    }
  };

  const applyBorderToCard = async (cardId) => {
    if (!selectedBorder || !cardId) return;
    
    try {
      // Ensure we're using the correct border ID
      const borderType = selectedBorder.id;
      
      // Use batch update with cache for better performance and cache synchronization
      await batchUpdateWithCache([{
        collection: 'cards',
        id: cardId,
        data: { borderType: borderType }
      }]);
      
      console.log(`Applied border ${borderType} to card ${cardId}`);
      
      Alert.alert('Success', `${selectedBorder.name} border applied to your card!`);
      setCardSelectionVisible(false);
      setSelectingExistingBorder(false);
      
      // Force a refresh of the user's cards
      setUserCards(prevCards => {
        return prevCards.map(card => {
          if (card.id === cardId) {
            return { ...card, borderType: borderType };
          }
          return card;
        });
      });
    } catch (error) {
      console.error('Error applying border to card:', error);
      Alert.alert('Error', 'Failed to apply border to card');
    }
  };

  const getBorderAnimation = (animationType, animation, borderColor, secondaryColor) => {
    // Use fixed styles without interpolation to avoid animation errors
    switch (animationType) {
      case 'pulse':
        return {
          borderWidth: 4,
          borderColor: borderColor,
          shadowColor: borderColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 7,
        };
      case 'shimmer':
        return {
          borderWidth: 4,
          borderColor: borderColor,
          shadowColor: borderColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 5,
        };
      case 'rotate':
        return {
          borderWidth: 4,
          borderColor: borderColor,
          shadowColor: borderColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 5,
        };
      case 'flicker':
        return {
          borderWidth: 4,
          borderColor: borderColor,
          shadowColor: secondaryColor || borderColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 6,
        };
      case 'frost':
        return {
          borderWidth: 4,
          borderColor: borderColor,
          shadowColor: secondaryColor || borderColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 7,
        };
      case 'wave':
        return {
          borderWidth: 4,
          borderColor: borderColor,
          shadowColor: secondaryColor || borderColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 5,
        };
      default:
        return {
          borderWidth: 3,
          borderColor: borderColor,
        };
    }
  };

  const renderBorderItem = ({ item, index }) => {
    const owned = userBorders.includes(item.id);
    const animation = animations[index];
    const animatedStyle = getBorderAnimation(
      item.animationType, 
      animation, 
      item.color, 
      item.secondaryColor
    );
    
    let borderStyle = {};
    if (item.id === 'rainbow') {
      // Special rainbow handling since we can't interpolate to multiple colors easily
      borderStyle = {
        borderWidth: 3,
        borderColor: '#FF0000',
        shadowColor: '#FF0000',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 5,
      };
    } else {
      borderStyle = animatedStyle;
    }
    
    return (
      <Card style={styles.borderCard}>
        <Card.Content>
          <View style={styles.borderPreview}>
            <Animated.View 
              style={[
                styles.borderSample,
                borderStyle
              ]}
            />
          </View>
          
          <Text style={styles.borderName}>{item.name}</Text>
          <Text style={styles.borderDescription}>{item.description}</Text>
          
          {item.id !== 'default' && (
            <View style={styles.priceContainer}>
              <Text style={styles.priceLabel}>Price:</Text>
              <Text style={styles.priceValue}>{item.price} coins</Text>
            </View>
          )}
        </Card.Content>
        
        <Card.Actions>
          {owned || item.id === 'default' ? (
            <Button mode="outlined" disabled={item.id !== 'default'} onPress={() => item.id === 'default' && purchaseBorder(item)}>
              {item.id === 'default' ? 'Free' : 'Owned'}
            </Button>
          ) : (
            <Button 
              mode="contained" 
              onPress={() => purchaseBorder(item)}
              disabled={balance < item.price}
            >
              Purchase
            </Button>
          )}
        </Card.Actions>
      </Card>
    );
  };

  const renderCardSelectionModal = () => (
    <Modal
      visible={cardSelectionVisible}
      onDismiss={() => {
        setCardSelectionVisible(false);
        setSelectingExistingBorder(false);
      }}
      contentContainerStyle={styles.cardSelectionModal}
    >
      <Text style={styles.modalTitle}>Select a Card</Text>
      <Text style={styles.modalSubtitle}>
        Choose a card to apply the {selectedBorder?.name} border
      </Text>
      
      {isLoadingCards ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading your cards...</Text>
        </View>
      ) : cardFetchError ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{cardFetchError}</Text>
          <Button 
            mode="contained" 
            onPress={loadUserCards}
            style={styles.retryButton}
          >
            Retry
          </Button>
        </View>
      ) : userCards.length > 0 ? (
        <FlatList
          data={userCards}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => applyBorderToCard(item.id)}>
              <Card style={styles.borderSelectCard}>
                <View style={styles.borderSelectContent}>
                  <Image 
                    source={{ uri: item.imageUrl }} 
                    style={styles.cardImage} 
                    resizeMode="cover"
                  />
                  <View style={styles.borderSelectDetails}>
                    <Text style={styles.borderName} numberOfLines={2}>{item.name}</Text>
                    <Text style={[styles.borderDescription, { color: getRarityColor(item.rarity) }]}>
                      {item.rarity}
                    </Text>
                    {item.borderType && (
                      <Text style={styles.currentBorder}>
                        Current: {getBorderName(item.borderType)}
                      </Text>
                    )}
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.bordersList}
        />
      ) : (
        <View style={styles.noCardsContainer}>
          <Text style={styles.noCardsText}>
            You don't have any cards yet. Collect some cards first!
          </Text>
          <Button 
            mode="contained" 
            onPress={() => {
              setCardSelectionVisible(false);
              setSelectingExistingBorder(false);
            }}
            style={styles.goCollectButton}
          >
            Go to Collection
          </Button>
        </View>
      )}
      
      <Button 
        mode="outlined" 
        onPress={() => {
          setCardSelectionVisible(false);
          setSelectingExistingBorder(false);
        }}
        style={styles.closeButton}
      >
        Cancel
      </Button>
    </Modal>
  );

  const openBorderSelection = () => {
    // Clear any existing state
    setSelectedBorder(null);
    setCardSelectionVisible(false);
    setUserCards([]);
    setCardFetchError(null);
    
    // Load cards and show border selection
    loadUserCards(); // Pre-load cards
    setBorderSelectionVisible(true);
    setSelectingExistingBorder(true);
  };

  const selectBorderToApply = (borderId) => {
    const border = BORDER_OPTIONS.find(b => b.id === borderId);
    if (border) {
      setSelectedBorder(border);
      setBorderSelectionVisible(false);
      setCardSelectionVisible(true);
    }
  };

  const renderBorderSelectionModal = () => (
    <Modal
      visible={borderSelectionVisible}
      onDismiss={() => {
        setBorderSelectionVisible(false);
        setSelectingExistingBorder(false);
      }}
      contentContainerStyle={styles.cardSelectionModal}
    >
      <Text style={styles.modalTitle}>Select a Border</Text>
      <Text style={styles.modalSubtitle}>
        Choose a border to apply to one of your cards
      </Text>
      
      <FlatList
        data={BORDER_OPTIONS.filter(border => userBorders.includes(border.id))}
        keyExtractor={item => item.id}
        renderItem={({ item, index }) => {
          const animation = animations[
            BORDER_OPTIONS.findIndex(b => b.id === item.id)
          ];
          
          const animatedStyle = getBorderAnimation(
            item.animationType, 
            animation, 
            item.color, 
            item.secondaryColor
          );
          
          let borderStyle = {};
          if (item.id === 'rainbow') {
            borderStyle = {
              borderWidth: 3,
              borderColor: '#FF0000',
              shadowColor: '#FF0000',
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.8,
              shadowRadius: 5,
            };
          } else {
            borderStyle = animatedStyle;
          }
          
          return (
            <TouchableOpacity onPress={() => selectBorderToApply(item.id)}>
              <Card style={styles.borderSelectCard}>
                <View style={styles.borderSelectContent}>
                  <Animated.View 
                    style={[
                      styles.borderSample,
                      borderStyle
                    ]}
                  />
                  <View style={styles.borderSelectDetails}>
                    <Text style={styles.borderName}>{item.name}</Text>
                    <Text style={styles.borderDescription}>{item.description}</Text>
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={styles.bordersList}
      />
      
      <Button 
        mode="outlined" 
        onPress={() => {
          setBorderSelectionVisible(false);
          setSelectingExistingBorder(false);
        }}
        style={styles.closeButton}
      >
        Cancel
      </Button>
    </Modal>
  );

  // Helper function to get border name from id
  const getBorderName = (borderId) => {
    const border = BORDER_OPTIONS.find(b => b.id === borderId);
    return border ? border.name : borderId;
  };

  // Helper function to get rarity color
  const getRarityColor = (rarity) => {
    switch(rarity?.toLowerCase()) {
      case 'common': return '#808080';
      case 'rare': return '#4169E1';
      case 'epic': return '#9932CC';
      case 'legendary': return '#FFD700';
      default: return '#808080';
    }
  };

  if (!currentGroup) {
    return (
      <ScreenBackground>
        <View style={styles.container}>
          <Surface style={styles.messageContainer}>
            <Text style={styles.messageText}>Please select a group to access the store</Text>
          </Surface>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <Surface style={styles.headerContainer}>
          <Text style={styles.headerTitle}>Card Border Store</Text>
          <Text style={styles.headerSubtitle}>
            Purchase custom borders to apply to your cards
          </Text>
          <Text style={styles.balanceText}>Your Balance: {balance} coins</Text>
          
          <Button
            mode="contained"
            style={styles.applyBorderButton}
            onPress={openBorderSelection}
          >
            Apply Owned Borders
          </Button>
        </Surface>
        
        <FlatList
          data={BORDER_OPTIONS}
          renderItem={renderBorderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContainer}
          numColumns={2}
        />
        
        <Portal>
          {renderCardSelectionModal()}
          {renderBorderSelectionModal()}
        </Portal>
      </View>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  headerContainer: {
    padding: 16,
    marginBottom: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    opacity: 0.7,
  },
  balanceText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 12,
    color: '#4CAF50',
  },
  applyBorderButton: {
    marginTop: 12,
  },
  listContainer: {
    paddingBottom: 20,
  },
  borderCard: {
    flex: 1,
    margin: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.8)',
    overflow: 'hidden',
  },
  borderPreview: {
    alignItems: 'center',
    marginBottom: 12,
  },
  borderSample: {
    width: 100,
    height: 150,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    margin: 5,
  },
  borderName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  borderDescription: {
    fontSize: 12,
    marginBottom: 12,
    opacity: 0.7,
  },
  priceContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceLabel: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  priceValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  messageContainer: {
    padding: 20,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageText: {
    fontSize: 16,
    textAlign: 'center',
  },
  cardSelectionModal: {
    backgroundColor: 'white',
    margin: 20,
    borderRadius: 12,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    opacity: 0.7,
  },
  cardsList: {
    paddingVertical: 10,
  },
  cardItem: {
    marginBottom: 12,
    borderRadius: 8,
    elevation: 2,
  },
  cardItemContent: {
    flexDirection: 'row',
    padding: 8,
  },
  cardImage: {
    width: 100,
    height: 150,
    borderRadius: 8,
    margin: 5,
  },
  cardDetails: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  cardName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  cardRarity: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  currentBorder: {
    fontSize: 12,
    fontStyle: 'italic',
    opacity: 0.7,
  },
  noCardsContainer: {
    alignItems: 'center',
    padding: 20,
  },
  noCardsText: {
    textAlign: 'center',
    marginVertical: 16,
    fontStyle: 'italic',
    opacity: 0.7,
    fontSize: 16,
  },
  goCollectButton: {
    marginTop: 12,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  errorContainer: {
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: 'red',
    marginBottom: 12,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
  },
  closeButton: {
    marginTop: 16,
    marginBottom: 8,
  },
  borderSelectCard: {
    marginBottom: 12,
    borderRadius: 8,
    elevation: 2,
  },
  borderSelectContent: {
    flexDirection: 'row',
    padding: 12,
    alignItems: 'center',
  },
  borderSelectDetails: {
    flex: 1,
    marginLeft: 12,
  },
  bordersList: {
    paddingVertical: 10,
    paddingBottom: 20,
  },
});

export default StoreScreen; 