import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { getLevelProgress } from '../services/XPService';

const ProfileLevelSection = ({ userId }) => {
  const theme = useTheme();
  const [levelProgress, setLevelProgress] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadLevelProgress = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      const progress = await getLevelProgress(userId);
      setLevelProgress(progress);
    } catch (error) {
      console.error('Error loading level progress:', error);
      setLevelProgress(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadLevelProgress();
  }, [loadLevelProgress]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.onSurface }]}>
          Loading level progress...
        </Text>
      </View>
    );
  }

  if (!levelProgress) {
    return null;
  }

  return (
    <View style={[styles.levelSection, { 
      borderColor: theme.colors.outline,
      backgroundColor: `${theme.colors.surface}CC`, // More translucent
      shadowColor: theme.colors.shadow || '#000',
    }]}>
      <View style={styles.levelHeader}>
        <View style={styles.levelBadgeContainer}>
          <View style={[
            styles.levelBadge, 
            { 
              backgroundColor: levelProgress.isMaxLevel ? '#FFD700' : theme.colors.primary,
              shadowColor: levelProgress.isMaxLevel ? '#FFD700' : theme.colors.primary,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.6,
              shadowRadius: 8,
              elevation: 8,
            }
          ]}>
            <Text style={[
              styles.levelText, 
              { color: levelProgress.isMaxLevel ? '#000' : theme.colors.onPrimary }
            ]}>
              {levelProgress.currentLevel}
            </Text>
          </View>
          {levelProgress.isMaxLevel && (
            <View style={styles.maxLevelCrown}>
              <Text style={styles.crownText}>👑</Text>
            </View>
          )}
        </View>
        
        <View style={styles.levelDetails}>
          <Text style={[styles.levelTitle, { color: theme.colors.onSurface }]}>
            {levelProgress.isMaxLevel ? '✨ MAXIMUM LEVEL REACHED! ✨' : `🎯 Level ${levelProgress.currentLevel}`}
          </Text>
          {!levelProgress.isMaxLevel && (
            <Text style={[styles.xpText, { color: theme.colors.onSurface }]}>
              {levelProgress.currentXP} / {levelProgress.xpRequiredForNext} XP
            </Text>
          )}
          {levelProgress.isMaxLevel && (
            <Text style={[styles.maxLevelSubtext, { color: theme.colors.primary }]}>
              🏆 Legendary Collector 🏆
            </Text>
          )}
        </View>
      </View>
      
      {!levelProgress.isMaxLevel && (
        <View style={styles.progressContainer}>
          <View style={styles.progressLabels}>
            <Text style={[styles.progressLabel, { color: theme.colors.onSurface }]}>⚡ Progress</Text>
            <Text style={[styles.progressPercentage, { color: theme.colors.primary }]}>
              {Math.round(levelProgress.progressPercentage)}%
            </Text>
          </View>
          
          <View style={[styles.progressBar, { 
            backgroundColor: theme.colors.surfaceVariant,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.2,
            shadowRadius: 4,
            elevation: 4,
          }]}>
            <View 
              style={[
                styles.progressFill, 
                { 
                  width: `${levelProgress.progressPercentage}%`,
                  backgroundColor: theme.colors.primary,
                  shadowColor: theme.colors.primary,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.8,
                  shadowRadius: 6,
                }
              ]} 
            />
          </View>
        </View>
      )}
      
      <View style={styles.rewardsContainer}>
        <View style={styles.rewardCards}>
          {!levelProgress.isMaxLevel && (
            <View style={[styles.rewardCard, { 
              backgroundColor: `${theme.colors.surface}E6`,
              borderColor: `${theme.colors.primary}40`,
            }]}>
              <Text style={styles.rewardEmoji}>💎</Text>
              <Text style={[styles.rewardTitle, { color: theme.colors.onSurface }]}>Next Level</Text>
              <Text style={[styles.rewardValue, { color: theme.colors.primary }]}>
                +{levelProgress.gemRewardForNext} gems
              </Text>
            </View>
          )}
          
          <View style={[styles.rewardCard, { 
            backgroundColor: `${theme.colors.surface}E6`,
            borderColor: `${theme.colors.secondary || theme.colors.primary}40`,
          }]}>
            <Text style={styles.rewardEmoji}>⚡</Text>
            <Text style={[styles.rewardTitle, { color: theme.colors.onSurface }]}>Total XP</Text>
            <Text style={[styles.rewardValue, { color: theme.colors.secondary || theme.colors.primary }]}>
              {levelProgress.totalExperience.toLocaleString()}
            </Text>
          </View>
        </View>
        
        {levelProgress.isMaxLevel && (
          <View style={styles.maxLevelAchievement}>
            <Text style={styles.achievementText}>
              🌟 ULTIMATE ACHIEVEMENT UNLOCKED 🌟
            </Text>
            <Text style={[styles.achievementSubtext, { color: theme.colors.onSurface }]}>
              You've reached the pinnacle of card collecting mastery!
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
  },
  levelSection: {
    marginVertical: 20,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    elevation: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  levelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  levelBadgeContainer: {
    position: 'relative',
    marginRight: 20,
  },
  levelBadge: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  levelText: {
    fontSize: 28,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  maxLevelCrown: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  crownText: {
    fontSize: 18,
  },
  levelDetails: {
    flex: 1,
  },
  levelTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 6,
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  xpText: {
    fontSize: 18,
    fontWeight: '600',
  },
  maxLevelSubtext: {
    fontSize: 16,
    fontWeight: '600',
  },
  progressContainer: {
    marginBottom: 20,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  progressLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  progressPercentage: {
    fontSize: 16,
    fontWeight: '700',
  },
  progressBar: {
    height: 16,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 8,
  },
  rewardsContainer: {
    alignItems: 'center',
  },
  rewardCards: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 16,
  },
  rewardCard: {
    width: 110,
    height: 100,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  rewardEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  rewardTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: 4,
    textAlign: 'center',
  },
  rewardValue: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 2,
  },
  maxLevelAchievement: {
    alignItems: 'center',
  },
  achievementText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
    textAlign: 'center',
  },
  achievementSubtext: {
    fontSize: 12,
    textAlign: 'center',
  },
});

export default ProfileLevelSection; 