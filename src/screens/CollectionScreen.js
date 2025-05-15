import { useNavigation } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, startAfter, updateDoc, where } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Platform,
  RefreshControl,
  StyleSheet,
  ToastAndroid,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Chip,
  Dialog,
  Divider,
  IconButton,
  Menu,
  Portal,
  Surface,
  Text,
  useTheme
} from 'react-native-paper';
import { FadeInDown } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ScreenBackground from '../components/ScreenBackground';
import { db } from '../config/firebase';
import { CACHE_TTL } from '../constants/cacheConfig';
import { useAuth } from '../contexts/AuthContext';
import { useBalance } from '../contexts/BalanceContext';
import { GROUP_CHANGED_EVENT, useGroup } from '../contexts/GroupContext';
import { queueUpdate } from '../utils/batchProcessor';
import { BORDER_OPTIONS } from '../utils/borderOptions';
import { clearExpiredCache } from '../utils/cacheUtils';
import EventManager from '../utils/eventManager';
import { setupCachedQueryListenerWithChanges } from '../utils/firestoreUtils';
import { aggregateQueryResults, createQueryConfig } from '../utils/queryAggregator';
import { RARITY_COLORS, getDownloadPrice } from '../utils/rarity';
import { loadViewState, saveViewState } from '../utils/viewStateUtils';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Only include any external function declarations here if they don't use hooks

