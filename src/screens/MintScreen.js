import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { addDoc, collection, doc, getDoc, getDocs, increment, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import objectHash from 'object-hash';
import React, { useState } from 'react';
import { Alert, Image, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Card, IconButton, Text } from 'react-native-paper';
import { db, storage } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';
import { computeRarity } from '../utils/rarityCalculator';

const MINT_COST = 5; // Coins required to mint a card

const MintScreen = () => {
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageMetadata, setImageMetadata] = useState(null);
  const { user, updateCoinBalance } = useAuth();
  const navigation = useNavigation();

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant camera roll permissions to mint cards');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled) {
      setSelectedImage(result.assets[0].uri);
      setImageMetadata(result.assets[0]);
    }
  };

  const captureImage = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant camera permissions to mint cards');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled) {
      setSelectedImage(result.assets[0].uri);
      setImageMetadata(result.assets[0]);
    }
  };

  const handleMint = async () => {
    if (!selectedImage || !imageMetadata || !user) return;
    
    setLoading(true);
    try {
      // Deduct minting cost
      await updateCoinBalance(-MINT_COST);

      // Get timestamp
      const timestamp = new Date();
      console.log('Timestamp:', timestamp);

      // Check if first mint today
      const todayString = timestamp.toDateString();
      console.log('Checking first mint for date:', todayString);
      const logRef = doc(db, 'mints', user.uid, 'logs', todayString);
      const logSnap = await getDoc(logRef);
      const isFirstMintToday = !logSnap.exists();
      console.log('Is first mint today:', isFirstMintToday);

      // Check uniqueness
      console.log('Checking image uniqueness...');
      const hash = objectHash(imageMetadata.base64 + timestamp.getTime());
      const dupQuery = query(collection(db, 'cards'), where('hash', '==', hash));
      const dupSnap = await getDocs(dupQuery);
      const isUnique = dupSnap.size < 3;
      console.log('Is unique:', isUnique, 'Duplicates found:', dupSnap.size);

      // Check daily boost
      console.log('Checking daily boost eligibility...');
      const lastBoostDate = user.lastBoostDate?.toDate()?.toDateString();
      const hasDailyBoost = lastBoostDate !== todayString && user.coinBalance >= 10;
      console.log('Has daily boost:', hasDailyBoost, 'Last boost date:', lastBoostDate);

      // Compute rarity
      console.log('Computing rarity...');
      try {
        const rarity = await computeRarity({ 
          timestamp, 
          isFirstMintToday, 
          isUnique, 
          hasDailyBoost 
        });
        console.log('Computed rarity:', rarity);

        // Upload image
        console.log('Uploading image...');
        const response = await fetch(selectedImage);
        const blob = await response.blob();
        const imageRef = ref(storage, `cards/${user.uid}/${Date.now()}`);
        await uploadBytes(imageRef, blob);
        const imageUrl = await getDownloadURL(imageRef);
        console.log('Image uploaded successfully');

        // Calculate coin value based on rarity
        const coinValue = {
          common: 5,
          rare: 20,
          epic: 50,
          legendary: 150
        }[rarity];
        console.log('Coin value:', coinValue);

        // Deduct mint cost and optional boost cost
        console.log('Updating user balance...');
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          coinBalance: increment(-MINT_COST - (hasDailyBoost ? 5 : 0)),
          lastBoostDate: hasDailyBoost ? serverTimestamp() : user.lastBoostDate
        });
        console.log('User balance updated');

        // Create card document
        console.log('Creating card document...');
        await addDoc(collection(db, 'cards'), {
          ownerId: user.uid,
          imageUrl,
          rarity,
          hash,
          hour: timestamp.getHours(),
          createdAt: serverTimestamp(),
          coinValue
        });
        console.log('Card document created');

        // Log the mint
        console.log('Logging mint...');
        await setDoc(logRef, { mintedAt: serverTimestamp() });
        console.log('Mint logged successfully');

        Alert.alert('Success', `Card minted successfully! Rarity: ${rarity.toUpperCase()}`, [
          {
            text: 'OK',
            onPress: () => {
              setSelectedImage(null);
              setImageMetadata(null);
              navigation.navigate('Home');
            }
          }
        ]);
      } catch (rarityError) {
        console.error('Error in rarity calculation:', rarityError);
        Alert.alert('Error', 'Failed to calculate card rarity. Please try again.');
      }
    } catch (error) {
      // If minting fails, refund the coins
      await updateCoinBalance(MINT_COST);
      console.error('Minting error:', error);
      Alert.alert('Error', `Failed to mint card: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => navigation.navigate('Home')} />
        <Appbar.Content title="Mint New Card" />
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 }}>
        <Card style={styles.card}>
          <Card.Content style={styles.cardContent}>
            {selectedImage ? (
              <View style={styles.imageContainer}>
                <Image source={{ uri: selectedImage }} style={styles.image} />
                <IconButton
                  icon="close"
                  size={24}
                  onPress={() => {
                    setSelectedImage(null);
                    setImageMetadata(null);
                  }}
                  style={styles.closeButton}
                />
              </View>
            ) : (
              <View style={styles.buttonContainer}>
                <IconButton
                  icon="camera"
                  size={48}
                  onPress={captureImage}
                  style={styles.cameraButton}
                />
                <IconButton
                  icon="image"
                  size={48}
                  onPress={pickImage}
                  style={styles.galleryButton}
                />
              </View>
            )}
          </Card.Content>
        </Card>

        {selectedImage && (
          <View style={styles.detailsContainer}>
            <Text style={styles.costText}>Mint Cost: {MINT_COST} coins</Text>
            <Text style={styles.balanceText}>Your Balance: {user?.coinBalance || 0} coins</Text>
            <Text style={styles.boostText}>
              Daily Boost Available: +5 coins for +5% rarity
            </Text>
          </View>
        )}

        <Button
          mode="contained"
          onPress={handleMint}
          loading={loading}
          disabled={!selectedImage || loading || !user?.coinBalance || user.coinBalance < MINT_COST}
          style={styles.mintButton}
        >
          Mint Card
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: 16,
  },
  cardContent: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    aspectRatio: 1,
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  closeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 16,
  },
  cameraButton: {
    backgroundColor: theme.colors.primary,
  },
  galleryButton: {
    backgroundColor: theme.colors.secondary,
  },
  detailsContainer: {
    marginBottom: 16,
  },
  costText: {
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 8,
  },
  balanceText: {
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 8,
  },
  boostText: {
    fontSize: 14,
    color: theme.colors.secondary,
  },
  mintButton: {
    marginTop: 16,
  },
});

export default MintScreen; 