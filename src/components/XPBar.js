import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useAuth } from '../contexts/AuthContext';
import { getLevelProgress } from '../services/XPService';

const XPBar = ({ compact = false }) => {
  const theme = useTheme();
  const { user } = useAuth();
  const [levelProgress, setLevelProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Animation values
  const progressWidth = useSharedValue(0);

  useEffect(() => {
    loadLevelProgress();
  }, [user]);

  const loadLevelProgress = async () => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const progress = await getLevelProgress(user.uid);
      setLevelProgress(progress);
      
      // Animate progress bar
      progressWidth.value = withTiming(progress.progressPercentage || 0, {
        duration: 800,
      });
      
    } catch (error) {
      console.error('Error loading level progress for XP bar:', error);
      setLevelProgress(null);
    } finally {
      setLoading(false);
    }
  };

  const animatedProgressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  if (loading || !levelProgress) {
    return null; // Don't show anything while loading
  }

  const { currentLevel, progressPercentage, isMaxLevel } = levelProgress;

  if (compact) {
    // Compact version for header with consistent sizing
    return (
      <View style={styles.compactContainer}>
        {/* Level Badge */}
        <View style={[styles.compactLevelBadge, { backgroundColor: isMaxLevel ? '#FFD700' : theme.colors.primary }]}>
          <Text style={[styles.compactLevelText, { color: isMaxLevel ? '#000' : theme.colors.onPrimary }]}>
            {currentLevel}
          </Text>
        </View>
        
        {/* XP Progress Bar */}
        <View style={[styles.compactProgressContainer, { backgroundColor: theme.colors.surfaceVariant }]}>
          <Animated.View 
            style={[
              styles.compactProgressBar, 
              { backgroundColor: isMaxLevel ? '#FFD700' : theme.colors.primary },
              animatedProgressStyle
            ]} 
          />
        </View>
        
        {/* Max Level Indicator */}
        {isMaxLevel && (
          <Text style={styles.compactMaxText}>🏆</Text>
        )}
      </View>
    );
  }

  // Full version for standalone use
  return (
    <View style={styles.container}>
      {/* Level Badge */}
      <View style={[styles.levelBadge, { backgroundColor: isMaxLevel ? '#FFD700' : theme.colors.primary }]}>
        <Text style={[styles.levelText, { color: isMaxLevel ? '#000' : theme.colors.onPrimary }]}>
          {currentLevel}
        </Text>
      </View>
      
      {/* XP Progress Bar */}
      <View style={[styles.progressContainer, { backgroundColor: theme.colors.surfaceVariant }]}>
        <Animated.View 
          style={[
            styles.progressBar, 
            { backgroundColor: isMaxLevel ? '#FFD700' : theme.colors.primary },
            animatedProgressStyle
          ]} 
        />
        
        {/* Progress Text */}
        <Text style={[styles.progressText, { color: theme.colors.onSurfaceVariant }]}>
          {isMaxLevel ? 'MAX' : `${Math.round(progressPercentage)}%`}
        </Text>
      </View>
      
      {/* Max Level Indicator */}
      {isMaxLevel && (
        <View style={styles.maxLevelIndicator}>
          <Text style={styles.maxLevelText}>🏆</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginTop: 8,
    marginLeft: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    minWidth: 120,
  },
  levelBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  levelText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  progressContainer: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
    marginRight: 4,
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
    minWidth: 2,
  },
  progressText: {
    position: 'absolute',
    top: -16,
    right: 0,
    fontSize: 10,
    fontWeight: '600',
  },
  maxLevelIndicator: {
    marginLeft: 4,
  },
  maxLevelText: {
    fontSize: 16,
  },
  // Enhanced compact styles for consistent header positioning
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginVertical: 2,
    marginLeft: 0,
    marginRight: 0,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    minWidth: 60,
    maxWidth: 80,
    height: 32,
  },
  compactLevelBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  compactLevelText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  compactProgressContainer: {
    width: 24,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginRight: 4,
  },
  compactProgressBar: {
    height: '100%',
    borderRadius: 2,
    minWidth: 1,
  },
  compactMaxText: {
    fontSize: 10,
    marginLeft: 2,
  },
});

export default XPBar; 