const CollectionScreen = () => {
  const [cards, setCards] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [cardToDelete, setCardToDelete] = useState(null);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedCard, setSelectedCard] = useState(null);
  const [cardPreviewVisible, setCardPreviewVisible] = useState(false);
  const [displayedCardCount, setDisplayedCardCount] = useState(20);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const theme = useTheme();
  const navigation = useNavigation();
  const [downloadingCard, setDownloadingCard] = useState(false);
  const { balance, subtractCoins, addCoins } = useBalance();
  const [unsubscribeListeners, setUnsubscribeListeners] = useState([]);

  // Animation refs for card preview
  const cardScaleAnim = useRef(new Animated.Value(0)).current;
  const cardRotateAnim = useRef(new Animated.Value(0)).current;
  const cardOpacityAnim = useRef(new Animated.Value(0)).current;
  const cardDetailsAnim = useRef(new Animated.Value(0)).current;
  const detailsShimmerAnim = useRef(new Animated.Value(-100)).current;

  const [sortByMenuVisible, setSortByMenuVisible] = useState(false);
  const [sortOrderMenuVisible, setSortOrderMenuVisible] = useState(false);
  const [filterStatusMenuVisible, setFilterStatusMenuVisible] = useState(false);

  // Add a flag to track if we've loaded from view state
  const [loadedFromViewState, setLoadedFromViewState] = useState(false);
  
  // Save view state when component unmounts or when state changes significantly
  useEffect(() => {
    // Don't save while loading
    if (loading) return;
    
    // Save view state when significant state changes
    if (cards.length > 0) {
      const viewState = {
        cards,
        sortBy,
        sortOrder,
        filterStatus,
        lastSaved: Date.now()
      };
      
      saveViewState('collection_screen', viewState);
    }
    
    // Also save when component unmounts
    return () => {
      if (cards.length > 0) {
        const viewState = {
          cards,
          sortBy,
          sortOrder,
          filterStatus,
          lastSaved: Date.now()
        };
        
        saveViewState('collection_screen', viewState);
      }
    };
  }, [cards.length, sortBy, sortOrder, filterStatus, loading]);

  // Clean up cache when component mounts
  useEffect(() => {
    clearExpiredCache().then(count => {
      console.log(`Cleared ${count} expired cache entries on component mount`);
    });
    
    // Try to load view state
    const loadSavedViewState = async () => {
      if (!user || !currentGroup) return;
      
      try {
        const savedState = await loadViewState('collection_screen');
        
        if (savedState && !loadedFromViewState) {
          console.log('Restoring collection screen state from saved view state');
          
          // Check if the saved state is for the current user and group
          if (savedState.cards && savedState.cards.length > 0) {
            const firstCard = savedState.cards[0];
            const matchesCurrentContext = 
              (firstCard.ownerId === user.uid || firstCard.userId === user.uid) && 
              firstCard.groupId === currentGroup.id;
            
            if (matchesCurrentContext) {
              // Restore state
              setCards(savedState.cards);
              setSortBy(savedState.sortBy || 'name');
              setSortOrder(savedState.sortOrder || 'asc');
              setFilterStatus(savedState.filterStatus || 'all');
              setLoadedFromViewState(true);
              setLoading(false);
              
              console.log(`Restored ${savedState.cards.length} cards from view state`);
              return true;
            }
          }
        }
        return false;
      } catch (error) {
        console.error('Error loading view state:', error);
        return false;
      }
    };
    
    loadSavedViewState().then(loaded => {
      // If we couldn't load from view state, do the normal fetch
      if (!loaded) {
        // Fetch cards normally
      }
    });
  }, []);
  
  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeListeners.length > 0) {
        console.log('Cleaning up all card listeners');
        unsubscribeListeners.forEach(unsub => unsub());
      }
    };
  }, [unsubscribeListeners]);
  
  // Memoize the fetchCardsInitially function to prevent recreation on every render
  const fetchCardsInitially = useCallback(async () => {
    if (!user || !currentGroup || loadedFromViewState) {
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      
      // Create direct query objects with pagination
      const pageSize = 20; // Load 20 cards at a time
      const ownerQuery = query(
        collection(db, 'cards'),
        where('ownerId', '==', user.uid),
        where('groupId', '==', currentGroup.id),
        orderBy('createdAt', 'desc'), // Add an orderBy for startAfter to work
        limit(pageSize)
      );
      
      const userIdQuery = query(
        collection(db, 'cards'),
        where('userId', '==', user.uid),
        where('groupId', '==', currentGroup.id),
        orderBy('createdAt', 'desc'), // Ensure same sort order
        limit(pageSize)
      );
      
      // Use query aggregator for efficient fetching and deduplication
      const cardsArray = await aggregateQueryResults([
        createQueryConfig(ownerQuery, {
          ttl: CACHE_TTL.COLLECTION, // Use standardized TTL values
          cacheKey: `cards_owner_${user.uid}_${currentGroup.id}_page1`
        }),
        createQueryConfig(userIdQuery, {
          ttl: CACHE_TTL.COLLECTION,
          cacheKey: `cards_userid_${user.uid}_${currentGroup.id}_page1`
        })
      ]);
      
      // Store last docs for pagination
      if (cardsArray.length >= pageSize) {
        setHasMoreCards(true);
      }
      
      console.log(`Got ${cardsArray.length} cards from aggregated query`);
      setCards(cardsArray);
      
      // Handle query updates with changes
      const handleQueryUpdateWithChanges = (newData, changes, source) => {
        console.log(`Processing ${source} cards update with specific change information`);
        
        setCards(currentCards => {
          // Start with the current cards
          const cardMap = new Map(currentCards.map(card => [card.id, card]));
          
          // Apply changes using the specific change information
          if (changes) {
            // First handle removals
            if (changes.removed && changes.removed.length > 0) {
              changes.removed.forEach(removedId => {
                cardMap.delete(removedId);
                console.log(`Removed card ${removedId} from local state`);
              });
            }
            
            // Then handle additions
            if (changes.added && changes.added.length > 0) {
              changes.added.forEach(card => {
                // Verify ownership
                const isOwner = card.ownerId === user?.uid;
                const isUser = card.userId === user?.uid;
                const isCorrectGroup = card.groupId === currentGroup?.id;
                
                if ((isOwner || isUser) && isCorrectGroup) {
                  console.log(`Adding new card ${card.id} (${card.name}) to local state`);
                  cardMap.set(card.id, card);
                }
              });
            }
            
            // Finally handle modifications
            if (changes.modified && changes.modified.length > 0) {
              changes.modified.forEach(card => {
                // Check if we still own/use this card after modification
                const isOwner = card.ownerId === user?.uid;
                const isUser = card.userId === user?.uid;
                const isCorrectGroup = card.groupId === currentGroup?.id;
                
                if ((isOwner || isUser) && isCorrectGroup) {
                  console.log(`Updating card ${card.id} (${card.name}) in local state`);
                  cardMap.set(card.id, card);
                } else if (cardMap.has(card.id)) {
                  // We no longer own/use this card, remove it
                  console.log(`Removing card ${card.id} from local state due to ownership change`);
                  cardMap.delete(card.id);
                }
              });
            }
          } else {
            // Fallback to the old way if no changes object is provided
            newData.forEach(card => {
              const isOwner = card.ownerId === user?.uid;
              const isUser = card.userId === user?.uid;
              const isCorrectGroup = card.groupId === currentGroup?.id;
              
              if ((isOwner || isUser) && isCorrectGroup) {
                cardMap.set(card.id, card);
              }
            });
          }
          
          return Array.from(cardMap.values());
        });
      };
      
      // Store all the unsubscribe functions
      const unsubFunctions = [];
      
      // Owner query listener
      const unsubOwner = setupCachedQueryListenerWithChanges(
        ownerQuery,
        (newData, changes) => {
          // We now receive information about what changed
          console.log(`Owner cards changes: ${changes?.added.length} added, ${changes?.modified.length} modified, ${changes?.removed.length} removed`);
          handleQueryUpdateWithChanges(newData, changes, 'owner');
        },
        { 
          ttl: CACHE_TTL.COLLECTION,
          cacheKey: `cards_owner_${user.uid}_${currentGroup.id}`,
          listenerHeartbeatMs: 3000 // 3 second throttling 
        }
      );
      unsubFunctions.push(unsubOwner);
      
      // UserId query listener
      const unsubUserId = setupCachedQueryListenerWithChanges(
        userIdQuery,
        (newData, changes) => {
          // We now receive information about what changed
          console.log(`UserId cards changes: ${changes?.added.length} added, ${changes?.modified.length} modified, ${changes?.removed.length} removed`);
          handleQueryUpdateWithChanges(newData, changes, 'userId');
        },
        { 
          ttl: CACHE_TTL.COLLECTION,
          cacheKey: `cards_userid_${user.uid}_${currentGroup.id}`,
          listenerHeartbeatMs: 3000 // 3 second throttling
        }
      );
      unsubFunctions.push(unsubUserId);
      
      // Store unsubscribe functions
      setUnsubscribeListeners(unsubFunctions);
      
      // Silently verify card statuses in the background
      await verifyCardsStatuses(cardsArray);
      
      setLoading(false);
    } catch (error) {
      console.error('Error fetching cards initially:', error);
      setLoading(false);
    }
  }, [user, currentGroup, loadedFromViewState, setLoading, aggregateQueryResults, createQueryConfig, verifyCardsStatuses]);

  // Memoize the fetchBorders function
  const fetchBorders = useCallback(async () => {
    try {
      // Implement border fetching logic if needed
      console.log('Fetching borders');
      // This can be empty if borders are fetched in onRefresh or elsewhere
    } catch (error) {
      console.error('Error fetching borders:', error);
    }
  }, []);

  // Update useEffect for loading cards (now it just calls fetchCardsInitially)
  useEffect(() => {
    fetchCardsInitially();
  }, [user, currentGroup, loadedFromViewState, fetchCardsInitially]);
  
  // Add state for tracking pagination
  const [isLoadingMoreCards, setIsLoadingMoreCards] = useState(false);
  const [hasMoreCards, setHasMoreCards] = useState(false);
  const lastOwnerDoc = useRef(null);
  const lastUserIdDoc = useRef(null);
  
  // Function to load more cards (pagination)
  const loadMoreCards = async () => {
    if (!user || !currentGroup || isLoadingMoreCards || !hasMoreCards) return;
    
    setIsLoadingMoreCards(true);
    
    try {
      // Create paginated queries
      const pageSize = 20;
      
      // Only create paginated queries if we have last docs
      let newCards = [];
      
      // Build the paginated owner query if we have a last doc
      if (lastOwnerDoc.current) {
        const paginatedOwnerQuery = query(
          collection(db, 'cards'),
          where('ownerId', '==', user.uid),
          where('groupId', '==', currentGroup.id),
          orderBy('createdAt', 'desc'),
          startAfter(lastOwnerDoc.current),
          limit(pageSize)
        );
        
        const ownerSnapshot = await getDocs(paginatedOwnerQuery);
        if (!ownerSnapshot.empty) {
          lastOwnerDoc.current = ownerSnapshot.docs[ownerSnapshot.docs.length - 1];
          
          // Get cards from this query
          const ownerCards = ownerSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          
          newCards = [...newCards, ...ownerCards];
        }
      }
      
      // Build the paginated userId query if we have a last doc
      if (lastUserIdDoc.current) {
        const paginatedUserIdQuery = query(
          collection(db, 'cards'),
          where('userId', '==', user.uid),
          where('groupId', '==', currentGroup.id),
          orderBy('createdAt', 'desc'),
          startAfter(lastUserIdDoc.current),
          limit(pageSize)
        );
        
        const userIdSnapshot = await getDocs(paginatedUserIdQuery);
        if (!userIdSnapshot.empty) {
          lastUserIdDoc.current = userIdSnapshot.docs[userIdSnapshot.docs.length - 1];
          
          // Get cards from this query
          const userIdCards = userIdSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          
          newCards = [...newCards, ...userIdCards];
        }
      }
      
      // Deduplicate new cards (in case a card appears in both queries)
      const uniqueNewCards = [];
      const existingIds = new Set(cards.map(card => card.id));
      
      for (const card of newCards) {
        if (!existingIds.has(card.id)) {
          uniqueNewCards.push(card);
          existingIds.add(card.id);
        }
      }
      
      // Update state with new cards
      if (uniqueNewCards.length > 0) {
        setCards(prevCards => [...prevCards, ...uniqueNewCards]);
        
        // Check if we should expect more cards
        setHasMoreCards(uniqueNewCards.length >= pageSize);
      } else {
        // No more cards to load
        setHasMoreCards(false);
      }
      
      // Verify card statuses silently in the background
      verifyCardsStatuses(uniqueNewCards);
      
    } catch (error) {
      console.error('Error loading more cards:', error);
    } finally {
      setIsLoadingMoreCards(false);
    }
  };
  
  // Verify and fix card statuses in the background
  const verifyCardsStatuses = async (cardsToVerify) => {
    if (!cardsToVerify?.length) return;
    
    console.log(`Silently verifying statuses of ${cardsToVerify.length} cards`);
    
    const now = new Date();
    let changedCount = 0;
    
    cardsToVerify.forEach(card => {
      // Check for invalid status
      if (card.status === 'traded' || card.status === 'auction') {
        // For traded or auction cards, verify if they're stale
        const lastStatusUpdateTime = card.statusUpdateTime ? 
          new Date(card.statusUpdateTime.seconds * 1000) : null;
        
        // If status is stale (no update in 24 hours), reset to normal
        if (lastStatusUpdateTime && 
            (now - lastStatusUpdateTime) > 24 * 60 * 60 * 1000) {
          
          // Queue update instead of immediate write
          queueUpdate('cards', card.id, {
            status: 'normal',
            statusUpdateTime: now
          });
          
          changedCount++;
        }
      }
    });
    
    if (changedCount > 0) {
      console.log(`Queued status updates for ${changedCount} stale cards`);
    }
  };

  // Function to refresh the collection - memoize it
  const onRefresh = useCallback(async () => {
    if (!user || !currentGroup) return;
    
    setRefreshing(true);
    
    try {
      // Create query objects directly
      const ownerQuery = query(
        collection(db, 'cards'),
        where('ownerId', '==', user.uid),
        where('groupId', '==', currentGroup.id)
      );
      
      const userIdQuery = query(
        collection(db, 'cards'),
        where('userId', '==', user.uid),
        where('groupId', '==', currentGroup.id)
      );
      
      // Use query aggregator for efficient refreshing
      const cardsArray = await aggregateQueryResults([
        createQueryConfig(ownerQuery, {
          forceRefresh: true,
          cacheKey: `cards_owner_${user.uid}_${currentGroup.id}`
        }),
        createQueryConfig(userIdQuery, {
          forceRefresh: true,
          cacheKey: `cards_userid_${user.uid}_${currentGroup.id}`
        })
      ]);
      
      setCards(cardsArray);
      
      // Silently verify card statuses in the background
      await verifyCardsStatuses(cardsArray);
    } catch (error) {
      console.error('Error refreshing cards:', error);
    } finally {
      setRefreshing(false);
    }
  }, [user, currentGroup, aggregateQueryResults, createQueryConfig, verifyCardsStatuses]);

  const confirmDeleteCard = (card) => {
    setCardToDelete(card);
    setConfirmDialog(true);
  };

  const handleDeleteCard = async () => {
    if (!cardToDelete) return;
    
    try {
      // Delete the card
      await deleteDoc(doc(db, 'cards', cardToDelete.id));
      
      // Update local state
      setCards(prev => prev.filter(card => card.id !== cardToDelete.id));
      
      // Close dialog
      setConfirmDialog(false);
      setCardToDelete(null);
      
      // Show success message
      Alert.alert('Success', 'Card deleted successfully');
    } catch (error) {
      console.error('Error deleting card:', error);
      Alert.alert('Error', 'Failed to delete card');
    }
  };

  // Function to filter and sort cards
  const getSortedAndFilteredCards = () => {
    // Filter cards first
    let filteredCards = [...cards];
    
    // Apply status filter
    if (filterStatus !== 'all') {
      if (filterStatus === 'available') {
        filteredCards = cards.filter(card => !card.inTrade && !card.inAuction);
      } else if (filterStatus === 'inTrade') {
        filteredCards = cards.filter(card => card.inTrade);
      } else if (filterStatus === 'inAuction') {
        filteredCards = cards.filter(card => card.inAuction);
      }
    }
    
    // Apply sorting
    const sortedCards = [...filteredCards].sort((a, b) => {
      let comparison = 0;
      
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'rarity') {
        // Define rarity order
        const rarityOrder = {
          common: 0,
          uncommon: 1,
          rare: 2,
          ultraRare: 3,
          legendary: 4,
          mythic: 5,
          'ultra-rare': 3, // For backward compatibility
        };
        
        const aValue = rarityOrder[a.rarity?.toLowerCase()] || 0;
        const bValue = rarityOrder[b.rarity?.toLowerCase()] || 0;
        
        comparison = aValue - bValue;
      } else if (sortBy === 'dateAdded') {
        // Sort by creation date (newest first by default)
        const aDate = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
        const bDate = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
        
        comparison = bDate - aDate; // Default newest first
        if (sortOrder === 'asc') {
          comparison = -comparison; // Reverse for oldest first
        }
        
        return comparison;
      }
      
      // Apply sort order (except for dateAdded which already handles it)
      if (sortBy !== 'dateAdded') {
        return sortOrder === 'asc' ? comparison : -comparison;
      }
      
      return comparison;
    });
    
    return sortedCards;
  };

  // Card preview animation functions
  const showCardPreview = (card) => {
    setSelectedCard(card);
    setCardPreviewVisible(true);
    
    // Reset animations
    cardScaleAnim.setValue(0);
    cardRotateAnim.setValue(0);
    cardOpacityAnim.setValue(0);
    cardDetailsAnim.setValue(0);
    detailsShimmerAnim.setValue(-100);
    
    // Start animations
    Animated.sequence([
      // First scale up the card
      Animated.spring(cardScaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true
      }),
      // Then fade in the details with shimmer effect
      Animated.parallel([
        Animated.timing(cardOpacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true
        }),
        Animated.timing(cardDetailsAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true
        }),
        Animated.loop(
          Animated.timing(detailsShimmerAnim, {
            toValue: 100,
            duration: 1800,
            useNativeDriver: true
          })
        )
      ])
    ]).start();
    
    // Start subtle hover animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(cardRotateAnim, {
          toValue: 1,
          duration: 2500,
          easing: Easing.ease,
          useNativeDriver: true
        }),
        Animated.timing(cardRotateAnim, {
          toValue: -1,
          duration: 2500,
          easing: Easing.ease,
          useNativeDriver: true
        }),
        Animated.timing(cardRotateAnim, {
          toValue: 0,
          duration: 2500,
          easing: Easing.ease,
          useNativeDriver: true
        })
      ])
    ).start();

    // Trigger haptic feedback
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.log('Haptics not available');
    }
  };

  const closeCardPreview = () => {
    // Trigger haptic feedback
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      console.log('Haptics not available');
    }

    Animated.parallel([
      Animated.timing(cardScaleAnim, {
        toValue: 0.8,
        duration: 200,
        useNativeDriver: true
      }),
      Animated.timing(cardOpacityAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true
      })
    ]).start(() => {
      setCardPreviewVisible(false);
      setSelectedCard(null);
    });
  };

  // Function to download card image to the device
  const downloadCardToDevice = async (card) => {
    if (!card || !card.imageUrl) {
      Alert.alert('Error', 'Cannot download this card. Image not available.');
      return;
    }

    try {
      setDownloadingCard(true);
      
      // Calculate price based on rarity
      const downloadPrice = getDownloadPrice(card.rarity);
      
      // Check if user has enough balance
      if (balance < downloadPrice) {
        Alert.alert(
          'Insufficient Balance', 
          `You need ${downloadPrice} coins to download this ${card.rarity} card. Your current balance is ${balance} coins.`
        );
        setDownloadingCard(false);
        return;
      }
      
      // Confirm purchase
      Alert.alert(
        'Confirm Download',
        `Download this ${card.rarity} card for ${downloadPrice} coins?`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => setDownloadingCard(false)
          },
          {
            text: 'Download',
            onPress: async () => {
              try {
                // Request permissions first if needed
                const { status } = await MediaLibrary.requestPermissionsAsync();
                
                if (status !== 'granted') {
                  Alert.alert('Permission Denied', 'Permission to access media library is required to save the card.');
                  setDownloadingCard(false);
                  return;
                }
                
                // Deduct coins first
                const deductResult = await subtractCoins(downloadPrice);
                
                if (!deductResult) {
                  Alert.alert('Transaction Failed', 'Could not process the transaction. Please try again later.');
                  setDownloadingCard(false);
                  return;
                }
                
                // Download the image
                const fileUri = FileSystem.documentDirectory + `card_${card.id}.jpg`;
                const downloadResult = await FileSystem.downloadAsync(card.imageUrl, fileUri);
                
                if (downloadResult.status === 200) {
                  // Save to media library
                  const asset = await MediaLibrary.createAssetAsync(fileUri);
                  await MediaLibrary.createAlbumAsync('Cardmates', asset, false);
                  
                  // Show success message
                  if (Platform.OS === 'android') {
                    ToastAndroid.show('Card saved to your photos!', ToastAndroid.SHORT);
                  } else {
                    Alert.alert('Success', 'Card saved to your photos!');
                  }
                } else {
                  throw new Error('Download failed');
                }
              } catch (error) {
                console.error('Error downloading card:', error);
                Alert.alert('Download Failed', 'There was an error downloading the card. Please try again later.');
                
                // Refund coins if download failed after deduction
                await addCoins(downloadPrice);
              } finally {
                setDownloadingCard(false);
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error initiating download:', error);
      Alert.alert('Error', 'Could not download the card. Please try again later.');
      setDownloadingCard(false);
    }
  };

  // Function to determine sell price based on rarity
  const getSellPrice = (rarity) => {
    const rarityPrices = {
      'common': 10,
      'uncommon': 25,
      'rare': 50,
      'epic': 100,
      'legendary': 250,
      'mystery': 5
    };
    return rarityPrices[rarity?.toLowerCase()] || 10;
  };
  
  // Function to sell a card
  const sellCard = async (card) => {
    try {
      const sellPrice = getSellPrice(card.rarity);
      Alert.alert(
        'Sell Card',
        `Are you sure you want to sell this ${card.rarity} card for ${sellPrice} coins?`,
        [
          {
            text: 'Cancel',
            style: 'cancel'
          },
          {
            text: 'Sell',
            onPress: async () => {
              try {
                // Delete the card
                await deleteDoc(doc(db, 'cards', card.id));
                
                // Add coins to user's balance
                const userRef = doc(db, 'users', user.uid);
                const userDoc = await getDoc(userRef);
                
                if (userDoc.exists()) {
                  const userData = userDoc.data();
                  const groupBalances = userData.groupBalances || {};
                  const currentBalance = groupBalances[currentGroup.id] || 0;
                  
                  await updateDoc(userRef, {
                    [`groupBalances.${currentGroup.id}`]: currentBalance + sellPrice
                  });
                }
                
                // Update local state
                setCards(prev => prev.filter(c => c.id !== card.id));
                closeCardPreview();
                
                // Show success message
                Alert.alert('Success', `Card sold successfully! You received ${sellPrice} coins.`);
              } catch (error) {
                console.error('Error selling card:', error);
                Alert.alert('Error', 'Failed to sell card');
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error preparing card sale:', error);
      Alert.alert('Error', 'Could not prepare card for sale');
    }
  };

  // Render a card item
  const renderCard = ({ item }) => {
    // Determine border style based on border type
    let cardBorderStyle = {};
    if (item.borderType && item.borderType !== 'default') {
      const borderOption = BORDER_OPTIONS?.find(b => b.id === item.borderType);
      if (borderOption) {
        cardBorderStyle = {
          borderWidth: 4,
          borderColor: borderOption.color,
          shadowColor: borderOption.color,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 5,
        };
      }
    }
    
    return (
      <Animated.View style={styles.cardContainer}
        entering={FadeInDown.duration(400).delay(Math.random() * 300)}
      >
        <TouchableWithoutFeedback 
          onPress={() => showCardPreview(item)}
          delayPressIn={50}
        >
          <Card style={[
            styles.card, 
            { 
              borderColor: RARITY_COLORS[item.rarity] || RARITY_COLORS.common,
              shadowColor: RARITY_COLORS[item.rarity] || RARITY_COLORS.common 
            },
            item.borderType ? cardBorderStyle : {}
          ]}>
            <View style={styles.imageWrapper}>
              <Card.Cover 
                source={{ uri: item.imageUrl }} 
                style={styles.cardImage}
                resizeMode="cover"
              />
            </View>
            <Card.Content style={styles.cardContent}>
              <Text numberOfLines={1} style={styles.cardTitle}>{item.name}</Text>
              <View style={styles.cardInfo}>
                <Text style={[
                  styles.rarityBadge, 
                  { backgroundColor: RARITY_COLORS[item.rarity] || RARITY_COLORS.common }
                ]}>
                  {item.rarity?.toUpperCase()}
                </Text>
                {(item.inTrade || item.inAuction) && (
                  <View style={styles.statusContainer}>
                    <Text style={[
                      styles.statusBadge,
                      { backgroundColor: item.inTrade ? '#FF9800' : '#9C27B0' }
                    ]}>
                      {item.inTrade ? 'TRADE' : 'AUCTION'}
                    </Text>
                  </View>
                )}
              </View>
            </Card.Content>
          </Card>
        </TouchableWithoutFeedback>
      </Animated.View>
    );
  };

  // Check if the user is an admin (simplified for now)
  const isUserAdmin = () => {
    return user && currentGroup && currentGroup.adminIds && 
      currentGroup.adminIds.includes(user.uid);
  };

  // Render the header with filters
  const renderHeader = () => (
    <Surface style={styles.headerSurface} elevation={0}>
      <View style={styles.header}>
        <View style={styles.collectionStats}>
          <Text style={styles.statsText}>
            <Text style={styles.statsCount}>{cards.length}</Text> Total Cards
          </Text>
          <Chip 
            icon="cards" 
            style={styles.availableChip}
            textStyle={styles.chipText}
          >
            {availableCount} Available
          </Chip>
        </View>
        
        <View style={styles.filterRow}>
          {/* Sort By Menu */}
          <Menu
            visible={sortByMenuVisible}
            onDismiss={() => setSortByMenuVisible(false)}
            anchor={
              <TouchableOpacity 
                style={styles.filterButton}
                onPress={() => setSortByMenuVisible(true)}
              >
                <Icon name="sort" size={16} color="#333" />
                <Text style={styles.filterButtonText}>{`Sort: ${sortBy}`}</Text>
                <IconButton icon="chevron-down" size={16} />
              </TouchableOpacity>
            }
          >
            <Menu.Item 
              onPress={() => { setSortBy('name'); setSortByMenuVisible(false); }} 
              title="Name" 
              leadingIcon="sort-alphabetical-ascending"
            />
            <Menu.Item 
              onPress={() => { setSortBy('rarity'); setSortByMenuVisible(false); }} 
              title="Rarity" 
              leadingIcon="diamond-stone"
            />
            <Menu.Item 
              onPress={() => { setSortBy('dateAdded'); setSortByMenuVisible(false); }} 
              title="Date Added" 
              leadingIcon="calendar"
            />
          </Menu>
          
          {/* Sort Order Menu */}
          <Menu
            visible={sortOrderMenuVisible}
            onDismiss={() => setSortOrderMenuVisible(false)}
            anchor={
              <TouchableOpacity 
                style={styles.filterButton}
                onPress={() => setSortOrderMenuVisible(true)}
              >
                <Icon name={sortOrder === 'asc' ? 'arrow-up' : 'arrow-down'} size={16} color="#333" />
                <Text style={styles.filterButtonText}>{sortOrder === 'asc' ? 'Ascending' : 'Descending'}</Text>
                <IconButton icon="chevron-down" size={16} />
              </TouchableOpacity>
            }
          >
            <Menu.Item 
              onPress={() => { setSortOrder('asc'); setSortOrderMenuVisible(false); }} 
              title="Ascending" 
              leadingIcon="arrow-up"
            />
            <Menu.Item 
              onPress={() => { setSortOrder('desc'); setSortOrderMenuVisible(false); }} 
              title="Descending" 
              leadingIcon="arrow-down"
            />
          </Menu>
          
          {/* Filter Status Menu */}
          <Menu
            visible={filterStatusMenuVisible}
            onDismiss={() => setFilterStatusMenuVisible(false)}
            anchor={
              <TouchableOpacity 
                style={styles.filterButton}
                onPress={() => setFilterStatusMenuVisible(true)}
              >
                <Icon name="filter-variant" size={16} color="#333" />
                <Text style={styles.filterButtonText}>{`Status: ${filterStatus === 'all' ? 'All' : filterStatus}`}</Text>
                <IconButton icon="chevron-down" size={16} />
              </TouchableOpacity>
            }
          >
            <Menu.Item 
              onPress={() => { setFilterStatus('all'); setFilterStatusMenuVisible(false); }} 
              title="All" 
              leadingIcon="cards"
            />
            <Menu.Item 
              onPress={() => { setFilterStatus('available'); setFilterStatusMenuVisible(false); }} 
              title="Available" 
              leadingIcon="check-circle"
            />
            <Menu.Item 
              onPress={() => { setFilterStatus('inTrade'); setFilterStatusMenuVisible(false); }} 
              title="In Trade" 
              leadingIcon="account-switch"
            />
            <Menu.Item 
              onPress={() => { setFilterStatus('inAuction'); setFilterStatusMenuVisible(false); }} 
              title="In Auction" 
              leadingIcon="gavel"
            />
          </Menu>
        </View>
      </View>
    </Surface>
  );

  // Calculate the number of available cards
  const availableCount = cards.filter(card => !card.inTrade && !card.inAuction).length;

  // Helper function to get border style
  const getBorderStyle = (borderType) => {
    if (borderType === 'default') {
      // For default border, return empty object to use the rarity-based border
      return {};
    }
    
    const border = BORDER_OPTIONS.find(b => b.id === borderType);
    if (!border) return {};
    
    return {
      borderWidth: 4,
      borderColor: border.color,
      shadowColor: border.color,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.8,
      shadowRadius: 7,
    };
  };

  // Helper function to get border name
  const getBorderName = (borderType) => {
    const border = BORDER_OPTIONS.find(b => b.id === borderType);
    return border ? border.name : 'Unknown';
  };

  // Helper function to get border color
  const getBorderColor = (borderType) => {
    const border = BORDER_OPTIONS.find(b => b.id === borderType);
    return border ? border.color : '#ccc';
  };

  // Function to handle loading more cards
  const handleLoadMore = () => {
    // Don't load more if already loading more or all cards are displayed
    if (isLoadingMore) return;
    
    const filteredCards = getSortedAndFilteredCards();
    if (displayedCardCount >= filteredCards.length) return;
    
    setIsLoadingMore(true);
    
    // Simulate a small delay to avoid UI jank
    setTimeout(() => {
      const newCount = Math.min(displayedCardCount + 20, filteredCards.length);
      setDisplayedCardCount(newCount);
      setIsLoadingMore(false);
    }, 300);
  };
  
  // Reset displayed count when filter/sort changes
  useEffect(() => {
    setDisplayedCardCount(20);
  }, [sortBy, sortOrder, filterStatus]);
  
  // Get the subset of cards to actually display
  const getDisplayedCards = () => {
    const sorted = getSortedAndFilteredCards();
    return sorted.slice(0, displayedCardCount);
  };

  useEffect(() => {
    if (user && currentGroup) {
      fetchCardsInitially();
      onRefresh(); // This will handle fetching borders and other initialization
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentGroup]);
  
  // Update the EventManager subscription with the memoized functions
  useEffect(() => {
    // Subscribe to the group change event
    const subscription = EventManager.subscribe(GROUP_CHANGED_EVENT, (event) => {
      console.log('Group changed event detected in Collection screen');
      if (user && currentGroup && event.groupId === currentGroup.id) {
        // Refresh collection data when group changes
        fetchCardsInitially();
        onRefresh(); // This will handle fetching borders and other data
      }
    });
    
    // Clean up subscription
    return () => {
      EventManager.unsubscribe(subscription);
    };
  }, [user, currentGroup, fetchCardsInitially, onRefresh]);

  return (
    <ScreenBackground>
      {renderHeader()}
      
      {/* Collection Cards */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading your collection...</Text>
        </View>
      ) : (
        <Animated.FlatList
          data={getDisplayedCards()}
          keyExtractor={item => item.id}
          renderItem={renderCard}
          contentContainerStyle={styles.cardGrid}
          numColumns={2}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#4CAF50']}
            />
          }
          onEndReached={hasMoreCards ? loadMoreCards : handleLoadMore}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="cards" size={60} color="#ccc" />
              <Text style={styles.emptyText}>No cards found</Text>
              <Text style={styles.emptySubtext}>
                Pull to refresh or adjust your filters
              </Text>
              <Button 
                mode="contained" 
                onPress={onRefresh}
                icon="refresh"
                style={{ marginTop: 16 }}
              >
                Refresh
              </Button>
            </View>
          }
          ListFooterComponent={() => (
            <>
              {isLoadingMoreCards && (
                <View style={{ padding: 20, alignItems: 'center', width: '100%' }}>
                  <ActivityIndicator size="small" color="#4CAF50" />
                  <Text style={{ marginTop: 8, color: '#666' }}>Loading more cards...</Text>
                </View>
              )}
              {(!isLoadingMoreCards && hasMoreCards) && (
                <Button 
                  mode="text" 
                  onPress={loadMoreCards}
                  style={{ marginVertical: 10, alignSelf: 'center' }}
                >
                  Load more from database
                </Button>
              )}
              {(!isLoadingMore && !isLoadingMoreCards && displayedCardCount < getSortedAndFilteredCards().length) && (
                <Button 
                  mode="text" 
                  onPress={handleLoadMore}
                  style={{ marginVertical: 10, alignSelf: 'center' }}
                >
                  Show more loaded cards
                </Button>
              )}
              <View style={{ height: 20 }} />
            </>
          )}
        />
      )}
      
      {/* Card Preview Modal */}
      <Portal>
        {cardPreviewVisible && selectedCard && (
          <TouchableWithoutFeedback onPress={closeCardPreview}>
            <View style={styles.previewOverlay}>
              <TouchableWithoutFeedback>
                <Animated.View 
                  style={[
                    styles.cardPreviewContainer,
                    {
                      transform: [
                        { scale: cardScaleAnim },
                        { 
                          rotateY: cardRotateAnim.interpolate({
                            inputRange: [-1, 0, 1],
                            outputRange: ['-4deg', '0deg', '4deg']
                          }) 
                        },
                        {
                          translateY: cardRotateAnim.interpolate({
                            inputRange: [-1, 0, 1],
                            outputRange: [5, 0, -5]
                          })
                        }
                      ]
                    }
                  ]}
                >
                  {/* Card image with holographic effect */}
                  <View style={styles.previewImageContainer}>
                    <Image 
                      source={{ uri: selectedCard.imageUrl }} 
                      style={[
                        styles.previewImage,
                        { borderColor: RARITY_COLORS[selectedCard.rarity] || RARITY_COLORS.common }
                      ]}
                      resizeMode="cover"
                    />
                    <Animated.View 
                      style={[
                        styles.holographicOverlay,
                        {
                          opacity: cardRotateAnim.interpolate({
                            inputRange: [-1, 0, 1],
                            outputRange: [0.2, 0, 0.2]
                          }),
                          backgroundColor: RARITY_COLORS[selectedCard.rarity] || RARITY_COLORS.common
                        }
                      ]}
                    />
                    
                    {selectedCard.borderType && (
                      <View 
                        style={[
                          styles.cardBorderEffect,
                          getBorderStyle(selectedCard.borderType)
                        ]}
                      />
                    )}
                  </View>
                  
                  {/* Card details panel with shimmer effect */}
                  <Animated.View 
                    style={[
                      styles.cardDetails,
                      { 
                        opacity: cardDetailsAnim,
                        transform: [
                          { 
                            translateY: cardDetailsAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [10, 0]
                            })
                          }
                        ]
                      }
                    ]}
                  >
                    <Animated.View 
                      style={[
                        styles.detailsShimmer,
                        {
                          transform: [{ 
                            translateX: detailsShimmerAnim.interpolate({
                              inputRange: [-100, 100],
                              outputRange: [-150, SCREEN_WIDTH]
                            })
                          }]
                        }
                      ]}
                    />
                    
                    <View style={styles.detailsHeader}>
                      <Text style={styles.cardDetailTitle}>{selectedCard.name}</Text>
                      <Text style={[
                        styles.cardDetailRarity,
                        { color: RARITY_COLORS[selectedCard.rarity] || RARITY_COLORS.common }
                      ]}>
                        {selectedCard.rarity?.toUpperCase()}
                      </Text>
                    </View>
                    
                    <Divider style={styles.divider} />
                    
                    <View style={styles.detailsGrid}>
                      <View style={styles.detailsGridItem}>
                        <Text style={styles.detailsGridLabel}>Status</Text>
                        <Text style={[
                          styles.detailsGridValue,
                          {
                            color: selectedCard.inTrade ? '#FF9800' : 
                                  selectedCard.inAuction ? '#9C27B0' : 
                                  '#4CAF50'
                          }
                        ]}>
                          {selectedCard.inTrade ? 'In Trade' : 
                          (selectedCard.inAuction ? 'In Auction' : 'Available')}
                        </Text>
                      </View>
                      
                      {selectedCard.createdAt && (
                        <View style={styles.detailsGridItem}>
                          <Text style={styles.detailsGridLabel}>Added</Text>
                          <Text style={styles.detailsGridValue}>
                            {new Date(selectedCard.createdAt.seconds * 1000).toLocaleDateString()}
                          </Text>
                        </View>
                      )}

                      {selectedCard.owner && (
                        <View style={styles.detailsGridItem}>
                          <Text style={styles.detailsGridLabel}>Owner</Text>
                          <Text style={styles.detailsGridValue}>
                            {selectedCard.owner}
                          </Text>
                        </View>
                      )}

                      {selectedCard.borderType && (
                        <View style={styles.detailsGridItem}>
                          <Text style={styles.detailsGridLabel}>Border</Text>
                          <Text style={[
                            styles.detailsGridValue,
                            { color: getBorderColor(selectedCard.borderType) }
                          ]}>
                            {getBorderName(selectedCard.borderType)}
                          </Text>
                        </View>
                      )}
                    </View>
                    
                    {/* Action buttons */}
                    <View style={styles.previewActions}>
                      {(!selectedCard.inTrade && !selectedCard.inAuction) && (
                        <View style={styles.actionsRow}>
                          <Button 
                            mode="outlined" 
                            icon="hand-coin"
                            style={[styles.actionButton, { borderColor: '#FF9800' }]}
                            labelStyle={{ color: '#FF9800' }}
                            onPress={() => {
                              closeCardPreview();
                              // Navigate to trade screen with correct path
                              navigation.navigate('Trades', { 
                                screen: 'CreateTrade', 
                                params: { initialCardId: selectedCard.id } 
                              });
                            }}
                          >
                            Trade
                          </Button>
                          <Button 
                            mode="outlined" 
                            icon="download"
                            style={[styles.actionButton, { borderColor: '#2196F3' }]}
                            labelStyle={{ color: '#2196F3' }}
                            loading={downloadingCard}
                            disabled={downloadingCard}
                            onPress={() => downloadCardToDevice(selectedCard)}
                          >
                            Own
                          </Button>
                          <Button 
                            mode="outlined" 
                            icon="cash"
                            style={[styles.actionButton, { borderColor: '#4CAF50' }]}
                            labelStyle={{ color: '#4CAF50' }}
                            onPress={() => sellCard(selectedCard)}
                          >
                            Sell
                          </Button>
                        </View>
                      )}
                      
                      {/* Download button for cards in trade or auction */}
                      {(selectedCard.inTrade || selectedCard.inAuction) && (
                        <Button 
                          mode="outlined" 
                          icon="download"
                          style={[styles.actionButton, { borderColor: '#2196F3', marginTop: 8 }]}
                          labelStyle={{ color: '#2196F3' }}
                          loading={downloadingCard}
                          disabled={downloadingCard}
                          onPress={() => downloadCardToDevice(selectedCard)}
                        >
                          Own
                        </Button>
                      )}
                      
                      {isUserAdmin() && (
                        <Button 
                          mode="contained" 
                          icon="delete"
                          onPress={() => {
                            closeCardPreview();
                            setTimeout(() => confirmDeleteCard(selectedCard), 300);
                          }}
                          style={styles.deleteButton}
                        >
                          Delete Card
                        </Button>
                      )}
                    </View>
                  </Animated.View>
                </Animated.View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        )}
      </Portal>
      
      {/* Confirm Delete Dialog */}
      <Portal>
        <Dialog
          visible={confirmDialog}
          onDismiss={() => setConfirmDialog(false)}
          style={styles.dialog}
        >
          <Dialog.Title style={styles.dialogTitle}>Delete Card</Dialog.Title>
          <Dialog.Content>
            <Text>Are you sure you want to delete this card? This action cannot be undone.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmDialog(false)}>Cancel</Button>
            <Button 
              onPress={handleDeleteCard} 
              textColor="#D32F2F"
              mode="contained"
              buttonColor="#ffebee"
            >
              Delete
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  cardGrid: {
    padding: 8,
  },
  cardContainer: {
    width: '50%',
    padding: 8,
  },
  card: {
    borderWidth: 3,
    elevation: 4,
    borderRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  imageWrapper: {
    overflow: 'hidden',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  cardImage: {
    height: 180,
  },
  cardContent: {
    padding: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  cardInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rarityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 10,
    color: 'white',
    fontWeight: 'bold',
  },
  statusContainer: {
    alignItems: 'flex-end',
    overflow: 'hidden',
  },
  statusBadge: {
    fontSize: 9,
    color: 'white',
    fontWeight: 'bold',
    padding: 3,
    borderRadius: 6,
  },
  headerSurface: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  header: {
    padding: 16,
  },
  collectionStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  statsText: {
    fontSize: 16,
  },
  statsCount: {
    fontWeight: 'bold',
    fontSize: 20,
  },
  availableChip: {
    backgroundColor: '#4CAF50',
  },
  chipText: {
    color: 'white',
    fontWeight: 'bold',
  },
  filterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  filterTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 0,
  },
  filterButtonText: {
    fontSize: 12,
    marginHorizontal: 4,
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    height: 300,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.7,
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardPreviewContainer: {
    width: SCREEN_WIDTH * 0.9,
    borderRadius: 16,
    backgroundColor: 'white',
  },
  previewImageContainer: {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  previewImage: {
    width: '100%',
    height: SCREEN_WIDTH * 0.9 * 1.4,
    borderWidth: 4,
    borderRadius: 16,
  },
  holographicOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.15,
    borderRadius: 16,
  },
  cardDetails: {
    padding: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  detailsShimmer: {
    position: 'absolute',
    top: 0,
    left: -50,
    width: 30,
    height: '200%',
    backgroundColor: 'rgba(255,255,255,0.3)',
    transform: [{ skewX: '-20deg' }],
  },
  detailsHeader: {
    marginBottom: 12,
  },
  cardDetailTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  cardDetailRarity: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  divider: {
    marginVertical: 12,
    height: 1,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  detailsGridItem: {
    width: '50%',
    marginBottom: 12,
  },
  detailsGridLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  detailsGridValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  previewActions: {
    marginTop: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  actionButton: {
    flex: 1,
    marginHorizontal: 4,
    marginBottom: 8,
  },
  deleteButton: {
    marginTop: 8,
    backgroundColor: 'crimson',
  },
  dialog: {
    borderRadius: 16,
  },
  dialogTitle: {
    textAlign: 'center',
  },
  cardBorderEffect: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    zIndex: 2,
    pointerEvents: 'none',
  },
});

export default CollectionScreen; 