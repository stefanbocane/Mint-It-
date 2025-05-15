import { CameraView as Camera, Camera as ExpoCamera } from 'expo-camera';
import { addDoc, collection, doc, getDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useEffect, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, View } from 'react-native';
import { Button, IconButton, Text, TextInput } from 'react-native-paper';
import { db, storage } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useBalance } from '../contexts/BalanceContext';
import { useGroup } from '../contexts/GroupContext';
import { useTheme } from '../contexts/ThemeContext';
import ScreenBackground from '../components/ScreenBackground';
import { sendCardCoinedNotification } from '../services/notifications';
import { ensureInitialRewardProtection } from '../utils/balanceUtils';

// Flash mode constants - these are the string values expected by expo-camera
const FLASH_MODE = {
  OFF: 'off',
  ON: 'on',
  AUTO: 'auto'
};

const CoinScreen = () => {
  const [hasPermission, setHasPermission] = useState(null);
  const [camera, setCamera] = useState(null);
  const [image, setImage] = useState(null);
  const [cardName, setCardName] = useState('');
  const [userCoins, setUserCoins] = useState(0);
  const [coinCost, setCoinCost] = useState(5);
  const [isCoining, setIsCoining] = useState(false);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const { balance, refreshBalance, subtractCoins } = useBalance();
  const { theme } = useTheme();

  useEffect(() => {
    // Request camera permissions
    (async () => {
      const { status } = await ExpoCamera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  useEffect(() => {
    // Get real-time balance from the BalanceContext
    console.log('COIN DEBUG: Current balance from context:', balance);
    setUserCoins(balance);
    
    if (currentGroup) {
      fetchGroupCoinCost();
    }
  }, [currentGroup, balance]);

  // Force a balance refresh when component mounts
  useEffect(() => {
    console.log('COIN DEBUG: Component mounted, safely fetching user coins');
    // Don't use refreshBalance() which can trigger 200 coin award
    // refreshBalance();
    
    // Instead use our direct fetch method that doesn't trigger the award
    fetchUserCoins();
    
    // Also fetch the coin cost for minting
    if (currentGroup) {
      fetchGroupCoinCost();
    }
  }, []);

  const fetchUserCoins = async () => {
    if (!user || !currentGroup) return;
    
    console.log('COIN DEBUG: Fetching user coins directly');
    try {
      // Add protection in case balance is low
      await ensureInitialRewardProtection(user.uid, currentGroup.id, 'fetchUserCoins');
      
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const groupBalance = userData.groupBalances?.[currentGroup.id] || 0;
        console.log('COIN DEBUG: Direct balance fetch result:', groupBalance);
        setUserCoins(groupBalance);
      }
    } catch (error) {
      console.error('Error fetching user coins:', error);
    }
  };

  const fetchGroupCoinCost = async () => {
    if (!currentGroup) return;
    
    const groupRef = doc(db, 'groups', currentGroup.id);
    const groupDoc = await getDoc(groupRef);
    
    if (groupDoc.exists()) {
      setCoinCost(groupDoc.data().mintCost || 5);
    }
  };

  const takePicture = async () => {
    if (camera) {
      try {
        const photo = await camera.takePictureAsync({
          quality: 0.8,
          base64: true,
        });
        setImage(photo.uri);
      } catch (error) {
        Alert.alert('Error', 'Failed to take picture');
      }
    }
  };

  const toggleFlash = () => {
    setFlashEnabled(prev => !prev);
  };

  const coinCard = async () => {
    if (!image) {
      Alert.alert('No Image', 'Please take a picture of your card first.');
      return;
    }

    if (!cardName.trim()) {
      Alert.alert('Missing Name', 'Please provide a name for your card.');
      return;
    }

    if (userCoins < coinCost) {
      Alert.alert('Insufficient Coins', `You need ${coinCost} coins to mint a card. You currently have ${userCoins} coins.`);
      return;
    }

    setIsCoining(true);

    try {
      // Upload image to storage
      console.log('Uploading image to storage...');
      const filename = `cards/${user.uid}/${Date.now()}.jpg`;
      const storageRef = ref(storage, filename);
      
      // Convert image URI to blob
      const response = await fetch(image);
      const blob = await response.blob();
      
      // Upload the blob
      const snapshot = await uploadBytes(storageRef, blob);
      console.log('Image uploaded successfully!');
      
      // Get download URL
      const downloadURL = await getDownloadURL(snapshot.ref);
      console.log('Download URL:', downloadURL);
      
      // Create a new card document in Firestore
      console.log('Creating card document...');
      const cardsRef = collection(db, 'cards');
      
      // Generate current timestamp for Firestore
      const createdAt = Timestamp.now();
      
      // Create expiration timestamp (30 seconds from now)
      const THIRTY_SECONDS = 30 * 1000; // 30 seconds in milliseconds
      const expiresAt = new Timestamp(
        Math.floor((Date.now() + THIRTY_SECONDS) / 1000),
        0
      );
      
      // Add document to cards collection
      const cardDoc = await addDoc(cardsRef, {
        name: cardName.trim(),
        imageUrl: downloadURL,
        createdBy: user.uid,
        ownerId: user.uid,
        userId: user.uid,
        groupId: currentGroup.id,
        createdAt,
        expiresAt,
        mintedAt: new Date().toISOString(),
        startingBid: 5,
        currentBid: 5,
        status: 'active',
        inAuction: true,
        bids: [],
        rarity: 'common',
        isNewlyCoined: true
      });
      
      console.log('Card created successfully, processing coin transaction');
      
      // Create an auction for the newly minted card
      console.log('Creating auction for new card...');
      const auctionsRef = collection(db, 'auctions');
      
      const auctionDoc = await addDoc(auctionsRef, {
        cardId: cardDoc.id,
        ownerId: user.uid,
        groupId: currentGroup.id,
        startingBid: 5,
        currentBid: 5,
        currentBidder: null,
        createdAt,
        expiresAt,
        endTime: expiresAt,
        status: 'active',
        bidHistory: [],
        cardRarity: 'mystery',
        isNewlyCoined: true,
        cardName: cardName.trim(),
        cardImage: downloadURL,
        sellerId: user.uid,
        sellerName: user.displayName || user.email || 'Unknown User'
      });
      
      // Update the card with auction information
      await updateDoc(doc(db, 'cards', cardDoc.id), {
        auctionId: auctionDoc.id,
        inAuction: true
      });
      
      console.log(`Created auction ${auctionDoc.id} for card ${cardDoc.id}`);
      
      // Use the subtractCoins function from BalanceContext to properly handle the transaction
      // This is the key fix - using the context method instead of direct database updates
      const success = await subtractCoins(coinCost);
      
      if (!success) {
        throw new Error(`Failed to subtract ${coinCost} coins from your balance.`);
      }
      
      console.log(`Successfully subtracted ${coinCost} coins - new balance: ${balance - coinCost}`);
      
      // Update the local state
      setUserCoins(balance - coinCost);
      
      // Send push notification to group members
      const username = user.displayName || user.email || 'Someone';
      await sendCardCoinedNotification(
        currentGroup.id, 
        user.uid, 
        username, 
        cardName.trim()
      );
      
      setImage(null);
      setCardName('');
      
      // Show a more detailed success message
      Alert.alert(
        'Card Coined Successfully!', 
        `Your card "${cardName}" has been created and automatically listed in the auction for 30 seconds.`,
        [{ text: 'OK', onPress: () => console.log('OK Pressed') }]
      );
    } catch (error) {
      console.error('Coining error:', error);
      Alert.alert('Error', `Failed to coin card: ${error.message}`);
    } finally {
      setIsCoining(false);
    }
  };

  if (hasPermission === null) {
    return <View style={styles.container}><Text>Requesting camera permission...</Text></View>;
  }
  if (hasPermission === false) {
    return <View style={styles.container}><Text>No access to camera</Text></View>;
  }

  return (
    <ScreenBackground>
      <View style={styles.container}>
      {!image ? (
        <View style={styles.container}>
          <Camera 
            style={styles.camera} 
            ref={ref => setCamera(ref)}
            // Use enableTorch for continuous light
            enableTorch={flashEnabled}
            // Use flash for taking pictures
            flash={flashEnabled ? FLASH_MODE.ON : FLASH_MODE.OFF}
          />
          {/* Move buttons outside CameraView to fix "does not support children" warning */}
          <View style={styles.buttonContainer}>
            <Button
              mode="contained"
              onPress={takePicture}
              style={styles.button}
              icon="camera"
            >
              Take Picture
            </Button>
            <IconButton
              icon={flashEnabled ? "flash" : "flash-off"}
              mode="contained"
              size={30}
              onPress={toggleFlash}
              style={styles.flashButton}
              iconColor={flashEnabled ? "#ffff00" : "#ffffff"}
              containerColor="rgba(0,0,0,0.5)"
            />
          </View>
        </View>
      ) : (
        <View style={styles.previewContainer}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            <Text style={styles.previewTitle}>
              
            </Text>
            
            <View style={styles.cardPreviewWrapper}>
              <Image source={{ uri: image }} style={styles.preview} />
              {cardName.trim() && (
                <View style={styles.cardNameOverlay}>
                  <Text style={styles.cardNameText}>{cardName}</Text>
                </View>
              )}
            </View>
            
            <View style={styles.nameInputSection}>
              <Text style={styles.sectionTitle}>Name Your Card</Text>
              <TextInput
                label="Card Name *"
                value={cardName}
                onChangeText={setCardName}
                style={styles.nameInput}
                maxLength={30}
                placeholder="Enter a unique name for your card"
                error={cardName.trim() === ''}
                right={<TextInput.Affix text={`${cardName.length}/30`} />}
              />
              
              {cardName.trim() === '' && (
                <Text style={styles.nameInputHelp}>A name is required for your card</Text>
              )}
            </View>
            
            <View style={styles.previewButtonsContainer}>
              <Button
                mode="contained"
                onPress={coinCard}
                style={styles.coinButton}
                icon="check-bold"
                disabled={!currentGroup || userCoins < coinCost || !cardName.trim() || isCoining}
                loading={isCoining}
              >
                {currentGroup 
                  ? userCoins < coinCost 
                    ? `Need ${coinCost - userCoins} more coins` 
                    : `Coin Card (${coinCost} coins)` 
                  : 'Select a Group First'}
              </Button>
              
              <Button
                mode="outlined"
                onPress={() => {
                  setImage(null);
                  setCardName('');
                }}
                style={styles.retakeButton}
                icon="camera-retake"
              >
                Retake
              </Button>
            </View>
            
            {/* Add bottom padding to ensure no overlap with navigation */}
            <View style={styles.bottomPadding} />
          </ScrollView>
        </View>
      )}
    </View>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  camera: {
    flex: 1,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  button: {
    flex: 1,
    marginHorizontal: 10,
  },
  flashButton: {
    marginLeft: 8,
    borderRadius: 30,
  },
  previewContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  previewTitle: {
    fontSize: 24, 
    fontWeight: 'bold', 
    marginBottom: 20, 
    textAlign: 'center'
  },
  cardPreviewWrapper: {
    width: '100%',
    height: 350,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
    position: 'relative',
    elevation: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  preview: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  cardNameOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 12,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  cardNameText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  nameInput: {
    marginBottom: 20,
  },
  nameInputHelp: {
    color: 'red',
    fontSize: 12,
    marginTop: 5,
  },
  previewButtonsContainer: {
    marginTop: 10,
  },
  coinButton: {
    marginBottom: 10,
    backgroundColor: '#4CAF50',
  },
  retakeButton: {
    marginBottom: 10,
  },
  bottomPadding: {
    height: 60,
  },
  modal: {
    backgroundColor: 'white',
    padding: 20,
    margin: 20,
    borderRadius: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    marginBottom: 20,
  },
  emergencyButton: {
    marginBottom: 10,
    backgroundColor: '#FF5722',
  },
  nameInputSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
});

export default CoinScreen; 