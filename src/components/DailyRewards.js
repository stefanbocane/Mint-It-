import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Button, Modal, Portal, Surface, Text } from 'react-native-paper';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

const DAILY_REWARD = 10; // coins
const STREAK_BONUS = 5; // additional coins per day of streak

const DailyRewards = () => {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const coinsAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    checkDailyReward();
  }, []);

  const checkDailyReward = async () => {
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const lastReward = userDoc.data()?.lastRewardDate?.toDate();
      const currentStreak = userDoc.data()?.rewardStreak || 0;

      if (lastReward) {
        const today = new Date();
        const lastRewardDay = new Date(lastReward);
        
        // Reset streak if more than a day has passed
        if ((today - lastRewardDay) / (1000 * 60 * 60 * 24) > 1) {
          setStreak(0);
        } else {
          setStreak(currentStreak);
        }

        // Check if reward is available (next day)
        const isNextDay = today.toDateString() !== lastRewardDay.toDateString();
        if (isNextDay) {
          showRewardModal();
        }
      } else {
        // First time user
        showRewardModal();
      }
    } catch (error) {
      console.error('Error checking daily reward:', error);
    }
  };

  const showRewardModal = () => {
    setVisible(true);
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();
  };

  const hideModal = () => {
    Animated.timing(scaleAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setVisible(false));
  };

  const claimReward = async () => {
    try {
      setLoading(true);
      const newStreak = streak + 1;
      const reward = DAILY_REWARD + (newStreak * STREAK_BONUS);

      // Update user document
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        coinBalance: (user.coinBalance || 0) + reward,
        lastRewardDate: serverTimestamp(),
        rewardStreak: newStreak,
      });

      // Animate claim
      setClaimed(true);
      Animated.sequence([
        Animated.spring(rotateAnim, {
          toValue: 1,
          tension: 100,
          friction: 5,
          useNativeDriver: true,
        }),
        Animated.timing(coinsAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setTimeout(hideModal, 1500);
      });
    } catch (error) {
      console.error('Error claiming reward:', error);
    } finally {
      setLoading(false);
    }
  };

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={hideModal}
        contentContainerStyle={styles.modalContainer}
      >
        <Animated.View
          style={[
            styles.content,
            {
              transform: [
                { scale: scaleAnim },
                { rotate: claimed ? spin : '0deg' },
              ],
            },
          ]}
        >
          <Surface style={styles.rewardCard}>
            <Text style={styles.title}>Daily Reward!</Text>
            {!claimed ? (
              <>
                <Text style={styles.description}>
                  Claim your daily reward and maintain your streak for bonus coins!
                </Text>
                <View style={styles.rewardInfo}>
                  <Text style={styles.rewardText}>
                    Base Reward: {DAILY_REWARD} coins
                  </Text>
                  <Text style={styles.streakText}>
                    Streak Bonus: {streak * STREAK_BONUS} coins
                  </Text>
                  <Text style={styles.totalText}>
                    Total: {DAILY_REWARD + (streak * STREAK_BONUS)} coins
                  </Text>
                </View>
                <Text style={styles.streakCount}>
                  🔥 Current Streak: {streak} days
                </Text>
                <Button
                  mode="contained"
                  onPress={claimReward}
                  loading={loading}
                  style={styles.claimButton}
                >
                  Claim Reward
                </Button>
              </>
            ) : (
              <Animated.View
                style={[
                  styles.claimedContainer,
                  {
                    opacity: coinsAnim,
                    transform: [
                      {
                        translateY: coinsAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, -50],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Text style={styles.claimedText}>
                  +{DAILY_REWARD + (streak * STREAK_BONUS)} coins!
                </Text>
                <Text style={styles.streakText}>
                  🔥 Streak: {streak + 1} days
                </Text>
              </Animated.View>
            )}
          </Surface>
        </Animated.View>
      </Modal>
    </Portal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    margin: 20,
  },
  content: {
    backgroundColor: 'transparent',
  },
  rewardCard: {
    padding: 24,
    borderRadius: 16,
    elevation: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
    color: theme.colors.primary,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    opacity: 0.7,
  },
  rewardInfo: {
    backgroundColor: theme.colors.surfaceVariant,
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
  },
  rewardText: {
    fontSize: 16,
    marginBottom: 8,
  },
  streakText: {
    fontSize: 16,
    marginBottom: 8,
    color: theme.colors.secondary,
  },
  totalText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 8,
    color: theme.colors.primary,
  },
  streakCount: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 24,
  },
  claimButton: {
    marginTop: 8,
  },
  claimedContainer: {
    alignItems: 'center',
    padding: 24,
  },
  claimedText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginBottom: 16,
  },
});

export default DailyRewards; 