import { BlurView } from 'expo-blur';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, IconButton, Surface, Text, TextInput, useTheme } from 'react-native-paper';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import { supabase } from '../config/supabase';
import CacheService from '../services/caching/CacheService';

const SettingsContent = ({ navigation }) => {
  const { user, signOut: contextSignOut } = useAuth();
  const { currentGroup } = useGroup();
  const theme = useTheme();
  const [displayName, setDisplayName] = useState(user?.display_name || user?.displayName || '');
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load user preferences when component mounts
  useEffect(() => {
    const loadUserPreferences = async () => {
      if (!user?.id) return;

      try {
        setLoading(true);

        // Try cache first
        const cacheKey = `user_profile_${user.id}`;
        const cached = await CacheService.getValue(cacheKey);

        if (cached) {
          setDisplayName(cached.display_name || cached.username || '');
          console.log('User preferences loaded from cache');
          setLoading(false);
          return;
        }

        // Fetch from Supabase
        const { data: userData, error } = await supabase
          .from('users')
          .select('display_name, username')
          .eq('id', user.id)
          .single();

        if (error) {
          console.error('Error loading user preferences:', error);
        } else if (userData) {
          setDisplayName(userData.display_name || userData.username || '');

          // Cache for 10 minutes
          await CacheService.setValue(cacheKey, userData, { ttl: 10 * 60 * 1000 });
        }
      } catch (error) {
        console.error('Error loading user preferences:', error);
      } finally {
        setLoading(false);
      }
    };

    loadUserPreferences();
  }, [user?.id]);

  const handleLogout = async () => {
    try {
      if (contextSignOut) {
        await contextSignOut();
      } else {
        // Fallback to direct Supabase signOut
        await supabase.auth.signOut();
      }
    } catch (error) {
      console.error('Error signing out:', error);
      Alert.alert('Error', 'Failed to sign out. Please try again.');
    }
  };

  const handleSaveProfile = async () => {
    if (!user?.id) return;

    try {
      const trimmedName = displayName.trim();

      if (!trimmedName) {
        Alert.alert('Error', 'Display name cannot be empty.');
        return;
      }

      console.log(`💾 Saving display name for user ${user.id}: "${trimmedName}"`);

      // Update Supabase users table
      const { error } = await supabase
        .from('users')
        .update({
          display_name: trimmedName,
          username: trimmedName,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (error) {
        console.error('Error updating profile:', error);
        Alert.alert('Error', 'Failed to update profile. Please try again.');
        return;
      }

      console.log('✅ Display name saved successfully');

      // Invalidate relevant caches
      await CacheService.invalidate(`user_profile_${user.id}`);
      await CacheService.invalidate(`unified_user_${user.id}`);

      setIsEditing(false);
      Alert.alert('Success', 'Your profile has been updated.');
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    }
  };

  const handleViewTerms = () => {
    navigation.navigate('TermsAndConditions');
  };

  const handleViewPrivacy = () => {
    navigation.navigate('PrivacyPolicy');
  };

  return (
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
          <Text style={styles.sectionTitle}>Legal</Text>
          <Button 
            mode="contained-tonal" 
            onPress={handleViewTerms} 
            style={styles.legalButton}
            icon="file-document-outline"
          >
            Terms & Conditions
          </Button>
          <Button 
            mode="contained-tonal" 
            onPress={handleViewPrivacy} 
            style={[styles.legalButton, styles.legalButtonSpacing]}
            icon="shield-account-outline"
          >
            Privacy Policy
          </Button>
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

        <View style={styles.versionContainer}>
          <Text style={styles.versionText}>Version 1.0.0</Text>
        </View>
      </BlurView>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  blurContainer: {
    flex: 1,
    padding: 16,
  },
  profileSection: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
  },
  translucentSurface: {
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  editContainer: {
    width: '100%',
  },
  input: {
    marginBottom: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  saveButton: {
    flex: 1,
  },
  cancelButton: {
    flex: 1,
  },
  profileInfo: {
    alignItems: 'center',
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  displayName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginRight: 8,
  },
  email: {
    fontSize: 16,
    opacity: 0.7,
  },
  section: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  legalButton: {
    marginBottom: 8,
  },
  legalButtonSpacing: {
    marginTop: 8,
  },
  logoutButton: {
    backgroundColor: '#f44336',
  },
  versionContainer: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  versionText: {
    fontSize: 12,
    opacity: 0.5,
  },
});

export default SettingsContent; 