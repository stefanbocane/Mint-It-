import { useNavigation } from '@react-navigation/native';
import { addDoc, arrayRemove, arrayUnion, collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, IconButton, Modal, Portal, Text, TextInput } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useBalance } from '../contexts/BalanceContext';
import { useGroup } from '../contexts/GroupContext';
import { useTheme } from '../contexts/ThemeContext';

const SocialScreen = () => {
  const [activeTab, setActiveTab] = useState('groups');
  const [groups, setGroups] = useState([]);
  const [createGroupModal, setCreateGroupModal] = useState(false);
  const [joinGroupModal, setJoinGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupPassword, setNewGroupPassword] = useState('');
  const [joinGroupName, setJoinGroupName] = useState('');
  const [joinGroupPassword, setJoinGroupPassword] = useState('');
  const [dailyClaimLoading, setDailyClaimLoading] = useState(false);
  const [lastClaimTimes, setLastClaimTimes] = useState({});
  const { user, logout } = useAuth();
  const { currentGroup, setCurrentGroup } = useGroup();
  const { addCoins } = useBalance();
  const { theme } = useTheme();
  const navigation = useNavigation();

  // Check if the user can claim daily coins
  const checkLastClaimTimes = async () => {
    if (!user) return;
    
    try {
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        setLastClaimTimes(userData.lastDailyClaim || {});
      }
    } catch (error) {
      console.error('Error checking last claim times:', error);
    }
  };
  
  const canClaimDailyCoins = (groupId) => {
    if (!groupId || !lastClaimTimes[groupId]) return true;
    
    const lastClaim = new Date(lastClaimTimes[groupId]);
    const now = new Date();
    const hoursSinceLastClaim = (now - lastClaim) / (1000 * 60 * 60);
    
    return hoursSinceLastClaim >= 24;
  };
  
  const claimDailyCoins = async () => {
    if (!user || !currentGroup) {
      Alert.alert('Error', 'You need to select a group first');
      return;
    }
    
    try {
      setDailyClaimLoading(true);
      
      if (!canClaimDailyCoins(currentGroup.id)) {
        const lastClaim = new Date(lastClaimTimes[currentGroup.id]);
        const nextClaim = new Date(lastClaim.getTime() + 24 * 60 * 60 * 1000);
        const timeRemaining = nextClaim - new Date();
        const hoursRemaining = Math.ceil(timeRemaining / (1000 * 60 * 60));
        
        Alert.alert(
          'Already Claimed',
          `You've already claimed your daily coins for this group. You can claim again in ${hoursRemaining} hours.`
        );
        setDailyClaimLoading(false);
        return;
      }
      
      // Add the coins
      const success = await addCoins(50);
      
      if (success) {
        // Update the last claim time
        const userRef = doc(db, 'users', user.uid);
        const updatedClaimTimes = {
          ...lastClaimTimes,
          [currentGroup.id]: new Date().toISOString()
        };
        
        await updateDoc(userRef, {
          lastDailyClaim: updatedClaimTimes
        });
        
        setLastClaimTimes(updatedClaimTimes);
        
        Alert.alert('Success', 'You claimed 50 coins!');
      } else {
        Alert.alert('Error', 'Failed to claim daily coins');
      }
    } catch (error) {
      console.error('Error claiming daily coins:', error);
      Alert.alert('Error', 'Something went wrong');
    } finally {
      setDailyClaimLoading(false);
    }
  };

  const fetchGroups = async () => {
    if (!user) return;
    
    try {
      const groupsRef = collection(db, 'groups');
      const q = query(
        groupsRef,
        where('members', 'array-contains', user.uid)
      );
      
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot || !querySnapshot.docs) {
        console.error('Empty or invalid snapshot received when fetching groups');
        setGroups([]);
        return;
      }
      
      const groupsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      setGroups(groupsData);
    } catch (error) {
      console.error('Error fetching groups:', error);
    }
  };

  useEffect(() => {
    if (user) {
      fetchGroups();
      checkLastClaimTimes();
    }
  }, [user]);

  const createGroup = async () => {
    if (!newGroupName || !newGroupPassword || !user) return;

    try {
      const groupRef = await addDoc(collection(db, 'groups'), {
        name: newGroupName,
        password: newGroupPassword,
        ownerId: user.uid,
        members: [user.uid],
        createdAt: new Date().toISOString(),
      });

      // Update user's groups array
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        groups: arrayUnion(groupRef.id)
      });

      setCreateGroupModal(false);
      setNewGroupName('');
      setNewGroupPassword('');
      fetchGroups();
    } catch (error) {
      console.error('Error creating group:', error);
    }
  };

  const joinGroup = async () => {
    if (!joinGroupName || !joinGroupPassword || !user) return;

    try {
      const groupsRef = collection(db, 'groups');
      const q = query(
        groupsRef,
        where('name', '==', joinGroupName),
        where('password', '==', joinGroupPassword)
      );
      
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) {
        alert('Invalid group name or password');
        return;
      }

      const groupDoc = querySnapshot.docs[0];
      const groupData = groupDoc.data();

      // Update group members
      const groupRef = doc(db, 'groups', groupDoc.id);
      await updateDoc(groupRef, {
        members: arrayUnion(user.uid)
      });

      // Update user's groups array
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        groups: arrayUnion(groupDoc.id)
      });

      setJoinGroupModal(false);
      setJoinGroupName('');
      setJoinGroupPassword('');
      fetchGroups();
    } catch (error) {
      console.error('Error joining group:', error);
    }
  };

  const leaveGroup = async (groupId) => {
    if (!user) return;
    
    try {
      // Update group members
      const groupRef = doc(db, 'groups', groupId);
      await updateDoc(groupRef, {
        members: arrayRemove(user.uid)
      });

      // Update user's groups array
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        groups: arrayRemove(groupId)
      });

      if (currentGroup?.id === groupId) {
        setCurrentGroup(null);
      }

      fetchGroups();
    } catch (error) {
      console.error('Error leaving group:', error);
    }
  };

  const handleSignIn = () => {
    // The AuthGuard will automatically redirect to Login when logout() is called
    logout();
  };

  const renderGroups = () => {
    // If not logged in, show login prompt
    if (!user) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.modalTitle}>Please sign in to access social features</Text>
          <Button
            mode="contained"
            onPress={handleSignIn}
            style={styles.loginButton}
          >
            Sign In
          </Button>
        </View>
      );
    }
    
    return (
      <ScrollView style={styles.container}>
        <View style={styles.buttonContainer}>
          <Button
            mode="contained"
            onPress={() => setCreateGroupModal(true)}
            style={styles.button}
          >
            Create Group
          </Button>
          <Button
            mode="contained"
            onPress={() => setJoinGroupModal(true)}
            style={styles.button}
          >
            Join Group
          </Button>
        </View>

        {currentGroup && (
          <Card style={styles.dailyClaimCard}>
            <Card.Content>
              <Text style={styles.dailyClaimTitle}>Daily Reward</Text>
              <Text style={styles.dailyClaimDescription}>
                Claim 50 coins for free every 24 hours in each group!
              </Text>
            </Card.Content>
            <Card.Actions style={styles.dailyClaimActions}>
              <Button
                mode="contained"
                onPress={claimDailyCoins}
                loading={dailyClaimLoading}
                disabled={dailyClaimLoading || !canClaimDailyCoins(currentGroup?.id)}
                style={[
                  styles.dailyClaimButton,
                  !canClaimDailyCoins(currentGroup?.id) && styles.dailyClaimButtonDisabled
                ]}
                icon="currency-usd"
              >
                {canClaimDailyCoins(currentGroup?.id) ? 'Claim 50 Coins' : 'Already Claimed'}
              </Button>
            </Card.Actions>
          </Card>
        )}

        {groups.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text>You haven't joined any groups yet.</Text>
            <Text>Create a new group or join an existing one.</Text>
          </View>
        ) : (
          groups.map(group => (
            <Card key={group.id} style={styles.groupCard}>
              <Card.Content>
                <Text style={styles.groupName}>{group.name}</Text>
                <Text>Owner: {group.ownerId === user.uid ? 'You' : 'Someone else'}</Text>
                <Text>Members: {group.members.length}</Text>
                {group.id === currentGroup?.id && (
                  <Text style={styles.currentGroup}>Current Group</Text>
                )}
              </Card.Content>
              <Card.Actions>
                {group.id !== currentGroup?.id && (
                  <Button onPress={() => setCurrentGroup(group)}>Select</Button>
                )}
                <Button onPress={() => leaveGroup(group.id)}>Leave</Button>
              </Card.Actions>
            </Card>
          ))
        )}
      </ScrollView>
    );
  };

  const navigateToLeaderboard = () => {
    navigation.navigate('Leaderboard');
  };

  const navigateToSettings = () => {
    navigation.navigate('Settings');
  };

  const navigateToStore = () => {
    navigation.navigate('Store');
  };

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <View style={styles.tabContainer}>
          <IconButton
            icon="account-group"
            size={24}
            mode={activeTab === 'groups' ? 'contained' : 'outlined'}
            onPress={() => setActiveTab('groups')}
            iconColor={activeTab === 'groups' ? 'white' : theme.colors.primary}
            containerColor={activeTab === 'groups' ? theme.colors.primary : 'transparent'}
            style={styles.iconButton}
          />
          <IconButton
            icon="trophy"
            size={24}
            mode="outlined"
            onPress={navigateToLeaderboard}
            iconColor={theme.colors.primary}
            style={styles.iconButton}
          />
          <IconButton
            icon="store"
            size={24}
            mode="outlined"
            onPress={navigateToStore}
            iconColor={theme.colors.primary}
            style={styles.iconButton}
          />
          <IconButton
            icon="cog"
            size={24}
            mode="outlined"
            onPress={navigateToSettings}
            iconColor={theme.colors.primary}
            style={styles.iconButton}
          />
        </View>

        {renderGroups()}

        {user && (
          <Portal>
            <Modal
              visible={createGroupModal}
              onDismiss={() => setCreateGroupModal(false)}
              contentContainerStyle={styles.modal}
            >
              <Text style={styles.modalTitle}>Create New Group</Text>
              <TextInput
                label="Group Name"
                value={newGroupName}
                onChangeText={setNewGroupName}
                style={styles.input}
              />
              <TextInput
                label="Group Password"
                value={newGroupPassword}
                onChangeText={setNewGroupPassword}
                secureTextEntry
                style={styles.input}
              />
              <Button
                mode="contained"
                onPress={createGroup}
                disabled={!newGroupName || !newGroupPassword}
                style={styles.modalButton}
              >
                Create Group
              </Button>
            </Modal>

            <Modal
              visible={joinGroupModal}
              onDismiss={() => setJoinGroupModal(false)}
              contentContainerStyle={styles.modal}
            >
              <Text style={styles.modalTitle}>Join Group</Text>
              <TextInput
                label="Group Name"
                value={joinGroupName}
                onChangeText={setJoinGroupName}
                style={styles.input}
              />
              <TextInput
                label="Group Password"
                value={joinGroupPassword}
                onChangeText={setJoinGroupPassword}
                secureTextEntry
                style={styles.input}
              />
              <Button
                mode="contained"
                onPress={joinGroup}
                disabled={!joinGroupName || !joinGroupPassword}
                style={styles.modalButton}
              >
                Join Group
              </Button>
            </Modal>
          </Portal>
        )}
      </View>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  tabContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'space-around',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  iconButton: {
    margin: 5,
  },
  buttonContainer: {
    flexDirection: 'row',
    padding: 16,
  },
  button: {
    flex: 1,
    marginHorizontal: 8,
  },
  groupCard: {
    margin: 16,
  },
  groupName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  currentGroup: {
    color: '#4CAF50',
    fontWeight: 'bold',
    marginTop: 8,
  },
  modal: {
    backgroundColor: 'white',
    padding: 20,
    margin: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  input: {
    marginBottom: 16,
  },
  modalButton: {
    backgroundColor: '#4CAF50',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loginButton: {
    marginTop: 16,
    width: '50%',
    alignSelf: 'center',
  },
  dailyClaimCard: {
    margin: 16,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 8,
    elevation: 2,
  },
  dailyClaimTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  dailyClaimDescription: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  dailyClaimActions: {
    justifyContent: 'center',
    padding: 8,
  },
  dailyClaimButton: {
    width: '80%',
    backgroundColor: '#4CAF50',
  },
  dailyClaimButtonDisabled: {
    backgroundColor: '#9E9E9E',
  },
});

export default SocialScreen; 