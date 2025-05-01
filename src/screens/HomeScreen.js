import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Card, IconButton, Modal, Portal, Text } from 'react-native-paper';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

const HomeScreen = () => {
  const navigation = useNavigation();
  const { user, signOut } = useAuth();
  const [showUserInfo, setShowUserInfo] = useState(false);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.Content title="Cardmates" />
        <IconButton icon="account" onPress={() => setShowUserInfo(true)} />
        <IconButton icon="logout" onPress={handleSignOut} />
      </Appbar.Header>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <Card style={styles.balanceCard}>
          <Card.Content>
            <Text variant="titleLarge">Welcome back!</Text>
            <Text variant="bodyLarge">Your balance: {user?.coinBalance || 0} coins</Text>
          </Card.Content>
        </Card>

        <View style={styles.buttonGrid}>
          <Button
            mode="contained"
            icon="plus-circle"
            style={styles.button}
            onPress={() => navigation.navigate('Mint')}
          >
            Mint New Card
          </Button>

          <Button
            mode="contained"
            icon="swap-horizontal"
            style={styles.button}
            onPress={() => navigation.navigate('Trade')}
          >
            Trade Cards
          </Button>

          <Button
            mode="contained"
            icon="gavel"
            style={styles.button}
            onPress={() => navigation.navigate('Auction')}
          >
            Auction House
          </Button>

          <Button
            mode="contained"
            icon="trophy"
            style={styles.button}
            onPress={() => navigation.navigate('Leaderboard')}
          >
            Leaderboard
          </Button>

          <Button
            mode="outlined"
            onPress={() => navigation.navigate('UsersDebug')}
            style={{ marginTop: 16 }}
          >
            Debug: View Users
          </Button>
        </View>
      </ScrollView>

      <Portal>
        <Modal
          visible={showUserInfo}
          onDismiss={() => setShowUserInfo(false)}
          contentContainerStyle={styles.modal}
        >
          <Text variant="titleLarge" style={styles.modalTitle}>User Information</Text>
          <View style={styles.userInfo}>
            <Text variant="bodyLarge">Email: {user?.email}</Text>
            <Text variant="bodyLarge">User ID: {user?.uid}</Text>
            <Text variant="bodyLarge">Display Name: {user?.displayName || 'Not set'}</Text>
            <Text variant="bodyLarge">Coin Balance: {user?.coinBalance || 0}</Text>
          </View>
          <Button
            mode="contained"
            onPress={() => setShowUserInfo(false)}
            style={styles.closeButton}
          >
            Close
          </Button>
        </Modal>
      </Portal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  balanceCard: {
    marginBottom: 20,
  },
  buttonGrid: {
    gap: 12,
  },
  button: {
    marginVertical: 6,
  },
  modal: {
    backgroundColor: 'white',
    padding: 20,
    margin: 20,
    borderRadius: 8,
  },
  modalTitle: {
    textAlign: 'center',
    marginBottom: 20,
  },
  userInfo: {
    gap: 10,
    marginBottom: 20,
  },
  closeButton: {
    marginTop: 10,
  },
});

export default HomeScreen; 