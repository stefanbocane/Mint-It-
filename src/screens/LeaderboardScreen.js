import React, { useState, useEffect } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, List, Avatar } from 'react-native-paper';
import { db } from '../firebase';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';

const LeaderboardScreen = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLeaderboard();
  }, []);

  const loadLeaderboard = async () => {
    try {
      const usersQuery = query(
        collection(db, 'users'),
        orderBy('coinBalance', 'desc'),
        limit(20)
      );
      const querySnapshot = await getDocs(usersQuery);
      const topUsers = querySnapshot.docs.map((doc, index) => ({
        id: doc.id,
        rank: index + 1,
        ...doc.data()
      }));
      setUsers(topUsers);
    } catch (error) {
      console.error('Error loading leaderboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderUser = ({ item }) => (
    <List.Item
      title={item.displayName || item.email}
      description={`${item.coinBalance} coins`}
      left={props => (
        <View style={styles.rankContainer}>
          <Text style={styles.rankText}>{item.rank}</Text>
        </View>
      )}
      right={props => (
        <Avatar.Text
          size={40}
          label={item.displayName?.charAt(0) || item.email.charAt(0)}
        />
      )}
      style={styles.userItem}
    />
  );

  return (
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>Leaderboard</Text>
      
      <FlatList
        data={users}
        renderItem={renderUser}
        keyExtractor={item => item.id}
        refreshing={loading}
        onRefresh={loadLeaderboard}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  title: {
    textAlign: 'center',
    marginBottom: 20,
  },
  userItem: {
    backgroundColor: '#fff',
    marginBottom: 5,
    borderRadius: 10,
    elevation: 2,
  },
  rankContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6200ee',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  rankText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default LeaderboardScreen; 