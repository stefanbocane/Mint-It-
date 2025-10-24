import { useNavigation } from '@react-navigation/native';
import { collection, doc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar, Button, Card, HelperText, Text, TextInput, useTheme } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGroup } from '../contexts/GroupContext';
import CacheService from '../services/caching/CacheService';
import { handleOneTimeInitialCoinAward } from '../utils/balanceUtils';
import { checkGroupMembershipLimit } from '../utils/cardLimits';

const JoinGroupScreen = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { refreshGroups, switchGroup } = useGroup();
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const groupsQuery = query(
        collection(db, 'groups'),
        where('isPrivate', '==', false)
      );
      const snapshot = await getDocs(groupsQuery);
      const groupsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setGroups(groupsData);
    } catch (error) {
      console.error('Error fetching groups:', error);
      setError('Failed to load groups');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGroup = async () => {
    if (!user || !user.uid) {
      setError('You must be logged in to join a group.');
      return;
    }
    if (!code.trim()) {
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

      // Find the group by name
      const groupsRef = collection(db, 'groups');
      const q = query(groupsRef, where('name', '==', code.trim()));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        setError('Invalid group name');
        return;
      }

      const groupDoc = querySnapshot.docs[0];
      const groupData = groupDoc.data();

      // Check if user is already a member using cache
      const memberData = await CacheService.getDocument(`groups/${groupDoc.id}/members`, user.uid, { ttl: 60 * 1000 });

      if (memberData) {
        setError('You are already a member of this group');
        return;
      }

      // Add user to group members
      const memberRef = doc(db, 'groups', groupDoc.id, 'members', user.uid);
      await setDoc(memberRef, {
        role: 'member',
        joinedAt: new Date().toISOString()
      });

      // Update group member count
      await updateDoc(doc(db, 'groups', groupDoc.id), {
        memberCount: groupData.memberCount + 1,
        members: [...(groupData.members || []), user.uid]
      });

      // Invalidate relevant caches
      await CacheService.invalidate(`groups/${groupDoc.id}/members:${user.uid}`);
      await CacheService.invalidate(`groups:${groupDoc.id}`);

      // Award initial coins using the robust utility
      const coinResult = await handleOneTimeInitialCoinAward(user.uid, groupDoc.id, 100);
      console.log('Initial coin award result:', coinResult);
      
      // Refresh the groups list and switch to the new group
      await refreshGroups();
      const updatedGroup = { id: groupDoc.id, ...groupData };
      switchGroup(updatedGroup);
      
      navigation.goBack();
    } catch (error) {
      console.error('Error joining group:', error);
      setError('Failed to join group. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const filteredGroups = groups.filter(group =>
    group.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderGroup = ({ item }) => (
    <Card style={styles.groupCard}>
      <Card.Content>
        <Text variant="titleMedium">{item.name}</Text>
        <Text variant="bodyMedium" style={styles.description}>
          {item.description}
        </Text>
        <Text variant="bodySmall" style={styles.memberCount}>
          {item.memberCount || 0} members
        </Text>
      </Card.Content>
      <Card.Actions>
        <Button
          mode="contained"
          onPress={() => {
            setCode(item.name);
            handleJoinGroup();
          }}
        >
          Join Group
        </Button>
      </Card.Actions>
    </Card>
  );

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <Appbar.Header style={styles.header}>
          <Appbar.BackAction 
            onPress={() => navigation.goBack()} 
            iconColor={theme.colors.primary}
          />
          <Appbar.Content 
            title="Join Group" 
            titleStyle={{ color: theme.colors.text }}
          />
        </Appbar.Header>

        <View style={styles.content}>
          <TextInput
            label="Group Name"
            value={code}
            onChangeText={setCode}
            style={styles.input}
            error={!!error}
            placeholder="Enter the exact group name to join"
          />

          {error ? (
            <HelperText type="error" visible={!!error}>
              {error}
            </HelperText>
          ) : null}

          <Button
            mode="contained"
            onPress={handleJoinGroup}
            loading={loading}
            disabled={loading || !code.trim()}
            style={styles.button}
          >
            Join Group
          </Button>

          <Text variant="titleMedium" style={styles.sectionTitle}>
            Available Groups
          </Text>

          <TextInput
            placeholder="Search groups..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchInput}
          />

          {filteredGroups.map(group => (
            <Card key={group.id} style={styles.groupCard}>
              <Card.Content>
                <Text variant="titleMedium">{group.name}</Text>
                <Text variant="bodyMedium" style={styles.description}>
                  {group.description}
                </Text>
                <Text variant="bodySmall" style={styles.memberCount}>
                  {group.memberCount || 0} members
                </Text>
              </Card.Content>
              <Card.Actions>
                <Button
                  mode="contained"
                  onPress={() => {
                    setCode(group.name);
                    handleJoinGroup();
                  }}
                >
                  Join Group
                </Button>
              </Card.Actions>
            </Card>
          ))}

          {loading && (
            <Text style={styles.loadingText}>Loading groups...</Text>
          )}

          {!loading && filteredGroups.length === 0 && (
            <Text style={styles.emptyText}>No groups found</Text>
          )}
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
    padding: 16,
  },
  input: {
    marginBottom: 16,
  },
  button: {
    marginTop: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    marginBottom: 16,
    fontWeight: 'bold',
  },
  searchInput: {
    marginBottom: 16,
  },
  groupCard: {
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  description: {
    marginTop: 4,
    marginBottom: 8,
  },
  memberCount: {
    opacity: 0.7,
  },
  loadingText: {
    textAlign: 'center',
    marginTop: 20,
    opacity: 0.7,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 20,
    opacity: 0.7,
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

export default JoinGroupScreen; 