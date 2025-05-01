import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { addDoc, collection, doc, increment, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import React, { useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, IconButton, Text } from 'react-native-paper';
import { db, storage } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

const MINT_COST = 10; // Coins required to mint a card

const MintScreen = () => {
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
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
    });

    if (!result.canceled) {
      setSelectedImage(result.assets[0].uri);
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
    });

    if (!result.canceled) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  const calculateRarity = (imageMetadata) => {
    const size = imageMetadata.fileSize || 0;
    const width = imageMetadata.width || 0;
    const height = imageMetadata.height || 0;

    let rarity = 'common';
    if (size > 2000000 && width > 1000 && height > 1000) {
      rarity = 'rare';
    } else if (size > 1000000 && width > 800 && height > 800) {
      rarity = 'uncommon';
    }

    return rarity;
  };

  const calculateCoinValue = (rarity) => {
    const values = {
      common: 5,
      uncommon: 10,
      rare: 20,
    };
    return values[rarity] || 5;
  };

  const getRarityColor = (rarity) => {
    const colors = {
      common: '#757575',
      uncommon: '#2196F3',
      rare: '#FFD700',
    };
    return colors[rarity] || '#757575';
  };

  const handleMint = async () => {
    if (!selectedImage) {
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

      const response = await fetch(selectedImage);
      const blob = await response.blob();
      const imageRef = ref(storage, `cards/${user.uid}/${Date.now()}`);
      await uploadBytes(imageRef, blob);
      const imageUrl = await getDownloadURL(imageRef);

      const metadata = {
        fileSize: blob.size,
        width: 1000,
        height: 1000,
      };
      const rarity = calculateRarity(metadata);
      const coinValue = calculateCoinValue(rarity);

      const cardRef = await addDoc(collection(db, 'cards'), {
        ownerId: user.uid,
        imageUrl,
        rarity,
        createdAt: new Date(),
        coinValue,
      });

      await updateDoc(userDoc, {
        coinBalance: increment(-MINT_COST),
      });

      await addDoc(collection(db, 'coinTransactions'), {
        userId: user.uid,
        amount: -MINT_COST,
        type: 'mint',
        timestamp: new Date(),
      });

      Alert.alert('Success', 'Card minted successfully!', [
        {
          text: 'OK',
          onPress: () => {
            setSelectedImage(null);
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
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 }}>
        <Card style={styles.card}>
          <Card.Content style={styles.cardContent}>
            {selectedImage ? (
              <View style={styles.imageContainer}>
                <Image source={{ uri: selectedImage }} style={styles.image} />
                <IconButton
                  icon="close"
                  size={24}
                  onPress={() => setSelectedImage(null)}
                  style={styles.closeButton}
                />
              </View>
            ) : (
              <IconButton
                icon="plus"
                size={48}
                onPress={pickImage}
                style={styles.plusButton}
              />
            )}
          </Card.Content>
        </Card>

        {selectedImage && (
          <View style={styles.detailsContainer}>
            <Chip
              mode="outlined"
              style={[styles.rarityChip, { borderColor: getRarityColor(calculateRarity({})) }]}
              textStyle={{ color: getRarityColor(calculateRarity({})) }}
            >
              {calculateRarity({}).toUpperCase()}
            </Chip>
            <Text style={styles.costText}>Mint Cost: {MINT_COST} coins</Text>
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
  plusButton: {
    backgroundColor: theme.colors.primary,
  },
  detailsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  rarityChip: {
    marginRight: 8,
  },
  costText: {
    color: theme.colors.text,
  },
  mintButton: {
    marginTop: 16,
  },
});

export default MintScreen; 