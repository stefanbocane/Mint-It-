import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, ProgressBar, Text, useTheme } from 'react-native-paper';
import { useAuth } from '../contexts/AuthContextSupabase';
import { claimGemRewards, forceResetGemRewards, getDailyAchievements } from '../utils/gemRewards';
import { autoMigrateIfNeeded } from '../utils/gemRewardsMigration';

const ACHIEVEMENT_LABELS = {
  first_coin: 'Coin a Card',
  first_auction_win: 'Win an Auction',
  first_trade: 'Complete a Trade'
};

export default function DailyGemsSection({ groupId }) {
  const { user } = useAuth();
  const theme = useTheme();
  const [achievements, setAchievements] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [claimStatus, setClaimStatus] = useState({}); // { success: boolean, message: string }
  const [debugMode, setDebugMode] = useState(false);

  useEffect(() => {
    loadAchievements();
  }, [groupId]);

  const loadAchievements = async () => {
    try {
      setIsLoading(true);
      console.log('🔄 Loading achievements for user:', user.uid, 'in group:', groupId);
      
      // Auto-migrate user from old system if needed
      await autoMigrateIfNeeded(user.uid);
      
      const data = await getDailyAchievements(user.uid);
      console.log('📊 Loaded achievements:', data);
      setAchievements(data);
      
      // Show debug info if there are issues
      if (data && data.claimed.length > 0 && data.availableToClaim.length === 0) {
        console.log('🔍 Debug: All achievements appear claimed but none available to claim');
        console.log('🔍 This might indicate an issue with the gem rewards system');
      }
    } catch (error) {
      console.error('❌ Failed to load achievements:', error);
      setClaimStatus({
        success: false,
        message: 'Failed to load achievements'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClaimRewards = async () => {
    try {
      setIsLoading(true);
      console.log('💎 Attempting to claim rewards...');
      
      const result = await claimGemRewards(user.uid, groupId);
      console.log('💎 Claim result:', result);
      
      if (result.success) {
        setClaimStatus({
          success: true,
          message: `🎉 ${result.gemsAwarded} gems claimed!`
        });
        // Refresh achievements after claiming
        await loadAchievements();
      } else {
        setClaimStatus({
          success: false,
          message: result.error || 'Failed to claim rewards'
        });
        
        // If no rewards to claim but user thinks there should be, show debug info
        if (result.error === 'No rewards to claim') {
          console.log('🔍 No rewards to claim - this might be expected or indicate an issue');
          setDebugMode(true);
        }
      }
    } catch (error) {
      console.error('❌ Error claiming rewards:', error);
      setClaimStatus({
        success: false,
        message: 'An error occurred while claiming rewards'
      });
    } finally {
      setIsLoading(false);
      
      // Clear status after 3 seconds
      setTimeout(() => setClaimStatus({}), 3000);
    }
  };

  const handleForceReset = async () => {
    try {
      setIsLoading(true);
      console.log('🔧 Force resetting gem rewards...');
      
      const result = await forceResetGemRewards(user.uid);
      console.log('🔧 Reset result:', result);
      
      if (result.success) {
        setClaimStatus({
          success: true,
          message: '🔧 Gem rewards reset successfully!'
        });
        setDebugMode(false);
        // Refresh achievements after reset
        await loadAchievements();
      } else {
        setClaimStatus({
          success: false,
          message: result.message || 'Failed to reset'
        });
      }
    } catch (error) {
      console.error('❌ Error resetting gem rewards:', error);
      setClaimStatus({
        success: false,
        message: 'An error occurred while resetting'
      });
    } finally {
      setIsLoading(false);
      
      // Clear status after 3 seconds
      setTimeout(() => setClaimStatus({}), 3000);
    }
  };

  if (!achievements) return null;

  const canClaim = achievements.availableToClaim.length > 0;
  const totalAchievements = Object.keys(ACHIEVEMENT_LABELS).length;
  const completedCount = Object.values(achievements.completed).filter(Boolean).length;
  const claimedCount = achievements.claimed.length;
  const progress = totalAchievements > 0 ? (completedCount / totalAchievements) : 0;

  return (
    <Card style={styles.card}>
      <Card.Content>
        <View style={styles.header}>
          <Text variant="titleSmall">Daily Gems</Text>
          <Text variant="bodySmall" style={styles.progressText}>
            {completedCount}/{totalAchievements} completed
          </Text>
        </View>
        
        <ProgressBar 
          progress={progress} 
          color={theme.colors.primary}
          style={styles.progressBar} 
        />

        <View style={styles.achievementsContainer}>
          {Object.entries(ACHIEVEMENT_LABELS).map(([key, label]) => (
            <View key={key} style={styles.achievementRow}>
              <Text style={styles.achievementText}>
                {achievements.completed[key] ? '✓ ' : '○ '}
                {label}
              </Text>
              <Text style={[
                styles.achievementStatus,
                achievements.claimed.includes(key) && styles.claimed
              ]}>
                {achievements.claimed.includes(key) ? 'Claimed' : 
                 achievements.completed[key] ? 'Ready to claim' : 'Incomplete'}
              </Text>
            </View>
          ))}
        </View>

        <Button
          mode="contained"
          onPress={handleClaimRewards}
          disabled={!canClaim || isLoading}
          loading={isLoading}
          style={styles.claimButton}
          labelStyle={styles.claimButtonLabel}
        >
          {canClaim ? `Claim ${achievements.availableToClaim.length} Gems` : 'No Rewards to Claim'}
        </Button>
        
        {/* Debug mode - show reset button if there are issues */}
        {debugMode && (
          <View style={styles.debugContainer}>
            <Text style={styles.debugText}>
              🔧 Having issues with gem rewards? Try resetting:
            </Text>
            <Button
              mode="outlined"
              onPress={handleForceReset}
              disabled={isLoading}
              style={styles.resetButton}
              textColor={theme.colors.error}
            >
              Reset Gem Rewards
            </Button>
            <Button
              mode="text"
              onPress={() => setDebugMode(false)}
              style={styles.cancelDebugButton}
            >
              Cancel
            </Button>
          </View>
        )}
        
        {claimStatus.message && (
          <Text 
            style={[
              styles.statusMessage, 
              claimStatus.success ? styles.successMessage : styles.errorMessage
            ]}
          >
            {claimStatus.message}
          </Text>
        )}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: 16,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressText: {
    color: '#666',
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    marginBottom: 16,
    backgroundColor: '#f0f0f0',
  },
  achievementsContainer: {
    marginBottom: 16,
  },
  achievementRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  achievementText: {
    fontSize: 14,
  },
  achievementStatus: {
    fontSize: 12,
    color: '#666',
  },
  claimed: {
    color: '#4CAF50',
    fontWeight: 'bold',
  },
  claimButton: {
    marginTop: 8,
    borderRadius: 8,
  },
  claimButtonLabel: {
    paddingVertical: 4,
  },
  statusMessage: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 14,
  },
  successMessage: {
    color: '#4CAF50',
  },
  errorMessage: {
    color: '#F44336',
  },
  debugContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#FFF3E0',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFB74D',
  },
  debugText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    textAlign: 'center',
  },
  resetButton: {
    marginBottom: 4,
    borderColor: '#F44336',
  },
  cancelDebugButton: {
    marginTop: 4,
  },
});
