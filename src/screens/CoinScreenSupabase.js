import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import CameraComponent from '../components/CameraComponent';
import ScreenBackground from '../components/ScreenBackground';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import { useTheme } from '../contexts/ThemeContext';
import { useBalance } from '../hooks/useBackwardCompatibility';
import { clearCollectionCache } from '../hooks/useSimpleCollectionData';
import CacheService from '../services/caching/CacheService';

// Constants
const CAMERA_CONFIG = {
  CARD_NAME_MAX_LENGTH: 30,
  AUCTION_DURATION_SECONDS: 30
};

const COIN_COST = 6; // Cost to coin a card
const CARD_COLLECTION_LIMIT = 25;

const CoinScreenSupabase = () => {
  // Core state
  const [image, setImage] = useState(null);
  const [cardName, setCardName] = useState('');
  const [isCoining, setIsCoining] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Refs
  const mountedRef = useRef(true);
  const operationInProgressRef = useRef(false);

  // Contexts
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const { balance, refreshBalance, subtractCoins } = useBalance();
  const { theme } = useTheme();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Handle picture taken
  const handlePictureTaken = useCallback((imageUri) => {
    setImage(imageUri);
    console.log('📸 Picture received from camera component');
  }, []);

  // Can coin card validation
  const canCoinCard = useMemo(() => {
    const trimmedName = cardName.trim();
    return Boolean(
      image &&
      trimmedName.length >= 2 &&
      trimmedName.length <= CAMERA_CONFIG.CARD_NAME_MAX_LENGTH &&
      currentGroup?.id &&
      balance >= COIN_COST &&
      !isCoining &&
      !operationInProgressRef.current
    );
  }, [image, cardName, currentGroup?.id, balance, isCoining]);

  const insufficientCoinsMessage = useMemo(() => {
    if (!currentGroup?.id) return 'Please select a group first';
    if (balance < COIN_COST) {
      return `Need ${COIN_COST - balance} more coins to mint a card`;
    }
    return null;
  }, [balance, currentGroup?.id]);

  // Check card collection limit
  const checkCardLimit = async () => {
    try {
      const { count, error } = await supabase
        .from('cards')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', user.id)
        .eq('group_id', currentGroup.id);

      if (error) throw error;

      const canAdd = count < CARD_COLLECTION_LIMIT;
      return {
        canAdd,
        currentCount: count,
        limit: CARD_COLLECTION_LIMIT
      };
    } catch (error) {
      console.error('Error checking card limit:', error);
      return { canAdd: false, currentCount: 0, limit: CARD_COLLECTION_LIMIT };
    }
  };

  // Upload image to Supabase Storage
  const uploadImage = async (imageUri) => {
    try {
      // Read the file as base64
      const base64 = await FileSystem.readAsStringAsync(imageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Generate unique filename
      const fileExt = 'jpg';
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;  // Path: userID/filename.jpg (NO 'cards/' prefix!)

      // Convert base64 to ArrayBuffer
      const arrayBuffer = decode(base64);

      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from('cards')  // Bucket is specified here
        .upload(filePath, arrayBuffer, {  // Path should NOT include bucket name
          contentType: 'image/jpeg',
          upsert: false
        });

      if (error) throw error;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('cards')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (error) {
      console.error('Error uploading image:', error);
      throw error;
    }
  };

  // Coin a card
  const handleCoinCard = async () => {
    if (!canCoinCard || operationInProgressRef.current) return;

    operationInProgressRef.current = true;
    setIsCoining(true);

    try {
      console.log('🪙 Starting coin card process...');

      // Check collection limit
      const limitCheck = await checkCardLimit();
      if (!limitCheck.canAdd) {
        Alert.alert(
          'Collection Limit Reached',
          `You have reached the maximum of ${limitCheck.limit} cards. Current: ${limitCheck.currentCount} cards.`
        );
        return;
      }

      // Deduct coins first
      const coinsDeducted = await subtractCoins(COIN_COST);
      if (!coinsDeducted) {
        Alert.alert('Error', 'Failed to deduct coins. Please try again.');
        return;
      }

      console.log('✅ Coins deducted');

      // Upload image
      console.log('📤 Uploading image...');
      const imageUrl = await uploadImage(image);
      console.log('✅ Image uploaded:', imageUrl);

      // Create card in database
      const { data: newCard, error: cardError } = await supabase
        .from('cards')
        .insert({
          name: cardName.trim(),
          image_url: imageUrl,
          owner_id: user.id,
          group_id: currentGroup.id,
          rarity: 'common',
          status: 'available',
          in_trade: false,
          in_auction: false
        })
        .select()
        .single();

      if (cardError) throw cardError;

      console.log('✅ Card created:', newCard.id);

      // Create auction for the card
      const auctionEndTime = new Date(Date.now() + (CAMERA_CONFIG.AUCTION_DURATION_SECONDS * 1000));

      const { data: auction, error: auctionError } = await supabase
        .from('auctions')
        .insert({
          card_id: newCard.id,
          group_id: currentGroup.id,
          seller_id: user.id,
          seller_username: user.email?.split('@')[0] || 'Unknown',
          card_name: cardName.trim(),
          card_image_url: imageUrl,
          status: 'active',
          start_time: new Date().toISOString(),
          end_time: auctionEndTime.toISOString(),
          starting_bid: 6,
          current_bid: 6,
          current_rarity: 'common',
          unique_bidder_count: 0
        })
        .select()
        .single();

      if (auctionError) throw auctionError;

      console.log('✅ Auction created:', auction.id);

      // Update card with auction reference
      const { error: updateCardError } = await supabase
        .from('cards')
        .update({
          auction_id: auction.id,
          status: 'in_auction',
          in_auction: true
        })
        .eq('id', newCard.id);

      if (updateCardError) {
        console.error('Error updating card with auction:', updateCardError);
      }

      // Clear caches
      clearCollectionCache(); // Clear in-memory cache
      await CacheService.invalidate(`cards_${user.id}_${currentGroup.id}`);
      await CacheService.invalidate(`auctions_${currentGroup.id}`);

      // Success!
      Alert.alert(
        'Success!',
        `Card "${cardName.trim()}" minted and listed in auction!`,
        [
          {
            text: 'OK',
            onPress: () => {
              // Clear form
              setImage(null);
              setCardName('');
              // Refresh balance
              refreshBalance();
            }
          }
        ]
      );

    } catch (error) {
      console.error('❌ Coining error:', error);
      Alert.alert(
        'Coining Failed',
        error.message || 'Failed to create card. Please try again.'
      );
    } finally {
      if (mountedRef.current) {
        setIsCoining(false);
        operationInProgressRef.current = false;
      }
    }
  };

  // Handle back button
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (image) {
        setImage(null);
        return true;
      }
      return false;
    });

    return () => backHandler.remove();
  }, [image]);

  return (
    <ScreenBackground>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
        >
          <Text style={[styles.title, { color: theme.colors.text }]}>
            Coin a Card
          </Text>

          {!image ? (
            <>
              <Text style={[styles.instructions, { color: theme.colors.textSecondary }]}>
                Take a photo of a trading card to mint it as an NFT
              </Text>
              <CameraComponent onPictureTaken={handlePictureTaken} />
            </>
          ) : (
            <>
              <Image source={{ uri: image }} style={styles.preview} />

              <TextInput
                label="Card Name"
                value={cardName}
                onChangeText={setCardName}
                mode="outlined"
                style={styles.input}
                maxLength={CAMERA_CONFIG.CARD_NAME_MAX_LENGTH}
                placeholder="Enter card name"
              />

              <Text style={[styles.costText, { color: theme.colors.textSecondary }]}>
                Cost: {COIN_COST} coins (Balance: {balance})
              </Text>

              {insufficientCoinsMessage && (
                <Text style={[styles.errorText, { color: theme.colors.error }]}>
                  {insufficientCoinsMessage}
                </Text>
              )}

              <View style={styles.buttonRow}>
                <Button
                  mode="outlined"
                  onPress={() => {
                    setImage(null);
                    setCardName('');
                  }}
                  style={styles.button}
                  disabled={isCoining}
                >
                  Retake
                </Button>

                <Button
                  mode="contained"
                  onPress={handleCoinCard}
                  style={styles.button}
                  disabled={!canCoinCard}
                  loading={isCoining}
                >
                  Coin Card
                </Button>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 100, // Extra bottom padding to ensure buttons are accessible
    flexGrow: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  instructions: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  preview: {
    width: '100%',
    height: 300,
    borderRadius: 8,
    marginBottom: 16,
    resizeMode: 'contain',
  },
  input: {
    marginBottom: 16,
  },
  costText: {
    fontSize: 14,
    marginBottom: 8,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
    marginBottom: 16,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 32, // Extra bottom margin for button accessibility
  },
  button: {
    flex: 1,
    marginHorizontal: 8,
  },
});

export default CoinScreenSupabase;
