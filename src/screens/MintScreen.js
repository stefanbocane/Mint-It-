import React, { useState } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import { auth, storage, db } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

const MintScreen = () => {
  const [image, setImage] = useState(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 1,
    });

    if (!result.canceled) {
      setImage(result.assets[0].uri);
    }
  };

  const calculateRarity = (image) => {
    // This is a placeholder for your rarity algorithm
    // You might want to analyze image properties, colors, etc.
    return Math.floor(Math.random() * 100);
  };

  const handleMint = async () => {
    if (!image || !title) {
      alert('Please select an image and enter a title');
      return;
    }

    try {
      setLoading(true);
      
      // Upload image to Firebase Storage
      const response = await fetch(image);
      const blob = await response.blob();
      const storageRef = ref(storage, `cards/${auth.currentUser.uid}/${Date.now()}`);
      const snapshot = await uploadBytes(storageRef, blob);
      const imageUrl = await getDownloadURL(snapshot.ref);

      // Calculate rarity
      const rarity = calculateRarity(image);

      // Create card document in Firestore
      await addDoc(collection(db, 'cards'), {
        title,
        imageUrl,
        ownerId: auth.currentUser.uid,
        rarity,
        createdAt: serverTimestamp(),
      });

      alert('Card minted successfully!');
      setImage(null);
      setTitle('');
    } catch (error) {
      console.error('Minting error:', error);
      alert('Error minting card');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>Mint a New Card</Text>
      
      {image && (
        <Image source={{ uri: image }} style={styles.image} />
      )}
      
      <Button
        mode="outlined"
        onPress={pickImage}
        style={styles.button}
      >
        {image ? 'Change Image' : 'Select Image'}
      </Button>

      <TextInput
        label="Card Title"
        value={title}
        onChangeText={setTitle}
        style={styles.input}
      />

      <Button
        mode="contained"
        onPress={handleMint}
        loading={loading}
        style={styles.button}
      >
        Mint Card
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  title: {
    textAlign: 'center',
    marginBottom: 20,
  },
  image: {
    width: '100%',
    height: 300,
    marginBottom: 20,
    borderRadius: 10,
  },
  input: {
    marginBottom: 20,
  },
  button: {
    marginBottom: 10,
  },
});

export default MintScreen; 