import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';
import { Appbar, Button, Surface, Text } from 'react-native-paper';
import { theme } from '../theme';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width * 0.8;
const CARD_HEIGHT = CARD_WIDTH * 1.4;

const CardDetailsScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { card } = route.params;
  const [isFlipped, setIsFlipped] = useState(false);
  const flipAnim = useRef(new Animated.Value(0)).current;

  // Stats animation values
  const statsProgress = useRef({
    rarity: new Animated.Value(0),
    value: new Animated.Value(0),
    age: new Animated.Value(0),
  }).current;

  useEffect(() => {
    // Animate stats when screen loads
    Animated.stagger(200, [
      Animated.spring(statsProgress.rarity, {
        toValue: getRarityScore(),
        tension: 40,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.spring(statsProgress.value, {
        toValue: getValueScore(),
        tension: 40,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.spring(statsProgress.age, {
        toValue: getAgeScore(),
        tension: 40,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const flipCard = () => {
    const toValue = isFlipped ? 0 : 1;
    Animated.spring(flipAnim, {
      toValue,
      friction: 8,
      tension: 40,
      useNativeDriver: true,
    }).start();
    setIsFlipped(!isFlipped);
  };

  const getRarityScore = () => {
    const scores = { common: 0.25, rare: 0.5, epic: 0.75, legendary: 1 };
    return scores[card.rarity] || 0;
  };

  const getValueScore = () => {
    return Math.min(card.coinValue / 150, 1); // 150 is max value (legendary)
  };

  const getAgeScore = () => {
    const ageInDays = (Date.now() - card.createdAt?.toMillis()) / (1000 * 60 * 60 * 24);
    return Math.min(ageInDays / 30, 1); // Max age score at 30 days
  };

  const frontAnimatedStyle = {
    transform: [
      {
        rotateY: flipAnim.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '180deg'],
        }),
      },
    ],
  };

  const backAnimatedStyle = {
    transform: [
      {
        rotateY: flipAnim.interpolate({
          inputRange: [0, 1],
          outputRange: ['180deg', '360deg'],
        }),
      },
    ],
  };

  const rarityColor = {
    common: '#757575',
    rare: '#2196F3',
    epic: '#9C27B0',
    legendary: '#FFD700',
  }[card.rarity];

  return (
    <>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title="Card Details" />
      </Appbar.Header>

      <View style={styles.container}>
        <View style={styles.cardContainer}>
          {/* Front of card */}
          <Animated.View style={[styles.cardSide, frontAnimatedStyle]}>
            <Surface style={[styles.card, { borderColor: rarityColor }]}>
              <Animated.Image
                source={{ uri: card.imageUrl }}
                style={styles.cardImage}
                resizeMode="cover"
              />
              <View style={styles.cardInfo}>
                <Text style={[styles.rarityText, { color: rarityColor }]}>
                  {card.rarity.toUpperCase()}
                </Text>
                <Text style={styles.valueText}>{card.coinValue} coins</Text>
              </View>
            </Surface>
          </Animated.View>

          {/* Back of card */}
          <Animated.View style={[styles.cardSide, styles.cardBack, backAnimatedStyle]}>
            <Surface style={[styles.card, { borderColor: rarityColor }]}>
              <View style={styles.statsContainer}>
                <Text style={styles.statsTitle}>Card Stats</Text>
                
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Rarity Power</Text>
                  <View style={styles.statBar}>
                    <Animated.View
                      style={[
                        styles.statFill,
                        {
                          width: statsProgress.rarity.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                          backgroundColor: rarityColor,
                        },
                      ]}
                    />
                  </View>
                </View>

                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Value</Text>
                  <View style={styles.statBar}>
                    <Animated.View
                      style={[
                        styles.statFill,
                        {
                          width: statsProgress.value.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                          backgroundColor: theme.colors.primary,
                        },
                      ]}
                    />
                  </View>
                </View>

                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Age Bonus</Text>
                  <View style={styles.statBar}>
                    <Animated.View
                      style={[
                        styles.statFill,
                        {
                          width: statsProgress.age.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                          backgroundColor: theme.colors.secondary,
                        },
                      ]}
                    />
                  </View>
                </View>

                <View style={styles.cardMetadata}>
                  <Text style={styles.metadataText}>
                    Minted: {new Date(card.createdAt?.toMillis()).toLocaleDateString()}
                  </Text>
                  <Text style={styles.metadataText}>
                    Card ID: {card.id.substring(0, 8)}...
                  </Text>
                </View>
              </View>
            </Surface>
          </Animated.View>
        </View>

        <Button
          mode="contained"
          onPress={flipCard}
          style={styles.flipButton}
        >
          {isFlipped ? 'Show Front' : 'Show Stats'}
        </Button>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    alignItems: 'center',
    padding: 16,
  },
  cardContainer: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    marginVertical: 24,
  },
  cardSide: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    backfaceVisibility: 'hidden',
  },
  cardBack: {
    transform: [{ rotateY: '180deg' }],
  },
  card: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    borderWidth: 2,
    overflow: 'hidden',
    elevation: 8,
  },
  cardImage: {
    width: '100%',
    height: '80%',
  },
  cardInfo: {
    padding: 12,
    height: '20%',
    justifyContent: 'center',
  },
  rarityText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  valueText: {
    fontSize: 14,
    marginTop: 4,
    opacity: 0.7,
  },
  statsContainer: {
    flex: 1,
    padding: 16,
  },
  statsTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
    textAlign: 'center',
  },
  statRow: {
    marginBottom: 20,
  },
  statLabel: {
    fontSize: 16,
    marginBottom: 8,
  },
  statBar: {
    height: 8,
    backgroundColor: theme.colors.surfaceVariant,
    borderRadius: 4,
    overflow: 'hidden',
  },
  statFill: {
    height: '100%',
    borderRadius: 4,
  },
  cardMetadata: {
    marginTop: 'auto',
    borderTopWidth: 1,
    borderTopColor: theme.colors.surfaceVariant,
    paddingTop: 16,
  },
  metadataText: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 4,
  },
  flipButton: {
    marginTop: 16,
  },
});

export default CardDetailsScreen; 