import { useNavigation } from '@react-navigation/native';
import * as FaceDetector from 'expo-face-detector';
import * as ImagePicker from 'expo-image-picker';
import { addDoc, collection, doc, increment, serverTimestamp, updateDoc } from 'firebase/firestore';
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
  const { user } = useAuth();
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

  const getRarityColor = (rarity) => {
    const colors = {
      common: '#757575',
      rare: '#2196F3',
      epic: '#9C27B0',
      legendary: '#FFD700',
    };
    return colors[rarity] || '#757575';
  };

  const handleMint = async () => {
    if (!selectedImage || !imageMetadata) {
      Alert.alert('No Image', 'Please select an image to mint');
      return;
    }

    try {
      setLoading(true);

      const userDoc = doc(db, 'users', user.uid);
      const userData = await userDoc.get();
      if (userData.data().coinBalance < MINT_COST) {
        Alert.alert('Insufficient Funds', `You need ${MINT_COST} coins to mint a card`);
        return;
      }

      // Detect faces
      const fd = await FaceDetector.detectFacesAsync(selectedImage, { 
        mode: FaceDetector.Constants.Mode.fast 
      });
      const faceCount = fd.faces.length;

      // Get timestamp
      const timestamp = new Date();

      // Check if first mint today
      const todayString = timestamp.toDateString();
      const logRef = doc(db, 'mints', user.uid, 'logs', todayString);
      const isFirstMintToday = !(await logRef.get()).exists;

      // Check uniqueness
      const hash = objectHash(imageMetadata.base64 + timestamp.getTime());
      const dupSnap = await db.collection('cards').where('hash', '==', hash).get();
      const isUnique = dupSnap.size < 3;

      // Check daily boost
      const lastBoostDate = userData.data().lastBoostDate?.toDate()?.toDateString();
      const hasDailyBoost = lastBoostDate !== todayString && userData.data().coinBalance >= 10;

      // Compute rarity
      const rarity = await computeRarity({ 
        timestamp, 
        faceCount, 
        isFirstMintToday, 
        isUnique, 
        hasDailyBoost 
      });

      // Upload image
      const response = await fetch(selectedImage);
      const blob = await response.blob();
      const imageRef = ref(storage, `cards/${user.uid}/${Date.now()}`);
      await uploadBytes(imageRef, blob);
      const imageUrl = await getDownloadURL(imageRef);

      // Calculate coin value based on rarity
      const coinValue = {
        common: 5,
        rare: 20,
        epic: 50,
        legendary: 150
      }[rarity];

      // Deduct mint cost and optional boost cost
      await updateDoc(userDoc, {
        coinBalance: increment(-MINT_COST - (hasDailyBoost ? 5 : 0)),
        lastBoostDate: hasDailyBoost ? serverTimestamp() : lastBoostDate
      });

      // Create card document
      const cardRef = await addDoc(collection(db, 'cards'), {
        ownerId: user.uid,
        imageUrl,
        rarity,
        hash,
        hour: timestamp.getHours(),
        createdAt: serverTimestamp(),
        coinValue
      });

      // Log the mint
      await logRef.set({ mintedAt: serverTimestamp() });

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
    } catch (error) {
      console.error('Minting error:', error);
      Alert.alert('Error', 'Failed to mint card. Please try again.');
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
            <Text style={styles.boostText}>
              Daily Boost Available: +5 coins for +5% rarity
            </Text>
          </View>
        )}

        <Button
          mode="contained"
          onPress={handleMint}
          loading={loading}
          disabled={!selectedImage || loading}
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
  boostText: {
    fontSize: 14,
    color: theme.colors.secondary,
  },
  mintButton: {
    marginTop: 16,
  },
});

export default MintScreen; 