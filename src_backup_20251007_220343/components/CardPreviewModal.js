import {
    Alert,
    Dimensions,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    ToastAndroid,
    TouchableWithoutFeedback,
    View
} from 'react-native';
import { Button, Divider, Portal } from 'react-native-paper';

import { useNavigation } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { deleteDoc, doc } from 'firebase/firestore';
import { useState } from 'react';
import { db } from '../config/firebase';
import { useCardAnimations } from '../hooks/useCardAnimations';
import { BORDER_OPTIONS, getBorderAnimationStyle } from '../utils/borderOptions';
import { getCardRestrictionMessage, isCardDownloadable } from '../utils/cardUtils';
import { RARITY_COLORS, getDownloadPrice } from '../utils/rarity';
import CreateAuctionModal from './auction/CreateAuctionModal';
import SimpleCardImage from './SimpleCardImage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const getSellPrice = (rarity) => {
  const rarityPrices = {
    'common': 2,
    'uncommon': 5,
    'rare': 10,
    'epic': 15,
    'legendary': 20,
    'mythic': 25
  };
  return rarityPrices[rarity?.toLowerCase()] || 10;
};

const CardPreviewModal = ({
  visible,
  card,
  onClose,
  onCardDeleted,
  isUserAdmin,
  downloadingCard,
  setDownloadingCard,
  balance,
  subtractCoins,
  addCoins,
  handleError
}) => {
  const navigation = useNavigation();
  const { animations, startExitAnimation } = useCardAnimations();
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [createAuctionVisible, setCreateAuctionVisible] = useState(false);

  // A card is ownable if it is marked available (not in trade/auction) and the image is downloadable.
  const canOwnCard = card && (!card.inTrade && !card.inAuction && (card.status === 'available' || !card.status)) && isCardDownloadable(card);

  const getBorderStyle = (borderType) => {
    if (!borderType || borderType === 'default') {
      return {};
    }
    
    const border = BORDER_OPTIONS.find(b => b.id === borderType);
    if (!border) return {};
    
    return getBorderAnimationStyle(
      border.animationType,
      border.color,
      border.secondaryColor,
      border.glowIntensity
    );
  };

  const handleClose = () => {
    startExitAnimation(() => {
      onClose();
    });
  };

  const handleImageLoad = () => {
    setImageLoading(false);
    setImageError(false);
  };

  const handleImageError = () => {
    setImageLoading(false);
    setImageError(true);
  };

  const openCreateAuction = () => {
    setCreateAuctionVisible(true);
    // Don't close the card preview immediately - let the user interact with the auction modal first
  };

  const downloadCardToDevice = async () => {
    try {
      // Check if card can be downloaded
      if (!isCardDownloadable(card)) {
        Alert.alert(
          'Card Not Available',
          getCardRestrictionMessage(card) || 'This card cannot be downloaded at the moment.',
          [{ text: 'OK' }]
        );
        return;
      }

      if (!card.imageUrl) {
        throw new Error('Card image not available');
      }

      setDownloadingCard(true);
      
      const downloadPrice = getDownloadPrice(card.rarity);
      
      if (balance < downloadPrice) {
        Alert.alert(
          'Insufficient Balance', 
          `You need ${downloadPrice} coins to download this ${card.rarity} card. Your current balance is ${balance} coins.`
        );
        setDownloadingCard(false);
        return;
      }
      
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
                const { status } = await MediaLibrary.requestPermissionsAsync();
                
                if (status !== 'granted') {
                  Alert.alert('Permission Denied', 'Permission to access media library is required to save the card.');
                  setDownloadingCard(false);
                  return;
                }
                
                const deductResult = await subtractCoins(downloadPrice);
                
                if (!deductResult) {
                  Alert.alert('Transaction Failed', 'Could not process the transaction. Please try again later.');
                  setDownloadingCard(false);
                  return;
                }
                
                const fileUri = FileSystem.documentDirectory + `card_${card.id}.jpg`;
                const downloadResult = await FileSystem.downloadAsync(card.imageUrl, fileUri);
                
                if (downloadResult.status === 200) {
                  const asset = await MediaLibrary.createAssetAsync(fileUri);
                  await MediaLibrary.createAlbumAsync('Cardmates', asset, false);
                  
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
                handleError(error, 'download_card');
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
      handleError(error, 'download_initiation');
      setDownloadingCard(false);
    }
  };

  const ownCard = async () => {
    try {
      // Guard only on downloadable / available status; message otherwise
      if (!canOwnCard) {
        Alert.alert('Card Not Available', 'This card cannot be owned at the moment.', [{ text: 'OK' }]);
        return;
      }

      const coinReward = getSellPrice(card.rarity);
      Alert.alert(
        'Own Card',
        `Download this ${card.rarity} card to your camera roll and receive ${coinReward} coins? This will remove the card from the collection.`,
        [
          {
            text: 'Cancel',
            style: 'cancel'
          },
          {
            text: 'Own Card',
            onPress: async () => {
              try {
                setDownloadingCard(true);
                
                const { status } = await MediaLibrary.requestPermissionsAsync();
                
                if (status !== 'granted') {
                  Alert.alert('Permission Denied', 'Permission to access media library is required to save the card.');
                  setDownloadingCard(false);
                  return;
                }
                
                const fileUri = FileSystem.documentDirectory + `card_${card.id}.jpg`;
                const downloadResult = await FileSystem.downloadAsync(card.imageUrl, fileUri);
                
                if (downloadResult.status === 200) {
                  const asset = await MediaLibrary.createAssetAsync(fileUri);
                  await MediaLibrary.createAlbumAsync('Cardmates', asset, false);
                  
                  const addResult = await addCoins(coinReward);
                  
                  if (addResult) {
                    await deleteDoc(doc(db, 'cards', card.id));
                    
                    if (Platform.OS === 'android') {
                      ToastAndroid.show(`Card saved and ${coinReward} coins added!`, ToastAndroid.SHORT);
                    } else {
                      Alert.alert('Success', `Card saved to your photos and ${coinReward} coins added to your balance!`);
                    }
                    
                    handleClose();
                    onCardDeleted(card.id, 'own');
                  } else {
                    Alert.alert('Error', 'Failed to add coins. Please try again.');
                  }
                } else {
                  throw new Error('Download failed');
                }
              } catch (error) {
                console.error('Error owning card:', error);
                handleError(error, 'own_card');
                Alert.alert('Error', 'Failed to own card. Please try again.');
              } finally {
                setDownloadingCard(false);
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error in own card flow:', error);
      handleError(error, 'own_card_initiation');
    }
  };

  if (!card) return null;

  return (
    <Portal>
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.previewOverlay}>
          <TouchableWithoutFeedback>
            <View style={styles.cardPreviewContainer}>
              {/* Card Image */}
              <View style={styles.previewImageContainer}>
                <SimpleCardImage
                  imageUrl={card.imageUrl}
                  rarityColor={RARITY_COLORS[card.rarity] || RARITY_COLORS.common}
                  aspectRatio={1.2} // Slightly taller for preview
                  style={styles.previewImage}
                  placeholder="Card Preview"
                  retryEnabled={true}
                  onLoad={() => setImageLoading(false)}
                  onError={() => setImageError(true)}
                />
                
                {card.borderType && (
                  <View 
                    style={[
                      styles.cardBorderEffect,
                      getBorderStyle(card.borderType)
                    ]}
                  />
                )}
              </View>
              
              {/* Card Details */}
              <View style={styles.cardDetails}>
                <ScrollView 
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.scrollContent}
                >
                  <View style={styles.detailsHeader}>
                    <Text style={styles.cardDetailTitle}>{card.name || 'Unknown Card'}</Text>
                    <Text style={[
                      styles.cardDetailRarity,
                      { color: RARITY_COLORS[card.rarity] || RARITY_COLORS.common }
                    ]}>
                      {card.rarity ? (card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1)) : 'Common'}
                    </Text>
                  </View>
                  
                  <Divider style={styles.divider} />
                  
                  <View style={styles.detailsGrid}>
                    <View style={styles.detailsGridItem}>
                      <Text style={styles.detailsGridLabel}>Creator</Text>
                      <Text style={styles.detailsGridValue}>
                        {card.createdByName || card.ownerName || card.userName || 'Unknown'}
                      </Text>
                    </View>
                    
                    <View style={styles.detailsGridItem}>
                      <Text style={styles.detailsGridLabel}>Status</Text>
                      <Text style={[
                        styles.detailsGridValue,
                        card.inTrade && { color: '#FF9800' },
                        card.inAuction && { color: '#2196F3' }
                      ]}>
                        {card.inTrade ? 'In Trade' : 
                         card.inAuction ? 'In Auction' : 'Available'}
                      </Text>
                    </View>
                    
                    {card.borderType && card.borderType !== 'default' && (
                      <View style={styles.detailsGridItem}>
                        <Text style={styles.detailsGridLabel}>Border</Text>
                        <Text style={[
                          styles.detailsGridValue,
                          { color: getBorderStyle(card.borderType).borderColor }
                        ]}>
                          {card.borderType}
                        </Text>
                      </View>
                    )}
                    
                    {(card.dateAcquired || card.createdAt) && (
                      <View style={styles.detailsGridItem}>
                        <Text style={styles.detailsGridLabel}>Acquired</Text>
                        <Text style={styles.detailsGridValue}>
                          {card.dateAcquired 
                            ? new Date(card.dateAcquired).toLocaleDateString()
                            : card.createdAt?.toDate 
                              ? card.createdAt.toDate().toLocaleDateString()
                              : 'Unknown'
                          }
                        </Text>
                      </View>
                    )}
                  </View>
                  
                  {/* Action Buttons */}
                  {(!card.inTrade && !card.inAuction && (card.status === 'available' || !card.status)) && (
                    <View style={styles.previewActions}>
                      <View style={styles.actionsRow}>
                        <Button 
                          mode="contained" 
                          style={styles.actionButton}
                          contentStyle={styles.compactButtonContent}
                          labelStyle={styles.compactButtonLabel}
                          onPress={() => {
                            handleClose();
                            navigation.navigate('Trades', {
                              screen: 'CreateTrade',
                              params: { initialCardId: card.id }
                            });
                          }}
                          icon="swap-horizontal"
                        >
                          Trade
                        </Button>
                        
                        <Button 
                          mode="contained" 
                          style={styles.actionButton}
                          contentStyle={styles.compactButtonContent}
                          labelStyle={styles.compactButtonLabel}
                          onPress={openCreateAuction}
                          icon="gavel"
                        >
                          Auction
                        </Button>
                      </View>

                      <Button
                        mode="contained"
                        style={styles.actionButton}
                        contentStyle={styles.ownButtonContent}
                        labelStyle={styles.ownButtonLabel}
                        onPress={ownCard}
                        disabled={downloadingCard}
                        loading={downloadingCard}
                        icon="download"
                      >
                        Own (+{getSellPrice(card.rarity)})
                      </Button>
                    </View>
                  )}
                  
                  {isUserAdmin && (
                    <Button 
                      mode="contained" 
                      style={[styles.actionButton, styles.deleteButton]}
                      onPress={() => {
                        handleClose();
                        onCardDeleted(card.id, 'delete');
                      }}
                      icon="delete"
                    >
                      Delete Card
                    </Button>
                  )}
                  
                  <Button 
                    mode="text" 
                    onPress={handleClose}
                    style={{ marginTop: 8 }}
                  >
                    Close
                  </Button>
                </ScrollView>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
      
      {/* Create Auction Modal */}
      <CreateAuctionModal
        visible={createAuctionVisible}
        onDismiss={() => setCreateAuctionVisible(false)}
        initialCard={card}
        onSuccess={(auctionId) => {
          setCreateAuctionVisible(false);
          handleClose(); // Close the card preview modal after successful auction creation
          console.log('Auction created from card preview:', auctionId);
        }}
      />
    </Portal>
  );
};

const styles = StyleSheet.create({
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardPreviewContainer: {
    width: SCREEN_WIDTH * 0.9,
    maxHeight: '90%',
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
    height: SCREEN_WIDTH * 0.9 * 1.2,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  cardDetails: {
    padding: 0,
    maxHeight: 350,
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
    marginBottom: 8,
    gap: 6,
  },
  actionButton: {
    flex: 0.48,
    marginBottom: 6,
    minHeight: 36,
  },
  ownButton: {
    backgroundColor: '#4CAF50',
    marginBottom: 6,
    flex: 1,
    minHeight: 40,
  },
  deleteButton: {
    backgroundColor: '#f44336',
    marginBottom: 6,
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
  imageLoadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 12,
  },
  imageErrorContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 12,
  },
  compactButtonContent: {
    padding: 8,
  },
  compactButtonLabel: {
    fontSize: 12,
  },
  ownButtonContent: {
    padding: 8,
  },
  ownButtonLabel: {
    fontSize: 12,
  },
  scrollContent: {
    padding: 16,
  },
});

export default CardPreviewModal; 