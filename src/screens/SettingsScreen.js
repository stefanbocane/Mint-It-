import { BlurView } from 'expo-blur';
import { signOut, updateProfile } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, IconButton, Surface, Switch, Text, TextInput } from 'react-native-paper';
import BalanceDisplay from '../components/BalanceDisplay';
import ScreenBackground from '../components/ScreenBackground';
import { auth } from '../config/firebase';
import { CACHE_TTL } from '../constants/cacheConfig';
import { useAuth } from '../contexts/AuthContext';
import { useBalance } from '../contexts/BalanceContext';
import { useGroup } from '../contexts/GroupContext';
import { batchUpdateWithCache } from '../utils/dbOptimizationUtils';
import { getCachedDoc } from '../utils/firestoreUtils';

const SettingsScreen = ({ navigation }) => {
  const { user } = useAuth();
  const { balance } = useBalance();
  const { currentGroup } = useGroup();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [isEditing, setIsEditing] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  
  // Load user preferences when component mounts
  useEffect(() => {
    const loadUserPreferences = async () => {
      if (!user) return;
      
      try {
        setLoading(true);
        // Use cached document with TTL from config
        const userData = await getCachedDoc('users', user.uid, { 
          ttl: CACHE_TTL.USER_PREFERENCES,
          forceRefresh: false // Only fetch from server if cache is expired
        });
        
        if (userData) {
          // Load notification preference, defaulting to true if not set
          setNotificationsEnabled(userData.notificationsEnabled !== false);
        }
      } catch (error) {
        console.error('Error loading user preferences:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadUserPreferences();
  }, [user]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
      Alert.alert('Error', 'Failed to sign out. Please try again.');
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;

    try {
      const trimmedName = displayName.trim();
      
      // Update Firebase Auth profile first
      await updateProfile(auth.currentUser, { displayName: trimmedName });
      
      // Use batch update utility which also updates cache
      await batchUpdateWithCache([{
        collection: 'users',
        id: user.uid,
        data: {
          displayName: trimmedName,
          username: trimmedName,
          updatedAt: new Date().toISOString(),
        }
      }]);

      setIsEditing(false);
      Alert.alert('Success', 'Your profile has been updated.');
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    }
  };

  const toggleNotifications = async () => {
    if (!user) return;
    
    try {
      const newNotificationState = !notificationsEnabled;
      setNotificationsEnabled(newNotificationState);
      
      // Use batch update utility which also updates cache
      await batchUpdateWithCache([{
        collection: 'users',
        id: user.uid,
        data: {
          notificationsEnabled: newNotificationState,
          updatedAt: new Date().toISOString(),
        }
      }]);
      
      console.log(`Notifications ${newNotificationState ? 'enabled' : 'disabled'} for user ${user.uid}`);
    } catch (error) {
      console.error('Error updating notification preferences:', error);
      // Revert UI state if update fails
      setNotificationsEnabled(notificationsEnabled);
      Alert.alert('Error', 'Failed to update notification preferences');
    }
  };

  return (
    <ScreenBackground>
      <ScrollView style={styles.container}>
        <BlurView intensity={85} tint="light" style={styles.blurContainer}>
          <Surface style={[styles.profileSection, styles.translucentSurface]}>
            {isEditing ? (
              <View style={styles.editContainer}>
                <TextInput
                  label="Display Name"
                  value={displayName}
                  onChangeText={setDisplayName}
                  style={styles.input}
                />
                <View style={styles.editActions}>
                  <Button 
                    mode="contained" 
                    onPress={handleSaveProfile}
                    style={styles.saveButton}
                  >
                    Save
                  </Button>
                  <Button 
                    mode="outlined" 
                    onPress={() => setIsEditing(false)}
                    style={styles.cancelButton}
                  >
                    Cancel
                  </Button>
                </View>
              </View>
            ) : (
              <View style={styles.profileInfo}>
                <View style={styles.nameContainer}>
                  <Text style={styles.displayName}>{displayName || 'Anonymous User'}</Text>
                  <IconButton 
                    icon="pencil" 
                    size={20} 
                    onPress={() => setIsEditing(true)} 
                  />
                </View>
                <Text style={styles.email}>{user?.email}</Text>
              </View>
            )}
          </Surface>

          <Surface style={[styles.section, styles.translucentSurface]}>
            <Text style={styles.sectionTitle}>Notifications</Text>
            <View style={styles.settingRow}>
              <Text>Receive Notifications</Text>
              <Switch value={notificationsEnabled} onValueChange={toggleNotifications} />
            </View>
          </Surface>

          <Surface style={[styles.section, styles.translucentSurface]}>
            <Text style={styles.sectionTitle}>Account</Text>
            <Button 
              mode="contained" 
              onPress={handleLogout} 
              style={styles.logoutButton}
              icon="logout"
            >
              Log Out
            </Button>
          </Surface>

          <Surface style={[styles.section, styles.translucentSurface]}>
            <Text style={styles.sectionTitle}>Balance</Text>
            <View style={styles.balanceContainer}>
              <Text style={styles.balanceLabel}>Current Balance: </Text>
              <BalanceDisplay showLabel={false} showRefreshButton={true} />
            </View>
          </Surface>

          <Surface style={[styles.section, styles.translucentSurface]}>
            <Text style={styles.sectionTitle}>Advanced</Text>
            <Button 
              mode="contained-tonal" 
              onPress={() => navigation.navigate('SystemOptimization')} 
              style={styles.advancedButton}
              icon="tune"
            >
              System Optimization
            </Button>
          </Surface>

          <View style={styles.versionContainer}>
            <Text style={styles.versionText}>Version 1.0.0</Text>
          </View>
        </BlurView>
      </ScrollView>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  blurContainer: {
    flex: 1,
    padding: 10,
  },
  profileSection: {
    margin: 20,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  translucentSurface: {
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderColor: 'rgba(255, 255, 255, 0.8)',
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  profileInfo: {
    alignItems: 'center',
    width: '100%',
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  displayName: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  email: {
    fontSize: 16,
    color: '#666',
    marginTop: 8,
  },
  editContainer: {
    width: '100%',
  },
  input: {
    marginBottom: 16,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  saveButton: {
    flex: 1,
    marginRight: 8,
  },
  cancelButton: {
    flex: 1,
    marginLeft: 8,
  },
  section: {
    margin: 20,
    padding: 20,
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  logoutButton: {
    backgroundColor: '#F44336',
  },
  versionContainer: {
    padding: 16,
    alignItems: 'center',
  },
  versionText: {
    color: '#999',
  },
  balanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  balanceLabel: {
    fontSize: 16,
    marginRight: 8,
  },
  advancedButton: {
    backgroundColor: '#2196F3',
  },
});

export default SettingsScreen; 