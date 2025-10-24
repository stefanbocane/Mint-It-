import { signOut, updateProfile } from 'firebase/auth';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, IconButton, Surface, Text, TextInput, useTheme } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import { auth } from '../config/firebase';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import { batchUpdateWithCache } from '../utils/dbOptimizationUtils';

const SettingsScreen = ({ navigation }) => {
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const theme = useTheme();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [isEditing, setIsEditing] = useState(false);

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

  const handleBackToSocialHub = () => {
    navigation.navigate('SocialHub');
  };

  const handleViewTerms = () => {
    navigation.navigate('TermsAndConditions');
  };

  const handleViewPrivacy = () => {
    navigation.navigate('PrivacyPolicy');
  };

  return (
    <ScreenBackground>
      <Appbar.Header style={[styles.header, { backgroundColor: theme.colors.surface }]}>
        <Appbar.BackAction 
          onPress={handleBackToSocialHub} 
          iconColor={theme.colors.primary}
        />
        <Appbar.Content title="Settings" titleStyle={{ color: theme.colors.onSurface }} />
      </Appbar.Header>
      
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>Profile</Text>
          {isEditing ? (
            <View style={styles.editContainer}>
              <TextInput
                label="Display Name"
                value={displayName}
                onChangeText={setDisplayName}
                style={styles.input}
                mode="outlined"
              />
              <View style={styles.editActions}>
                <Button 
                  mode="contained" 
                  onPress={handleSaveProfile}
                  style={styles.actionButton}
                >
                  Save
                </Button>
                <Button 
                  mode="outlined" 
                  onPress={() => setIsEditing(false)}
                  style={styles.actionButton}
                >
                  Cancel
                </Button>
              </View>
            </View>
          ) : (
            <View style={styles.profileInfo}>
              <View style={styles.nameContainer}>
                <Text style={[styles.displayName, { color: theme.colors.onSurface }]}>
                  {displayName || 'Anonymous User'}
                </Text>
                <IconButton 
                  icon="pencil" 
                  size={20} 
                  onPress={() => setIsEditing(true)} 
                  iconColor={theme.colors.primary}
                />
              </View>
              <Text style={[styles.email, { color: theme.colors.onSurfaceVariant }]}>
                {user?.email}
              </Text>
            </View>
          )}
        </Surface>

        <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>Legal</Text>
          <Button 
            mode="contained-tonal" 
            onPress={handleViewTerms} 
            style={styles.actionButton}
            icon="file-document-outline"
          >
            Terms & Conditions
          </Button>
          <Button 
            mode="contained-tonal" 
            onPress={handleViewPrivacy} 
            style={[styles.actionButton, styles.buttonSpacing]}
            icon="shield-account-outline"
          >
            Privacy Policy
          </Button>
        </Surface>

        <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>Account</Text>
          <Button 
            mode="contained" 
            onPress={handleLogout} 
            style={[styles.actionButton, { backgroundColor: theme.colors.error }]}
            icon="logout"
            textColor={theme.colors.onError}
          >
            Log Out
          </Button>
        </Surface>

        <View style={styles.versionContainer}>
          <Text style={[styles.versionText, { color: theme.colors.onSurfaceVariant }]}>
            Version 1.0.0
          </Text>
        </View>
      </ScrollView>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  header: {
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  section: {
    padding: 20,
    borderRadius: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
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
    fontSize: 20,
    fontWeight: 'bold',
  },
  email: {
    fontSize: 16,
  },
  editContainer: {
    width: '100%',
  },
  input: {
    marginBottom: 16,
  },
  editActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
  },
  buttonSpacing: {
    marginTop: 12,
  },
  versionContainer: {
    padding: 16,
    alignItems: 'center',
  },
  versionText: {
    fontSize: 14,
  },
});

export default SettingsScreen; 