import { addDoc, collection, doc, setDoc } from 'firebase/firestore';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar, Button, HelperText, Switch, Text, TextInput, useTheme } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import { handleOneTimeInitialCoinAward } from '../utils/balanceUtils';
import { checkGroupMembershipLimit } from '../utils/cardLimits';

const CreateGroupScreen = ({ navigation }) => {
  const { user } = useAuth();
  const { refreshGroups, switchGroup } = useGroup();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreateGroup = async () => {
    if (!user || !user.uid) {
      setError('You must be logged in to create a group.');
      return;
    }
    if (!name.trim()) {
      setError('Group name is required');
      return;
    }

    try {
      setLoading(true);
      setError('');

      // Check group membership limit first
      const limitCheck = await checkGroupMembershipLimit(user.uid);
      if (!limitCheck.canJoin) {
        setError(`You have reached the maximum of ${limitCheck.limit} groups. You are currently in ${limitCheck.currentCount} groups.`);
        return;
      }

      // Create the group document
      const groupRef = await addDoc(collection(db, 'groups'), {
        name: name.trim(),
        description: description.trim(),
        isPrivate,
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
        memberCount: 1,
        members: [user.uid],
        code: name.trim().toLowerCase() // Set the group code to be the lowercase group name
      });

      // Add the creator as an admin in the members subcollection
      await setDoc(doc(db, 'groups', groupRef.id, 'members', user.uid), {
        role: 'admin',
        joinedAt: new Date().toISOString()
      });

      // Award initial coins using the robust utility
      const coinResult = await handleOneTimeInitialCoinAward(user.uid, groupRef.id, 100);
      console.log('Initial coin award result:', coinResult);

      // Refresh groups and switch to the new group
      await refreshGroups();
      const newGroup = {
        id: groupRef.id,
        name: name.trim(),
        description: description.trim(),
        isPrivate,
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
        memberCount: 1,
        members: [user.uid],
        code: name.trim().toLowerCase()
      };
      switchGroup(newGroup);

      navigation.goBack();
    } catch (error) {
      console.error('Error creating group:', error);
      setError('Failed to create group. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <Appbar.Header style={styles.header}>
          <Appbar.BackAction 
            onPress={() => navigation.goBack()} 
            iconColor={theme.colors.primary}
          />
          <Appbar.Content 
            title="Create Group" 
            titleStyle={{ color: theme.colors.text }}
          />
        </Appbar.Header>

        <View style={styles.content}>
          <TextInput
            label="Group Name"
            value={name}
            onChangeText={setName}
            style={styles.input}
            error={!!error && !name.trim()}
          />

          <TextInput
            label="Description"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            style={styles.input}
          />

          <View style={styles.switchContainer}>
            <Text>Private Group</Text>
            <Switch
              value={isPrivate}
              onValueChange={setIsPrivate}
            />
          </View>

          <HelperText type="info" visible={isPrivate}>
            Private groups require approval to join
          </HelperText>

          {error ? (
            <HelperText type="error" visible={!!error}>
              {error}
            </HelperText>
          ) : null}

          <Button
            mode="contained"
            onPress={handleCreateGroup}
            loading={loading}
            disabled={loading || !name.trim()}
            style={styles.button}
          >
            Create Group
          </Button>
        </View>
      </View>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: 100,
  },
  input: {
    marginBottom: 16,
  },
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  button: {
    marginTop: 16,
  },
  header: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    elevation: 2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
});

export default CreateGroupScreen; 