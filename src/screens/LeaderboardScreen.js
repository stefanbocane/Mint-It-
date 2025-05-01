import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Appbar, List, Text } from 'react-native-paper';
import { db } from '../config/firebase';

const LeaderboardScreen = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation();

  useEffect(() => {
    fetchTopUsers();
  }, []);

  const fetchTopUsers = async () => {
    try {
      const usersQuery = query(
        collection(db, 'users'),
        orderBy('coinBalance', 'desc'),
        limit(20)
      );
      const snapshot = await getDocs(usersQuery);
      const topUsers = snapshot.docs.map((doc, index) => ({
        id: doc.id,
        rank: index + 1,
        ...doc.data()
      }));
      setUsers(topUsers);
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
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
          <Text style={styles.rank}>{item.rank}</Text>
        </View>
      )}
      right={props => (
        <View style={styles.coinContainer}>
          <Text style={styles.coins}>{item.coinBalance}</Text>
        </View>
      )}
      style={styles.userItem}
    />
  );

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => navigation.navigate('Home')} />
        <Appbar.Content title="Leaderboard" />
      </Appbar.Header>
      <Text style={styles.title}>Top Collectors</Text>
      {loading ? (
        <ActivityIndicator size="large" />
      ) : (
        <FlatList
          data={users}
          renderItem={renderUser}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 20,
  },
  list: {
    padding: 10,
  },
  userItem: {
    backgroundColor: 'white',
    marginBottom: 5,
    borderRadius: 5,
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
  rank: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  coinContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingRight: 10,
  },
  coins: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#6200ee',
  },
});

export default LeaderboardScreen; 